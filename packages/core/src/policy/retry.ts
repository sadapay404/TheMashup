/**
 * Retry, jittered backoff, token buckets and circuit breakers.
 * Small, dependency-free, and deterministic under an injected clock so it is unit-testable.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  jitter?: number;
  maxAttempts?: number;
}

/**
 * Full-jitter exponential backoff, clamped to `maxMs`.
 *
 * The clamp is applied *after* jitter on purpose: clamping first and then multiplying by up to
 * (1 + jitter) can exceed the ceiling (with the defaults, 30 s becomes 33.3 s), which defeats the
 * point of having a ceiling. Verified by the stress suite.
 */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}, rand: () => number = Math.random): number {
  const base = opts.baseMs ?? 400;
  const max = opts.maxMs ?? 30_000;
  const factor = opts.factor ?? 2;
  const jitter = Math.max(0, Math.min(1, opts.jitter ?? 0.3));
  const raw = base * Math.pow(factor, Math.max(0, attempt));
  const jittered = raw * (1 - jitter + 2 * jitter * rand());
  return Math.round(Math.min(max, Math.max(0, jittered)));
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

/** Retry an operation while `shouldRetry` says yes. Never retries a Cancelled error. */
export async function retry<T, E>(
  op: (attempt: number) => Promise<{ ok: true; value: T } | { ok: false; error: E }>,
  shouldRetry: (e: E) => boolean,
  clock: Clock = realClock,
  opts: BackoffOptions = {},
  rand: () => number = Math.random,
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: E; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 4;
  let last: E | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await op(attempt);
    if (res.ok) return { ok: true, value: res.value, attempts: attempt + 1 };
    last = res.error;
    if (!shouldRetry(res.error)) return { ok: false, error: res.error, attempts: attempt + 1 };
    if (attempt < maxAttempts - 1) await clock.sleep(backoffDelay(attempt, opts, rand));
  }
  return { ok: false, error: last as E, attempts: maxAttempts };
}

/** Token bucket: smooth rate limiting so a burst never trips upstream protections. */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly clock: Clock = realClock,
  ) {
    this.tokens = capacity;
    this.lastRefill = clock.now();
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
      this.lastRefill = now;
    }
  }

  tryTake(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /** Wait until a token is available, then take it. */
  async take(n = 1): Promise<void> {
    for (;;) {
      if (this.tryTake(n)) return;
      const deficit = n - this.tokens;
      await this.clock.sleep(Math.max(50, Math.ceil((deficit / this.refillPerSec) * 1000)));
    }
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }
}

export type BreakerState = 'closed' | 'open' | 'half-open';

/**
 * Consecutive-failure breaker. Open for `cooldownMs`, then a single half-open probe decides.
 * Used per (endpoint, profile) so one dead rung of the ladder cannot poison the others.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 300_000,
    private readonly clock: Clock = realClock,
  ) {}

  canAttempt(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open' && this.clock.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half-open';
      return true;
    }
    return this.state === 'half-open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === 'half-open' || this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = this.clock.now();
    }
  }

  get current(): BreakerState {
    return this.state;
  }
}
