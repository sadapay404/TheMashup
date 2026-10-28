import type { LyricMatch, Track } from "../types.js";
import { rankSearchResults, type RankedTrack } from "./rank.js";
import { normalize } from "./fuzzy.js";

export type HybridRow =
  | { kind: "track"; key: string; track: RankedTrack; rank_score: number }
  | { kind: "lyric"; key: string; match: LyricMatch["matches"][number]; rank_score: number };

/**
 * Merge the two halves of the smart search bar:
 *   A) metadata results (songs/artists from the catalog resolver)
 *   B) lyric-match candidates (free text / partial lyrics → LRCLIB)
 *
 * Lyric rows that duplicate an already-present track are dropped; everything
 * is interleaved by score so "blinding lights" (exact) and "the lights are
 * blinding in the dark" (lyric hit) both land in one dropdown.
 */
export function mergeHybrid(
  tracks: Track[],
  lyricMatches: LyricMatch["matches"],
  query: string,
): HybridRow[] {
  const ranked = rankSearchResults(tracks, query);
  const seen = new Set(
    ranked.map((t) => `${normalize(t.title)}|${normalize(t.artist_names)}`),
  );

  const trackRows: HybridRow[] = ranked.map((t) => ({
    kind: "track",
    key: `track:${t.id}`,
    track: t,
    rank_score: t.rank_score,
  }));

  const lyricRows: HybridRow[] = [];
  for (const m of lyricMatches) {
    const dedupeKey = `${normalize(m.track_name)}|${normalize(m.artist_name)}`;
    if (seen.has(dedupeKey)) continue;
    if ((m.similarity ?? 0) < 0.3) continue;
    lyricRows.push({
      kind: "lyric",
      key: `lyric:${m.lrclib_id}`,
      match: m,
      rank_score: Math.min(1, m.similarity * 0.95),
    });
  }

  return [...trackRows, ...lyricRows].sort((a, b) => b.rank_score - a.rank_score);
}

/** Flatten helper for keyboard navigation over mixed rows. */
export function hybridIndexBounds(rows: HybridRow[]): number {
  return rows.length - 1;
}
