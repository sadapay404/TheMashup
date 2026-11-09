/**
 * App state. Zustand-style with a tiny hand-rolled store (no dependency, no provider tree, and
 * selector-based subscriptions so a playing track never re-renders the whole library).
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { AffinityState, Lyrics, StreamInfo, Track } from '@themashup/core';
import { emptyAffinity } from '@themashup/core';
import { DEFAULT_HAPTIC_SETTINGS, haptic, type HapticEvent } from '@/lib/haptics';

export type ThemeId = 'obsidian' | 'vinyl' | 'paper' | 'cyberpunk' | 'forest';

export type RepeatMode = 'off' | 'all' | 'one';
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

export interface AppState {
  route: Route;
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
  rate: number;

  stream: StreamInfo | null;
  streamError: string | null;

  lyrics: Lyrics | null;
  lyricsLoading: boolean;

  searchQuery: string;
  history: Track[];
  downloads: DownloadJob[];
  folders: DownloadFolder[];
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
   */
  notify = (text: string, kind: 'info' | 'error' | 'success' = 'info'): void => {
    haptic(kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'tap');
    const id = Date.now();
    this.set({ toast: { id, text, kind } });
    setTimeout(() => {
      if (this.state.toast?.id === id) this.set({ toast: null });
    }, 4200);
  };
}

export const store = new Store();

/** Selector hook. `useApp(s => s.queue)` re-renders only when that slice changes. */
export function useApp<T>(selector: (s: AppState) => T): T {
  const getSnapshot = useCallback(() => selector(store.getState()), [selector]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export const currentTrack = (s: AppState): Track | null => s.queue[s.index] ?? null;
