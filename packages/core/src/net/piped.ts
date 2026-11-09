/**
 * Browser-mode provider: Piped / Invidious compatible public APIs.
 *
 * WHY THIS EXISTS (and why it beats a relay)
 *   InnerTube has no CORS headers, so a browser cannot call it. Instead of pushing our JSON through a
 *   generic CORS relay (slow, fragile, third-party trust), we use the public *Piped* and *Invidious*
 *   APIs, which are CORS-enabled BY DESIGN because their own frontends are web apps.
 *
 *   Result: browser mode does real streaming with no relay, no proxy we run, and no server.
 *   Native builds (Android/Tauri) still prefer InnerTube directly — it has the richest music payload.
 *
 * HONEST LIMITATION: these are community-run instances. Any of them can go down or be rate-limited.
 * The ladder tries several, and the Diagnostics screen reports exactly which one answered.
 */

import type { AudioFormat, SearchResult, StreamInfo, Track, VideoFormat } from '../domain.js';

export interface PublicApiInstance {
  id: string;
  kind: 'piped' | 'invidious';
  base: string;
  /** Music-specific search is only available on Piped `/search?filter=music_songs`. */
  musicSearch: boolean;
}

/**
 * Default ladder. Users can edit this list in Settings and it persists locally.
 * Ordered by observed reliability; every one is probed before use.
 */
export const DEFAULT_INSTANCES: PublicApiInstance[] = [
  // Order: official Piped first (multi-region CDN, actively maintained), then well-known community
  // instances from TeamPiped's public list, then Invidious. Two entries used to be here that had
  // been dead for over a year (a common Piped problem — instances are routinely repurposed or go
  // offline), which meant browser search failed unless one specific host happened to be up.
  { id: 'piped.kavin.rocks', kind: 'piped', base: 'https://pipedapi.kavin.rocks', musicSearch: true },
  { id: 'piped.adminforge', kind: 'piped', base: 'https://pipedapi.adminforge.de', musicSearch: true },
  { id: 'piped.leptons', kind: 'piped', base: 'https://pipedapi.leptons.xyz', musicSearch: true },
  { id: 'piped.drgns', kind: 'piped', base: 'https://pipedapi.drgns.space', musicSearch: true },
  { id: 'piped.ducks', kind: 'piped', base: 'https://pipedapi.ducks.party', musicSearch: true },
  { id: 'piped.private.coffee', kind: 'piped', base: 'https://api.piped.private.coffee', musicSearch: true },
  { id: 'piped.reallyaweso', kind: 'piped', base: 'https://pipedapi.reallyaweso.me', musicSearch: true },
  { id: 'piped.darkness', kind: 'piped', base: 'https://pipedapi.darkness.services', musicSearch: true },
  // Invidious has no music-only filter, so these are the broad fallback.
  { id: 'inv.nadeko.net', kind: 'invidious', base: 'https://inv.nadeko.net', musicSearch: false },
  { id: 'invidious.nerdvpn', kind: 'invidious', base: 'https://invidious.nerdvpn.de', musicSearch: false },
];

const TIMEOUT_MS = 9000;

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------- mapping helpers

function secsFromText(t: string | undefined): number {
  if (!t) return 0;
  const parts = t.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return (parts[0] as number) * 3600 + (parts[1] as number) * 60 + (parts[2] as number);
  if (parts.length === 2) return (parts[0] as number) * 60 + (parts[1] as number);
  return parts[0] ?? 0;
}

function idFromUrl(u: string | undefined): string | null {
  if (!u) return null;
  const m = u.match(/[?&]v=([\w-]{11})/);
  return m?.[1] ?? null;
}

function thumbsFromPiped(t: { url?: string } | undefined): Track['thumbs'] {
  const url = t?.url;
  if (!url) return [];
  // Piped thumbs are ytimg URLs; build a small srcset manually.
  return [
    { url, width: 60, height: 60 },
    { url, width: 320, height: 320 },
  ];
}

interface PipedSearchItem {
  url?: string;
  title?: string;
  uploaderName?: string;
  uploaderUrl?: string;
  duration?: number;
  thumbnail?: string;
  type?: string;
}

function mapPipedSearchItem(item: PipedSearchItem, source: string): Track | null {
  const id = idFromUrl(item.url);
  if (!id) return null;
  return {
    id,
    title: item.title ?? '(unknown title)',
    artist: item.uploaderName ?? '',
    ...(item.uploaderUrl ? { artistId: item.uploaderUrl } : {}),
    durationSec: typeof item.duration === 'number' ? item.duration : secsFromText(undefined),
    thumbs: item.thumbnail
      ? [
          { url: item.thumbnail, width: 60, height: 60 },
          { url: item.thumbnail, width: 320, height: 320 },
        ]
      : [],
    source,
  };
}

interface InvidiousSearchItem {
  videoId?: string;
  title?: string;
  author?: string;
  authorId?: string;
  lengthSeconds?: number;
  videoThumbnails?: Array<{ url?: string; width?: number; height?: number }>;
}

