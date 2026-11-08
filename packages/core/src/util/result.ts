/**
 * Result<T, E> — ADR-003.
 *
 * Nothing in `packages/core` throws across a module boundary. Failures are values, so every caller
 * is forced by the type system to consider them, and no async rejection can escape unhandled.
 */

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type AppError =
  | { k: 'Network'; retryable: true; cause: 'offline' | 'timeout' | 'dns' | 'reset' | 'unknown'; message: string }
  | { k: 'Cors'; retryable: true; message: string }
  | { k: 'Upstream'; retryable: boolean; endpoint: string; status: number; message: string }
  | { k: 'Parse'; retryable: false; endpoint: string; message: string }
  | { k: 'Auth'; retryable: false; reason: 'expired' | 'missing' | 'revoked'; message: string }
  | { k: 'Playability'; retryable: false; status: string; message: string }
  | { k: 'Storage'; retryable: false; reason: 'quota' | 'denied' | 'corrupt'; message: string }
  | { k: 'Capability'; retryable: false; missing: string; message: string }
  | { k: 'Cancelled'; retryable: false; message: string }
  | { k: 'Unknown'; retryable: false; fingerprint: string; message: string };

/** Every error carries a sentence a human can act on. No stack traces in the UI. */
export function humanize(e: AppError): { title: string; detail: string; action: string } {
  switch (e.k) {
    case 'Network':
      return {
        title: e.cause === 'offline' ? "You're offline" : 'Connection problem',
        detail: e.message,
        action: e.cause === 'offline' ? 'Showing cached content' : 'Retry',
      };
    case 'Cors':
      return { title: 'Request blocked', detail: e.message, action: 'Try another route' };
    case 'Upstream':
      return { title: `Source returned ${e.status}`, detail: e.message, action: e.retryable ? 'Retry' : 'Go back' };
    case 'Parse':
      return { title: 'Unexpected response', detail: e.message, action: 'Retry' };
    case 'Auth':
      return { title: 'Sign-in needed', detail: e.message, action: 'Open settings' };
    case 'Playability':
      return { title: 'Not playable', detail: e.message, action: 'Try another result' };
    case 'Storage':
      return { title: 'Storage problem', detail: e.message, action: 'Free up space' };
    case 'Capability':
      return { title: 'Not supported here', detail: e.message, action: 'Dismiss' };
    case 'Cancelled':
      return { title: 'Cancelled', detail: e.message, action: 'Dismiss' };
    case 'Unknown':
      return { title: 'Something went wrong', detail: `Ref ${e.fingerprint}`, action: 'Retry' };
  }
}

/** Convert an unknown thrown value into AppError. The only place `catch (e: unknown)` is parsed. */
export function toAppError(e: unknown, endpoint = 'unknown'): AppError {
  if (typeof e === 'object' && e !== null && 'k' in e) return e as AppError;
  if (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') {
    return { k: 'Cancelled', retryable: false, message: 'Request cancelled' };
  }
  if (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'TimeoutError') {
    return { k: 'Network', retryable: true, cause: 'timeout', message: 'The request timed out' };
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return {
      k: 'Cors',
      retryable: true,
      message: 'The browser blocked this request (CORS) or the network dropped.',
    };
  }
  return {
    k: 'Unknown',
    retryable: false,
    fingerprint: shortHash(`${endpoint}:${message}`),
    message,
  };
}

export function shortHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(7, '0').slice(0, 7);
}

/** Compose: run f, map errors. Keeps call sites linear without try/catch noise. */
export async function attempt<T>(f: () => Promise<T>, endpoint = 'unknown'): Promise<Result<T>> {
  try {
    return ok(await f());
  } catch (e) {
    return err(toAppError(e, endpoint));
  }
}

export function unwrapOr<T>(r: Result<T>, fallback: T): T {
  return r.ok ? r.value : fallback;
}
