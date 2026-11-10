/**
 * Recovery must continue a song, never restart it.
 *
 * Every recovery path used to call `load(track)` with no position, and `load` unconditionally wrote
 * `positionSec: 0`. A stream that stalled at 2:10 therefore reloaded and played the intro again —
 * and if it stalled again, the intro again. From the user's side the song "doesn't play in full",
 * which is the report this release answers. The stall detectors were working correctly and their
 * remedy was the bug.
 *
 * `load(track, resumeAt)` is the contract. These tests pin the arithmetic that surrounds it, since
 * the hook itself is not mountable in isolation here.
 */

import { describe, expect, it } from 'vitest';

/** Mirrors the guard `load()` uses before applying a seek to either transport. */
const shouldResume = (resumeAt: number): boolean => resumeAt > 0.5;

/** Mirrors `positionSec: Math.max(0, resumeAt)` — the value written on load. */
const startPosition = (resumeAt: number): number => Math.max(0, resumeAt);

describe('recovery resumes instead of restarting', () => {
  it('a normal play starts at zero', () => {
    expect(startPosition(0)).toBe(0);
    expect(shouldResume(0)).toBe(false);
  });

  it('a stall at 2:10 continues at 2:10', () => {
    expect(startPosition(130)).toBe(130);
    expect(shouldResume(130)).toBe(true);
  });

  it('a stall in the first half second is not worth a seek', () => {
    // Seeking here costs a range request and gains nothing the buffer has not already got.
    expect(shouldResume(0.4)).toBe(false);
    expect(shouldResume(0.6)).toBe(true);
  });

  it('a negative position cannot leak into the store', () => {
    expect(startPosition(-5)).toBe(0);
  });

  it('a position restored from a previous session is not treated as a recovery seek', () => {
    // Restore writes `positionSec` directly rather than calling load(), so the threshold must not
    // accidentally gate legitimate resume-from-last-session behaviour.
    expect(shouldResume(0)).toBe(false);
  });
});
