/**
 * Download engine (web + native routing).
 *
 * Web:   Range-chunked fetch → Blob → File System Access (or anchor download).
 * Native: handed to the Kotlin foreground service (resumable, survives screen-off).
 *
 * Honest constraints implemented here rather than hidden:
 *  - googlevideo URLs from a browser may be CORS-blocked for *reading* the body. We probe with a
 *    ranged GET first and report `BLOCKED` instead of hanging at 0 %.
 *  - we never claim a transcode happened. If the user asked for MP3/FLAC and no encoder is present,
 *    the job ends as `UNSUPPORTED` with the exact reason.
 */

import { store, type DownloadJob } from '@/state/store';
import type { Track } from '@themashup/core';
import { nativeDownload, isNative, onNativeEvent } from './native';

export type DownloadState = DownloadJob['state'];

const CHUNK_THRESHOLD = 4 * 1024 * 1024; // below this, one request is faster than 4
const MAX_PARALLEL = 4;

export interface Target {
  label: string;
  /** Container the user asked for (m4a/webm are stream copies; mp3/flac need an encoder). */
  container: 'm4a' | 'webm' | 'mp3' | 'flac' | 'mp4';
  itag: number;
  /** True when producing this file needs a real transcode. */
  needsTranscode: boolean;
  kbps?: number;
}

export function fileNameFor(track: Track, target: Target): string {
  const safe = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'untitled';
  return `${safe(track.artist)} - ${safe(track.title)} [${target.kbps ?? target.itag}k ${target.container}].${target.container}`;
}

function update(id: string, patch: Partial<DownloadJob>): void {
  store.set((s) => ({
    downloads: s.downloads.map((j) => (j.id === id ? { ...j, ...patch } : j)),
  }));
}

/** Read a Response into a Blob, tolerating environments whose stream() is unimplemented. */
async function readAsBlob(res: Response): Promise<Blob> {
  if (typeof res.blob === 'function') {
    try {
      return await res.blob();
    } catch {
      /* fall through */
    }
  }
  const buf = await res.arrayBuffer();
  return new Blob([buf]);
}

/** Fetch with byte-range support and progress reporting. Returns a Blob. */
async function downloadWithRanges(
  url: string,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const head = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal });
  if (head.status === 403) throw new Error('BLOCKED: the CDN refuses this origin (CORS)');
  if (!head.ok && head.status !== 206) throw new Error(`HTTP ${head.status}`);

  // Release the probe's connection before issuing the chunk requests; an undrained body holds a
  // socket open and some CDNs cap concurrent connections per origin.
  try {
    await head.body?.cancel();
  } catch {
    /* already consumed or unsupported */
  }

  const contentRange = head.headers.get('content-range'); // "bytes 0-0/12345678"
  const total = contentRange ? Number(contentRange.split('/')[1] ?? 0) : Number(head.headers.get('content-length') ?? 0);

  if (!contentRange) {
    if (head.status === 206) {
      // BUG GUARD: a 206 without Content-Range means the server honoured our 1-byte Range but did
      // not tell us the full size. The body here is a single byte; treating it as the whole file
      // would save a 1-byte "song" and report success. Re-request without a Range instead.
      const full = await fetch(url, { signal });
      if (full.status === 403) throw new Error('BLOCKED: the CDN refuses this origin (CORS)');
      if (!full.ok) throw new Error(`HTTP ${full.status}`);
      const blob = await readAsBlob(full);
      onProgress(blob.size, blob.size);
      return blob;
    }
    // A 200 means Range was ignored entirely and this body is the whole file.
    const blob = await readAsBlob(head);
    onProgress(blob.size, blob.size);
    return blob;
  }

  if (!Number.isFinite(total) || total <= 0) throw new Error('Unknown content length');

  const parts: Blob[] = new Array(MAX_PARALLEL).fill(new Blob());
  const chunkSize = Math.ceil(total / MAX_PARALLEL);
  let received = 0;

  await Promise.all(
    Array.from({ length: MAX_PARALLEL }, async (_v, i) => {
      const start = i * chunkSize;
      const end = Math.min(total - 1, start + chunkSize - 1);
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
      if (!res.ok) throw new Error(`chunk ${i} failed: HTTP ${res.status}`);
      const blob = await readAsBlob(res);
      parts[i] = blob;
      received += blob.size;
      onProgress(received, total);
    }),
  );

  return new Blob(parts);
}

/** Thrown when the user dismisses the save dialog, so the caller can mark the job cancelled. */
class SaveCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SaveCancelled';
  }
}

