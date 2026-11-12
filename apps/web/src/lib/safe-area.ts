/**
 * Real system-bar geometry, measured on the device.
 *
 * ## Why this is not just `env(safe-area-inset-top)`
 *
 * The app draws edge-to-edge. `env()` is the standards answer for keeping content out of the system
 * bars, and it is what the CSS uses as a baseline — but it is only populated when the host turns on
 * viewport-fit inset propagation, and Capacitor's WebView does not on the user's device. The result was
 * `0px` on a phone with a punch-hole camera, and the app's title rendered under the clock and the
 * battery. That is the collision the user reported.
 *
 * So the shell measures the window it is actually drawing in and publishes the numbers as CSS custom
 * properties. `styles/tokens.css` uses `max(env(...), 28px)` as the pre-measurement fallback, which is
 * a good guess for every device we have seen; this replaces the guess with the truth.
 *
 * Values are written to `document.documentElement.style` as `--safe-t` / `--safe-b` (and their left /
 * right siblings) so every screen that already reads those tokens picks them up on the next paint with
 * no re-render and no prop threading.
 *
 * ## Failure behaviour
 *
 * Silent. On the web build there is no plugin; on a device whose insets arrive as zeros before layout,
 * the call is retried after the first frame. Nothing here can block a first paint.
 */

import { isNative } from './native';

interface UiPluginRef {
  insets?: () => Promise<unknown>;
}

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** False when the window had not been laid out yet — the caller should retry once. */
  reliable: boolean;
}

function plugin(): UiPluginRef | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return (cap?.Plugins?.MashupUi as UiPluginRef | undefined) ?? null;
}

/**
 * Publish the device's insets into CSS.
 *
 * Idempotent and cheap, so it can be called on boot, on resize (rotation changes the top inset on a
 * notched phone in landscape) and on resume.
 */
export async function syncSafeArea(): Promise<boolean> {
  const p = plugin();
  if (!p || !isNative()) return false;

  const read = async (): Promise<Insets | null> => {
    try {
      const res = (await p.insets?.()) as Partial<Insets> | undefined;
      if (!res) return null;
      return {
        top: Number(res.top ?? 0),
        bottom: Number(res.bottom ?? 0),
        left: Number(res.left ?? 0),
        right: Number(res.right ?? 0),
        reliable: Boolean(res.reliable),
      };
    } catch {
      return null;
    }
  };

  let insets = await read();
  if (!insets) return false;
  if (!insets.reliable) {
    // One frame is all the layout needs; anything more is a device that will never report and the
    // CSS fallback is correct there.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    insets = (await read()) ?? insets;
  }

  const root = document.documentElement;
  /*
   * Only ever raise a value, never lower it to zero.
   *
   * `--safe-b: env(safe-area-inset-bottom)` is usually 0 in this WebView too, and there is no
   * `max()`-on-a-custom-property trick that would work for a property already assigned — so the
   * merging happens here, in JS, with the CSS fallback as the floor.
   */
  const raise = (name: string, px: number, floor = 0) => {
    const usepx = Math.max(px, floor);
    if (usepx > 0) root.style.setProperty(name, `${usepx.toFixed(2)}px`);
  };
  raise('--safe-t', insets.top);
  raise('--safe-b', insets.bottom);
  raise('--safe-l', insets.left);
  raise('--safe-r', insets.right);
  return insets.top > 0;
}

/**
 * Wire the measurement to the lifecycle events that can change it.
 *
 * Returns a cleanup function. Called once from the app shell.
 */
export function watchSafeArea(): () => void {
  let disposed = false;
  const run = () => {
    if (!disposed) void syncSafeArea();
  };
  run();
  window.addEventListener('resize', run);
  window.addEventListener('orientationchange', run);
  document.addEventListener('resume', run);
  return () => {
    disposed = true;
    window.removeEventListener('resize', run);
    window.removeEventListener('orientationchange', run);
    document.removeEventListener('resume', run);
  };
}
