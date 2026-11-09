import { describe, expect, it } from 'vitest';
import { StallDetector } from '@/lib/stall';

/**
 * Regression cover for the Android playback restart loop.
 *
 * The native player has no `timeupdate` event, so the watchdog originally compared against a
 * timestamp only the <audio> element ever wrote. In native mode that timestamp froze at load time and
 * the watchdog declared a stall every ~11 s, reloading the track from zero mid-song.
 */
describe('StallDetector', () => {
  const clock = (start = 0) => {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('never reports a stall while the position advances', () => {
    const c = clock();
    const d = new StallDetector(8000, c.now);
    for (let i = 0; i < 30; i++) {
      expect(d.check(i)).toBe(false);
      c.advance(1000);
    }
  });

  it('reports a stall once the position has been frozen past the threshold', () => {
    const c = clock();
    const d = new StallDetector(8000, c.now);
    d.check(5);
    c.advance(5000);
    expect(d.check(5)).toBe(false);
    c.advance(4000);
    expect(d.check(5)).toBe(true);
  });

  it('does not report a stall while buffering within the threshold', () => {
    const c = clock();
    const d = new StallDetector(8000, c.now);
    d.check(5);
    c.advance(7999);
    expect(d.check(5)).toBe(false);
    d.check(6); // resumed
    c.advance(1000);
    expect(d.check(6)).toBe(false);
  });

  it('reset() restarts the window so a reload is not retried immediately', () => {
    const c = clock();
    const d = new StallDetector(8000, c.now);
    d.check(5);
    c.advance(9000);
    expect(d.check(5)).toBe(true);
    d.reset(5);
    c.advance(1000);
    expect(d.check(5)).toBe(false);
  });

  it('treats a position that jumps forward as healthy progress', () => {
    const c = clock();
    const d = new StallDetector(8000, c.now);
    d.check(10);
    c.advance(7000);
    expect(d.check(42)).toBe(false);
  });
});