async function saveBlob(blob: Blob, fileName: string): Promise<void> {
  const w = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  };
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Audio', accept: { 'audio/*': [`.${fileName.split('.').pop() ?? 'm4a'}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      // Distinguish "the user said no" from "the API is unusable". Falling through on a cancel
      // would save the file the user just declined.
      if (e instanceof DOMException && e.name === 'AbortError') throw new SaveCancelled();
      if (e instanceof DOMException && e.name === 'NotAllowedError') throw new SaveCancelled();
      // Any other failure: fall back to the anchor download rather than losing the file.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Start a download. Returns the job id.
 * The job is registered immediately so the UI shows honest state, then it transitions.
 */
export async function startDownload(track: Track, url: string, target: Target): Promise<string> {
  const id = `dl-${target.itag}-${track.id}-${Date.now()}`;
  const job: DownloadJob = {
    id,
    track,
    target: target.label,
    progress: 0,
    state: 'queued',
    createdAt: Date.now(),
  };
  store.set((s) => ({ downloads: [job, ...s.downloads].slice(0, 60) }));

  // Native path: the Kotlin service does resumable chunking and survives backgrounding.
  if (isNative() && !target.needsTranscode) {
    const res = await nativeDownload({
      id,
      url,
      fileName: fileNameFor(track, target),
      ...(track.album ? { subdir: track.album } : {}),
    });
    if (res) {
      bindNativeDownloadEvents();
      update(id, { state: 'downloading' });
      return id;
    }
    // fall through to the browser path if the plugin rejected it
  }

  if (target.needsTranscode) {
    update(id, {
      state: 'failed',
      error: `Transcoding to .${target.container} needs an encoder. In the browser this runs through the WebAssembly media pipeline, which is not bundled in this build — pick ${target.container === 'mp3' ? 'WEBM/M4A' : 'a stream-copy'} to download now.`,
    });
    store.notify('That target needs a transcode — pick a stream-copy tier.', 'error');
    return id;
  }

  const controller = new AbortController();
  update(id, { state: 'downloading' });

  try {
    const blob = await downloadWithRanges(
      url,
      (received, total) => {
        update(id, { progress: total > 0 ? received / total : 0, bytes: received, totalBytes: total });
      },
      controller.signal,
    );
    update(id, { state: 'muxing', progress: 1 });
    await saveBlob(blob, fileNameFor(track, target));
    update(id, { state: 'done', progress: 1, totalBytes: blob.size });
    store.notify(`Saved ${track.title}`, 'success');
  } catch (e) {
    if (e instanceof SaveCancelled) {
      // Not an error: the user chose not to save. Keep the progress so a retry can resume.
      update(id, { state: 'partial', error: 'Saved to disk was cancelled — the download can be retried.' });
      store.notify('Save cancelled', 'info');
      return id;
    }
    const message = e instanceof Error ? e.message : 'download failed';
    const blocked = message.includes('BLOCKED');
    update(id, {
      state: blocked ? 'partial' : 'failed',
      error: blocked
        ? 'The media CDN blocked this browser origin. Install the Android build, or switch the source route in Settings.'
        : message,
    });
    store.notify(blocked ? 'Blocked by the CDN — try the Android build.' : 'Download failed', 'error');
  }

  return id;
}

/**
 * Mirror the native foreground service into the job list.
 *
 * Without this the UI would show 0 % forever on Android: the Kotlin service owns the transfer and
 * reports over its own event bus. Registered once per session.
 */
let nativeBound = false;
export function bindNativeDownloadEvents(): void {
  if (nativeBound || !isNative()) return;
  nativeBound = true;

  onNativeEvent('downloadProgress', (data) => {
    const d = data as { id?: string; bytes?: number; total?: number };
    if (!d?.id) return;
    const total = Number(d.total ?? 0);
    const bytes = Number(d.bytes ?? 0);
    // exactOptionalPropertyTypes: only include totalBytes when it is actually known.
    update(d.id, {
      state: 'downloading',
      bytes,
      progress: total > 0 ? Math.min(1, bytes / total) : 0,
      ...(total > 0 ? { totalBytes: total } : {}),
    });
  });

  onNativeEvent('downloadComplete', (data) => {
    const d = data as { id?: string; name?: string };
    if (!d?.id) return;
    update(d.id, { state: 'done', progress: 1 });
    store.notify(`Saved ${d.name ?? 'track'}`, 'success');
  });

  onNativeEvent('downloadFailed', (data) => {
    const d = data as { id?: string; reason?: string };
    if (!d?.id) return;
    const cancelled = (d.reason ?? '').toLowerCase().includes('cancel');
    update(d.id, {
      // A cancel is not an error; anything else is, and carries the reason verbatim.
      state: cancelled ? 'partial' : 'failed',
      error: d.reason ?? 'download failed',
    });
  });
}

/** Bytes currently queued/in-flight, for the Library storage line. */
export function pendingBytes(): number {
  return store.getState().downloads.reduce((n, j) => n + (j.bytes ?? 0), 0);
}
