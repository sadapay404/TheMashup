/**
 * Native bridge (Android via Capacitor).
 *
 * The web build runs everywhere; this module is the only place that knows native plugins exist.
 * Every call is capability-detected and returns a Result-like value, so the browser build is
 * byte-for-byte functional without them.
 *
 * Playback note: when the native Media3 service is available we hand it the resolved stream URL and
 * stop the local <audio> element, so audio continues with the screen off and shows on the lockscreen.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

interface PluginRef {
  addListener?: (event: string, cb: (data: unknown) => void) => { remove: () => void };
  [method: string]: unknown;
}

function cap(): CapacitorGlobal | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNative(): boolean {
  return Boolean(cap()?.isNativePlatform?.());
}

type PluginName = 'MashupPlayer' | 'MashupDownloads' | 'MashupAccount' | 'MashupLog' | 'MashupExtractor';

function plugin(name: PluginName): PluginRef | null {
  const c = cap();
  if (!c?.Plugins) return null;
  return (c.Plugins[name] as PluginRef | undefined) ?? null;
}

async function invoke(name: PluginName, method: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const p = plugin(name);
  if (!p) throw new Error(`${name} unavailable`);
  const fn = p[method];
  if (typeof fn !== 'function') throw new Error(`${name}.${method} missing`);
  return (fn as (a: Record<string, unknown>) => Promise<unknown>).call(p, args);
}

export interface NativePlayPayload {
  url: string;
  title: string;
  artist: string;
  artUrl?: string;
  durationMs: number;
  /** Load and start playing (default on the native side). Pass false to preload without audio. */
  shouldPlay?: boolean;
  /**
   * Request headers the media URL needs, when the resolver reported any.
   *
   * A CDN that issued a URL for a particular `Referer` refuses it without one, and the refusal looks
   * exactly like the stream dying. Passed through to `PlaybackService` and applied by
   * `MediaItemHeaders` at request time.
   */
  headers?: Record<string, string>;
}

/** True when a native Media3 session exists and can take over playback. */
export function hasNativePlayback(): boolean {
  return Boolean(plugin('MashupPlayer'));
}

export async function nativePlay(p: NativePlayPayload): Promise<boolean> {
  if (!hasNativePlayback()) return false;
  try {
    await invoke('MashupPlayer', 'play', { ...p });
    return true;
  } catch {
    return false;
  }
}

/**
 * Headers the media request needs, if the resolver reported any.
 *
 * Some URLs only serve bytes when asked with the `Referer` (or `User-Agent`) they were issued for.
 * Passing them through is the difference between a stream that starts and a 403 that looks like the
 * stream dying — the exact failure this app has chased for months.
 */
/**
 * Play a track through Media3, with the resolver's request headers attached.
 *
 * `nativePlay` above is kept for callers that have no headers (a local file, a plain CDN URL); this
 * is the same call plus the optional map, and is what the resolution path uses.
 */
/**
 * End playback outright and retire the notification.
 *
 * Distinct from pause: the X on the song card means "make it stop", and a paused Media3 session keeps
 * its media item, lockscreen entry and shade entry alive. `pause + seek(0)` — what this used to do —
 * left the player sitting in the notification tray showing a track that was supposed to be gone.
 */
export async function nativeStop(): Promise<void> {
  if (!hasNativePlayback()) return;
  try {
    await invoke('MashupPlayer', 'stop');
  } catch {
    /* the service may already be gone — nothing to retire */
  }
}

export async function nativePause(): Promise<void> {
  try {
    await invoke('MashupPlayer', 'pause');
  } catch {
    /* ignore */
  }
}

/**
 * Resume playback.
 *
 * Returns false when the service refused — which is not noise: `Player.play()` on an empty playlist
 * is a silent no-op, so a resume after a track failed to resolve would otherwise leave the UI showing
 * "playing" with no audio anywhere. The caller uses this to start the track instead of waiting.
 */
export async function nativeResume(): Promise<boolean> {
  try {
    await invoke('MashupPlayer', 'resume');
    return true;
  } catch {
    return false;
  }
}

