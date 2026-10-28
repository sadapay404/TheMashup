import type { Lyrics, LyricMatch } from "@themashup/shared";
import { matchScore, normalize, parseLrc, similarity as textSimilarity } from "@themashup/shared";
import { config } from "../config.js";
import { log } from "../logger.js";

interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration?: number | null;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  instrumental?: boolean;
}

/** Offline fixtures used when MOCK_UPSTREAM=1 (sandbox demos, tests). */
const FIXTURE_LYRICS: { match: string; record: LrclibRecord }[] = [
  {
    match: "midnight mirage nova arcade",
    record: {
      id: 900001,
      trackName: "Midnight Mirage",
      artistName: "Nova Arcade",
      albumName: "Chrome Gardens",
      duration: 214,
      plainLyrics:
        "City hums in ultraviolet\nSignals fold into the night\nEvery shadow keeps a secret\nEvery street becomes a light",
      syncedLyrics:
        "[00:00.00]City hums in ultraviolet\n[00:07.50]Signals fold into the night\n[00:15.00]Every shadow keeps a secret\n[00:23.00]Every street becomes a light\n",
    },
  },
  {
    match: "paper crowns elder vine",
    record: {
      id: 900002,
      trackName: "Paper Crowns",
      artistName: "Elder & Vine",
      albumName: "Quiet Riot Season",
      duration: 187,
      plainLyrics: "We wore paper crowns\nAnd swore they were gold",
      syncedLyrics:
        "[00:04.00]We wore paper crowns\n[00:11.00]And swore they were gold\n[00:19.00]The rain had other plans\n",
    },
  },
  {
    match: "neon tide kite society",
    record: {
      id: 900003,
      trackName: "Neon Tide",
      artistName: "Kite Society",
      albumName: "Afterglow Club",
      duration: 231,
      plainLyrics: "Ride the neon tide\nHold the current close",
      syncedLyrics:
        "[00:02.00]Ride the neon tide\n[00:10.00]Hold the current close\n[00:18.00]Nothing here is borrowed\n",
    },
  },
];

/** Best-matching lyric line for the "matched lyric" snippet UI. */
function bestLine(r: LrclibRecord, query: string): string | undefined {
  const source =
    (r.plainLyrics ?? "").trim() ||
    (r.syncedLyrics ?? "")
      .split(/\r?\n/)
      .map((l) => l.replace(/\[[^\]]*\]/g, "").trim())
      .filter(Boolean)
      .join("\n");
  if (!source) return undefined;
  let best = "";
  let bestScore = 0;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 3) continue;
    const s = textSimilarity(query, line);
    if (s > bestScore) {
      bestScore = s;
      best = line;
    }
  }
  return bestScore >= 0.34 ? best : undefined;
}

function recordToMatch(r: LrclibRecord, query: string): LyricMatch["matches"][number] {
  // Score against BOTH "title artist" (metadata queries) AND the lyric body
  // (partial-lyric queries) — mirrors LRCLIB's full-text search behaviour.
  const titleArtistScore = matchScore(query, `${r.trackName} ${r.artistName}`);
  const plain = (r.plainLyrics ?? "").trim();
  const lyricTextScore = plain ? textSimilarity(query, plain) : 0;
  const similarity = Math.max(titleArtistScore, lyricTextScore);
  return {
    track_name: r.trackName,
    artist_name: r.artistName,
    album_name: r.albumName ?? undefined,
    duration_sec: r.duration ?? undefined,
    synced: Boolean(r.syncedLyrics),
    plain: Boolean(r.plainLyrics),
    similarity,
    lrclib_id: r.id,
    snippet: bestLine(r, query),
  };
}

function pickBest(records: LrclibRecord[], trackName: string, artistName: string, duration?: number) {
  const want = normalize(`${trackName} ${artistName}`);
  const scored = records.map((r) => {
    let s = matchScore(want, `${r.trackName} ${r.artistName}`);
    if (duration && r.duration && Math.abs(r.duration - duration) <= 3) s += 0.3;
    if (r.syncedLyrics) s += 0.1;
    return { r, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0]?.r;
}

function toLyrics(r: LrclibRecord, provider: "lrclib" | "mock"): Lyrics {
  return {
    plain: r.plainLyrics ?? undefined,
    synced: r.syncedLyrics ? parseLrc(r.syncedLyrics) : undefined,
    instrumental: r.instrumental,
    provider,
  };
}

async function lrclibFetch<T>(path: string, timeoutMs = 8_000): Promise<T | null> {
  try {
    const res = await fetch(`${config.lyricsBase}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "TheMashup/0.1 (personal music player)" },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      log.warn(`lrclib ${path} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    log.warn(`lrclib unreachable: ${path}`, (err as Error).message);
    return null;
  }
}

export const lyricsService = {
  provider: (): "lrclib" | "mock" => (config.mockUpstream ? "mock" : "lrclib"),

  /** Free-text / title / artist → ranked lyric candidates. */
  async match(query: string): Promise<LyricMatch> {
    const started = Date.now();
    if (config.mockUpstream) {
      const matches = FIXTURE_LYRICS.map((f) => recordToMatch(f.record, query))
        .filter((m) => m.similarity > 0.15)
        .sort((a, b) => b.similarity - a.similarity);
      return { query, matches, took_ms: Date.now() - started };
    }
    const records = await lrclibFetch<LrclibRecord[]>(
      `/api/search?q=${encodeURIComponent(query)}`,
    );
    const matches = (records ?? [])
      .slice(0, 20)
      .map((r) => recordToMatch(r, query))
      .filter((m) => m.similarity > 0.25)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 8);
    return { query, matches, took_ms: Date.now() - started };
  },

  /** Exact-ish lyrics for a track (metadata supplied by the gateway). */
  async forTrack(meta: {
    title: string;
    artist_names: string;
    duration_sec?: number;
    id?: string;
  }): Promise<Lyrics | null> {
    if (config.mockUpstream) {
      const want = normalize(`${meta.title} ${meta.artist_names}`);
      const hit = FIXTURE_LYRICS.find(
        (f) => matchScore(want, f.match) > 0.5 || normalize(f.record.trackName) === normalize(meta.title),
      );
      return hit ? toLyrics(hit.record, "mock") : null;
    }
    const params = new URLSearchParams({ track_name: meta.title, artist_name: meta.artist_names });
    if (meta.duration_sec) params.set("duration", String(Math.round(meta.duration_sec)));
    let record = await lrclibFetch<LrclibRecord>(`/api/get?${params.toString()}`);
    if (!record) {
      const records = await lrclibFetch<LrclibRecord[]>(
        `/api/search?q=${encodeURIComponent(`${meta.title} ${meta.artist_names}`)}`,
      );
      record = records?.length
        ? pickBest(records, meta.title, meta.artist_names, meta.duration_sec)
        : null;
    }
    return record ? toLyrics(record, "lrclib") : null;
  },
};
