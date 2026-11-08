/**
 * Desktop bridge (Tauri).
 *
 * The desktop shell exists for three reasons, in order of importance:
 *   1. **native HTTP** — no origin, therefore no CORS, therefore no third-party relay. This is the
 *      single biggest reliability win in the whole architecture (ADR-001 made relays a compromise;
 *      this removes the compromise).
 *   2. tray + OS media keys
 *   3. remembering what you were playing across restarts
 *
 * Everything here is capability-detected. In a browser every function reports "unavailable" and the
 * app behaves exactly as before.
 */

interface TauriInternals {
  __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
}

interface TauriEventApi {
  listen?: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
}

function internals(): TauriInternals {
  return window as unknown as TauriInternals;
}

export function isDesktop(): boolean {
  // `__TAURI_INTERNALS__` is injected by Tauri 2 before any user script runs.
  return Boolean(internals().__TAURI_INTERNALS__?.invoke);
}

async function invoke<T>(cmd: string, args?: unknown): Promise<T | null> {
  const call = internals().__TAURI_INTERNALS__?.invoke;
  if (!call) return null;
  try {
    return (await call(cmd, args)) as T;
  } catch {
    return null;
  }
}

export interface DesktopCapabilities {
  nativeHttp: boolean;
  tray: boolean;
  mediaKeys: boolean;
  singleInstance: boolean;
}

export async function desktopCapabilities(): Promise<DesktopCapabilities> {
  const raw = await invoke<{ native_http?: boolean; tray?: boolean; media_keys?: boolean; single_instance?: boolean }>(
    'desktop_capabilities',
  );
  return {
    nativeHttp: Boolean(raw?.native_http),
    tray: Boolean(raw?.tray),
    mediaKeys: Boolean(raw?.media_keys),
    singleInstance: Boolean(raw?.single_instance),
  };
}

export interface NativeHttpResult {
  ok: boolean;
  status: number;
  body: string;
  error?: string;
}

/**
 * Perform a request through Rust. Returns `null` when the shell is absent so the caller can fall
 * through to the browser transport rather than treating "not applicable" as a failure.
 */
export async function nativeHttp(args: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<NativeHttpResult | null> {
  if (!isDesktop()) return null;
  const res = await invoke<{ ok?: boolean; status?: number; body?: string; error?: string }>('native_fetch', {
    request: {
      url: args.url,
      method: args.method,
      headers: args.headers,
      body: args.body ?? null,
      timeout_ms: args.timeoutMs ?? null,
    },
  });
  if (!res) return null;
  return {
    ok: Boolean(res.ok),
    status: Number(res.status ?? 0),
    body: String(res.body ?? ''),
    ...(res.error ? { error: res.error } : {}),
  };
}

/** Tray and media-key actions arrive here; the player owns what they mean. */
export type DesktopAction = 'toggle-play' | 'next' | 'prev' | 'stop';

export async function onDesktopAction(cb: (action: DesktopAction) => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined;
  const api = (window as unknown as { __TAURI__?: { event?: TauriEventApi } }).__TAURI__?.event;
  const listen = api?.listen;
  if (typeof listen !== 'function') return () => undefined;

  const unlisteners: Array<() => void> = [];
  for (const event of ['desktop://tray-action', 'desktop://media-key']) {
    try {
      const unlisten = await listen.call(api, event, (e) => {
        const value = e.payload;
        if (value === 'toggle-play' || value === 'next' || value === 'prev' || value === 'stop') cb(value);
      });
      unlisteners.push(unlisten);
    } catch {
      /* event API unavailable — media keys simply do nothing */
    }
  }
  return () => {
    for (const off of unlisteners) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
  };
}

/** Fired when the window is hidden instead of closed, so the renderer can flush state. */
export async function onWindowHidden(cb: () => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined;
  const api = (window as unknown as { __TAURI__?: { event?: TauriEventApi } }).__TAURI__?.event;
  if (typeof api?.listen !== 'function') return () => undefined;
  try {
    return await api.listen('desktop://window-hidden', () => cb());
  } catch {
    return () => undefined;
  }
}

/**
 * Native notifications.
 *
 * Uses the Web Notification API when the shell exposes it (Tauri maps this to the OS centre) and
 * degrades to a no-op otherwise. Never throws: a missed "now playing" toast must not break playback.
 */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      return;
    }
    if (Notification.permission === 'default') {
      const granted = await Notification.requestPermission();
      if (granted === 'granted') new Notification(title, { body });
    }
  } catch {
    /* notifications are a nicety, never a dependency */
  }
}
