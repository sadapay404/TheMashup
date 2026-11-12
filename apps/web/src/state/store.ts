/**
 * App state. Zustand-style with a tiny hand-rolled store (no dependency, no provider tree, and
 * selector-based subscriptions so a playing track never re-renders the whole library).
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { AffinityState, Lyrics, StreamInfo, Track } from '@themashup/core';
import { emptyAffinity } from '@themashup/core';
import { DEFAULT_HAPTIC_SETTINGS, haptic, type HapticEvent } from '@/lib/haptics';
import { deservesNotification, postNotification } from '@/lib/notifications';

export type ThemeId = 'obsidian' | 'vinyl' | 'paper' | 'cyberpunk' | 'forest';

export type RepeatMode = 'off' | 'all' | 'one';

/**
 * Where the current queue came from.
 *
 * Only `downloads` has its own play policy. It is deliberately a small closed set rather than a free
 * string: the player switches on it, and a typo in a component should be a type error.
 */
export type QueueOrigin = 'library' | 'downloads';
export type Route = 'home' | 'search' | 'library' | 'downloads' | 'settings';

/**
 * What a downloaded item is.
 *
 * A song and a video are different things and the user asked for them in separate sections, so this
 * is a property of the file, not a label on the list that happens to contain it. `music` and `video`
 * are the two sections; a playlist is a *folder*, not a third kind.
 */
export type MediaKind = 'music' | 'video';

/**
 * A folder on disk as the app understands it.
 *
 * Folders exist in the data model on both platforms even though only the Android build can create
 * real directories: the browser keeps them as grouping metadata, so the interface a user learns is
 * identical, and moving a file between folders means the same thing in both places.
 */
export interface DownloadFolder {
  id: string;
  name: string;
  kind: MediaKind;
  /** System folders (All songs / Videos) cannot be renamed or deleted. */
  system?: boolean;
  createdAt: number;
}

export interface DownloadJob {
  id: string;
  track: Track;
  target: string;
  progress: number;
  state: 'queued' | 'resolving' | 'downloading' | 'muxing' | 'done' | 'failed' | 'partial';
  bytes?: number;
  totalBytes?: number;
  error?: string;
  createdAt: number;
  kind?: MediaKind;
  /** Folder this file belongs to, or null for "not filed yet". */
  folderId?: string | null;
  /** Absolute path on disk, known only when the native service wrote the file. */
  path?: string;
}

/**
 * A playlist the user builds by hand.
 *
 * Explicitly not auto-populated: the user said queue and playlists must be manual, so playing a song
 * never changes a playlist. Order is insertion order and duplicates are refused, because a playlist
 * that silently contains the same song twice is a bug the user cannot see.
 */
export interface UserPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  /** Kept so a track can be re-read without another network call. */
  tracks: Record<string, Track>;
  createdAt: number;
  updatedAt: number;
}

export interface AppState {
  route: Route;
  /**
   * Pages visited, oldest first. The current route is the last entry.
   *
   * The Android back button used to call `finish()` straight from Home, so backing out of Settings
   * closed the app instead of returning to where the user was. A route change now records history and
   * back pops it — which is what every other app on the device does, and needs no "press again to
   * exit" toast to paper over the difference.
   */
  navHistory: Route[];
  playerOpen: boolean;
  lyricsOpen: boolean;

  queue: Track[];
  index: number;
  playing: boolean;
  loading: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  /**
   * Which surface filled the queue.
   *
   * The Downloads library is the one place with a different *policy* rather than a different look: it
   * is offline media the user deliberately saved, so it plays end-to-end without needing a network,
   * and it never reaches for radio when the list runs out. Every other surface keeps the normal
   * behaviour. Storing the origin here — instead of a component-local flag — is what lets the player
   * make that decision at the moment a track ends, which is several screens away from where it started.
   */
  queueOrigin: QueueOrigin;
  /**
   * The shuffle setting to restore when leaving a downloads queue.
   *
   * Shuffle is a global preference, and the Downloads screen has to be able to switch it on without
   * silently rewriting what the user chose for the rest of the app. Null when no override is active.
   */
  shuffleBeforeDownloads: boolean | null;
  rate: number;
  stream: StreamInfo | null;
  streamError: string | null;

  lyrics: Lyrics | null;
  lyricsLoading: boolean;

  searchQuery: string;
  history: Track[];
  downloads: DownloadJob[];
  folders: DownloadFolder[];
  /** Playlist downloads in flight or finished, so progress survives leaving the screen. */
  playlistBatches: import('@/lib/playlist').PlaylistBatch[];
  /** Playlists the user built, newest last. */
  playlists: UserPlaylist[];
  affinity: AffinityState;
  /** Locally "liked" tracks, newest first. Also fed into the affinity graph on every change. */
  likes: Track[];

  amoled: boolean;
  /** Visual theme id. See `THEMES` in lib/theme.ts. */
  theme: ThemeId;
  /** Master switch for vibration. */
  haptics: boolean;
  /** Per-event switches, so a user can kill the annoying ones without losing feedback entirely. */
  hapticEvents: Record<HapticEvent, boolean>;
  transportRoute: string;
  toast: { id: number; text: string; kind: 'info' | 'error' | 'success' } | null;
}

