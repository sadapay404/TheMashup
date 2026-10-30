import type { Track } from "@themashup/shared";
import { config } from "../config.js";
import { unavailable, upstream } from "../errors.js";

export interface LyricSearchHit {
  title: string;
  artist: string;
  snippet: string;
}

// A small deterministic fixture is used only when MOCK_UPSTREAM=1. It is not
// evidence of live Genius, YouTube, fallback, or lyrics-provider availability.
const fixture: LyricSearchHit[] = [
  { title: "Midnight Mirage", artist: "Nova Arcade", snippet: "City hums in ultraviolet" },
  { title: "Paper Crowns", artist: "Elder & Vine", snippet: "We wore paper crowns" },
  { title: "Neon Tide", artist: "Kite Society", snippet: "Ride the neon tide" },
];

function canonical(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** A title AND artist must agree before a lyric result is given a playable ID. */
export function matchCatalogTrack(hit: LyricSearchHit, tracks: Track[]): Track | null {
  const title = canonical(hit.title);
  const artist = canonical(hit.artist);
  if (!title || !artist) return null;
  const matches = (actual: string, expected: string) => {
    const value = canonical(actual);
    return value === expected || (expected.length >= 4 && value.startsWith(`${expected} `));
  };
  return tracks.find((track) =>
    Boolean(track.id) && matches(track.title ?? "", title) &&
    (track.artists?.some((item) => matches(item.name ?? "", artist)) || matches(track.artist_names ?? "", artist)),
  ) ?? null;
}

/** Parse only lyric-index hits and short plaintext highlights, never HTML. */
export function parseGeniusHits(body: unknown, limit: number): LyricSearchHit[] {
  const root = body as { response?: { sections?: unknown } } | null;
  const sections = root?.response?.sections;
  if (!Array.isArray(sections)) throw upstream("Lyric search returned an invalid response");
  if (sections.length === 0) return [];
  const section = sections.find((entry: any) => entry?.type === "lyric");
  if (!section || !Array.isArray(section.hits)) throw upstream("Lyric search returned an invalid response");
  const hits: LyricSearchHit[] = [];
  const seen = new Set<string>();
  for (const entry of section.hits) {
    const song = entry?.result;
    const title = typeof song?.title === "string" ? song.title.trim() : "";
    const rawArtist = song?.primary_artist?.name ?? song?.primary_artist_names;
    const artist = typeof rawArtist === "string" ? rawArtist.trim() : "";
    const highlight = Array.isArray(entry?.highlights)
      ? entry.highlights.find((item: any) => item?.property === "lyrics" && typeof item?.value === "string") : null;
    const snippet = typeof highlight?.value === "string"
      ? highlight.value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "";
    const key = `${canonical(title)}|${canonical(artist)}`;
    if (!title || !artist || !snippet || seen.has(key)) continue;
    seen.add(key);
    hits.push({ title: title.slice(0, 200), artist: artist.slice(0, 200), snippet });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Genius's public web search is unofficial, can change or block clients. */
export async function searchLyrics(query: string, limit: number): Promise<LyricSearchHit[]> {
  if (config.mockUpstream) {
    const q = canonical(query);
    return fixture.filter((hit) => canonical(hit.snippet).includes(q)).slice(0, limit);
  }
  const params = new URLSearchParams({ q: query, per_page: String(Math.min(limit, 4)), text_format: "plain" });
  let response: Response;
  try {
    response = await fetch(`https://genius.com/api/search/lyric?${params}`, {
      headers: { "User-Agent": "TheMashup/0.1 (personal music player)", "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw unavailable("Lyric search provider unavailable");
  }
  if (!response.ok) throw upstream(`Lyric search provider returned ${response.status}`);
  let body: unknown;
  try { body = await response.json(); }
  catch { throw upstream("Lyric search returned an invalid response"); }
  return parseGeniusHits(body, limit);
}
