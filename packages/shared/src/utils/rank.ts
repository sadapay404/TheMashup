import type { Track } from "../types.js";
import { matchScore, normalize } from "./fuzzy.js";

/**
 * Merge strategy for the hybrid search bar: the gateway collects results from
 * several sources (metadata search, lyric match), then ranks them here.
 *
 * Priority: exact title/artist hits, then fuzzy title hits, then popularity.
 * Lyric-derived candidates carry a `lyric_similarity` from the matcher.
 */
export interface RankedTrack extends Track {
  rank_score: number;
  matched_lyric?: string;
}

export function rankSearchResults(
  tracks: Track[],
  query: string,
  opts: { lyricIds?: Map<number | string, { similarity: number; snippet?: string }> } = {},
): RankedTrack[] {
  const q = normalize(query);
  const qTokens = new Set(q.split(" ").filter(Boolean));

  const ranked = tracks.map((t): RankedTrack => {
    const titleSim = matchScore(query, t.title);
    const artistSim = matchScore(query, t.artist_names);
    const titleNorm = normalize(t.title);

    let exactBonus = 0;
    if (titleNorm === q) exactBonus = 0.5;
    else if (titleNorm.startsWith(q)) exactBonus = 0.3;

    // Partial word coverage of the query in the title.
    let wordHits = 0;
    for (const w of qTokens) if (titleNorm.includes(w)) wordHits++;
    const coverage = qTokens.size > 0 ? wordHits / qTokens.size : 0;

    const lyric = opts.lyricIds?.get(t.external_id) ?? opts.lyricIds?.get(t.id);
    const pop = Math.min(1, (t.popularity ?? 0) / 100);

    const rank_score =
      0.35 * titleSim +
      0.15 * artistSim +
      0.2 * coverage +
      exactBonus +
      0.1 * pop +
      (lyric ? 0.25 * lyric.similarity : 0);

    return {
      ...t,
      rank_score: Math.min(1, rank_score),
      matched_lyric: lyric?.snippet,
    };
  });

  return ranked.sort((a, b) => b.rank_score - a.rank_score);
}
