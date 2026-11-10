/**
 * A stack of dismissable overlays, so hardware back knows what to close.
 *
 * The bug this exists to prevent: the "add to playlist / queue" sheet had no way out on Android.
 * The app-level back handler knew about the player and the lyrics face, and nothing else — so back
 * skipped straight past any other sheet and navigated away underneath it, leaving it on screen.
 * On a phone with no Escape key and no visible close affordance in reach, that reads as a trap.
 *
 * The contract is deliberately tiny and ordering-based: an overlay pushes its own `close` when it
 * mounts and removes it when it unmounts. Back pops the most recently opened one. Nothing has to
 * know about anything else, and two sheets stacked on top of each other unwind in the right order.
 */

type Dismiss = () => void;

const stack: Dismiss[] = [];

/** Register a dismissable overlay. Returns the unregister function for cleanup. */
export function pushOverlay(dismiss: Dismiss): () => void {
  stack.push(dismiss);
  return () => {
    const at = stack.lastIndexOf(dismiss);
    if (at >= 0) stack.splice(at, 1);
  };
}

/** Dismiss the most recently opened overlay. Returns false when nothing was open. */
export function dismissTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  stack.pop();
  top();
  return true;
}

/** How many overlays are currently open. Exposed for tests and for the back handler's ordering. */
export function overlayCount(): number {
  return stack.length;
}

/** Drop everything. Used by tests so one case cannot leak into the next. */
export function clearOverlays(): void {
  stack.length = 0;
}
