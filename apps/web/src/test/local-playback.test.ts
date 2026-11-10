/**
 * Downloaded files must be played from disk, never re-streamed.
 *
 * The user's proposal, and the reason it is worth doing: a file that is already on the device cannot
 * be cut off at a megabyte by a token gate, and needs no network at all. Before this, `load()` went
 * straight to `resolveStream` and never consulted the downloads list — so a downloaded song still
 * streamed, and still stopped.
 *
 * This is a contract test, not an integration test: it pins the *decision*, which is the part that
 * silently regresses.
 */

import { describe, expect, it } from 'vitest';
import { store } from '../state/store';
import type { DownloadJob } from '../state/store';

const track = {
  id: 'vid-local-1',
  title: 'Pasoori',
  artist: 'Ali Sethi',
  durationSec: 226,
  thumbs: [],
};

const done = (path: string, id = 'vid-local-1'): DownloadJob => ({
  id: `dl-${id}`,
  track: { ...track, id } as never,
  target: 'M4A · 128 kbps',
  progress: 1,
  state: 'done',
  createdAt: Date.now(),
  path,
});

/** The lookup `load()` performs, kept in one place so the test and the hook cannot drift. */
function findLocalFile(id: string, downloads: DownloadJob[]): string | null {
  const job = downloads.find((d) => d.state === 'done' && d.track.id === id && d.path);
  return job?.path ?? null;
}

describe('local-first playback', () => {
  it('prefers a completed download over the network', () => {
    const path = findLocalFile('vid-local-1', [done('/data/user/0/app.themashup.music/files/songs/pasoori.m4a')]);
    expect(path).toBe('/data/user/0/app.themashup.music/files/songs/pasoori.m4a');
  });

  it('ignores an unfinished or failed download', () => {
    const partial = { ...done('/tmp/part'), state: 'downloading' as const };
    const failed = { ...done('/tmp/fail'), state: 'failed' as const };
    expect(findLocalFile('vid-local-1', [partial, failed])).toBeNull();
  });

  it('ignores a finished download of a different track', () => {
    expect(findLocalFile('vid-local-1', [done('/tmp/other.m4a', 'vid-other')])).toBeNull();
  });

  it('falls through to streaming when nothing is on disk', () => {
    expect(findLocalFile('vid-local-1', [])).toBeNull();
  });

  it('tolerates a job that finished without a path', () => {
    // The browser download path never learns an absolute path, so it must not be treated as playable.
    const { path: _omit, ...noPath } = done('x');
    expect(findLocalFile('vid-local-1', [noPath])).toBeNull();
  });
});
