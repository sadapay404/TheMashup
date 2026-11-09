/**
 * User-built playlists.
 *
 * Manual by design: nothing here is called by playback. A song only joins a playlist when the user
 * presses "Add to playlist" and picks one, because a playlist that grows on its own is not a
 * playlist, it is a log of everything they ever heard.
 */

import type { Track } from '@themashup/core';
import { store, type UserPlaylist } from '@/state/store';

export function playlists(): UserPlaylist[] {
  return store.getState().playlists;
}

export function playlistById(id: string): UserPlaylist | null {
  return store.getState().playlists.find((p) => p.id === id) ?? null;
}

/** Tracks in playlist order, skipping ids whose track was never stored. */
export function playlistTracks(id: string): Track[] {
  const p = playlistById(id);
  if (!p) return [];
  return p.trackIds.map((t) => p.tracks[t]).filter((t): t is Track => Boolean(t));
}

export function createPlaylist(name: string): UserPlaylist | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const now = Date.now();
  const p: UserPlaylist = {
    id: `up-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed.slice(0, 80),
    trackIds: [],
    tracks: {},
    createdAt: now,
    updatedAt: now,
  };
  store.set((s) => ({ playlists: [...s.playlists, p] }));
  return p;
}

/**
 * Add a track to a playlist.
 *
 * Returns what actually happened so the caller can report it truthfully. Adding a song that is
 * already there is not a success: saying "added" would be a lie the user only discovers by
 * scrolling to find it twice.
 */
export function addToPlaylist(
  playlistId: string,
  track: Track,
): 'added' | 'duplicate' | 'missing-playlist' {
  const target = playlistById(playlistId);
  if (!target) return 'missing-playlist';
  if (target.trackIds.includes(track.id)) return 'duplicate';

  store.set((s) => ({
    playlists: s.playlists.map((p) =>
      p.id === playlistId
        ? {
            ...p,
            trackIds: [...p.trackIds, track.id],
            tracks: { ...p.tracks, [track.id]: track },
            updatedAt: Date.now(),
          }
        : p,
    ),
  }));
  return 'added';
}

export function removeFromPlaylist(playlistId: string, trackId: string): boolean {
  const target = playlistById(playlistId);
  if (!target || !target.trackIds.includes(trackId)) return false;
  store.set((s) => ({
    playlists: s.playlists.map((p) => {
      if (p.id !== playlistId) return p;
      const tracks = { ...p.tracks };
      delete tracks[trackId];
      return { ...p, trackIds: p.trackIds.filter((id) => id !== trackId), tracks, updatedAt: Date.now() };
    }),
  }));
  return true;
}

/** Playlists that already contain a track — used to mark them in the picker. */
export function playlistsContaining(trackId: string): string[] {
  return store
    .getState()
    .playlists.filter((p) => p.trackIds.includes(trackId))
    .map((p) => p.id);
}

export function renamePlaylist(id: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const exists = store.getState().playlists.some((p) => p.id === id);
  if (!exists) return false;
  store.set((s) => ({
    playlists: s.playlists.map((p) => (p.id === id ? { ...p, name: trimmed.slice(0, 80), updatedAt: Date.now() } : p)),
  }));
  return true;
}

export function deletePlaylist(id: string): boolean {
  const exists = store.getState().playlists.some((p) => p.id === id);
  if (!exists) return false;
  store.set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
  return true;
}
