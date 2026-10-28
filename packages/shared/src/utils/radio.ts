import type { Track } from "../types.js";
import { normalize, similarity } from "./fuzzy.js";

export interface RadioOptions {
  limit?: number;
  /** MMR lambda: 1 = pure relevance to seed, 0 = pure diversity. */
  lambda?: number;
  /** Injectable RNG so tests are deterministic. */
  rng?: () => number;
}

/**
 * Build an endless-radio-style queue from a seed track and a pool of related
 * candidates: dedupes, drops the seed itself, then greedily re-ranks with
 * Maximal Marginal Relevance so the queue stays on-topic without repeating
 * the same artist back-to-back.
 */
export function buildRadioQueue(
  seed: Track | undefined,
  pool: Track[],
  options: RadioOptions = {},
): Track[] {
  const limit = options.limit ?? 30;
  const lambda = options.lambda ?? 0.7;
  const rng = options.rng ?? Math.random;

  const seen = new Set<string>();
  const fresh: Track[] = [];
  for (const t of pool) {
    if (!t?.id) continue;
    if (seed && t.id === seed.id) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    fresh.push(t);
  }
  if (fresh.length === 0) return [];

  const remaining = [...fresh];
  const picked: Track[] = [];

  // Seed relevance profile: artist tokens + title of the seed (if any).
  const seedProfile = seed
    ? normalize(`${seed.artist_names} ${seed.title}`)
    : normalize(fresh[0]?.artist_names ?? "");

  while (picked.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const rel = seedProfile
        ? similarity(seedProfile, normalize(`${cand.artist_names} ${cand.title}`))
        : 0.5;
      // Diversity: penalize similarity to what we already picked (MMR).
      let maxSimToPicked = 0;
      for (const p of picked) {
        const s = similarity(
          normalize(`${cand.artist_names} ${cand.title}`),
          normalize(`${p.artist_names} ${p.title}`),
        );
        if (s > maxSimToPicked) maxSimToPicked = s;
      }
      // Never play the same artist twice in a row — unless every remaining
      // candidate IS that artist (forced pick when the pool is exhausted).
      const prev = picked[picked.length - 1];
      const prevArtist = prev ? normalize(prev.artist_names) : "";
      const hasAlternative = prevArtist
        ? remaining.some((c) => normalize(c.artist_names) !== prevArtist)
        : true;
      const sameArtistAsPrev =
        prevArtist &&
        normalize(cand.artist_names) === prevArtist &&
        hasAlternative;
      const streakPenalty = sameArtistAsPrev ? 0.45 : 0;
      // Tiny jitter keeps repeats varied between regenerations.
      const score =
        lambda * rel - (1 - lambda) * maxSimToPicked - streakPenalty + rng() * 0.05;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    picked.push(remaining.splice(bestIdx, 1)[0]);
  }
  return picked;
}
