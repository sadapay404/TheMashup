import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPersisted, saveNow } from '@/lib/persist';
import { reconcileFromDisk } from '@/lib/folders';
import { store, type DownloadJob } from '@/state/store';
import type { Track } from '@themashup/core';

/**
 * "Songs say Downloaded in the notification but are not in the Downloads section."
 *
 * Two independent causes, and either one alone produces exactly that symptom:
 *
 *  1. `downloads` and `folders` were missing from the persisted state, so the job list was rebuilt
 *     from an empty literal on every launch. The file existed on disk; nothing referenced it.
 *  2. `nativeTree()` — the plugin method that reads the real directory — existed and was exported but
 *     never called from anywhere. So even a file already on disk had no way back into the list.
 *
 * The notification was the only place the outcome appeared, which is why the report is so specific:
 * the shade said Downloaded and the app disagreed.
 */

const track = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  durationSec: 200,
  thumbs: [],
  source: 'download',
} as Track);

const job = (id: string, over: Partial<DownloadJob> = {}): DownloadJob => ({
  id,
  track: track(id),
  target: 'WEBM · 128 kbps',
  progress: 1,
  state: 'done',
  createdAt: 1,
  path: `/data/user/0/app/files/Music/${id}.webm`,
  ...over,
});

describe('downloads survive a relaunch', () => {
  beforeEach(() => {
    localStorage.clear();
    store.set({ downloads: [], folders: [] });
  });

  it('saves completed downloads instead of dropping them', () => {
    store.set({ downloads: [job('a'), job('b')] });
    saveNow(() => store.getState());

    const raw = JSON.parse(localStorage.getItem('mashup.state.v1') ?? '{}') as {
      downloads?: unknown[];
    };
    expect(raw.downloads).toHaveLength(2);
  });

  it('restores them, with the path that proves the file exists', () => {
    store.set({ downloads: [job('a')] });
    saveNow(() => store.getState());

    const loaded = loadPersisted();
    expect(loaded?.downloads).toHaveLength(1);
    expect(loaded?.downloads[0]?.path).toBe('/data/user/0/app/files/Music/a.webm');
  });

  it('drops in-flight jobs, which cannot resume across a process death', () => {
    // A restored 'downloading' row is a spinner that can never finish: the service is gone and the
    // stream URL has expired. Only real outcomes are worth keeping.
    store.set({
      downloads: [
        job('done', { state: 'done' }),
        job('live', { state: 'downloading', progress: 0.4 }),
        job('queued', { state: 'queued' }),
        job('resolving', { state: 'resolving' }),
      ],
    });
    saveNow(() => store.getState());

    expect(loadPersisted()?.downloads.map((d) => d.id)).toEqual(['done']);
  });

  it('keeps the two system folders even when the saved file predates folders', () => {
    /*
     * Without them the Downloads screen has no buckets, and a restored file has nowhere to appear.
     * A blob written by an older build simply has no `folders` key, so the floor is applied on read.
     */
    saveNow(() => store.getState());
    const blob = JSON.parse(localStorage.getItem('mashup.state.v1') ?? '{}') as Record<string, unknown>;
    delete blob['folders'];
    localStorage.setItem('mashup.state.v1', JSON.stringify(blob));

    expect(loadPersisted()?.folders.map((f) => f.id)).toEqual(['all-songs', 'all-videos']);
  });

  it('drops a malformed job rather than rendering it', () => {
    localStorage.setItem(
      'mashup.state.v1',
      JSON.stringify({
        v: 1,
        savedAt: 1,
        route: 'home',
        queue: [],
        index: 0,
        positionSec: 0,
        volume: 0.8,
        muted: false,
        repeat: 'off',
        shuffle: false,
        rate: 1,
        amoled: false,
        theme: 'obsidian',
        haptics: true,
        hapticEvents: {},
        history: [],
        likes: [],
        affinity: {},
        // No track, and an unknown state.
        downloads: [{ id: 'x', target: '', progress: 0, state: 'wat', createdAt: 0 }, { id: 'y' }],
      }),
    );
    expect(loadPersisted()?.downloads).toEqual([]);
  });
});

describe('files already on disk are adopted', () => {
  beforeEach(() => {
    localStorage.clear();
    store.set({ downloads: [], folders: [] });
  });

  const tree = [
    {
      kind: 'music' as const,
      files: [{ name: 'loose file.webm', path: '/music/loose file.webm', size: 100 }],
      folders: [],
    },
    {
      kind: 'music' as const,
      files: [],
      folders: [
        { path: '/music/Album', files: [{ name: 'Artist - Song.webm', path: '/music/Album/Artist - Song.webm' }] },
      ],
    },
  ];

  it('turns a file with no job record into a finished download', () => {
    // This is the rescue path for files written by an earlier build.
    const adopted = reconcileFromDisk(tree);
    expect(adopted).toBe(2);
    const ids = store.getState().downloads.map((d) => d.path);
    expect(ids).toContain('/music/loose file.webm');
    expect(ids).toContain('/music/Album/Artist - Song.webm');
  });

  it('does not duplicate a file that already has a job', () => {
    store.set({ downloads: [job('a', { path: '/music/loose file.webm' })] });
    expect(reconcileFromDisk(tree)).toBe(1);
    expect(store.getState().downloads.filter((d) => d.path === '/music/loose file.webm')).toHaveLength(1);
  });

  it('never adopts a half-written scratch file', () => {
    const adopted = reconcileFromDisk([
      { kind: 'music', files: [{ name: 'x.webm.part', path: '/music/x.webm.part', size: 10 }], folders: [] },
    ]);
    expect(adopted).toBe(0);
  });

  it('is idempotent across repeated launches', () => {
    reconcileFromDisk(tree);
    const after = store.getState().downloads.length;
    expect(reconcileFromDisk(tree)).toBe(0);
    expect(store.getState().downloads).toHaveLength(after);
  });
});

describe('the wiring exists', () => {
  const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');

  it('reconciles from disk at startup', () => {
    // `nativeTree` was dead code — exported, correct, and called from nowhere.
    expect(app).toContain('nativeTree()');
    expect(app).toContain('reconcileFromDisk');
  });

  it('binds download events at startup, not only when a download starts', () => {
    // A service that finished while the app was closed had no listener to hear it.
    expect(app).toContain('bindNativeDownloadEvents()');
  });
});
