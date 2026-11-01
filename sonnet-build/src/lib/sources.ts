import type { Album, Artist, LyricsResponse, SearchResponse, Track } from "./types";
import { parseLrc } from "./format";

const PIPED = (process.env.PIPED_INSTANCES ??
  "https://api.piped.private.coffee,https://pipedapi.kavin.rocks,https://pipedapi.adminforge.de,https://pipedapi.leptons.xyz")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

const INVIDIOUS = (process.env.INVIDIOUS_INSTANCES ??
  "https://yewtu.be,https://inv.nadeko.net,https://invidious.nerdvpn.de")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

export async function getJson<T>(url: string, timeoutMs = 6000, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: { "user-agent": "TheMashup/1.0", accept: "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Try every base in order, return first successful parse. */
async function failover<T>(
  bases: string[],
  path: string,
  parse: (j: unknown) => T | null,
  timeoutMs = 5000,
): Promise<{ value: T; base: string } | null> {
  for (const base of bases) {
    try {
      const j = await getJson<unknown>(base + path, timeoutMs);
      const v = parse(j);
      if (v) return { value: v, base };
    } catch {
      /* next mirror */
    }
  }
  return null;
}

const vid = (url: string | undefined) => (url ? new URL(url, "https://x.invalid").searchParams.get("v") : null);

/* ---------------- iTunes (reliable metadata + preview failover) ---------------- */
type ITunesItem = {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  artistId?: number;
  collectionId?: number;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
};

const art = (u?: string, size = 400) => u?.replace("100x100bb", `${size}x${size}bb`);

function itunesTrack(i: ITunesItem): Track | null {
  if (!i.trackId || !i.trackName) return null;
  return {
    id: `it:${i.trackId}`,
    title: i.trackName,
    artist: i.artistName ?? "Unknown",
    album: i.collectionName,
    artwork: art(i.artworkUrl100),
    duration: i.trackTimeMillis ? Math.round(i.trackTimeMillis / 1000) : undefined,
    previewUrl: i.previewUrl,
  };
}

async function itunes(term: string, entity: string, limit = 20): Promise<ITunesItem[]> {
  const j = await getJson<{ results: ITunesItem[] }>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=${limit}`,
    6000,
  );
  return j.results ?? [];
}

/* ---------------- Search ---------------- */
type PipedItem = {
  url?: string;
  type?: string;
  title?: string;
  name?: string;
  thumbnail?: string;
  uploaderName?: string;
  duration?: number;
};

async function catalogSongs(q: string, via: string[]): Promise<Track[]> {
  const piped = await failover(PIPED, `/search?q=${encodeURIComponent(q)}&filter=music_songs`, (j) => {
    const items = (j as { items?: PipedItem[] }).items;
    return items?.length ? items : null;
  });
  if (piped) {
    via.push(new URL(piped.base).host);
    const out: Track[] = [];
    for (const i of piped.value) {
      const id = vid(i.url);
      if (!id || !i.title) continue;
      out.push({
        id: `yt:${id}`,
        title: i.title,
        artist: (i.uploaderName ?? "Unknown").replace(/ - Topic$/, ""),
        artwork: i.thumbnail,
        duration: i.duration && i.duration > 0 ? i.duration : undefined,
      });
    }
    if (out.length) return out;
  }
  const inv = await failover(INVIDIOUS, `/api/v1/search?q=${encodeURIComponent(q)}&type=video`, (j) =>
    Array.isArray(j) && j.length ? (j as { videoId: string; title: string; author: string; lengthSeconds: number }[]) : null,
  );
  if (inv) {
    via.push(new URL(inv.base).host);
    return inv.value.slice(0, 20).map((v) => ({
      id: `yt:${v.videoId}`,
      title: v.title,
      artist: v.author.replace(/ - Topic$/, ""),
      artwork: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      duration: v.lengthSeconds,
    }));
  }
  try {
    const items = await itunes(q, "song");
    via.push("itunes");
    return items.map(itunesTrack).filter((t): t is Track => !!t);
  } catch {
    return [];
  }
}

async function catalogArtistsAlbums(q: string): Promise<{ artists: Artist[]; albums: Album[] }> {
  try {
    const [a, b] = await Promise.all([itunes(q, "musicArtist", 6), itunes(q, "album", 8)]);
    return {
      artists: a
        .filter((x) => x.artistId)
        .map((x) => ({ id: String(x.artistId), name: x.artistName ?? "Artist" })),
      albums: b
        .filter((x) => x.collectionId)
        .map((x) => ({
          id: String(x.collectionId),
          title: x.collectionName ?? "Album",
          artist: x.artistName ?? "",
          artwork: art(x.artworkUrl100),
        })),
    };
  } catch {
    return { artists: [], albums: [] };
  }
}

type LrcItem = {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

function bestLine(lyrics: string, q: string): string | undefined {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return undefined;
  const lines = lyrics.split(/\r?\n/).map((l) => l.replace(/\[[^\]]*\]/g, "").trim()).filter(Boolean);
  let best: { l: string; s: number } | undefined;
  for (const l of lines) {
    const low = l.toLowerCase();
    const s = words.filter((w) => low.includes(w)).length;
    if (s && (!best || s > best.s)) best = { l, s };
  }
  return best?.l;
}

async function lyricSearch(q: string): Promise<Track[]> {
  try {
    const list = await getJson<LrcItem[]>(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, 6000);
    return list.slice(0, 12).map((i) => ({
      id: `lr:${i.id}`,
      title: i.trackName,
      artist: i.artistName,
      album: i.albumName,
      duration: i.duration ? Math.round(i.duration) : undefined,
      lyricLine: bestLine(i.syncedLyrics ?? i.plainLyrics ?? "", q),
    }));
  } catch {
    return [];
  }
}

/** Dual-mode search: catalog + lyric index in parallel, merged. */
export async function search(q: string, filter: string): Promise<SearchResponse> {
  const via: string[] = [];
  const wantSongs = filter === "all" || filter === "songs";
  const wantLyrics = filter === "all" || filter === "lyrics";
  const wantArtists = filter === "all" || filter === "artists";
  const [songs, lyrics, aa] = await Promise.all([
    wantSongs ? catalogSongs(q, via) : Promise.resolve([] as Track[]),
    wantLyrics ? lyricSearch(q) : Promise.resolve([] as Track[]),
    wantArtists ? catalogArtistsAlbums(q) : Promise.resolve({ artists: [], albums: [] }),
  ]);
  const seen = new Set(songs.map((s) => `${s.title}|${s.artist}`.toLowerCase()));
  const lyricsOnly = lyrics.filter((l) => !seen.has(`${l.title}|${l.artist}`.toLowerCase()));
  const res: SearchResponse = { songs, lyrics: lyricsOnly, artists: aa.artists, albums: aa.albums, via };
  if (!songs.length && !lyrics.length && !aa.artists.length) {
    res.error = "No sources responded. Check your connection and try again.";
  }
  return res;
}

export async function suggest(q: string): Promise<string[]> {
  const p = await failover(PIPED, `/suggestions?query=${encodeURIComponent(q)}`, (j) =>
    Array.isArray(j) && j.length ? (j as string[]) : null, 3000);
  if (p) return p.value.slice(0, 8);
  const i = await failover(INVIDIOUS, `/api/v1/search/suggestions?q=${encodeURIComponent(q)}`, (j) => {
    const s = (j as { suggestions?: string[] }).suggestions;
    return s?.length ? s : null;
  }, 3000);
  return i ? i.value.slice(0, 8) : [];
}

export async function trending(): Promise<Track[]> {
  try {
    const j = await getJson<{
      feed: { entry: { "im:name": { label: string }; "im:artist": { label: string }; "im:image": { label: string }[]; id: { attributes: { "im:id": string } }; link: { attributes: { href: string; type?: string } }[] | { attributes: { href: string; type?: string } } }[] };
    }>("https://itunes.apple.com/us/rss/topsongs/limit=24/json", 6000);
    return j.feed.entry.map((e) => {
      const links = Array.isArray(e.link) ? e.link : [e.link];
      const prev = links.find((l) => l.attributes.type?.startsWith("audio"))?.attributes.href;
      return {
        id: `it:${e.id.attributes["im:id"]}`,
        title: e["im:name"].label,
        artist: e["im:artist"].label,
        artwork: art(e["im:image"][e["im:image"].length - 1]?.label.replace(/\d+x\d+bb/, "100x100bb")),
        previewUrl: prev,
      };
    });
  } catch {
    return [];
  }
}

export async function related(track: { id: string; artist: string; title: string }): Promise<Track[]> {
  const via: string[] = [];
  const list = await catalogSongs(track.artist, via);
  return list.filter((t) => t.id !== track.id && t.title !== track.title).slice(0, 15);
}

/* ---------------- Stream resolution with failover ---------------- */
type PipedStreams = {
  audioStreams?: { url: string; bitrate: number; mimeType: string; quality?: string }[];
  videoStreams?: { url: string; videoOnly: boolean; mimeType: string; quality: string }[];
};

export type Resolved = { url: string; kind: "full" | "preview" | "video"; via: string; mime?: string };

export async function resolveStream(
  t: { id: string; title: string; artist: string; previewUrl?: string },
  opts: { bitrate?: number; video?: boolean } = {},
): Promise<Resolved | null> {
  let videoId = t.id.startsWith("yt:") ? t.id.slice(3) : null;
  if (!videoId) {
    const via: string[] = [];
    const found = await catalogSongs(`${t.artist} ${t.title}`, via);
    const first = found.find((f) => f.id.startsWith("yt:"));
    if (first) videoId = first.id.slice(3);
  }
  if (videoId) {
    const target = (opts.bitrate ?? 320) * 1000;
    const p = await failover(PIPED, `/streams/${videoId}`, (j) => {
      const s = j as PipedStreams;
      return s.audioStreams?.length || s.videoStreams?.length ? s : null;
    }, 6000);
    if (p) {
      const s = p.value;
      if (opts.video) {
        const v = s.videoStreams?.find((x) => !x.videoOnly && x.mimeType.includes("mp4"));
        if (v) return { url: v.url, kind: "video", via: new URL(p.base).host, mime: "video/mp4" };
      } else if (s.audioStreams?.length) {
        const sorted = [...s.audioStreams].sort(
          (a, b) => Math.abs(a.bitrate - target) - Math.abs(b.bitrate - target),
        );
        const m4a = sorted.find((x) => x.mimeType.includes("mp4")) ?? sorted[0];
        return { url: m4a.url, kind: "full", via: new URL(p.base).host, mime: m4a.mimeType.split(";")[0] };
      }
    }
    const inv = await failover(INVIDIOUS, `/api/v1/videos/${videoId}?local=true`, (j) => {
      const f = (j as { adaptiveFormats?: { url: string; type: string; bitrate: string }[] }).adaptiveFormats;
      return f?.filter((x) => x.type.startsWith("audio/")).length ? f : null;
    }, 6000);
    if (inv && !opts.video) {
      const a = inv.value.filter((x) => x.type.startsWith("audio/"));
      a.sort((x, y) => Math.abs(Number(x.bitrate) - target) - Math.abs(Number(y.bitrate) - target));
      return { url: a[0].url.startsWith("http") ? a[0].url : inv.base + a[0].url, kind: "full", via: new URL(inv.base).host, mime: a[0].type.split(";")[0] };
    }
  }
  if (opts.video) return null;
  // Last resort: 30s catalog preview.
  let preview = t.previewUrl;
  if (!preview) {
    try {
      const items = await itunes(`${t.artist} ${t.title}`, "song", 3);
      preview = items.find((i) => i.previewUrl)?.previewUrl;
    } catch {
      /* ignore */
    }
  }
  return preview ? { url: preview, kind: "preview", via: "itunes-preview", mime: "audio/mp4" } : null;
}

/* ---------------- Lyrics (lrclib) ---------------- */
export async function lyrics(title: string, artist: string, duration?: number): Promise<LyricsResponse> {
  const empty: LyricsResponse = { synced: [], plain: "" };
  const pick = (i: LrcItem): LyricsResponse => ({
    synced: i.syncedLyrics ? parseLrc(i.syncedLyrics) : [],
    plain: i.plainLyrics ?? "",
  });
  try {
    const qs = new URLSearchParams({ track_name: title, artist_name: artist });
    if (duration) qs.set("duration", String(Math.round(duration)));
    return pick(await getJson<LrcItem>(`https://lrclib.net/api/get?${qs}`, 6000));
  } catch {
    try {
      const list = await getJson<LrcItem[]>(
        `https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${title}`)}`,
        6000,
      );
      const hit = list.find((l) => l.syncedLyrics) ?? list.find((l) => l.plainLyrics);
      return hit ? pick(hit) : empty;
    } catch {
      return empty;
    }
  }
}

/* ---------------- Account verification ---------------- */
import { createHash } from "node:crypto";

export async function verifyYouTubeCookie(cookie: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const sapisid = /(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/.exec(cookie)?.[1];
  if (!sapisid) return { ok: false, error: "Cookie is missing SAPISID / __Secure-3PAPISID." };
  const ts = Math.floor(Date.now() / 1000);
  const origin = "https://music.youtube.com";
  const hash = createHash("sha1").update(`${ts} ${sapisid} ${origin}`).digest("hex");
  try {
    const res = await fetch("https://music.youtube.com/youtubei/v1/account/account_menu?prettyPrint=false", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin,
        "x-origin": origin,
        authorization: `SAPISIDHASH ${ts}_${hash}`,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      },
      body: JSON.stringify({ context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20240101.01.00", hl: "en" } } }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: `Account endpoint returned HTTP ${res.status}.` };
    const text = await res.text();
    const name = /"accountName":\{"runs":\[\{"text":"([^"]+)"/.exec(text)?.[1];
    return name ? { ok: true, name } : { ok: false, error: "Session was not recognized (signed out or expired)." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
