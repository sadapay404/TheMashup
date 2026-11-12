/**
 * Transport chain — ADR-001.
 *
 * Browsers cannot POST to music.youtube.com (no CORS headers). We refuse to run a server, so the
 * chain is: DIRECT (works in Capacitor/Tauri and same-origin setups) → RELAY LADDER (public CORS
 * proxies, user-editable, health-checked).
 *
 * Design rules:
 *  - A relay is never trusted with more than the request body it is given; cookies are only sent
 *    when the user explicitly enables "send credentials via relay" (off by default).
 *  - Failure is a value, never an exception.
 *  - Health state is sticky within a session, and demotion is immediate on failure.
 */

import type { FetchLike, InnerTubeRequest, RawResponse } from '../innertube/client.js';
import type { AppError } from '../util/result.js';
import { err, ok, type Result, toAppError } from '../util/result.js';
import { CircuitBreaker, TokenBucket } from '../policy/retry.js';

/**
 * A native transport, supplied by the host shell (Tauri today).
 *
 * Requests made outside the browser have no origin, so no CORS preflight is involved. When this is
 * present the relay ladder is dead weight and is demoted behind it.
 */
export interface NativeTransport {
  readonly name: string;
  (req: InnerTubeRequest, signal?: AbortSignal): Promise<RawResponse>;
}

export interface TransportOptions {
  /** Preferred when available: no CORS, no third party. */
  native?: NativeTransport;
}

export interface Relay {
  id: string;
  /** Template where `{url}` is the fully-encoded target URL, or `{host}`/`{path}` splits. */
  template: string;
  /** How to send the request body. */
  mode: 'get-url' | 'post-body';
  enabled: boolean;
}

/**
 * Shipped defaults. Two well-known public CORS relays, both editable and health-checked.
 * If they are down the user can paste their own — that is the whole point of the ladder.
 */
export const DEFAULT_RELAYS: Relay[] = [
  {
    id: 'corsproxy.io',
    template: 'https://corsproxy.io/?url={url}',
    mode: 'post-body',
    enabled: true,
  },
  {
    id: 'codetabs',
    template: 'https://api.codetabs.com/v1/proxy?quest={url}',
    mode: 'get-url',
    enabled: true,
  },
];

/** The synthetic route name for the native transport. */
export const NATIVE_ROUTE = 'native';

export interface TransportHealth {
  direct: 'unknown' | 'ok' | 'cors' | 'blocked';
  native: 'unknown' | 'ok' | 'down';
  relays: Record<string, 'unknown' | 'ok' | 'down'>;
  lastRoute?: string | undefined;
}

const TIMEOUT_MS = 12_000;

/**
 * How long a *single* route may take before the chain gives up on it and tries the next.
 *
 * Nine seconds is deliberately below the twelve-second socket timeout: a route that has not answered
 * by then is almost certainly going to fail, and the user is watching a spinner while it decides.
 * Waiting for the full socket timeout on the first route was a large part of "search takes a long
 * time" — the fast route never got a turn.
 */
const ROUTE_TIMEOUT_MS = 6_500;

/**
 * The whole ladder's wall-clock budget.
 *
 * Without this the chain was a sum of worst cases: N routes × 12 s socket timeout, one after
 * another, before it would admit defeat. With four routes that is nearly a minute of a frozen search
 * box on a bad mobile network — and on native the first route (`nativeHttp`) had **no timeout at all**,
 * so a hung socket blocked the entire ladder indefinitely. A search must resolve, success or failure,
 * inside one human attention span.
 */
const CHAIN_BUDGET_MS = 11_000;

/**
 * A deadline for one chain traversal.
 *
 * `expired` is checked between attempts so a slow-but-successful route is still allowed to finish
 * inside its own timeout, while a *sequence* of slow routes stops at the budget instead of adding up.
 */
function deadline(ms: number): { readonly expired: boolean; remaining(): number } {
  const end = Date.now() + ms;
  return {
    get expired() {
      return Date.now() >= end;
    },
    remaining: () => Math.max(0, end - Date.now()),
  };
}

