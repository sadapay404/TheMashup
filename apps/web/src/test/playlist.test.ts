/**
 * Playlist download engine.
 *
 * The behaviours worth pinning are the ones a user notices when they go wrong: every track lands in
 * the playlist's own folder, one unresolvable track does not sink the rest, and stopping actually
 * stops instead of tearing down a file mid-write.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@themashup/core';
import { store } from '../state/store';
import { cancelPlaylist, downloadPlaylist, playlistTarget, batchProgress } from '../lib/playlist';
import { foldersOf } from '../lib/folders';

const track = (id: string, kind: 'song' | 'video' = 'song'): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Someone',
  durationSec: 180,
  thumbs: [],
  kind,
});

beforeEach(() => {
  store.set({
    folders: [
      { id: 'all-songs', name: 'All songs', kind: 'music', system: true, createdAt: 0 },
      { id: 'all-videos', name: 'Videos', kind: 'video', system: true, createdAt: 0 },
    ],
    downloads: [],
    playlistBatches: [],
  });
});

describe('playlistTarget', () => {
  it('asks for a real audio stream copy, not a transcode', () => {
    const t = playlistTarget(track('a'));
    expect(t.container).toBe('m4a');
    expect(t.needsTranscode).toBe(false);
  });

  it('keeps video as video', () => {
    expect(playlistTarget(track('v', 'video')).container).toBe('mp4');
  });
});

describe('downloadPlaylist', () => {
  it('creates a folder named after the playlist and files every track into it', async () => {
    const resolve = vi.fn(async () => 'https://cdn.test/a');
    await downloadPlaylist({ name: 'Jhol', tracks: [track('a'), track('b')], resolve });

    const folder = foldersOf('music').find((f) => f.name === 'Jhol');
    expect(folder).toBeTruthy();
    const filed = store.getState().downloads.filter((j) => j.folderId === folder!.id);
    expect(filed).toHaveLength(2);
  });

  it('reuses one folder when the same playlist is downloaded twice', async () => {
    const resolve = vi.fn(async () => 'https://cdn.test/a');
    await downloadPlaylist({ name: 'Jhol', tracks: [track('a')], resolve });
    await downloadPlaylist({ name: 'Jhol', tracks: [track('b')], resolve });
    expect(foldersOf('music').filter((f) => f.name === 'Jhol')).toHaveLength(1);
  });

  it('downloads sequentially, in playlist order', async () => {
    const order: string[] = [];
    const resolve = vi.fn(async (t: Track) => {
      order.push(t.id);
      return 'https://cdn.test/x';
    });
    await downloadPlaylist({ name: 'Ordered', tracks: [track('a'), track('b'), track('c')], resolve });
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('carries on when one track cannot be resolved, and counts it', async () => {
    const resolve = vi.fn(async (t: Track) => (t.id === 'b' ? null : 'https://cdn.test/x'));
    const batch = await downloadPlaylist({
      name: 'Partial',
      tracks: [track('a'), track('b'), track('c')],
      resolve,
    });
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(batch?.failed).toBe(1);
    expect(store.getState().downloads).toHaveLength(2);
  });

  it('survives a resolver that throws', async () => {
    const resolve = vi.fn(async (t: Track) => {
      if (t.id === 'b') throw new Error('boom');
      return 'https://cdn.test/x';
    });
    const batch = await downloadPlaylist({ name: 'Throws', tracks: [track('a'), track('b')], resolve });
    expect(batch?.failed).toBe(1);
    expect(batch?.state).toBe('done');
  });

  it('puts a video playlist in the video section', async () => {
    const resolve = vi.fn(async () => 'https://cdn.test/v');
    await downloadPlaylist({ name: 'Clips', tracks: [track('v1', 'video'), track('v2', 'video')], resolve });
    const folder = foldersOf('video').find((f) => f.name === 'Clips');
    expect(folder).toBeTruthy();
    expect(store.getState().downloads.every((j) => j.kind === 'video')).toBe(true);
  });

  it('does nothing for an empty playlist instead of creating an empty folder', async () => {
    const resolve = vi.fn(async () => 'https://cdn.test/a');
    const batch = await downloadPlaylist({ name: 'Nothing', tracks: [], resolve });
    expect(batch).toBeNull();
    expect(foldersOf('music').some((f) => f.name === 'Nothing')).toBe(false);
  });

  it('stops between tracks when cancelled, and marks itself cancelled', async () => {
    const resolve = vi.fn(async (t: Track) => {
      if (t.id === 'a') cancelPlaylist(store.getState().playlistBatches[0]!.id);
      return 'https://cdn.test/x';
    });
    const batch = await downloadPlaylist({
      name: 'Stopped',
      tracks: [track('a'), track('b'), track('c')],
      resolve,
    });
    expect(batch?.state).toBe('cancelled');
    // 'a' was already in flight and completes; 'b' and 'c' never start.
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe('batchProgress', () => {
  it('reports a fraction of the playlist', () => {
    expect(
      batchProgress({
        id: 'x',
        folderId: 'f',
        name: 'n',
        kind: 'music',
        trackIds: ['a', 'b', 'c', 'd'],
        cursor: 1,
        state: 'running',
        failed: 0,
        startedAt: 0,
      }),
    ).toBe(0.25);
  });
});
