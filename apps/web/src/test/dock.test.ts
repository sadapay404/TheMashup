import { describe, expect, it } from 'vitest';

/**
 * The dock's collapse rules, extracted as pure constants so the behaviour can be asserted without a
 * DOM. These numbers are the whole spec:
 *   - hold to open, and it stays open while the thumb is down
 *   - release on the same page -> 3 s, so a mis-tap does not slam it shut
 *   - release after switching  -> 1.8 s, because the decision is already made
 */
const LONG_PRESS_MS = 320;
const HOLD_SAME_PAGE_MS = 3000;
const HOLD_CHANGED_PAGE_MS = 1800;

function collapseDelay(startedOn: string, endedOn: string): number {
  return startedOn === endedOn ? HOLD_SAME_PAGE_MS : HOLD_CHANGED_PAGE_MS;
}

describe('dock gestures', () => {
  it('long press fires well after a tap would have completed', () => {
    // A tap is ~50-120ms; the hold threshold must be comfortably beyond that.
    expect(LONG_PRESS_MS).toBeGreaterThan(250);
    expect(LONG_PRESS_MS).toBeLessThan(500);
  });

  it('keeps the dock open far longer when the page did not change', () => {
    expect(collapseDelay('home', 'home')).toBe(3000);
  });

  it('collapses sooner after an actual page switch', () => {
    expect(collapseDelay('home', 'search')).toBe(1800);
    expect(HOLD_CHANGED_PAGE_MS).toBeLessThan(HOLD_SAME_PAGE_MS);
  });

  it('both delays give the user time to see what happened', () => {
    // Anything under ~1.2s reads as an involuntary snap rather than a deliberate collapse.
    expect(HOLD_CHANGED_PAGE_MS).toBeGreaterThanOrEqual(1200);
  });
});
