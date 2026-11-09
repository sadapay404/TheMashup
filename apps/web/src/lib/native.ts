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

type PluginName = 'MashupPlayer' | 'MashupDownloads' | 'MashupAccount' | 'MashupLog';

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

export async function nativePause(): Promise<void> {
  try {
    await invoke('MashupPlayer', 'pause');
  } catch {
    /* ignore */
  }
}

export async function nativeResume(): Promise<void> {
  try {
    await invoke('MashupPlayer', 'resume');
  } catch {
    /* ignore */
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

/** Subscribe to native playback/download events. Returns an unsubscribe function. */
export function onNativeEvent(
  event: 'playing' | 'ended' | 'error' | 'downloadProgress' | 'downloadComplete' | 'downloadFailed' | 'accountSignedIn' | 'accountSignedOut',
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