export async function nativeSeek(positionMs: number): Promise<void> {
  try {
    await invoke('MashupPlayer', 'seek', { positionMs });
  } catch {
    /* ignore */
  }
}

export async function nativeSetVolume(volume: number): Promise<void> {
  try {
    await invoke('MashupPlayer', 'setVolume', { volume });
  } catch {
    /* ignore */
  }
}

export async function nativeSetRate(rate: number): Promise<void> {
  try {
    await invoke('MashupPlayer', 'setRate', { rate });
  } catch {
    /* ignore */
  }
}

export async function nativeState(): Promise<{ positionMs: number; durationMs: number; isPlaying: boolean } | null> {
  try {
    const res = (await invoke('MashupPlayer', 'getState')) as { positionMs?: number; durationMs?: number; isPlaying?: boolean };
    return {
      positionMs: Number(res.positionMs ?? 0),
      durationMs: Number(res.durationMs ?? 0),
      isPlaying: Boolean(res.isPlaying),
    };
  } catch {
    return null;
  }
}

/**
 * The native stream extractor (GPL APK only).
 *
 * Resolution order in [MusicService.resolveStream] is: this, then InnerTube client profiles, then the
 * public mirrors, then the direct downloader. It is first because it is the only rung that produces a
 * URL that is not token-gated — a gated URL dies after roughly a megabyte, which the listener
 * experiences as the song stopping a third of the way in.
 *
 * Both calls are capability-detected. In the standard APK the plugin is absent, `installed` is false,
 * and the ladder simply starts at its second rung; nothing pretends otherwise.
 */
export interface NativeExtractorStatus {
  /** True when this APK contains a working extractor. */
  installed: boolean;
  /** `withNativeExtractor` (GPL) or `standard`. Diagnostic only. */
  flavour: string;
}

/** A stream the native extractor resolved, in the shape the player needs. */
export interface NativeResolvedStream {
  url: string;
  /** `progressive` is a plain file; `hls` / `dash` are manifests ExoPlayer can also play. */
  kind: 'progressive' | 'hls' | 'dash';
  itag: number;
  codec: string;
  kbps: number;
  mime: string;
  durationSec: number;
  /** Request headers the media URL needs, if any. */
  headers: Record<string, string>;
  /** Which provider answered (`newpipe`). */
  source: string;
  /**
   * A caveat about what was actually resolved, when there is one.
   *
   * `video_track` means the extractor could not separate an audio stream and fell back to the muxed
   * video track: it plays, but it is not the audio format the UI would otherwise claim. Reported so
   * the player can say so in one sentence instead of letting the user believe a 144p mux is a
   * 160 kbps audio stream.
   */
  note?: string;
}

let extractorStatus: NativeExtractorStatus | null = null;

/** Ask once per session whether this APK can resolve streams natively. */
export async function nativeExtractorStatus(): Promise<NativeExtractorStatus> {
  if (extractorStatus) return extractorStatus;
  if (!plugin('MashupExtractor')) {
    extractorStatus = { installed: false, flavour: 'standard' };
    return extractorStatus;
  }
  try {
    const res = (await invoke('MashupExtractor', 'available')) as { installed?: boolean; flavour?: string };
    extractorStatus = {
      installed: Boolean(res.installed),
      flavour: String(res.flavour ?? 'unknown'),
    };
  } catch {
    extractorStatus = { installed: false, flavour: 'unknown' };
  }
  return extractorStatus;
}

/**
 * Resolve a stream through the native extractor.
 *
 * Returns null when it is not installed, timed out, or found nothing. The reason is reported through
 * the optional `onReason` callback rather than thrown, because the ladder treats every rung the same
 * way and an exception here would abort a resolve that still has three rungs left.
 */
