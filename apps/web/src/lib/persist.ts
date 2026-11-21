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
import type {
  AppState,
  DownloadFolder,
  DownloadJob,
  RepeatMode,
  Route,
  ThemeId,
} from '@/state/store';
import { DEFAULT_HAPTIC_SETTINGS } from '@/lib/haptics';

const KEY = 'mashup.state.v1';
const MAX_QUEUE = 200;
const MAX_HISTORY = 120;
const MAX_LIKES = 500;
/**
 * Kept generous: a downloaded file is a thing the user owns, and silently forgetting one because a
 * cap was hit would be worse than a large settings blob. The list is a few hundred bytes per entry.
 */
const MAX_DOWNLOADS = 500;

/** The two fixed buckets the Downloads screen always needs. */
function defaultFolders(): DownloadFolder[] {
  return [
    { id: 'all-songs', name: 'All songs', kind: 'music', system: true, createdAt: 0 },
    { id: 'all-videos', name: 'Videos', kind: 'video', system: true, createdAt: 0 },
  ];
}
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
  amoled: boolean;
  theme: ThemeId;
  haptics: boolean;
  hapticEvents: Record<string, boolean>;
  history: Track[];
  affinity: AffinityState;
  /** Optional: files written before favourites existed simply omit it and load with none. */
  /**
   * Always populated on load (files written before favourites existed simply have no entry and are
   * read as an empty list) — non-optional so restoring state can never write `undefined`.
   */
  likes: Track[];
  /**
   * Finished and in-flight downloads, and the folders they are filed in.
   *
   * These were **absent from the persisted shape entirely**, which is the whole "it says Downloaded
   * but the Downloads section is empty" bug: the job list lived only in memory and was rebuilt empty
   * on every launch, while the file sat in `filesDir/Music` with nothing referencing it. The
   * notification was the only place the outcome was ever visible, and only for a moment.
   */
  downloads: DownloadJob[];
  folders: DownloadFolder[];
}

const ROUTES: readonly Route[] = ['home', 'search', 'library', 'settings'];
const THEMES: readonly ThemeId[] = ['obsidian', 'vinyl', 'paper', 'cyberpunk', 'forest'];
const REPEATS: readonly RepeatMode[] = ['off', 'all', 'one'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Unknown or absent theme ids fall back to the default rather than leaving the UI unstyled. */
function theme(value: unknown): ThemeId {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
    ? (value as ThemeId)
    : 'obsidian';
}

/**
 * Per-event haptic switches. Unknown keys are dropped and missing ones fall back to the default, so a
 * settings blob written by an older build (or a future one with more events) stays valid.
 */
function hapticEvents(value: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = { ...DEFAULT_HAPTIC_SETTINGS };
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k in out && typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
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

/**
 * Downloads and folders are validated field by field like everything else here, because
 * `localStorage` is user-editable and a malformed job would otherwise be fed straight into the
 * Downloads screen. A job that cannot be understood is dropped, not repaired into something wrong.
 */
function downloadJobs(value: unknown, limit: number): DownloadJob[] {
  if (!Array.isArray(value)) return [];
  const out: DownloadJob[] = [];
  for (const raw of value.slice(0, limit)) {
    if (!isRecord(raw)) continue;
    if (typeof raw['id'] !== 'string' || !isTrack(raw['track'])) continue;
    const state = raw['state'];
    const valid =
      state === 'queued' || state === 'resolving' || state === 'downloading' ||
      state === 'muxing' || state === 'done' || state === 'failed' || state === 'partial';
    if (!valid) continue;
    const job: DownloadJob = {
      id: raw['id'],
      track: raw['track'],
      target: typeof raw['target'] === 'string' ? raw['target'] : '',
      progress: num(raw['progress'], 0, 0, 1),
      state,
      createdAt: num(raw['createdAt'], Date.now(), 0, Number.MAX_SAFE_INTEGER),
    };
    if (typeof raw['bytes'] === 'number') job.bytes = raw['bytes'];
    if (typeof raw['totalBytes'] === 'number') job.totalBytes = raw['totalBytes'];
    if (typeof raw['error'] === 'string') job.error = raw['error'];
    if (raw['kind'] === 'video') job.kind = 'video';
    else if (raw['kind'] === 'music') job.kind = 'music';
    if (raw['folderId'] === null || typeof raw['folderId'] === 'string') {
      job.folderId = raw['folderId'] as string | null;
    }
    if (typeof raw['path'] === 'string') job.path = raw['path'];
    out.push(job);
  }
  return out;
}

function downloadFolders(value: unknown, limit: number): DownloadFolder[] {
  if (!Array.isArray(value)) return [];
  const out: DownloadFolder[] = [];
  for (const raw of value.slice(0, limit)) {
    if (!isRecord(raw)) continue;
    if (typeof raw['id'] !== 'string' || typeof raw['name'] !== 'string') continue;
    if (raw['kind'] !== 'music' && raw['kind'] !== 'video') continue;
    out.push({
      id: raw['id'],
      name: raw['name'].slice(0, 120),
      kind: raw['kind'],
      ...(raw['system'] === true ? { system: true } : {}),
      createdAt: num(raw['createdAt'], 0, 0, Number.MAX_SAFE_INTEGER),
    });
  }
  return out;
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
    amoled: bool(parsed['amoled'], false),
    theme: theme(parsed['theme']),
    haptics: bool(parsed['haptics'], true),
    hapticEvents: hapticEvents(parsed['hapticEvents']),
    history: tracks(parsed['history'], MAX_HISTORY),
    likes: tracks(parsed['likes'], MAX_LIKES),
    affinity: isRecord(parsed['affinity']) ? (parsed['affinity'] as unknown as AffinityState) : emptyAffinitySafe(),
    downloads: downloadJobs(parsed['downloads'], MAX_DOWNLOADS),
    /*
     * A file written before folders were persisted has none. The two system folders are the floor —
     * without them the Downloads screen has no buckets and a restored job has nowhere to appear.
     */
    folders: (() => {
      const restored = downloadFolders(parsed['folders'], 200);
      return restored.length ? restored : defaultFolders();
    })(),
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
    amoled: s.amoled,
    theme: s.theme,
    haptics: s.haptics,
    hapticEvents: s.hapticEvents,
    history: s.history.slice(0, MAX_HISTORY),
    likes: s.likes.slice(0, MAX_LIKES),
    affinity: s.affinity,
    /*
     * Only jobs that still mean something on disk.
     *
     * `resolving`/`queued`/`muxing` were tied to an in-flight native service; across a process death
     * there is no service and no stream URL, so restoring them would resurrect a spinner that can
     * never finish. `downloading` is also dropped for the same reason — the `.part` file resumes only
     * when the user retries, which is an explicit act. Done and failed are real outcomes and survive.
     */
    downloads: s.downloads
      .filter((d) => d.state === 'done' || d.state === 'failed' || d.state === 'partial')
      .slice(0, MAX_DOWNLOADS),
    folders: s.folders.slice(0, 200),
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
/**
 * Write the current state immediately.
 *
 * Exported for tests and for the handful of moments where waiting for the throttle is wrong — a
 * finished download being the important one. Autosave's 1 s window is fine for position ticks; it is
 * not fine if the process is killed by the OS between the notification and the write.
 */
export function saveNow(getState: () => AppState): void {
  save(getState());
}

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
