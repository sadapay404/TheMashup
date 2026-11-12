/**
 * Playlist downloads.
 *
 * A playlist is a folder. Downloading one means: create the folder, then take the tracks one at a
 * time so the network is not saturated and the first songs are playable while the rest arrive.
 *
 * This is deliberately sequential rather than parallel. Four simultaneous downloads of a fifty-track
 * playlist means the first track is not ready for minutes; one at a time means the first track is
 * ready in seconds. It is also the difference between a progress bar that moves and one that lies.
 *
 * The batch itself is state, not a local variable, so closing the sheet does not cancel anything and
 * the Downloads screen can show the batch running.
 */

import type { Track } from '@themashup/core';
import { store, type MediaKind } from '@/state/store';
import { ensureFolder, safeFolderName, SYSTEM_FOLDER } from './folders';
import { startDownload, type Target } from './downloader';

export interface PlaylistBatch {
  id: string;
  /** Folder every track in this batch is filed into. */
  folderId: string;
  name: string;
  kind: MediaKind;
  trackIds: string[];
  /** Index of the track currently being fetched; equals trackIds.length when finished. */
  cursor: number;
  state: 'running' | 'done' | 'cancelled';
  failed: number;
  startedAt: number;
  /** Set while a cancel is requested, so the loop stops before the next track starts. */
  cancelRequested?: boolean;
}

/** The best stream-copy tier for a whole playlist: real audio, no transcode, no guessing. */
export function playlistTarget(track: Track): Target {
  const video = track.kind === 'video';
  return video
    ? { label: 'Video · original', container: 'mp4', itag: 22, needsTranscode: false }
    : { label: 'Audio · 128k m4a', container: 'm4a', itag: 140, needsTranscode: false };
}

type Resolver = (track: Track, target: Target) => Promise<string | null>;

/**
 * Optional hook for the request headers a resolved URL needs.
 *
 * Kept out of [Resolver] on purpose: the URL and its headers come from the same `StreamInfo`, but the
 * resolver's contract is "give me a URL", and changing it would break every test double. A caller that
 * has headers reports them here; one that does not simply omits the hook.
 */
type HeaderProvider = (track: Track) => Record<string, string> | undefined;

/**
 * Start downloading a playlist into its own folder.
 *
 * `resolve` turns a track into a CDN URL; it is injected so the engine can be tested without a
 * network and so the caller keeps control of which source route is used.
 */
export async function downloadPlaylist(opts: {
  name: string;
  tracks: Track[];
  kind?: MediaKind;
  resolve: Resolver;
  /** Request headers the resolved URL needs, when the caller knows them. */
  headers?: HeaderProvider;
}): Promise<PlaylistBatch | null> {
  const tracks = opts.tracks.filter((t) => t && t.id);
  if (!tracks.length) return null;

  const kind: MediaKind = opts.kind ?? (tracks.every((t) => t.kind === 'video') ? 'video' : 'music');
  const folder = ensureFolder(opts.name || 'Playlist', kind);

  const batch: PlaylistBatch = {
    id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    folderId: folder.id,
    name: folder.name,
    kind,
    trackIds: tracks.map((t) => t.id),
    cursor: 0,
    state: 'running',
    failed: 0,
    startedAt: Date.now(),
  };
  store.set((s) => ({ playlistBatches: [...s.playlistBatches, batch] }));

  const patch = (next: Partial<PlaylistBatch>) =>
    store.set((s) => ({
      playlistBatches: s.playlistBatches.map((b) => (b.id === batch.id ? { ...b, ...next } : b)),
    }));

  store.notify(`Downloading ${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'} into ${folder.name}`, 'info');

  for (let i = 0; i < tracks.length; i += 1) {
    // Cancellation is checked between tracks, never mid-transfer: killing a half-written file would
    // leave a corrupt entry that looks finished later.
    if (store.getState().playlistBatches.find((b) => b.id === batch.id)?.cancelRequested) {
      patch({ state: 'cancelled' });
      store.notify(`Stopped at ${i} of ${tracks.length}`, 'info');
      // Return the live record, not the local copy: the copy still says 'running', and a caller
      // that trusted it would report a cancelled batch as an active one.
      return store.getState().playlistBatches.find((b) => b.id === batch.id) ?? batch;
    }

    patch({ cursor: i });
    const track = tracks[i]!;
    const target = playlistTarget(track);

    try {
      const url = await opts.resolve(track, target);
      if (!url) {
        batch.failed += 1;
        patch({ failed: batch.failed });
        continue;
      }
      // `resolve` returned the URL; the headers it needed are attached to the same StreamInfo the
      // caller resolved from, so the downloader is authorised exactly like playback.
      const jobId = await startDownload(track, url, target, folder.name, opts.headers?.(track));
      // File the job into the playlist folder. startDownload registers it first so progress is
      // visible from the moment it is queued.
      store.set((s) => ({
        downloads: s.downloads.map((j) => (j.id === jobId ? { ...j, folderId: folder.id, kind } : j)),
      }));
    } catch {
      // One bad track must not abandon the other forty-nine.
      batch.failed += 1;
      patch({ failed: batch.failed });
    }

    // The engine hands each track to the service and moves on. Transfers themselves run in the
    // downloader (native service on Android), so this loop paces the queue, not the bytes.
    await new Promise((r) => setTimeout(r, 0));
  }

  patch({ state: 'done', cursor: tracks.length });
  const failed = batch.failed;
  store.notify(
    failed
      ? `${folder.name}: ${tracks.length - failed} of ${tracks.length} queued, ${failed} could not be resolved`
      : `${folder.name}: ${tracks.length} tracks queued`,
    failed ? 'error' : 'success',
  );
  return store.getState().playlistBatches.find((b) => b.id === batch.id) ?? batch;
}

/** Ask a running batch to stop after the track it is on. */
export function cancelPlaylist(batchId: string): void {
  store.set((s) => ({
    playlistBatches: s.playlistBatches.map((b) => (b.id === batchId && b.state === 'running' ? { ...b, cancelRequested: true } : b)),
  }));
}

export function batchFor(folderId: string): PlaylistBatch | null {
  return store.getState().playlistBatches.find((b) => b.folderId === folderId) ?? null;
}

/** Progress of a folder's batch, for the row subtitle. */
export function batchProgress(b: PlaylistBatch): number {
  return b.trackIds.length ? Math.min(1, b.cursor / b.trackIds.length) : 0;
}

export { SYSTEM_FOLDER, safeFolderName };