export async function nativeResolveStream(
  videoId: string,
  preferItag = 0,
  onReason?: (reason: string) => void,
): Promise<NativeResolvedStream | null> {
  if (!plugin('MashupExtractor')) {
    onReason?.('extractor_not_installed');
    return null;
  }
  try {
    const res = (await invoke('MashupExtractor', 'resolve', { videoId, preferItag })) as {
      ok?: boolean;
      reason?: string;
      detail?: string;
      url?: string;
      kind?: string;
      itag?: number;
      codec?: string;
      kbps?: number;
      mime?: string;
      durationSec?: number;
      headers?: Record<string, string>;
      source?: string;
      note?: string;
    };
    if (!res?.ok || !res.url) {
      onReason?.(res?.detail ? `${res.reason ?? 'failed'}: ${res.detail}` : (res?.reason ?? 'no_url'));
      return null;
    }
    const kind = res.kind === 'hls' || res.kind === 'dash' ? res.kind : 'progressive';
    return {
      url: res.url,
      kind,
      itag: Number(res.itag ?? 0),
      codec: String(res.codec ?? ''),
      kbps: Number(res.kbps ?? 0),
      mime: String(res.mime ?? ''),
      durationSec: Number(res.durationSec ?? 0),
      headers: res.headers && typeof res.headers === 'object' ? res.headers : {},
      source: String(res.source ?? 'newpipe'),
      ...(res.note ? { note: String(res.note) } : {}),
    };
  } catch (e) {
    onReason?.(`bridge_error: ${(e as Error).message}`);
    return null;
  }
}

/** Subscribe to native playback/download events. Returns an unsubscribe function. */
export function onNativeEvent(
  event:
    | 'playing'
    | 'ended'
    | 'error'
    | 'stopped'
    | 'downloadProgress'
    | 'downloadComplete'
    | 'downloadFailed'
    | 'accountSignedIn'
    | 'accountSignedOut'
    | 'toggleShuffle'
    | 'toggleRepeat'
    | 'toggleLike',
  cb: (data: unknown) => void,
): () => void {
  const p = plugin('MashupPlayer') ?? plugin('MashupDownloads') ?? plugin('MashupAccount');
  const listener = p?.addListener;
  if (typeof listener !== 'function') return () => undefined;
  try {
    const handle = (listener as (e: string, f: (d: unknown) => void) => { remove: () => void }).call(p, event, cb);
    return () => handle?.remove?.();
  } catch {
    return () => undefined;
  }
}

/** Download through the native foreground service (resumable, chunked, survives screen-off). */
export async function nativeDownload(args: {
  id: string;
  url: string;
  fileName: string;
  subdir?: string;
  /** Songs and videos are written under separate roots, so the file lands in the right section. */
  kind?: 'music' | 'video';
  publicMusicDir?: boolean;
  /**
   * Request headers the media URL needs.
   *
   * The same headers playback sends. A URL that plays in the player but 403s in the downloader is a
   * difference nobody can guess from the error message, so both paths take them from the resolver.
   */
  headers?: Record<string, string>;
}): Promise<{ id: string; path: string; folder: string } | null> {
  if (!plugin('MashupDownloads')) return null;
  try {
    const res = (await invoke('MashupDownloads', 'enqueue', { ...args })) as {
      id?: string;
      path?: string;
      folder?: string;
    };
    return {
      id: String(res.id ?? args.id),
      path: String(res.path ?? ''),
      folder: String(res.folder ?? ''),
    };
  } catch {
    return null;
  }
}

/** Ask the foreground service to abandon a transfer. Best-effort by design. */
export async function nativeCancelDownload(id: string): Promise<boolean> {
  if (!plugin('MashupDownloads')) return false;
  try {
    await invoke('MashupDownloads', 'cancel', { id });
    return true;
  } catch {
    return false;
  }
}

/** Account: native WebView sign-in (Android only). */
export async function nativeAccountStatus(): Promise<{ signedIn: boolean; visitorData: string } | null> {
  if (!plugin('MashupAccount')) return null;
  try {
    const res = (await invoke('MashupAccount', 'status')) as { signedIn?: boolean; visitorData?: string };
    return { signedIn: Boolean(res.signedIn), visitorData: String(res.visitorData ?? '') };
  } catch {
    return null;
  }
}

export async function nativeSignIn(): Promise<boolean> {
  try {
    await invoke('MashupAccount', 'signIn');
    return true;
  } catch {
    return false;
  }
}

