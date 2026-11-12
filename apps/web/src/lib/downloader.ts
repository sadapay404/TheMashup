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
import type { StreamInfo, Track } from '@themashup/core';
import { nativeCancelDownload, nativeDownload, isNative, onNativeEvent } from './native';
import { clearNotification, postNotification } from './notifications';
import { service } from './service';

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

/**
 * Keep a standing row in the shade while anything is transferring.
 *
 * The native service posts its own foreground progress notification, and that is the authoritative one
 * — but it only exists for jobs that reached `DownloadService`. A browser-path transfer, a job the
 * service rejected, or one that is sitting in `queued` has no foreground service behind it, and on the
 * device those were the downloads that appeared to do nothing at all. This row covers the gap: it is
 * derived from the same job list the UI shows, so what the shade says and what the screen says cannot
 * disagree.
 *
 * Cleared once nothing is in flight, so a finished queue does not leave a permanent "downloading 0%".
 */
const PROGRESS_NOTIF_ID = 6010;
function syncProgressNotification(): void {
  const jobs = store.getState().downloads;
  const active = jobs.filter((j) => j.state === 'downloading' || j.state === 'queued' || j.state === 'muxing');
  if (!active.length) {
    void clearNotification(PROGRESS_NOTIF_ID);
    return;
  }
  const pct = Math.round(
    (active.reduce((sum, j) => sum + (j.state === 'queued' ? 0 : Math.min(1, j.progress)), 0) / active.length) * 100,
  );
  const label = active.length === 1 ? active[0]!.track.title : `${active.length} tracks`;
  void postNotification({
    id: PROGRESS_NOTIF_ID,
    title: 'Downloading',
    body: label,
    channel: 'downloads',
    ongoing: true,
    progress: pct,
    route: 'downloads',
  });
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
export async function startDownload(
  track: Track,
  url: string,
  target: Target,
  folderName?: string,
  /** Request headers the resolved URL needs, when the resolver reported any. */
  startDownloadHeaders?: Record<string, string>,
): Promise<string> {
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
  syncProgressNotification();

  // Native path: the Kotlin service does resumable chunking and survives backgrounding.
  if (isNative() && !target.needsTranscode) {
    const res = await nativeDownload({
      id,
      url,
      fileName: fileNameFor(track, target),
      // A playlist download already decided which folder this belongs to; otherwise the album is
      // the sensible default. Either way the native side creates the real directory.
      ...(folderName ? { subdir: folderName } : track.album ? { subdir: track.album } : {}),
      kind: track.kind === 'video' ? 'video' : 'music',
      // Headers the resolver reported for this URL (Referer / User-Agent), so the transfer is
      // authorised exactly like playback.
      ...(startDownloadHeaders ? { headers: startDownloadHeaders } : {}),
    });
    if (res) {
      bindNativeDownloadEvents();
      // Keep the real on-disk path: a move later has to act on the file that exists, not on a name
      // reconstructed from the track title.
      update(id, { state: 'downloading', ...(res.path ? { path: res.path } : {}) });

      /*
       * The native service accepted the job, but that is a promise, not a transfer. If its events
       * never arrive — the service was killed, the bridge lost its sink, or the socket is silent —
       * this job sits on "downloading" forever and the only thing the user sees is a notification
       * that never moves. Nothing in the chain had a deadline, so a zombie job was indistinguishable
       * from a slow one.
       *
       * The watchdog turns silence into a visible failure with a reason. It is cleared by the first
       * real progress event (see `bindNativeDownloadEvents`), so a genuinely slow download on a poor
       * connection is unaffected.
       */
      armWatchdog(id);
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
  // Same deadline as the native path. A browser fetch to a dead CDN edge hangs without erroring,
  // so without this the row sits at 0 % indefinitely with nothing to act on.
  armWatchdog(id);

  try {
    const blob = await downloadWithRanges(
      url,
      (received, total) => {
        update(id, { progress: total > 0 ? received / total : 0, bytes: received, totalBytes: total });
        syncProgressNotification();
      },
      controller.signal,
    );
    clearWatchdog(id);
    update(id, { state: 'muxing', progress: 1 });
    await saveBlob(blob, fileNameFor(track, target));
    update(id, { state: 'done', progress: 1, totalBytes: blob.size });
    syncProgressNotification();
    store.notify(`Saved ${track.title}`, 'success', { notify: 'always', route: 'downloads' });
  } catch (e) {
    clearWatchdog(id);
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

/**
 * Fail a job that produces no sign of life.
 *
 * 45 s: long enough that a slow mobile start is not punished, short enough that a dead job does not
 * look like a working one for the rest of the session.
 */
const WATCHDOG_MS = 45_000;
const watchdogs = new Map<string, number>();

function armWatchdog(id: string): void {
  window.clearTimeout(watchdogs.get(id));
  watchdogs.set(
    id,
    window.setTimeout(() => {
      watchdogs.delete(id);
      const job = store.getState().downloads.find((j) => j.id === id);
      if (!job || job.state === 'done' || job.state === 'failed') return;
      update(id, {
        state: 'failed',
        error: 'The download service never reported progress. It may have been stopped by the system — retry, and check that the file can be fetched.',
      });
      syncProgressNotification();
      store.notify('Download stalled — no progress from the service', 'error', { route: 'downloads' });
    }, WATCHDOG_MS),
  );
}

function clearWatchdog(id: string): void {
  const t = watchdogs.get(id);
  if (t !== undefined) {
    window.clearTimeout(t);
    watchdogs.delete(id);
  }
}

export function bindNativeDownloadEvents(): void {
  if (nativeBound || !isNative()) return;
  nativeBound = true;

  onNativeEvent('downloadProgress', (data) => {
    const d = data as { id?: string; bytes?: number; total?: number };
    if (!d?.id) return;
    clearWatchdog(d.id);
    const total = Number(d.total ?? 0);
    const bytes = Number(d.bytes ?? 0);
    // exactOptionalPropertyTypes: only include totalBytes when it is actually known.
    update(d.id, {
      state: 'downloading',
      bytes,
      progress: total > 0 ? Math.min(1, bytes / total) : 0,
      ...(total > 0 ? { totalBytes: total } : {}),
    });
    syncProgressNotification();
  });

  onNativeEvent('downloadComplete', (data) => {
    const d = data as { id?: string; name?: string };
    if (!d?.id) return;
    clearWatchdog(d.id);
    update(d.id, { state: 'done', progress: 1 });
    syncProgressNotification();
    // 'always': a completed download is the canonical case for a shade entry — the user asked for the
    // file and has almost certainly left the app by the time it lands.
    store.notify(`Saved ${d.name ?? 'track'}`, 'success', { notify: 'always', route: 'downloads' });
  });

  onNativeEvent('downloadFailed', (data) => {
    const d = data as { id?: string; reason?: string };
    if (!d?.id) return;
    clearWatchdog(d.id);
    const cancelled = (d.reason ?? '').toLowerCase().includes('cancel');
    update(d.id, {
      // A cancel is not an error; anything else is, and carries the reason verbatim.
      state: cancelled ? 'partial' : 'failed',
      error: d.reason ?? 'download failed',
    });
    syncProgressNotification();
  });
}

/** Bytes currently queued/in-flight, for the Library storage line. */
/**
 * Abandon a job and forget it.
 *
 * Without this, a job that stalls had no exit: it stayed in "In progress" for the life of the
 * install, with no cancel, no retry and no way to remove the line. A list the user cannot clean is
 * worse than no list — it turns one bad transfer into permanent clutter.
 *
 * Cancelling the native side is best-effort: the job is forgotten locally either way, because the
 * user asked for it to be gone, not for a negotiation.
 */
export function cancelDownload(id: string): void {
  clearWatchdog(id);
  void nativeCancelDownload(id);
  store.set((s) => ({ downloads: s.downloads.filter((d) => d.id !== id) }));
  syncProgressNotification();
}

/** Drop a finished or failed job from the list. Running jobs go through `cancelDownload`. */
export function removeDownload(id: string): void {
  clearWatchdog(id);
  store.set((s) => ({ downloads: s.downloads.filter((d) => d.id !== id) }));
  syncProgressNotification();
}

/** Remove every job that is no longer doing anything. */
export function clearFinishedDownloads(): number {
  const before = store.getState().downloads.length;
  store.set((s) => ({
    downloads: s.downloads.filter((d) => d.state === 'downloading' || d.state === 'queued'),
  }));
  syncProgressNotification();
  return before - store.getState().downloads.length;
}

/**
 * Rebuild the exact `Target` a job was created from, using a freshly resolved stream.
 *
 * Matching is by itag, which is the stable identity of a format. The label is rebuilt rather than
 * reused so a retry cannot inherit a stale bitrate.
 */
export function targetFor(info: StreamInfo, itag: number): Target | null {
  const audio = info.audio.find((f) => f.itag === itag);
  if (audio) {
    return {
      label: `${audio.container.toUpperCase()} · ${audio.nominalKbps} kbps`,
      container: audio.container as Target['container'],
      itag,
      needsTranscode: false,
      kbps: audio.nominalKbps,
    };
  }
  const video = info.video.find((f) => f.itag === itag);
  if (video) {
    return {
      label: `${video.container.toUpperCase()} · ${video.res}${video.fps > 30 ? ` ${video.fps}fps` : ''}`,
      container: 'mp4',
      itag,
      needsTranscode: false,
    };
  }
  return null;
}

/**
 * Start the same track over again.
 *
 * A retry must re-resolve, never replay the old URL: stream URLs are signed and time-limited, so
 * retrying against a stored URL would fail for a reason unrelated to the original failure and would
 * look like the retry itself is broken. The itag is recovered from the previous job's id, which is
 * built as `dl-<itag>-<trackId>-<ts>` and is therefore the only place that identity survives.
 */
export async function retryDownload(job: DownloadJob): Promise<string | null> {
  const itag = Number(job.id.split('-')[1]);
  if (!Number.isFinite(itag)) {
    store.notify('Cannot retry this job — its format is unknown', 'error');
    return null;
  }
  const res = await service.resolveStream(job.track.id);
  if (!res.ok) {
    store.notify(res.error.message, 'error');
    return null;
  }
  const target = targetFor(res.info, itag);
  if (!target) {
    store.notify('That format is no longer offered for this track', 'error');
    return null;
  }
  const url = res.info.urls[itag];
  if (!url) {
    store.notify('This tier has no direct URL — try another.', 'error');
    return null;
  }
  // Re-resolve, re-forward headers: a retry against a stored URL fails for a reason unrelated to
  // the original failure — stream URLs are signed and time-limited.
  const headers = res.info.headers;
  return startDownload(job.track, url, target, undefined, headers);
}

export function pendingBytes(): number {
  return store.getState().downloads.reduce((n, j) => n + (j.bytes ?? 0), 0);
}