function mapInvidiousItem(item: InvidiousSearchItem, source: string): Track | null {
  if (!item.videoId) return null;
  const thumbs = (item.videoThumbnails ?? [])
    .filter((t): t is { url: string; width?: number; height?: number } => typeof t?.url === 'string')
    .map((t) => ({ url: t.url, width: t.width ?? 0, height: t.height ?? 0 }));
  return {
    id: item.videoId,
    title: item.title ?? '(unknown title)',
    artist: item.author ?? '',
    ...(item.authorId ? { artistId: item.authorId } : {}),
    durationSec: item.lengthSeconds ?? 0,
    thumbs,
    source,
  };
}

// ---------------------------------------------------------------- provider

export interface ProviderHealth {
  instance: string;
  ok: boolean;
  latencyMs: number;
}

export class PublicApiProvider {
  /**
   * Instances that recently failed, and when.
   *
   * This used to be a permanent `Set`, so one timeout — a mobile radio handing over between cells is
   * enough — exiled a perfectly good instance for the entire session, and the ladder shrank with
   * every failed attempt until search returned nothing. A failure now expires, so the ladder heals.
   */
  private dead = new Map<string, number>();
  /** How long a failed instance sits out before it is retried. */
  private static readonly RETRY_MS = 60_000;
  private preferred: string | undefined;
  lastUsed: string | undefined;
  health: ProviderHealth[] = [];

  constructor(private instances: PublicApiInstance[] = DEFAULT_INSTANCES) {}

  setInstances(list: PublicApiInstance[]): void {
    this.instances = list;
    this.dead.clear();
    this.preferred = undefined;
  }

  get instancesList(): PublicApiInstance[] {
    return this.instances;
  }

  /** Ordered candidates: the last known-good instance first, then everything still alive. */
  private ordered(): PublicApiInstance[] {
    const now = Date.now();
    for (const [id, at] of this.dead) {
      if (now - at > PublicApiProvider.RETRY_MS) this.dead.delete(id);
    }
    const alive = this.instances.filter((i) => !this.dead.has(i.id));
    if (!alive.length) {
      // Everything failed at some point — reset and try again rather than giving up silently.
      this.dead.clear();
      return this.instances;
    }
    if (!this.preferred) return alive;
    const first = alive.find((i) => i.id === this.preferred);
    return first ? [first, ...alive.filter((i) => i.id !== this.preferred)] : alive;
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    for (const inst of this.ordered()) {
      try {
        const result =
          inst.kind === 'piped'
            ? await this.searchPiped(inst, query, signal)
            : await this.searchInvidious(inst, query, signal);
        if (result.sections.length) {
          this.preferred = inst.id;
          this.lastUsed = inst.id;
          return result;
        }
      } catch {
        this.dead.set(inst.id, Date.now());
      }
    }
    return { sections: [] };
  }

  private async searchPiped(inst: PublicApiInstance, query: string, signal?: AbortSignal): Promise<SearchResult> {
    const filter = inst.musicSearch ? 'music_songs' : 'all';
    const json = await getJson(`${inst.base}/search?q=${encodeURIComponent(query)}&filter=${filter}`, signal);
    const root = json as { items?: PipedSearchItem[] };
    const items = Array.isArray(root?.items) ? root.items : [];
    const tracks = items.map((i) => mapPipedSearchItem(i, inst.id)).filter((t): t is Track => t !== null);
    return tracks.length ? { sections: [{ kind: 'songs', items: tracks }] } : { sections: [] };
  }

