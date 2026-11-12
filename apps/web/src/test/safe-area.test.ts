/**
 * The status-bar contract.
 *
 * The bug: the app draws edge-to-edge and nothing reserved the status bar, so the Home title rendered
 * under the clock and the punch-hole camera clipped the first line of every screen. The device also
 * reports no `env(safe-area-inset-top)` — Capacitor's WebView leaves viewport-fit propagation off — so
 * a CSS-only fix would have looked correct in a desktop browser and stayed broken on the phone.
 *
 * These assertions pin the two halves of the fix that a screenshot cannot check: every screen reads its
 * top offset from one function, and that function can never return zero.
 */

import { describe, expect, it } from 'vitest';
import {
  CARD_H,
  DOCK_CARD_GAP,
  DOCK_H,
  STATUS_BAR_MIN,
  cardBottom,
  contentBottom,
  dockBottomOverCard,
  screenTop,
  stackHeight,
  statusBarTop,
  stickyTop,
  toastBottom,
} from '../lib/layout';

/** Pull the numeric px out of `calc(var(--safe-b) + 84px)`. */
const px = (css: string): number => {
  const m = css.match(/(\d+(?:\.\d+)?)px/);
  return m ? Number(m[1]) : NaN;
};

describe('status bar', () => {
  it('reserves a real minimum, not just the host inset', () => {
    // `env()` alone is 0 on the user's device; the minimum is what keeps the title out of the clock.
    expect(STATUS_BAR_MIN).toBeGreaterThanOrEqual(24);
  });

  it('reads the measured token rather than env() directly', () => {
    // Reading `env()` here is what shipped the collision: the WebView reports 0 and the padding
    // collapses. The measured `--safe-t` is written by lib/safe-area after the first layout.
    expect(statusBarTop()).toBe('var(--safe-t)');
  });

  it('adds the separator gap above the content', () => {
    expect(px(screenTop())).toBe(8);
    expect(screenTop()).toContain('var(--safe-t)');
  });

  it('pins the sticky header at the status bar, with no extra gap', () => {
    // The header already carries its own padding; adding the gap twice would leave a visible band of
    // empty backdrop under the bar.
    expect(stickyTop()).toBe(statusBarTop());
  });

  it('never returns a zero inset through any of the screen offsets', () => {
    for (const css of [screenTop(), stickyTop(), statusBarTop()]) {
      expect(css).not.toMatch(/^0/);
    }
  });
});

describe('the bottom stack stays above the safe area', () => {
  it('offsets the dock and card from the measured bottom inset', () => {
    expect(cardBottom()).toContain('var(--safe-b)');
    expect(dockBottomOverCard()).toContain('var(--safe-b)');
    expect(contentBottom(true)).toContain('var(--safe-b)');
    expect(toastBottom(true)).toContain('var(--safe-b)');
  });

  it('places the toast above the dock and the card, not on top of them', () => {
    // The fixed 148px this replaces cleared the dock but not the card, so every "Added to queue"
    // landed across the card's transport buttons.
    expect(px(toastBottom(true))).toBeGreaterThan(stackHeight(true));
    expect(px(toastBottom(false))).toBeGreaterThan(stackHeight(false));
  });

  it('reserves more room when a card is showing', () => {
    expect(stackHeight(true)).toBeGreaterThan(stackHeight(false));
    expect(stackHeight(true)).toBeGreaterThanOrEqual(CARD_H + DOCK_CARD_GAP + DOCK_H);
  });

  it('gives the last list row clearance under the whole stack', () => {
    expect(px(contentBottom(true))).toBeGreaterThan(stackHeight(true));
  });
});
