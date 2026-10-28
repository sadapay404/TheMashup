import { useSessionStore } from "../stores/sessionStore";

import type {
  ArtistRef,
  DownloadJob,
  FormatManifest,
  Lyrics,
  LyricMatch,
  PlaylistMeta,
  RadioResponse,
  RecShelf,
  SearchResponse,
  StreamResponse,
  Track,
} from "@themashup/shared";

/**
 * Gateway origin. Empty on the web (same-origin → Vite proxy); absolute inside
 * the Tauri shell where the page runs on the tauri: scheme and must reach the
 * local gateway directly. VITE_API_BASE overrides both (e.g. remote gateway).
 */
export const API_BASE: string = (() => {
  if (typeof window === "undefined") return "";
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  if (env?.VITE_API_BASE) return env.VITE_API_BASE.replace(/\/$/, "");
  const loc = window.location;
  if (loc.protocol === "tauri:" || loc.hostname === "tauri.localhost") {
    return "http://127.0.0.1:4000";
  }
  return "";
})();

/** Prefix a root-relative gateway path with the active API base. */
export const apiUrl = (path: string): string =>
  path.startsWith("/api") ? API_BASE + path : path;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Demo identity (x-dev-user) or Supabase Bearer token — attached to every call. */
function authHeaders(): Record<string, string> {
  try {
    const s = useSessionStore.getState();
    if (s.mode === "supabase" && s.accessToken) {
      return { authorization: `Bearer ${s.accessToken}` };
    }
    if (s.mode === "demo" && s.user?.id) {
      return { "x-dev-user": s.user.id.replace(/^dev:/, "") };
    }
  } catch {
    /* session store unavailable */
  }
  return {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...authHeaders(),
        ...init?.headers,
      },
    });
  } catch (err) {
    throw new ApiError(0, `Cannot reach TheMashup API (${(err as Error).message})`, "NETWORK");
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const e = (body as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(res.status, e?.message ?? `Request failed (${res.status})`, e?.code);
  }
  return body as T;
}

