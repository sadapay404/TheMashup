/**
 * Haptics.
 *
 * One vocabulary of named events, so behaviour is consistent and reviewable — rather than each
 * component inventing its own vibration pattern. Two backends:
 *
 *   1. **Native (Android)** — the Capacitor WebView exposes `navigator.vibrate`, which the WebView
 *      maps onto the platform vibrator. This is the real path for the shipped app.
 *   2. **Web** — most desktop browsers ignore `vibrate()` entirely and Chrome refuses it before a
 *      user gesture. It is called anyway, wrapped, because a no-op is the correct outcome there.
 *
 * Every event is individually controllable (Settings → Haptics). Forced vibration on every tap is
 * genuinely irritating, so the defaults are conservative: primary actions and state changes buzz,
 * incidental scrolling and hover do not.
 */

export type HapticEvent =
  | 'tap'
  | 'press'
  | 'success'
  | 'error'
  | 'toggle'
  | 'navigation'
  | 'player'
  | 'queue'
  | 'download'
  | 'seek'
  | 'scroll'
  | 'longPress';

/** How each event feels. `ms` arrays are [vibrate, pause, vibrate, …] as the Vibration API expects. */
export const HAPTIC_EVENTS: Array<{
  id: HapticEvent;
  label: string;
  detail: string;
  pattern: number | number[];
  /** Off by default where vibrating would be noise. */
  defaultOn: boolean;
}> = [
  { id: 'tap', label: 'Taps', detail: 'Every button press', pattern: 8, defaultOn: true },
  { id: 'press', label: 'Press feedback', detail: 'Scale-down of a card or row', pattern: 5, defaultOn: true },
  { id: 'toggle', label: 'Switches', detail: 'Toggles, chips and filters', pattern: [6, 24, 10], defaultOn: true },
  { id: 'navigation', label: 'Page changes', detail: 'Switching between Home, Search, Library, Settings', pattern: 12, defaultOn: true },
  { id: 'player', label: 'Play / pause', detail: 'Transport changes and track starts', pattern: [10, 30, 18], defaultOn: true },
  { id: 'queue', label: 'Queue actions', detail: 'Adding, removing or reordering', pattern: [8, 20, 8], defaultOn: true },
  { id: 'download', label: 'Downloads', detail: 'Starting, finishing and failing a download', pattern: [14, 26, 14, 26, 22], defaultOn: true },
  { id: 'success', label: 'Success', detail: 'A completed action', pattern: [9, 32, 16], defaultOn: true },
  { id: 'error', label: 'Errors', detail: 'A failure the user must notice', pattern: [26, 40, 26, 40, 26], defaultOn: true },
  { id: 'seek', label: 'Seeking', detail: 'Detents while dragging the progress bar', pattern: 4, defaultOn: false },
  { id: 'longPress', label: 'Long press', detail: 'Holding an element to reveal more', pattern: [12, 20, 20], defaultOn: true },
  { id: 'scroll', label: 'Scroll edges', detail: 'Hitting the top or bottom of a list', pattern: 6, defaultOn: false },
];

export const DEFAULT_HAPTIC_SETTINGS: Record<HapticEvent, boolean> = Object.fromEntries(
  HAPTIC_EVENTS.map((e) => [e.id, e.defaultOn]),
) as Record<HapticEvent, boolean>;

/**
 * Mutable runtime state.
 *
 * Module-level rather than React context because haptics are called from event handlers all over the
 * app, including outside the component tree, and a missing context must never throw.
 */
let enabled = true;
let settings: Record<HapticEvent, boolean> = { ...DEFAULT_HAPTIC_SETTINGS };

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export function setHapticSettings(next: Record<HapticEvent, boolean>): void {
  settings = { ...next };
}

export function getHapticSettings(): Record<HapticEvent, boolean> {
  return { ...settings };
}

/** True when the platform can actually vibrate. Used to tell the user the truth in Settings. */
export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/**
 * Fire a haptic event. Never throws, never blocks, and silently does nothing when disabled or
 * unsupported — haptics are a garnish, and a garnish must never be able to break an interaction.
 */
export function haptic(event: HapticEvent): void {
  if (!enabled || !settings[event]) return;
  const pattern = HAPTIC_EVENTS.find((e) => e.id === event)?.pattern;
  if (pattern === undefined) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* Some browsers throw on vibrate without a user gesture; irrelevant to the interaction. */
  }
}

/** Preview a single event from the Settings list. Ignores the per-event toggle so it always shows. */
export function previewHaptic(event: HapticEvent): void {
  const pattern = HAPTIC_EVENTS.find((e) => e.id === event)?.pattern;
  if (pattern === undefined) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
