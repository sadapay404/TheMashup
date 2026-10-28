import type {
  DownloadJob,
  FormatManifest,
  SearchResponse,
  StreamCandidate,
  StreamResponse,
  Track,
  ArtistRef,
} from "@themashup/shared";
import { config } from "../config.js";
import { ApiError, upstream, unavailable } from "../errors.js";
import { log } from "../logger.js";

/** Candidate as returned by the resolver — gateway assigns `play_url` tokens. */
export type UpstreamCandidate = Omit<StreamCandidate, "play_url" | "id"> & { id?: string };

export interface ResolverStreamsResponse extends Omit<StreamResponse, "candidates"> {
  candidates: UpstreamCandidate[];
}

/** Contract implemented by the HTTP client and by test fakes. */
export interface ResolverClient {
  health(): Promise<{ ok: boolean; mock?: boolean; detail?: unknown }>;
  search(query: string, limit: number): Promise<{
    tracks: Track[];
    artists: ArtistRef[];
    albums: SearchResponse["albums"];
    warnings: string[];
  }>;
  suggest(query: string, limit: number): Promise<string[]>;
  streams(videoId: string): Promise<ResolverStreamsResponse>;
  formats(videoId: string): Promise<FormatManifest>;
  meta(videoId: string): Promise<Track>;
  related(videoId: string): Promise<Track[]>;
  artist(channelId: string): Promise<{ artist: ArtistRef; tracks: Track[] }>;
  charts(): Promise<{ tracks: Track[]; warnings: string[] }>;
  startDownload(body: {
    video_id: string;
    container: string;
    quality: string;
    title?: string;
    owner: string;
  }): Promise<DownloadJob>;
  listDownloads(owner?: string): Promise<DownloadJob[]>;
  getDownload(id: string): Promise<DownloadJob>;
  cancelDownload(id: string, owner?: string): Promise<DownloadJob>;
  downloadFileUrl(id: string): string;
}

type CallOpts = number | (RequestInit & { timeoutMs?: number });

async function callResolver<T>(path: string, opts: CallOpts = {}): Promise<T> {
  const cfg: RequestInit & { timeoutMs?: number } =
    typeof opts === "number" ? { timeoutMs: opts } : opts;
  const { timeoutMs = 25_000, ...init } = cfg;
  const url = `${config.resolverUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    log.warn(`resolver unreachable: ${path}`, (err as Error).message);
    throw unavailable("Resolver service unreachable", {
      resolver_url: config.resolverUrl,
      cause: (err as Error).message,
    });
  }
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const detail = (body as { detail?: unknown })?.detail ?? text.slice(0, 300);
    throw upstream(`Resolver failed (${res.status}) for ${path}`, detail);
  }
  return body as T;
}

export const httpResolver: ResolverClient = {
  health: () =>
    callResolver<{ ok: boolean; mock?: boolean; detail?: unknown }>("/health", 4_000).catch(
      (err) => {
        if (err instanceof ApiError) return { ok: false, detail: err.detail };
        throw err;
      },
    ),
  search: (q, limit) => callResolver(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  suggest: async (q, limit) => {
    const r = await callResolver<{ suggestions: string[] }>(
      `/suggest?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
    return r.suggestions ?? [];
  },
  streams: (videoId) => callResolver(`/streams/${encodeURIComponent(videoId)}`),
  formats: (videoId) => callResolver(`/formats/${encodeURIComponent(videoId)}`),
  meta: (videoId) => callResolver(`/meta/${encodeURIComponent(videoId)}`),
  related: async (videoId) => {
    const r = await callResolver<{ related?: Track[] }>(`/related/${encodeURIComponent(videoId)}`);
    return r.related ?? [];
  },
  artist: (channelId) => callResolver(`/artist/${encodeURIComponent(channelId)}`),
  charts: () => callResolver("/charts"),
  startDownload: (body) =>
    callResolver<DownloadJob>("/downloads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 20_000,
    }),
  listDownloads: async (owner) => {
    const r = await callResolver<{ jobs: DownloadJob[] }>(
      `/downloads${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`,
      10_000,
    );
    return r.jobs ?? [];
  },
  getDownload: (id) => callResolver<DownloadJob>(`/downloads/${encodeURIComponent(id)}`, 10_000),
  cancelDownload: (id, owner) =>
    callResolver<DownloadJob>(`/downloads/${encodeURIComponent(id)}${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`, {
      method: "DELETE",
      timeoutMs: 10_000,
    }),
  downloadFileUrl: (id) => `${config.resolverUrl}/downloads/${encodeURIComponent(id)}/file`,
};
