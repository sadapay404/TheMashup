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
export type Route = 'home' | 'search' | 'library' | 'settings';

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
