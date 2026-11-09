import { beforeEach, describe, expect, it } from 'vitest';
import type { Track } from '@themashup/core';
import { store, type DownloadJob } from '../state/store';
import {
  deleteFolder,
  ensureFolder,
  fileCount,
  filesIn,
  folderById,
  foldersOf,
  moveToFolder,
  renameFolder,
  safeFolderName,
  SYSTEM_FOLDER,
} from '../lib/folders';

const track = (id: string): Track => ({
  id,
  title: `Song ${id}`,
  artist: 'Someone',
  album: 'Somewhere',
  durationSec: 200,
  thumbnail: '',
});

const job = (id: string, kind: 'music' | 'video' = 'music', folderId: string | null = null): DownloadJob => ({
  id,
  track: track(id),
  target: '128k m4a',
  progress: 1,
  state: 'done',
  createdAt: Date.now(),
  kind,
  folderId,
});

beforeEach(() => {
  store.set({
    folders: [
      { id: 'all-songs', name: 'All songs', kind: 'music', system: true, createdAt: 0 },
      { id: 'all-videos', name: 'Videos', kind: 'video', system: true, createdAt: 0 },
    ],
    downloads: [],
  });
});

describe('safeFolderName', () => {
  it('replaces characters that break on a filesystem', () => {
    expect(safeFolderName('AC/DC: Live?')).toBe('AC_DC_ Live_');
  });

  it('strips trailing dots and spaces, which Windows silently drops', () => {
    expect(safeFolderName('Album... ')).toBe('Album');
  });

  it('falls back rather than producing an empty name', () => {
    expect(safeFolderName('   ')).toBe('Untitled');
    expect(safeFolderName('...')).toBe('Untitled');
  });
});

describe('ensureFolder', () => {
  it('creates a folder and returns it', () => {
    const f = ensureFolder('Jhol', 'music');
    expect(f.name).toBe('Jhol');
    expect(f.kind).toBe('music');
    expect(f.system).toBeUndefined();
    expect(folderById(f.id)).not.toBeNull();
  });

  it('reuses an existing folder regardless of case, so an album is not split in two', () => {
    const a = ensureFolder('Jhol', 'music');
    const b = ensureFolder('jhol', 'music');
    expect(b.id).toBe(a.id);
    expect(store.getState().folders.filter((f) => f.name.toLowerCase() === 'jhol')).toHaveLength(1);
  });

  it('keeps music and video folders of the same name apart', () => {
    const music = ensureFolder('Live', 'music');
    const video = ensureFolder('Live', 'video');
    expect(video.id).not.toBe(music.id);
  });
});

describe('foldersOf', () => {
  it('puts the system bucket first, then folders in creation order', () => {
    store.set({
      folders: [
        { id: 'all-songs', name: 'All songs', kind: 'music', system: true, createdAt: 0 },
        { id: 'late', name: 'Later', kind: 'music', createdAt: 500 },
        { id: 'early', name: 'Earlier', kind: 'music', createdAt: 100 },
        { id: 'all-videos', name: 'Videos', kind: 'video', system: true, createdAt: 0 },
      ],
    });
    expect(foldersOf('music').map((f) => f.id)).toEqual(['all-songs', 'early', 'late']);
    expect(foldersOf('video').map((f) => f.id)).toEqual(['all-videos']);
  });
});

describe('moveToFolder', () => {
  it('moves files and reports the count', () => {
    const f = ensureFolder('Jhol', 'music');
    store.set({ downloads: [job('a'), job('b')] });
    expect(moveToFolder(['a', 'b'], f.id).moved).toBe(2);
    expect(filesIn(f.id).map((j) => j.id).sort()).toEqual(['a', 'b']);
  });

  it('refuses to file music into a video folder instead of reclassifying it', () => {
    const videos = ensureFolder('Clips', 'video');
    store.set({ downloads: [job('song', 'music')] });
    expect(moveToFolder(['song'], videos.id).moved).toBe(0);
    expect(store.getState().downloads[0]!.kind).toBe('music');
  });

  it('does nothing when the folder does not exist', () => {
    store.set({ downloads: [job('a')] });
    expect(moveToFolder(['a'], 'nope')).toEqual({ moved: 0, folder: null });
  });

  it('counts only real moves, not files already in place', () => {
    const f = ensureFolder('Jhol', 'music');
    store.set({ downloads: [job('a', 'music', f.id)] });
    expect(moveToFolder(['a'], f.id).moved).toBe(0);
  });
});

describe('filesIn', () => {
  it('shows unfiled files in their section bucket rather than losing them', () => {
    store.set({ downloads: [job('a'), job('b', 'music', null)] });
    expect(filesIn(SYSTEM_FOLDER.music).map((j) => j.id).sort()).toEqual(['a', 'b']);
  });

  it('lists newest first', () => {
    store.set({
      downloads: [
        { ...job('old'), createdAt: 1 },
        { ...job('new'), createdAt: 9 },
      ],
    });
    expect(filesIn(SYSTEM_FOLDER.music).map((j) => j.id)).toEqual(['new', 'old']);
  });
});

describe('fileCount', () => {
  it('counts only completed files, so a failed download is not shown as a stored song', () => {
    const f = ensureFolder('Jhol', 'music');
    store.set({
      downloads: [job('a', 'music', f.id), { ...job('b', 'music', f.id), state: 'failed' }],
    });
    expect(fileCount(f.id)).toBe(1);
  });
});

describe('renameFolder', () => {
  it('renames a user folder', () => {
    const f = ensureFolder('Jhol', 'music');
    expect(renameFolder(f.id, 'Jhol — Live')).toBe(true);
    expect(folderById(f.id)?.name).toBe('Jhol — Live');
  });

  it('refuses to touch the system folders', () => {
    expect(renameFolder('all-songs', 'Everything')).toBe(false);
    expect(folderById('all-songs')?.name).toBe('All songs');
  });

  it('refuses a name already used in the same section', () => {
    ensureFolder('Jhol', 'music');
    const other = ensureFolder('Other', 'music');
    expect(renameFolder(other.id, 'jhol')).toBe(false);
    expect(folderById(other.id)?.name).toBe('Other');
  });
});

describe('deleteFolder', () => {
  it('keeps the files and folds them back into the section bucket', () => {
    const f = ensureFolder('Jhol', 'music');
    store.set({ downloads: [job('a', 'music', f.id)] });
    expect(deleteFolder(f.id)).toEqual({ folded: 1 });
    expect(folderById(f.id)).toBeNull();
    expect(filesIn(SYSTEM_FOLDER.music).map((j) => j.id)).toEqual(['a']);
  });

  it('refuses to delete a system folder', () => {
    expect(deleteFolder('all-songs')).toBeNull();
    expect(folderById('all-songs')).not.toBeNull();
  });
});