export async function nativeCookie(): Promise<string | null> {
  try {
    const res = (await invoke('MashupAccount', 'cookie')) as { cookie?: string };
    const cookie = res.cookie;
    return cookie && cookie.length > 0 ? cookie : null;
  } catch {
    return null;
  }
}

/** A folder as the Android side reports it, read from the real filesystem. */
export interface NativeFolder {
  name: string;
  path: string;
  files: { name: string; path: string; size: number; modified: number }[];
  size: number;
}

export interface NativeTreeSection {
  kind: 'music' | 'video';
  root: string;
  folders: NativeFolder[];
  files: { name: string; path: string; size: number; modified: number }[];
}

/**
 * The real download tree, straight from disk.
 *
 * Only the Android build can answer this; the browser resolves to null and the UI keeps using the
 * state model. Never fabricate an empty tree here — "no files" and "cannot look" are different
 * answers and the UI says different things for each.
 */
export async function nativeTree(publicMusicDir = false): Promise<NativeTreeSection[] | null> {
  if (!plugin('MashupDownloads')) return null;
  try {
    const res = (await invoke('MashupDownloads', 'tree', { publicMusicDir })) as { sections?: NativeTreeSection[] };
    return Array.isArray(res.sections) ? res.sections : null;
  } catch {
    return null;
  }
}

export async function nativeCreateFolder(name: string, kind: 'music' | 'video' = 'music'): Promise<string | null> {
  try {
    const res = (await invoke('MashupDownloads', 'createFolder', { name, kind })) as { path?: string };
    return res.path ?? null;
  } catch {
    return null;
  }
}

/** Move a file on disk. Returns the new path, or null when the native side refused. */
export async function nativeMoveFile(args: {
  from: string;
  fromKind: 'music' | 'video';
  toFolder: string;
  toKind?: 'music' | 'video';
}): Promise<string | null> {
  try {
    const res = (await invoke('MashupDownloads', 'move', { ...args })) as { path?: string };
    return res.path ?? null;
  } catch {
    return null;
  }
}

export async function nativeRemoveFile(path: string, kind: 'music' | 'video' = 'music'): Promise<boolean> {
  try {
    const res = (await invoke('MashupDownloads', 'remove', { path, kind })) as { removed?: boolean };
    return Boolean(res.removed);
  } catch {
    return false;
  }
}

/** Build and device identity, so a report is tied to a specific APK. */
export interface NativeInfo {
  package: string;
  versionName: string;
  versionCode: number;
  sdk: number;
  device: string;
  debuggable: boolean;
  crashFile: string;
}

export async function nativeInfo(): Promise<NativeInfo | null> {
  try {
    return (await invoke('MashupLog', 'info')) as NativeInfo;
  } catch {
    return null;
  }
}

/**
 * The last fatal crash recorded on this device, if any.
 *
 * Returns null when the plugin is absent (browser) so the UI can say "not available here" rather
 * than implying no crash was recorded.
 */
export async function nativeCrashReport(): Promise<{ found: boolean; text: string } | null> {
  try {
    const res = (await invoke('MashupLog', 'crashes')) as { found?: boolean; text?: string };
    return { found: Boolean(res.found), text: String(res.text ?? '') };
  } catch {
    return null;
  }
}

export async function nativeLogcat(lines = 400): Promise<{ ok: boolean; text: string } | null> {
  try {
    const res = (await invoke('MashupLog', 'logcat', { lines })) as { ok?: boolean; text?: string };
    return { ok: Boolean(res.ok), text: String(res.text ?? '') };
  } catch {
    return null;
  }
}

export async function nativeClearCrash(): Promise<boolean> {
  try {
    await invoke('MashupLog', 'clear');
    return true;
  } catch {
    return false;
  }
}

/** Write a line into the on-device boot log, so the web half of startup is recorded too. */
export function nativeBootMark(message: string): void {
  if (!isNative()) return;
  void invoke('MashupLog', 'mark', { message }).catch(() => undefined);
}
