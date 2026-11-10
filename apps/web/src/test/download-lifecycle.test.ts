/**
 * A download must be able to end — and the app must be able to say what happened.
 *
 * The tenth report's first item was "stuck on preparing download". Two independent things had to
 * be true for that sentence to be accurate, and both were:
 *
 *  1. The Android service posted a foreground notification whose text was the literal string
 *     "Preparing download…" and never re-posted it. Whatever the transfer did afterwards, the only
 *     surface that displayed progress kept claiming it was still preparing.
 *  2. Nothing had a deadline. A job that the service accepted but never reported on stayed in
 *     `downloading` at 0 % for the life of the install, and the list offered no cancel and no
 *     dismiss, so it could not even be cleared.
 *
 * These tests pin the second half. The first is Kotlin and is verified by the build, not here.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { store, type DownloadJob } from '../state/store';
import { cancelDownload, clearFinishedDownloads, removeDownload } from '../lib/downloader';

const track = {
  id: 'vid-lifecycle-1',
  title: 'Sahiba',
  artist: 'Jasleen Royal',
  durationSec: 240,
  thumbs: [],
};

const job = (id: string, state: DownloadJob['state'] = 'downloading'): DownloadJob => ({
  id,
  track: { ...track, id: `vid-${id}` } as never,
  target: 'M4A · 128 kbps',
  progress: state === 'done' ? 1 : 0,
  state,
  createdAt: Date.now(),
});

const ids = () => store.getState().downloads.map((d) => d.id);

describe('download jobs can always be ended', () => {
  beforeEach(() => {
    store.set({ downloads: [] });
  });

  it('cancelling forgets the job immediately', () => {
    store.set({ downloads: [job('a')] });
    cancelDownload('a');
    // No await: the user asked for it gone. Making the row disappear conditional on a native call
    // returning is how a cancel button ends up looking broken on the device that needs it.
    expect(ids()).toEqual([]);
  });

  it('cancelling one job leaves the others alone', () => {
    store.set({ downloads: [job('a'), job('b', 'queued')] });
    cancelDownload('a');
    expect(ids()).toEqual(['b']);
  });

  it('a failed job can be dismissed', () => {
    store.set({ downloads: [job('bad', 'failed')] });
    removeDownload('bad');
    expect(ids()).toEqual([]);
  });

  it('"clear finished" keeps live transfers and drops the rest', () => {
    store.set({
      downloads: [job('live'), job('done', 'done'), job('bad', 'failed'), job('waiting', 'queued')],
    });
    const removed = clearFinishedDownloads();
    expect(removed).toBe(2);
    expect(ids().sort()).toEqual(['live', 'waiting']);
  });

  it('"clear finished" on an all-live list reports that nothing was removed', () => {
    store.set({ downloads: [job('live')] });
    expect(clearFinishedDownloads()).toBe(0);
    expect(ids()).toEqual(['live']);
  });
});
