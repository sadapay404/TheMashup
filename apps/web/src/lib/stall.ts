/**
 * Stall detection for transports whose position is polled rather than evented.
 *
 * The <audio> element tells us directly when it last made progress (`timeupdate`). Media3 does not:
 * the native player is sampled through `getState` once a second. Without an equivalent watchdog the
 * native path either never recovers from a genuine stall, or — if it falls back to the element's
 * timestamp, which never advances in native mode — "recovers" from a healthy stream every few
 * seconds and restarts the song. Both failure modes were real.
 *
 * The rule is deliberately simple: a position that stops changing for longer than the threshold is
 * stuck. Any movement resets the clock, so a stream that buffers (position frozen) and then resumes
 * is not mistaken for a stall.
 */
export class StallDetector {
  private position = -1;
  private at: number;

  constructor(
    private readonly thresholdMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.at = now();
  }

  /**
   * Feed the current position. Returns true exactly once per stall: the caller resets the window so
   * a repeated reload is not attempted until another full threshold elapses.
   */
  check(positionSec: number): boolean {
    if (positionSec !== this.position) {
      this.reset(positionSec);
      return false;
    }
    return this.now() - this.at > this.thresholdMs;
  }

  /** Restart the window at a known position (used after acting on a stall). */
  reset(positionSec: number): void {
    this.position = positionSec;
    this.at = this.now();
  }
}
