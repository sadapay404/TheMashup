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

  it('does NOT save a 1-byte file when a 206 has no Content-Range', async () => {
    // Regression: a 206 without Content-Range used to be treated as "server ignored Range", so the
    // single probe byte was written out as the whole song and reported as success.
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const range = new Headers(init?.headers as HeadersInit).get('range');
      calls.push(range ?? 'no-range');
      if (range === 'bytes=0-0') {
        // One-byte probe response, 206, no Content-Range header.
        return {
          ok: true,
          status: 206,
          headers: new Headers(),
          body: { cancel: async () => undefined },
          blob: async () => new Blob([new Uint8Array(1)]),
          arrayBuffer: async () => new Uint8Array(1).buffer,
        } as unknown as Response;
      }
      // The follow-up full request.
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '2048' }),
        blob: async () => new Blob([new Uint8Array(2048)]),
        arrayBuffer: async () => new Uint8Array(2048).buffer,
      } as unknown as Response;
    });

    const id = await startDownload(track, 'https://example.test/a', target);
    const job = store.getState().downloads.find((j) => j.id === id);
    expect(job?.state).toBe('done');
    // The saved payload must be the real size, not the 1-byte probe.
    expect(job?.totalBytes).toBe(2048);
    expect(calls).toContain('no-range');
  });

  it('reports a cancelled save as partial, not as a failure', async () => {
    // Regression: dismissing the save dialog fell through to the anchor path and saved the file
    // anyway. It must also not be reported as an error.
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => ({
      createWritable: async () => {
        throw new DOMException('user aborted', 'AbortError');
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '16' }),
      blob: async () => new Blob([new Uint8Array(16)]),
      arrayBuffer: async () => new Uint8Array(16).buffer,
    } as unknown as Response);

    const id = await startDownload(track, 'https://example.test/a', target);
    const job = store.getState().downloads.find((j) => j.id === id);
    expect(job?.state).toBe('partial');
    expect(job?.error).toMatch(/cancelled/i);
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
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