  private async searchInvidious(inst: PublicApiInstance, query: string, signal?: AbortSignal): Promise<SearchResult> {
    const json = await getJson(
      `${inst.base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
      signal,
    );
    const list = Array.isArray(json) ? json : [];
    const tracks = (list as InvidiousSearchItem[])
      .filter((i) => typeof i.videoId === 'string')
      .map((i) => mapInvidiousItem(i, inst.id))
      .filter((t): t is Track => t !== null);
    return tracks.length ? { sections: [{ kind: 'songs', items: tracks }] } : { sections: [] };
  }

  /** Resolve audio + video formats for a track. */
  async stream(videoId: string, signal?: AbortSignal): Promise<StreamInfo | null> {
    for (const inst of this.ordered()) {
      try {
        const info =
          inst.kind === 'piped'
            ? await this.streamPiped(inst, videoId, signal)
            : await this.streamInvidious(inst, videoId, signal);
        if (info && info.audio.length) {
          this.preferred = inst.id;
          this.lastUsed = inst.id;
          return info;
        }
      } catch {
        this.dead.set(inst.id, Date.now());
      }
    }
    return null;
  }

  private async streamPiped(inst: PublicApiInstance, videoId: string, signal?: AbortSignal): Promise<StreamInfo | null> {
    const json = await getJson(`${inst.base}/streams/${videoId}`, signal);
    const root = json as {
      audioStreams?: Array<{ itag?: number; mimeType?: string; codec?: string; bitrate?: number; quality?: string; url?: string; contentLength?: number }>;
      videoStreams?: Array<{ itag?: number; mimeType?: string; codec?: string; bitrate?: number; quality?: string; width?: number; height?: number; fps?: number; url?: string; videoOnly?: boolean }>;
      duration?: number;
    };

    const audio: AudioFormat[] = [];
    const video: VideoFormat[] = [];
    const urls: Record<number, string> = {};

    for (const a of root.audioStreams ?? []) {
      const itag = Number(a.itag ?? 0);
      if (!itag) continue;
      const kbps = Math.round(Number(a.bitrate ?? 0) / 1000);
      if (a.url) urls[itag] = a.url;
      audio.push({
        itag,
        codec: (a.codec ?? (a.mimeType?.includes('opus') ? 'Opus' : 'AAC')).replace(/^audio\//, '').toUpperCase(),
        nominalKbps: kbps,
        actualKbps: kbps,
        container: a.mimeType?.includes('webm') ? 'webm' : 'm4a',
        quality: a.quality ?? '',
        deliver: a.url ? 'url' : 'none',
        premiumOnly: false,
      });
    }

    const byRes = new Map<string, VideoFormat>();
    for (const v of root.videoStreams ?? []) {
      const itag = Number(v.itag ?? 0);
      if (!itag) continue;
      const height = Number(v.height ?? Number(v.quality?.replace('p', '')) ?? 0);
      const res = height ? `${height}p` : (v.quality ?? '?');
      if (byRes.has(res)) continue;
      if (v.url) urls[itag] = v.url;
      byRes.set(res, {
        itag,
        height,
        res,
        codec: v.codec ?? 'unknown',
        fps: Number(v.fps ?? 30),
        kbps: Math.round(Number(v.bitrate ?? 0) / 1000),
        container: v.mimeType?.includes('webm') ? 'webm' : 'mp4',
        hasAudio: v.videoOnly === false,
        deliver: v.url ? 'url' : 'none',
      });
    }

    audio.sort((a, b) => b.nominalKbps - a.nominalKbps);
    return {
      videoId,
      profile: `piped:${inst.id}`,
      audio,
      video: [...byRes.values()],
      expiresInSec: 6 * 3600,
      playability: 'OK',
      urls,
    };
  }

  private async streamInvidious(inst: PublicApiInstance, videoId: string, signal?: AbortSignal): Promise<StreamInfo | null> {
    const json = await getJson(`${inst.base}/api/v1/videos/${videoId}?fields=adaptiveFormats,formatStreams`, signal);
    interface InvFormat {
      itag?: string;
      type?: string;
      bitrate?: string;
      qualityLabel?: string;
      url?: string;
      audioQuality?: string;
      resolution?: string;
    }
    const root = json as { adaptiveFormats?: InvFormat[]; formatStreams?: InvFormat[] };

    const audio: AudioFormat[] = [];
    const video: VideoFormat[] = [];
    const urls: Record<number, string> = {};

    for (const f of [...(root.adaptiveFormats ?? []), ...(root.formatStreams ?? [])]) {
      const itag = Number(f.itag ?? 0);
      if (!itag) continue;
      const type = f.type ?? '';
      const kbps = Math.round(Number(f.bitrate ?? '0') / 1000);
      if (f.url) urls[itag] = f.url;
      if (type.startsWith('audio/')) {
        audio.push({
          itag,
          codec: (type.match(/codecs="([^"]+)"/)?.[1] ?? 'unknown').toUpperCase(),
          nominalKbps: kbps,
          actualKbps: kbps,
          container: type.includes('webm') ? 'webm' : 'm4a',
          quality: f.audioQuality ?? '',
          deliver: f.url ? 'url' : 'none',
          premiumOnly: false,
        });
      } else if (type.startsWith('video/')) {
        const height = Number(f.qualityLabel?.replace('p', '') ?? 0);
        video.push({
          itag,
          height,
          res: f.qualityLabel ?? f.resolution ?? '?',
          codec: type.match(/codecs="([^"]+)"/)?.[1] ?? 'unknown',
          fps: 30,
          kbps,
          container: type.includes('webm') ? 'webm' : 'mp4',
          hasAudio: type.includes('mp4a') || type.includes('opus'),
          deliver: f.url ? 'url' : 'none',
        });
      }
    }

    audio.sort((a, b) => b.nominalKbps - a.nominalKbps);
    return {
      videoId,
      profile: `invidious:${inst.id}`,
      audio,
      video,
      expiresInSec: 6 * 3600,
      playability: 'OK',
      urls,
    };
  }

  /** Probe every instance; feeds the Diagnostics table. */
  async probe(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];
    for (const inst of this.instances) {
      const t0 = performance.now();
      try {
        await getJson(
          inst.kind === 'piped' ? `${inst.base}/trending?region=US` : `${inst.base}/api/v1/stats`,
        );
        results.push({ instance: inst.id, ok: true, latencyMs: Math.round(performance.now() - t0) });
      } catch {
        results.push({ instance: inst.id, ok: false, latencyMs: Math.round(performance.now() - t0) });
      }
    }
    this.health = results;
    return results;
  }
}

export { thumbsFromPiped };