const initialState: AppState = {
  route: 'home',
  navHistory: ['home'],
  playerOpen: false,
  lyricsOpen: false,

  queue: [],
  index: -1,
  playing: false,
  loading: false,
  positionSec: 0,
  durationSec: 0,
  volume: 0.9,
  muted: false,
  repeat: 'off',
  shuffle: false,
  queueOrigin: 'library',
  shuffleBeforeDownloads: null,
  rate: 1,

  stream: null,
  streamError: null,

  lyrics: null,
  lyricsLoading: false,

  searchQuery: '',
  history: [],
  downloads: [],
  /**
   * Seeded with the two fixed buckets the user asked for. They are system folders: no rename, no
   * delete, and every download lands in one of them unless it is filed somewhere else.
   */
  folders: [
    { id: 'all-songs', name: 'All songs', kind: 'music', system: true, createdAt: 0 },
    { id: 'all-videos', name: 'Videos', kind: 'video', system: true, createdAt: 0 },
  ] as DownloadFolder[],
  playlistBatches: [],
  playlists: [],
  affinity: emptyAffinity(),
  likes: [],

  amoled: false,
  theme: 'obsidian',
  haptics: true,
  hapticEvents: { ...DEFAULT_HAPTIC_SETTINGS },
  transportRoute: 'detecting',
  toast: null,
};

type Listener = () => void;

class Store {
  private state: AppState = initialState;
  private listeners = new Set<Listener>();

  getState = (): AppState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void => {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  };

  /**
   * Toast helper: auto-dismisses, and never stacks (last one wins).
   *
   * Haptics fire here because every user-visible outcome in the app goes through a toast, so this is
   * the one place that guarantees feedback is consistent — no component can forget to buzz.
   *
   * It also mirrors the message to the phone's notification shade. A toast only exists while the app
   * is in front of the user; a download that finishes after they switch away, or a playback failure
   * that happens while the screen is off, used to leave no trace anywhere. Both surfaces now receive
   * the same event — see `lib/notifications.ts` for which kinds are worth a notification, and why the
   * quiet ones stay quiet.
   */
  notify = (text: string, kind: 'info' | 'error' | 'success' = 'info', opts?: NotifyOptions): void => {
    haptic(kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'tap');
    const id = Date.now();
    this.set({ toast: { id, text, kind } });
    setTimeout(() => {
      if (this.state.toast?.id === id) this.set({ toast: null });
    }, 4200);

    // Fire-and-forget on purpose: `notify` is called from render paths and from inside catch blocks,
    // and neither can await a bridge call. The helper swallows every failure.
    if (opts?.notify === 'always' || deservesNotification(kind, text)) {
      void postNotification({
        title: opts?.title ?? defaultTitle(kind),
        body: text,
        channel: opts?.channel ?? (kind === 'error' ? 'alerts' : 'downloads'),
        ...(opts?.route ? { route: opts.route } : {}),
        ...(opts?.ongoing ? { ongoing: true } : {}),
        ...(opts?.id !== undefined ? { id: opts.id } : {}),
      });
    }
  };
}

/** Extra delivery options for a notification raised by `notify`. */
export interface NotifyOptions {
  /** Post to the shade even for a message that would normally stay a toast. */
  notify?: 'always';
  /** Headline in the shade. Defaults to the app name, or "Something went wrong" for errors. */
  title?: string;
  /** Which channel carries it. Defaults to `downloads` for news, `alerts` for failures. */
  channel?: 'alerts' | 'playback' | 'downloads';
  /** Screen to open when the notification is tapped. */
  route?: string;
  /** Keep it in the shade until dismissed (a transfer in progress). */
  ongoing?: boolean;
  /** Stable id inside the JS range, so repeated updates replace rather than stack. */
  id?: number;
}

function defaultTitle(kind: 'info' | 'error' | 'success'): string {
  return kind === 'error' ? 'Something went wrong' : 'TheMashup';
}

export const store = new Store();

/**
 * Go to a page, recording it in history.
 *
 * Every navigation must go through this rather than `store.set({ route })`; a direct set would move
 * the page without recording how it was reached, and back would then skip it.
 */
export function navigate(route: Route): void {
  store.set((s) =>
    s.route === route
      ? {}
      : { route, navHistory: [...s.navHistory, route].slice(-20) },
  );
}

/**
 * Back one step.
 *
 * Returns false when there is nothing left to pop, which is the caller's signal that the platform
 * default (leaving the app) is now correct. Deliberately no "press back again to exit": the user
 * asked for that text not to appear, and it only exists to explain a behaviour that should not
 * happen in the first place.
 */
export function goBack(): boolean {
  const s = store.getState();
  if (s.navHistory.length <= 1) return false;
  const next = s.navHistory.slice(0, -1);
  const route = next[next.length - 1] ?? 'home';
  store.set({ navHistory: next, route });
  return true;
}

/** Selector hook. `useApp(s => s.queue)` re-renders only when that slice changes. */
export function useApp<T>(selector: (s: AppState) => T): T {
  const getSnapshot = useCallback(() => selector(store.getState()), [selector]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export const currentTrack = (s: AppState): Track | null => s.queue[s.index] ?? null;
