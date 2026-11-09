/**
 * Auto-recovery state persistence.
 *
 * The brief's requirement is "auto-recovery state persistence" — a crash, a reload, an OS kill or a
 * power cut must not lose the queue, the position or the user's settings.
 *
 * Design rules, all of which exist because the naive version of this feature is a footgun:
 *  - **Versioned.** A schema change must not restore incompatible state and crash on boot. Unknown
 *    or older versions are discarded, not guessed at.
 *  - **Validated.** Every field is checked on read. `localStorage` is user-editable and can be
 *    corrupted by an extension or a full disk; a malformed blob must degrade to defaults, never
 *    throw inside a React render.
 *  - **Bounded.** Only what is needed to resume is stored. History and the affinity graph have
 *    their own limits; an unbounded queue would eventually exceed the quota.
 *  - **Quiet.** Every storage call is wrapped: private mode, quota exceeded and disabled storage are
 *    all normal conditions, not errors.
 */

import { emptyAffinity, type AffinityState, type Track } from '@themashup/core';
import type { AppState, RepeatMode, Route } from '@/state/store';

const KEY = 'mashup.state.v1';
const MAX_QUEUE = 200;
const MAX_HISTORY = 120;
/** Throttle: persisting on every 250 ms position tick would be a write per tick. */
const WRITE_INTERVAL_MS = 4000;

export interface PersistedState {
  v: 1;
  savedAt: number;
  route: Route;
  queue: Track[];
  index: number;
  positionSec: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  rate: number;
  history: Track[];
  affinity: AffinityState;
}

const ROUTES: readonly Route[] = ['home', 'search', 'library', 'settings'];
const REPEATS: readonly RepeatMode[] = ['off', 'all', 'one'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isTrack(value: unknown): value is Track {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.title === 'string' &&
    typeof value.artist === 'string' &&
    typeof value.durationSec === 'number' &&
    Number.isFinite(value.durationSec) &&
    Array.isArray(value.thumbs)
  );
}

function tracks(value: unknown, limit: number): Track[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isTrack).slice(0, limit);
}

/** Read and validate. Returns `null` for "nothing usable", never throws. */
export function loadPersisted(): PersistedState | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt blob: drop it so the next save starts clean rather than failing forever.
    clearPersisted();
    return null;
  }

  if (!isRecord(parsed) || parsed['v'] !== 1) return null;

  const queue = tracks(parsed['queue'], MAX_QUEUE);
  const index = Math.trunc(num(parsed['index'], 0, 0, Math.max(0, queue.length - 1)));
  const route = ROUTES.includes(parsed['route'] as Route) ? (parsed['route'] as Route) : 'home';
  const repeat = REPEATS.includes(parsed['repeat'] as RepeatMode) ? (parsed['repeat'] as RepeatMode) : 'off';

  return {
    v: 1,
    savedAt: num(parsed['savedAt'], 0, 0, Number.MAX_SAFE_INTEGER),
    route,
    queue,
    index,
    positionSec: num(parsed['positionSec'], 0, 0, 24 * 3600),
    volume: num(parsed['volume'], 0.85, 0, 1),
    muted: bool(parsed['muted'], false),
    repeat,
    shuffle: bool(parsed['shuffle'], false),
    rate: num(parsed['rate'], 1, 0.5, 2),
    history: tracks(parsed['history'], MAX_HISTORY),
    affinity: isRecord(parsed['affinity']) ? (parsed['affinity'] as unknown as AffinityState) : emptyAffinitySafe(),
  };
}

const emptyAffinitySafe = emptyAffinity;

export function clearPersisted(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Project app state down to what is worth persisting. */
function toPersisted(s: AppState): PersistedState {
  return {
    v: 1,
    savedAt: Date.now(),
    route: s.route,
    queue: s.queue.slice(0, MAX_QUEUE),
    index: s.index,
    positionSec: s.positionSec,
    volume: s.volume,
    muted: s.muted,
    repeat: s.repeat,
    shuffle: s.shuffle,
    rate: s.rate,
    history: s.history.slice(0, MAX_HISTORY),
    affinity: s.affinity,
  };
}

function save(s: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(toPersisted(s)));
  } catch {
    // Quota exceeded or storage disabled. Try once more without history/affinity, which are the
    // large parts; if that also fails, give up quietly.
    try {
      const slim = { ...toPersisted(s), history: [], affinity: emptyAffinitySafe() };
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Start autosaving. Returns a stop function.
 *
 * The store's own `subscribe` is required, not looked up: an earlier design had a separate
 * `bindPersistStore()` step, and forgetting to call it silently disabled autosave while every type
 * still checked. Making it a parameter removes that failure mode entirely.
 *
 * Saves are throttled because the position updates several times a second; a save on every tick
 * would be a synchronous write on the main thread, which is exactly how audio stutters.
 */
export function startAutosave(
  getState: () => AppState,
  subscribe: (listener: () => void) => () => void,
): () => void {
  let timer: number | null = null;
  let dirty = false;
  let lastWrite = 0;

  const flush = () => {
    if (!dirty) return;
    dirty = false;
    lastWrite = Date.now();
    save(getState());
  };

  const unsubscribe = subscribe(() => {
    dirty = true;
    if (timer !== null) return;
    const wait = Math.max(0, WRITE_INTERVAL_MS - (Date.now() - lastWrite));
    timer = window.setTimeout(() => {
      timer = null;
      flush();
    }, wait);
  });

  const onHide = () => flush();
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
  };

  // Flush on the events that precede a kill: backgrounding, unload, and hiding.
  window.addEventListener('beforeunload', onHide);
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    unsubscribe();
    if (timer !== null) window.clearTimeout(timer);
    window.removeEventListener('beforeunload', onHide);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
    flush();
  };
}
