/**
 * A working player must never be mistaken for a stalled one.
 *
 * This is the regression that cost a release. Two halves, and the second only happened because of
 * the first:
 *
 *   1. Kotlin — `PlaybackBridge` cached the position and refreshed it only from a `Player.Listener`
 *      on playback-state / is-playing / discontinuity / transition events. A track playing
 *      normally fires none of those, so `getState()` returned `positionMs = 0` for the whole song.
 *      That half is Kotlin and is verified by the build, not here.
 *
 *   2. JS — the native stall detector treated "position never changed" as a stall. With the
 *      position pinned at 0 it could never change, so a few seconds into every track it declared a
 *      stall and the recovery reloaded the stream. The user saw "Playback stalled, continuing from
 *      here" followed by the song restarting, while the audio had been fine the entire time.
 *
 * The invariant: a position of 0 while playing means "no measurement", never "stuck at the start".
 */

import { describe, expect, it } from 'vitest';
import { StallDetector } from '../lib/stall';

/** Mirrors the guard at the native branch of the watchdog in `usePlayer.ts`. */
const shouldFeedNativeStall = (positionSec: number): boolean => positionSec > 0;

describe('native position is not a stall signal when it is missing', () => {
  it('zero is never fed to the detector', () => {
    expect(shouldFeedNativeStall(0)).toBe(false);
  });

  it('any real position is fed', () => {
    expect(shouldFeedNativeStall(0.5)).toBe(true);
    expect(shouldFeedNativeStall(12)).toBe(true);
  });

  it('a detector fed zeros would have reported a stall — the bug, demonstrated', () => {
    // This is what the old code did: feed 0 every second and wait.
    let now = 0;
    const d = new StallDetector(8000, () => now);
    expect(d.check(0)).toBe(false); // first reading establishes the window
    now = 9000;
    expect(d.check(0)).toBe(true); // 9 s of "no movement" -> stall declared, recovery restarts
  });

  it('a detector fed real movement never fires', () => {
    let now = 0;
    const d = new StallDetector(8000, () => now);
    for (let sec = 1; sec <= 120; sec += 1) {
      now += 1000;
      expect(d.check(sec)).toBe(false);
    }
  });

  it('a genuine stall after real movement still fires', () => {
    // The guard must not disable the detector for a real problem.
    let now = 0;
    const d = new StallDetector(8000, () => now);
    d.check(30);
    now = 10_000;
    expect(d.check(30)).toBe(true);
  });
});
