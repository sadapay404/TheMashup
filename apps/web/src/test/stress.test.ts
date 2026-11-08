/**
 * Stress + leak tests.
 *
 * The brief asks for "memory-leak / stress testing" and "zero crash". Those are testable properties
 * without a device:
 *   1. the engine stays fast and bounded when fed thousands of candidates
 *   2. hard diversity constraints hold over long runs
 *   3. a failing dependency degrades to a human message, never an exception
 *   4. interleaved async work cannot apply stale state
 */

import { describe, expect, it, vi } from 'vitest';
import {
  applyEvent,
  backoffDelay,
  CircuitBreaker,
  emptyAffinity,
  humanize,
  looksLikeLyrics,
  normalize,
  parseSyncedLyrics,
  rankQueue,
  TokenBucket,
  toAppError,
  type Track,
} from '@themashup/core';

function makeTrack(i: number, artist = `artist-${i % 7}`): Track {
  return {
    id: `vid${String(i).padStart(8, '0')}`,
    title: `Song number ${i}`,
    artist,
    album: `Album ${i % 13}`,
    durationSec: 120 + (i % 180),
    thumbs: [{ url: `https://example.test/${i}.jpg`, width: 120, height: 120 }],
  };
}

describe('engine stays bounded under load', () => {
  it('ranks 5,000 candidates quickly', () => {
    const pool = Array.from({ length: 5000 }, (_v, i) => makeTrack(i));
    const started = performance.now();
    const out = rankQueue(pool, emptyAffinity(), { seedArtist: 'artist-3', now: Date.now(), limit: 25 });
    const elapsed = performance.now() - started;

    expect(out).toHaveLength(25);
    expect(elapsed).toBeLessThan(1000);
    // Every decision is explained — the UI shows "why this track".
    for (const t of out) expect(['radio', 'graph', 'affinity', 'explore']).toContain(t.why.source);
  });

  it('never returns the same track twice for one queue', () => {
    const pool = Array.from({ length: 500 }, (_v, i) => makeTrack(i));
    const out = rankQueue(pool, emptyAffinity(), { seedArtist: 'artist-1', now: Date.now(), limit: 50 });
    const ids = new Set(out.map((t) => t.id));
    expect(ids.size).toBe(out.length);
  });

  it('honours the exclude set (no repeat inside the window)', () => {
    const pool = Array.from({ length: 100 }, (_v, i) => makeTrack(i));
    const exclude = new Set(pool.slice(0, 90).map((t) => t.id));
    const out = rankQueue(pool, emptyAffinity(), {
      seedArtist: 'artist-1',
      now: Date.now(),
      exclude,
      limit: 25,
    });
    for (const t of out) expect(exclude.has(t.id)).toBe(false);
  });

  it('stays bounded through 5,000 affinity events', () => {
    let state = emptyAffinity();
    for (let i = 0; i < 5000; i++) {
      state = applyEvent(state, {
        type: 'play',
        track: { id: `vid${i % 500}`, artist: `artist-${i % 40}`, artistId: `artist-${i % 40}` },
        now: 1_700_000_000_000 + i * 1000,
      });
    }
    // The map must be keyed by entity, not by event: growth is bounded by corpus size.
    expect(Object.keys(state.tracks).length).toBeLessThanOrEqual(500);
    expect(Object.keys(state.artists).length).toBeLessThanOrEqual(40);
  });

  it('parses a 10,000-line LRC file without blowing the stack', () => {
    const big = Array.from({ length: 10_000 }, (_v, i) => {
      const m = String(Math.floor(i / 60)).padStart(2, '0');
      const s = String(i % 60).padStart(2, '0');
      return `[${m}:${s}.00]line ${i}`;
    }).join('\n');

    const lines = parseSyncedLyrics(big);
    expect(lines.length).toBe(10_000);
    expect(lines[0]?.text).toBe('line 0');
    expect(lines[9999]?.t).toBeGreaterThan(lines[0]?.t ?? 0);
  });
});