/**
 * Race a promise against a timer.
 *
 * Used for the native route, which is a bridge call into the host shell — there is no `fetch` to
 * abort and no socket the app owns, so the only way to bound it is to stop *waiting* for it. The
 * underlying request may still be in flight; that is fine, it is discarded, and it is strictly
 * better than a UI that never resolves.
 */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return Promise.reject(new Error(`${label}: budget exhausted`));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms} ms`)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, credentials: 'omit', mode: 'cors' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The chain. One instance per session; it remembers which route worked so later calls go straight
 * there instead of re-probing (saves ~1–2 s per navigation on a bad relay).
 */
export class TransportChain {
  health: TransportHealth = { direct: 'unknown', native: 'unknown', relays: {} };
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly buckets = new Map<string, TokenBucket>();
  private preferred: string | undefined;

  constructor(
    private readonly relays: Relay[] = DEFAULT_RELAYS,
    /** When true, sends cookies through relays too. Off by default: a relay operator could read them. */
    private readonly allowCredentialsViaRelay = false,
    private readonly native?: NativeTransport,
  ) {
    for (const r of relays) this.health.relays[r.id] = 'unknown';
  }

  /** True when requests leave through a native socket rather than the browser fetch. */
  get hasNative(): boolean {
    return Boolean(this.native);
  }

  /** The FetchLike the InnerTube client consumes. */
  readonly fetch: FetchLike = async (req, signal) => {
    const bucket = this.bucketFor('global');
    await bucket.take();

    /*
     * An aborted request is a *superseded* one — a keystroke replaced it — not a network fault. It
     * must not spend the ladder, and above all it must not be mistaken for "the network is down".
     */
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const attempts: Array<() => Promise<RawResponse>> = [];
    const order = this.orderedRoutes();

    for (const route of order) {
      const breaker = this.breakerFor(route);
      if (!breaker.canAttempt()) continue;
      attempts.push(() => this.viaRoute(route, req, signal));
    }

    if (!attempts.length) {
      throw { k: 'Network', retryable: true, cause: 'offline', message: 'No route available' } satisfies AppError;
    }

    /*
     * One budget for the whole ladder, not one per route.
     *
     * The previous code awaited each route in turn with the full socket timeout, so a bad network
     * could mean minutes before Search said anything. Now the ladder stops as soon as the budget is
     * gone and reports what it has — a fast honest failure instead of a slow guaranteed one.
     */
    const limit = deadline(CHAIN_BUDGET_MS);
    let lastError: unknown;

    for (const attempt of attempts) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (limit.expired) break;
      try {
        const res = await withTimeout(attempt(), Math.min(ROUTE_TIMEOUT_MS, limit.remaining()), 'route');
        return res;
      } catch (e) {
        // A superseded request stops here: the caller no longer wants this answer.
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        lastError = e;
      }
    }

    throw lastError ?? {
      k: 'Network',
      retryable: true,
      cause: 'timeout',
      message: 'Every route was too slow to answer.',
    } satisfies AppError;
  };

  /** Same chain, but returns a Result instead of throwing (used at UI boundaries). */
  readonly fetchSafe: FetchLike = async (req, signal) => {
    try {
      return await this.fetch(req, signal);
    } catch (e) {
      throw e;
    }
  };

  private orderedRoutes(): string[] {
    const direct = 'direct';
    const relayIds = this.relays.filter((r) => r.enabled).map((r) => r.id);
    // native first (no CORS at all), then same-origin direct, then the relay ladder.
    const all = [...(this.native ? [NATIVE_ROUTE] : []), direct, ...relayIds];
    if (!this.preferred) return all;
    // Preferred first, everything else as fallback (order preserved).
    return [this.preferred, ...all.filter((r) => r !== this.preferred)];
  }

  private async viaRoute(route: string, req: InnerTubeRequest, signal?: AbortSignal): Promise<RawResponse> {
    const breaker = this.breakerFor(route);
    try {
      const res =
        route === NATIVE_ROUTE
          ? await this.viaNative(req, signal)
          : route === 'direct'
            ? await this.direct(req, signal)
            : await this.viaRelay(route, req, signal);
      breaker.recordSuccess();
      this.preferred = route;
      this.health.lastRoute = route;
      if (route === NATIVE_ROUTE) this.health.native = 'ok';
      else if (route === 'direct') this.health.direct = 'ok';
      else this.health.relays[route] = 'ok';
      return res;
    } catch (e) {
      // Only a real transport fault counts against the route. A 403 delivered by YouTube is proof
      // the route works, and counting it here was what locked the app out of its own network.
      if (isRouteFailure(e)) {
        breaker.recordFailure();
        if (route === NATIVE_ROUTE) this.health.native = 'down';
        else if (route === 'direct') this.health.direct = 'cors';
        else this.health.relays[route] = 'down';
        if (this.preferred === route) this.preferred = undefined;
      }
      throw e;
    }
  }

  /** Requests through the host shell: no origin header, so no CORS negotiation. */
  private async viaNative(req: InnerTubeRequest, signal?: AbortSignal): Promise<RawResponse> {
    if (!this.native) {
      // A missing capability, not a network fault: retrying will never help.
      throw { k: 'Capability', retryable: false, missing: 'native-http', message: 'native transport not installed' } satisfies AppError;
    }
    /*
     * The native route is a bridge call with no AbortSignal of its own, and it used to have no
     * timeout — a hung socket on the host side blocked the whole ladder forever, which is the worst
     * possible failure for a search box. Bound it like any other route.
     */
    return withTimeout(this.native(req, signal), ROUTE_TIMEOUT_MS, 'native');
  }

  private async direct(req: InnerTubeRequest, signal?: AbortSignal): Promise<RawResponse> {
    const res = await fetchWithTimeout(
      req.url,
      { method: req.method, headers: req.headers, body: JSON.stringify(req.body) },
      signal,
      ROUTE_TIMEOUT_MS,
    );
    return readResponse(res);
  }

  private async viaRelay(relayId: string, req: InnerTubeRequest, signal?: AbortSignal): Promise<RawResponse> {
    const relay = this.relays.find((r) => r.id === relayId);
    if (!relay) throw { k: 'Capability', retryable: false, missing: relayId, message: 'Relay missing' } satisfies AppError;

    const headers = { ...req.headers };
    if (!this.allowCredentialsViaRelay) delete headers['Cookie'];
    // Relays frequently reject unknown custom headers; keep only what matters.
    const safeHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': headers['X-YouTube-Client-Name'] ?? '',
      'X-YouTube-Client-Version': headers['X-YouTube-Client-Version'] ?? '',
      'x-origin': headers['x-origin'] ?? '',
    };

    if (relay.mode === 'get-url') {
      const target = encodeURIComponent(req.url);
      const url = relay.template.replace('{url}', target);
      const res = await fetchWithTimeout(url, { method: 'GET' }, signal, ROUTE_TIMEOUT_MS);
      return readResponse(res);
    }

    // post-body: the relay takes our JSON body and forwards it to the target URL.
    const url = relay.template.replace('{url}', encodeURIComponent(req.url));
    const res = await fetchWithTimeout(
      url,
      { method: 'POST', headers: safeHeaders, body: JSON.stringify(req.body) },
      signal,
      ROUTE_TIMEOUT_MS,
    );
    return readResponse(res);
  }

  /** Probe all routes; used by the Diagnostics screen and at boot (cheap, one small request each). */
  async probe(baseRequest: InnerTubeRequest): Promise<TransportHealth> {
    const results: TransportHealth = { direct: 'unknown', native: 'unknown', relays: {} };

    if (this.native) {
      try {
        await this.viaNative(baseRequest);
        results.native = 'ok';
      } catch {
        results.native = 'down';
      }
    }

    try {
      await this.direct(baseRequest);
      results.direct = 'ok';
    } catch {
      results.direct = 'cors';
    }
    for (const relay of this.relays.filter((r) => r.enabled)) {
      try {
        await this.viaRelay(relay.id, baseRequest);
        results.relays[relay.id] = 'ok';
      } catch {
        results.relays[relay.id] = 'down';
      }
    }
    this.health = { ...results, ...(this.preferred ? { lastRoute: this.preferred } : {}) };
    return this.health;
  }

  private breakerFor(route: string): CircuitBreaker {
    let b = this.breakers.get(route);
    if (!b) {
      b = new CircuitBreaker(4, 120_000);
      this.breakers.set(route, b);
    }
    return b;
  }

  private bucketFor(key: string): TokenBucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = new TokenBucket(12, 6);
      this.buckets.set(key, b);
    }
    return b;
  }
}

/**
 * Did this failure indicate the *route* is bad, or only that the *request* was rejected?
 *
 * This distinction is the whole difference between a working app and one that reports "no route
 * available" while the network is perfectly healthy.
 *
 * A 400/403 from YouTube is a complete round trip: DNS resolved, TCP connected, TLS negotiated, the
 * request was delivered and YouTube answered. The route is fine. Treating that as a route failure
 * trips the breaker for every subsequent call, and the app then refuses to send anything — which is
 * exactly how a reachable host becomes an app that cannot play.
 *
 * Only 5xx and 429 mean the path itself is unhealthy and worth backing away from for a while.
 */
function isRouteFailure(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return true;
  const err = e as { k?: string; status?: number };
  if (err.k === 'Upstream') return (err.status ?? 0) >= 500 || err.status === 429;
  // A parse error is an upstream payload problem, not a route problem; a playability response is a
  // successful round trip carrying bad news. Neither says anything about the network path.
  if (err.k === 'Parse' || err.k === 'Playability' || err.k === 'Auth' || err.k === 'Cancelled') return false;
  return true;
}

async function readResponse(res: Response): Promise<RawResponse> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw {
      k: 'Upstream',
      retryable: res.status >= 500 || res.status === 429,
      endpoint: '',
      status: res.status,
      message: `Upstream responded ${res.status}`,
    } satisfies AppError;
  }
  if (json === null) {
    throw { k: 'Parse', retryable: false, endpoint: '', message: 'Response was not JSON' } satisfies AppError;
  }
  return { status: res.status, json };
}

/** Helper for the app layer: run a transport call and get a Result. */
export async function safeCall<T>(fn: () => Promise<T>, endpoint: string): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(toAppError(e, endpoint));
  }
}
