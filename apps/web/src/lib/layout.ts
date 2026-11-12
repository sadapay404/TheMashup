/**
 * Screen geometry: the status bar, and the bottom stack.
 *
 * ## The status bar
 *
 * The app draws edge-to-edge (transparent status and navigation bars in `styles.xml`), which is the
 * right choice for a full-bleed dark UI — but it means **the page is responsible for keeping its own
 * content out of the system bars**. Nothing did. The result on the device was the one the user
 * described: the Home title sat under the battery and wifi icons, and the punch-hole camera clipped the
 * first line of every screen.
 *
 * `--safe-t` / `--safe-b` are the CSS safe-area insets. In a WebView those are only non-zero when the
 * host reports them, and Capacitor does not — so a phone with a notch reported 0 and the content slid
 * under the cutout anyway. `topInset()` therefore takes the *maximum* of the CSS inset and a minimum
 * that is always reserved: the status bar is a fixed part of the screen and no app content should ever
 * be allowed to sit in it, whether or not the inset is reported.
 *
 * Every screen reads its top padding from this module. There is no second source of truth.
 *
 * ## The bottom stack
 *
 * The dock and the song card are two fixed-position layers that must agree about where they sit. They
 * used to be positioned independently — the card wrapper in App.tsx, the dock in SmartDock — and the
 * result was a card pinned near the bottom of the screen sliding underneath a dock that had floated
 * 92px up out of its way. On a tall phone that reads as the card hanging in mid-air and the dock
 * detached from it.
 *
 * One module owns the numbers. Both components read from here, so they cannot drift apart again.
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

/**
 * Width of one dock item once the label is gone.
 *
 * The dock is icon-only at the user's request. Width and height are deliberately equal, so each
 * destination is a circle rather than a leftover pill with space where a word used to be — five of
 * them at 52px inside a rounded container reads as one deliberate control, not as a dock that lost
 * its text.
 */
export const DOCK_ITEM_W = 52;

/**
 * The icon itself.
 *
 * Up from 21. The label used to carry about a third of the item's height; with it gone, a 21px glyph
 * in a 52px circle looks like a mistake rather than a choice.
 */
export const DOCK_ICON = 26;
export const DOCK_PADDING = 6;
export const DOCK_H = DOCK_ITEM_H + DOCK_PADDING * 2;

/** Height of the collapsed song card. */
export const CARD_H = 66;

/** Gap between the dock's bottom edge and the top of the card. */
export const DOCK_CARD_GAP = 10;

/** Space between the card's bottom edge and the safe area. */
const CARD_BASE = 8;

/**
 * The status bar, at minimum.
 *
 * 28px is a little over the height of a standard 24dp status bar at 1x, and matches what the system
 * reserves on a device with a notch without reporting an inset. Rounding up is deliberate: a few pixels
 * of extra breathing room is invisible, and a few pixels too few puts text under the clock.
 */
export const STATUS_BAR_MIN = 28;

/**
 * The extra separation between the system bar and app content.
 *
 * A hairline alone is not a separator — the user asked for something that visibly divides the app from
 * the status bar, and this is that: the status bar sits on the page background, then this gap, then the
 * screen's own header. It is what stops the two reading as one crowded band.
 */
export const STATUS_BAR_GAP = 8;

/**
 * Top padding for a screen.
 *
 * `env(safe-area-inset-top)` where the host reports it, otherwise {@link STATUS_BAR_MIN}. `max()` means
 * a device that reports a *larger* inset (a tall notch, landscape cutout) still wins, and one that
 * reports nothing still gets the reserved bar.
 */
export function statusBarTop(): string {
  // `--safe-t` carries the measured inset once `lib/safe-area` has run, and its own CSS fallback
  // (`max(env(...), 28px)`) covers the first frame. Reading the token rather than `env()` is what
  // makes the measurement take effect.
  return 'var(--safe-t)';
}

/** `padding-top` for a scrolling screen's content container. */
export function screenTop(): string {
  return `calc(${statusBarTop()} + ${STATUS_BAR_GAP}px)`;
}

/** `top` for a sticky header that must clear the status bar. */
export function stickyTop(): string {
  return statusBarTop();
}

/**
 * `bottom` for the dock when no card is showing.
 *
 * There used to be a `compact` parameter whose two branches were identical — a parameter that looked
 * like it did something and did not. The compact case is [dockBottomOverCard], which is a different
 * layout, not a different number; the callers already choose between them.
 */
export function dockBottom(): string {
  return `calc(var(--safe-b) + ${DOCK_BASE}px)`;
}

/** `bottom` for the song card. */
export function cardBottom(): string {
  return `calc(var(--safe-b) + ${CARD_BASE}px)`;
}

/**
 * `bottom` for the dock when the card is showing.
 *
 * The card occupies the bottom of the screen, so the dock clears it: card height plus gap, measured
 * from the same base the card uses.
 */
export function dockBottomOverCard(): string {
  return `calc(var(--safe-b) + ${CARD_BASE + CARD_H + DOCK_CARD_GAP}px)`;
}

/**
 * Bottom padding content needs so nothing hides behind the stack.
 *
 * Used by every screen's scroll container. A screen that does not reserve this has its last row
 * permanently behind the dock — which is the other half of what "the UI is broken" looked like.
 */
export function contentBottom(compact: boolean): string {
  const stack = compact ? CARD_BASE + CARD_H + DOCK_CARD_GAP + DOCK_H : DOCK_BASE + DOCK_H;
  return `calc(var(--safe-b) + ${stack + 20}px)`;
}

/**
 * `bottom` for a toast.
 *
 * Above the whole stack, because a toast that lands behind the dock is a message nobody reads. The
 * magic 148 this replaces only cleared the dock, not the song card, so every "Added to queue"
 * notification appeared on top of the card's transport row.
 */
export function toastBottom(hasCard: boolean): string {
  const stack = hasCard ? CARD_BASE + CARD_H + DOCK_CARD_GAP + DOCK_H : DOCK_BASE + DOCK_H;
  return `calc(var(--safe-b) + ${stack + 16}px)`;
}

/** Height of the mini-player/dock row, for surfaces that need to reserve it inline. */
export function stackHeight(compact: boolean): number {
  return compact ? CARD_BASE + CARD_H + DOCK_CARD_GAP + DOCK_H : DOCK_BASE + DOCK_H;
}