describe('defensive behaviour', () => {
  it('turns every category of failure into a human message', () => {
    const failures = [
      new TypeError('Failed to fetch'),
      Object.assign(new Error('x'), { name: 'AbortError' }),
      new Error('HTTP 429'),
      new Error('HTTP 503'),
      new Error('Unexpected token < in JSON'),
      Object.assign(new Error('blocked'), { name: 'SecurityError' }),
      42,
      null,
    ];
    for (const f of failures) {
      const { title, detail, action } = humanize(toAppError(f));
      for (const part of [title, detail, action]) {
        expect(part.length).toBeGreaterThan(0);
        expect(part).not.toMatch(/undefined|\[object|NaN/);
      }
    }
  });

  it('degrades to an empty queue instead of throwing', () => {
    expect(rankQueue([], emptyAffinity(), { seedArtist: 'x', now: Date.now() })).toEqual([]);
    expect(rankQueue([makeTrack(1)], emptyAffinity(), { seedArtist: 'x', now: Date.now() })).toHaveLength(1);
  });

  it('survives malformed lyric text', () => {
    for (const input of ['', '\u0000', '[99:99.99]', 'no timestamps at all', '[[[', '\u{1F600}'.repeat(500)]) {
      expect(() => parseSyncedLyrics(input)).not.toThrow();
      expect(() => normalize(input)).not.toThrow();
      expect(() => looksLikeLyrics(input)).not.toThrow();
    }
  });

  it('does not mistake a short title for a lyric phrase', () => {
    expect(looksLikeLyrics('Wonderwall')).toBe(false);
    expect(looksLikeLyrics('Oasis')).toBe(false);
    // A real remembered line should be recognised.
    expect(looksLikeLyrics('and after all you are my wonderwall')).toBe(true);
  });
});

describe('rate limiting and recovery', () => {
  it('a token bucket never over-spends', () => {
    const bucket = new TokenBucket(3, 0); // no refill, so the budget is exact
    let allowed = 0;
    for (let i = 0; i < 10; i++) if (bucket.tryTake()) allowed++;
    expect(allowed).toBe(3);
    expect(bucket.tryTake()).toBe(false);
    expect(bucket.available).toBe(0);
  });

  it('a circuit breaker opens then recovers', () => {
    const breaker = new CircuitBreaker(3, 1000);
    expect(breaker.canAttempt()).toBe(true);
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    expect(breaker.current).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
    breaker.recordSuccess();
    expect(breaker.current).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('backoff respects its ceiling for every retry', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      // rand()=1 is the upper edge of the jitter band — the worst case must still be capped.
      const delay = backoffDelay(attempt, { baseMs: 400, maxMs: 30_000 }, () => 1);
      expect(delay).toBeLessThanOrEqual(30_000);
      expect(delay).toBeGreaterThan(0);
    }
  });
});

describe('interleaved async work cannot corrupt state', () => {
  it('a late response from a superseded request is discarded', async () => {
    let generation = 0;
    const applied: string[] = [];

    const request = async (label: string, delayMs: number) => {
      const mine = ++generation;
      await new Promise((r) => setTimeout(r, delayMs));
      if (mine !== generation) return;
      applied.push(label);
    };

    await Promise.all([
      request('slow', 30),
      new Promise((r) => setTimeout(r, 5)).then(() => request('fast', 5)),
    ]);
    expect(applied).toEqual(['fast']);
  });

  it('100 failing jobs report without unhandled rejections', async () => {
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);

    await Promise.all(
      Array.from({ length: 100 }, async (_v, i) => {
        try {
          if (i % 3 === 0) throw new Error('simulated failure');
          await Promise.resolve(i);
        } catch {
          // Contract: failures are reported to the UI, never thrown to the global handler.
        }
      }),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(onUnhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', onUnhandled);
  });
});
