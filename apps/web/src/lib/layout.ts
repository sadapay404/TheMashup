/**
 * Bottom-stack geometry.
 *
 * The dock and the song card are two fixed-position layers that must agree about where they sit.
 * They used to be positioned independently — the card wrapper in App.tsx, the dock in SmartDock —
 * and the result was a card pinned near the bottom of the screen sliding underneath a dock that
 * had floated 92px up out of its way. On a tall phone that reads as the card hanging in mid-air and
 * the dock detached from it.
 *
 * One module owns the numbers. Both components read from here, so they cannot drift apart again,
 * and the relationship is stated once instead of being implied by two magic constants.
 *
 * Layout, from the bottom edge upward:
 *
 *     ┌─────────────────────────────┐
 *     │  dock      (floats)         │  ← dockBottom()
 *     ├─────────────────────────────┤  ← cardTop()
 *     │  song card (sits below)     │
 *     └─────────────────────────────┘  ← cardBottom()
 */

/** Space below the dock, above the safe area. */
const DOCK_BASE = 10;

/** Height of one dock item. The pill adds `DOCK_PADDING * 2` around it. */
export const DOCK_ITEM_H = 52;
export const DOCK_PADDING = 6;
export const DOCK_H = DOCK_ITEM_H + DOCK_PADDING * 2;

/** Height of the collapsed song card. */
export const CARD_H = 66;

/** Gap between the dock's bottom edge and the top of the card. */
export const DOCK_CARD_GAP = 10;

/** Space between the card's bottom edge and the safe area. */
const CARD_BASE = 8;

/** `bottom` for the dock: above the safe area while nothing is playing, unchanged when compact. */
export function dockBottom(compact: boolean): string {
  return `calc(env(safe-area-inset-bottom) + ${compact ? DOCK_BASE : DOCK_BASE}px)`;
}

/** `bottom` for the song card. */
export function cardBottom(): string {
  return `calc(env(safe-area-inset-bottom) + ${CARD_BASE}px)`;
}

/**
 * `bottom` for the dock when the card is showing.
 *
 * The card occupies the bottom of the screen, so the dock clears it: card height plus gap, measured
 * from the same base the card uses.
 */
export function dockBottomOverCard(): string {
  return `calc(env(safe-area-inset-bottom) + ${CARD_BASE + CARD_H + DOCK_CARD_GAP}px)`;
}

/**
 * Bottom padding content needs so nothing hides behind the stack.
 *
 * Used by every screen's scroll container. A screen that does not reserve this has its last row
 * permanently behind the dock — which is the other half of what "the UI is broken" looked like.
 */
export function contentBottom(compact: boolean): string {
  const stack = compact ? CARD_BASE + CARD_H + DOCK_CARD_GAP + DOCK_H : DOCK_BASE + DOCK_H;
  return `calc(env(safe-area-inset-bottom) + ${stack + 20}px)`;
}
