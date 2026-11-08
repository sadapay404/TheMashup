/** Downloader unit tests: naming safety, range maths, and honest failure states. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileNameFor, startDownload, type Target } from '../lib/downloader';
import { store } from '../state/store';

const track = {
  id: 'vid00000001',
  title: 'Song/With:Bad*Chars?',
  artist: 'Art\\ist',
  album: 'Alb',
  durationSec: 200,
  thumbs: [],
};

const target: Target = { label: 'WEBM 160k', container: 'webm', itag: 251, needsTranscode: false, kbps: 160 };

afterEach(() => {
  vi.restoreAllMocks();
  store.set({ downloads: [] });
});

describe('fileNameFor', () => {
  it('strips path separators and reserved characters', () => {
    const name = fileNameFor(track, target);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).toContain('Art_ist');
    expect(name.endsWith('.webm')).toBe(true);
  });

  it('never produces an empty base name', () => {
    const name = fileNameFor({ ...track, title: '///', artist: '??' }, target);
    expect(name.replace(/[\[\]\.\- ]/g, '').length).toBeGreaterThan(0);
  });
});

describe('startDownload', () => {
  it('refuses a transcode target honestly instead of faking success', async () => {
    const id = await startDownload(track, 'https://example.test/a', {
      ...target,
      container: 'mp3',
      needsTranscode: true,
    });
    const job = store.getState().downloads.find((j) => j.id === id);
    expect(job?.state).toBe('failed');
    expect(job?.error).toContain('encoder');
  });

  it('completes a single-request download when the server ignores Range', async () => {
    // jsdom's Response cannot take a Blob body, so build the minimal shape the downloader uses.
    const stub = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '1024' }),
      blob: async () => new Blob([new Uint8Array(1024)]),
      arrayBuffer: async () => new Uint8Array(1024).buffer,
    } as unknown as Response;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(stub);
    // jsdom has no showSaveFilePicker/anchor download side effects that matter here.
    const id = await startDownload(track, 'https://example.test/a', target);
    const job = store.getState().downloads.find((j) => j.id === id);
    if (job?.state !== 'done') throw new Error(`unexpected state ${job?.state}: ${job?.error}`);
    expect(job.progress).toBe(1);
  });

  it('marks the job partial when the CDN returns 403 (CORS block)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      { ok: false, status: 403, headers: new Headers() } as unknown as Response,
    );
    const id = await startDownload(track, 'https://example.test/a', target);
    const job = store.getState().downloads.find((j) => j.id === id);
    expect(job?.state).toBe('partial');
    expect(job?.error).toMatch(/blocked|CDN/i);
  });
});