export const api = {
  health: () =>
    request<{
      ok: boolean;
      lyrics_provider: string;
      resolver?: { ok?: boolean; ffmpeg?: boolean; downloads?: boolean; mock?: boolean };
    }>("/api/health"),

  recommendations: (kind: RecShelf["kind"] = "quick") =>
    request<RecShelf>(`/api/recommendations?kind=${kind}`),

  radio: (body: { seed_video_id?: string; query?: string; limit?: number }) =>
    request<RadioResponse>("/api/radio", { method: "POST", body: JSON.stringify(body) }),

  resolveStreams: async (videoId: string) => {
    const res = await request<StreamResponse>("/api/streams", {
      method: "POST",
      body: JSON.stringify({ video_id: videoId }),
    });
    // play_url is root-relative from the gateway — absolute it in the desktop shell.
    res.candidates = (res.candidates ?? []).map((c) => ({ ...c, play_url: apiUrl(c.play_url) }));
    return res;
  },

  track: (id: string) => request<Track & { related: Track[] }>(`/api/track/${id}`),

  related: (id: string) =>
    request<{ related: Track[] }>(`/api/related/${id}`),

  lyrics: (trackId: string) => request<Lyrics & { track_id: string }>(`/api/lyrics/${trackId}`),

  lyricsMatch: (q: string) =>
    request<LyricMatch>(`/api/lyrics/match?q=${encodeURIComponent(q)}`),

  search: (q: string, type = "auto") =>
    request<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&type=${type}`),

  suggest: async (q: string) => {
    const r = await request<{ suggestions: string[] }>(
      `/api/search/suggest?q=${encodeURIComponent(q)}`,
    );
    return r.suggestions ?? [];
  },

  /* ── Phase 5: formats + downloads ─────────────────────────────── */
  formats: (trackId: string) => request<FormatManifest>(`/api/formats/${encodeURIComponent(trackId)}`),

  /** Query-string identity for contexts that cannot set headers (<a download>). */
  fileUrl: (jobId: string) => {
    const { mode, user, accessToken } = useSessionStore.getState();
    const q = new URLSearchParams();
    if (mode === "demo" && user?.id) q.set("dev_user", user.id.replace(/^dev:/, ""));
    if (mode === "supabase" && accessToken) q.set("access_token", accessToken);
    const qs = q.toString();
    return apiUrl(`/api/downloads/${jobId}/file${qs ? `?${qs}` : ""}`);
  },

  downloads: {
    list: () => request<{ jobs: DownloadJob[] }>("/api/downloads"),
    create: (body: { video_id: string; container: string; quality: string; title?: string }) =>
      request<{ job: DownloadJob }>("/api/downloads", { method: "POST", body: JSON.stringify(body) }),
    cancel: (id: string) =>
      request<{ job: DownloadJob }>(`/api/downloads/${id}`, { method: "DELETE" }),

    /**
     * Fetch-based SSE (identity travels in headers — no EventSource query tokens).
     * Returns a cancel function.
     */
    stream: (
      onSnapshot: (jobs: DownloadJob[]) => void,
      onError?: () => void,
    ): (() => void) => {
      const ctrl = new AbortController();
      void (async () => {
        try {
          const res = await fetch(apiUrl("/api/downloads/stream"), {
            headers: authHeaders(),
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const line = frame.split("\n").find((l) => l.startsWith("data:"));
              if (!line) continue;
              try {
                const payload = JSON.parse(line.slice(5)) as { jobs?: DownloadJob[] };
                if (payload.jobs) onSnapshot(payload.jobs);
              } catch {
                /* partial frame */
              }
            }
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") onError?.();
        }
      })();
      return () => ctrl.abort();
    },
  },

  /* ── Phase 4: library (requires identity) ─────────────────────── */
  library: {
    likes: () => request<{ likes: Track[] }>("/api/library/likes"),
    like: (track: Track) => request<{ ok: boolean }>("/api/library/likes", { method: "PUT", body: JSON.stringify({ track }) }),
    unlike: (trackId: string) =>
      request<{ ok: boolean }>(`/api/library/likes/${encodeURIComponent(trackId)}`, { method: "DELETE" }),
    history: () => request<{ history: { track: Track; at: string; context?: string }[] }>("/api/library/history"),
    playlists: () => request<{ playlists: PlaylistMeta[] }>("/api/library/playlists"),
    createPlaylist: (title: string) =>
      request<{ playlist: PlaylistMeta }>("/api/library/playlists", { method: "POST", body: JSON.stringify({ title }) }),
    deletePlaylist: (id: string) =>
      request<{ ok: boolean }>(`/api/library/playlists/${id}`, { method: "DELETE" }),
    playlist: (id: string) =>
      request<{ meta: PlaylistMeta; tracks: Track[] }>(`/api/library/playlists/${id}`),
    addToPlaylist: (id: string, track: Track) =>
      request<{ ok: boolean }>(`/api/library/playlists/${id}/tracks`, { method: "POST", body: JSON.stringify({ track }) }),
    removeFromPlaylist: (id: string, trackId: string) =>
      request<{ ok: boolean }>(`/api/library/playlists/${id}/tracks/${encodeURIComponent(trackId)}`, { method: "DELETE" }),
    reorderPlaylist: (id: string, trackIds: string[]) =>
      request<{ meta: PlaylistMeta; tracks: Track[] }>(
        `/api/library/playlists/${id}/tracks/order`,
        { method: "PATCH", body: JSON.stringify({ track_ids: trackIds }) },
      ),
    follows: () => request<{ follows: ArtistRef[] }>("/api/library/follows"),
    follow: (artist: ArtistRef) =>
      request<{ ok: boolean }>("/api/library/follows", { method: "PUT", body: JSON.stringify({ artist }) }),
    unfollow: (key: string) =>
      request<{ ok: boolean }>(`/api/library/follows/${encodeURIComponent(key)}`, { method: "DELETE" }),
  },

  /** Fire-and-forget listening event (buffered gateway-side). */
  event: (ev: { type: string; track_id: string; listened_ms?: number; context?: string }) => {
    void fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ev),
    }).catch(() => undefined);
  },
};
