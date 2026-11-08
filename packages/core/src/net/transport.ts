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

export interface TransportHealth {
  direct: 'unknown' | 'ok' | 'cors' | 'blocked';
  relays: Record<string, 'unknown' | 'ok' | 'down'>;
  lastRoute?: string | undefined;
}

const TIMEOUT_MS = 12_000;

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
  health: TransportHealth = { direct: 'unknown', relays: {} };
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly buckets = new Map<string, TokenBucket>();
  private preferred: string | undefined;

  constructor(
    private readonly relays: Relay[] = DEFAULT_RELAYS,
    /** When true, sends cookies through relays too. Off by default: a relay operator could read them. */
    private readonly allowCredentialsViaRelay = false,
  ) {
    for (const r of relays) this.health.relays[r.id] = 'unknown';
  }

  /** The FetchLike the InnerTube client consumes. */
  readonly fetch: FetchLike = async (req, signal) => {
    const bucket = this.bucketFor('global');
    await bucket.take();

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

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        const res = await attempt();
        return res;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
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
    const all = [direct, ...relayIds];
    if (!this.preferred) return all;
    // Preferred first, everything else as fallback (order preserved).
    return [this.preferred, ...all.filter((r) => r !== this.preferred)];
  }

  private async viaRoute(route: string, req: InnerTubeRequest, signal?: AbortSignal): Promise<RawResponse> {
    const breaker = this.breakerFor(route);
    try {
      const res = route === 'direct' ? await this.direct(req, signal) : await this.viaRelay(route, req, signal);
      breaker.recordSuccess();
      this.preferred = route;
      this.health.lastRoute = route;
      if (route === 'direct') this.health.direct = 'ok';
      else this.health.relays[route] = 'ok';
      return res;
    } catch (e) {
      breaker.recordFailure();
      if (route === 'direct') this.health.direct = 'cors';
      else this.health.relays[route] = 'down';
      if (this.preferred === route) this.preferred = undefined;
      throw e;
    }
  }

  private async direct(req: InnerTubeRequest, signal?: AbortSignal): Promise<RawResponse> {
    const res = await fetchWithTimeout(
      req.url,
      { method: req.method, headers: req.headers, body: JSON.stringify(req.body) },
      signal,
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
      const res = await fetchWithTimeout(url, { method: 'GET' }, signal);
      return readResponse(res);
    }

    // post-body: the relay takes our JSON body and forwards it to the target URL.
    const url = relay.template.replace('{url}', encodeURIComponent(req.url));
    const res = await fetchWithTimeout(
      url,
      { method: 'POST', headers: safeHeaders, body: JSON.stringify(req.body) },
      signal,
    );
    return readResponse(res);
  }

  /** Probe all routes; used by the Diagnostics screen and at boot (cheap, one small request each). */
  async probe(baseRequest: InnerTubeRequest): Promise<TransportHealth> {
    const results: TransportHealth = { direct: 'unknown', relays: {} };
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
