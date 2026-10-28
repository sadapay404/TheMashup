import type { Track } from "../types.js";
import { normalize } from "./fuzzy.js";

/** A heard track with play time (from the library history). */
export interface HeardEntry {
  track: Track;
  at: string;
  context?: string;
}

const DAY_MS = 86_400_000;

function ageDays(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 30; // unknown → treat as old
  return Math.max(0, (now - t) / DAY_MS);
}

/**
 * "Listen Again" shelf: recency-weighted replays + stable favorites.
 * Liked tracks always outrank equally-recent plain plays; duplicates keep
 * their best score; result preserves descending score order.
 */
export function listenAgain(
  history: HeardEntry[],
  likedIds: Set<string>,
  limit = 24,
  now: number = Date.now(),
): Track[] {
  const best = new Map<string, { track: Track; score: number }>();

  const put = (track: Track, score: number) => {
    const prev = best.get(track.id);
    if (!prev || score > prev.score) best.set(track.id, { track, score });
  };

  for (const h of history) {
    const decay = Math.pow(0.9, ageDays(h.at, now)); // ~half-life 6.6 days
    const likedBonus = likedIds.has(h.track.id) ? 40 : 0;
    put(h.track, 50 * decay + likedBonus + 5);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.track);
}

/** Include liked tracks that were never played (favorites still belong here). */
export function listenAgainWithLikes(
  history: HeardEntry[],
  likedTracks: Track[],
  limit = 24,
  now: number = Date.now(),
): Track[] {
  const likedIds = new Set(likedTracks.map((t) => t.id));
  const base = listenAgain(history, likedIds, limit * 2, now);
  const seen = new Set(base.map((t) => t.id));
  const extra = likedTracks.filter((t) => !seen.has(t.id));
  // Interleave: top history picks first, unplayed favorites fill after top hits.
  const merged = [...base];
  for (const t of extra) {
    if (merged.length >= limit) break;
    merged.push(t);
  }
  return merged.slice(0, limit);
}

/**
 * User taste vector: artist → weight from plays (recency decay) + likes.
 * This is the local stand-in for pgvector embeddings (same shape of idea:
 * a vector over artist features, cosine-compared against candidates).
 */
export function tasteVector(
  history: HeardEntry[],
  likedIds: Set<string>,
  now: number = Date.now(),
): Map<string, number> {
  const v = new Map<string, number>();
  const add = (names: string, w: number) => {
    for (const raw of names.split(",")) {
      const key = normalize(raw.trim());
      if (!key) continue;
      v.set(key, (v.get(key) ?? 0) + w);
    }
  };
  for (const h of history) {
    const decay = Math.pow(0.93, ageDays(h.at, now));
    add(h.track.artist_names, (likedIds.has(h.track.id) ? 2.4 : 1) * decay);
  }
  return v;
}

function tasteScore(taste: Map<string, number>, track: Track): number {
  if (taste.size === 0) return 0;
  let score = 0;
  for (const raw of track.artist_names.split(",")) {
    const key = normalize(raw.trim());
    score = Math.max(score, taste.get(key) ?? 0);
  }
  const max = Math.max(...taste.values(), 1);
  return Math.min(1, score / max);
}

/** No two adjacent rows from the same artist (deterministic repair pass). */
export function diversify(list: Track[]): Track[] {
  const out = [...list];
  for (let i = 1; i < out.length; i++) {
    if (normalize(out[i].artist_names) === normalize(out[i - 1].artist_names)) {
      const swap = out.findIndex(
        (t, j) => j > i && normalize(t.artist_names) !== normalize(out[i - 1].artist_names),
      );
      if (swap > i) {
        [out[i], out[swap]] = [out[swap], out[i]];
      }
    }
  }
  return out;
}

/**
 * "Discover weekly": rank chart candidates against the taste vector, drop
 * whatever the user already heard recently (unless the pool gets thin), then
 * diversify. Falls back to raw candidates when there's no taste data.
 */
export function discoverMix(opts: {
  history: HeardEntry[];
  likedIds: Set<string>;
  candidates: Track[];
  limit?: number;
  now?: number;
}): Track[] {
  const limit = opts.limit ?? 24;
  const now = opts.now ?? Date.now();
  const taste = tasteVector(opts.history, opts.likedIds, now);
  const heardIds = new Set(opts.history.slice(0, 60).map((h) => h.track.id));

  let pool = opts.candidates.filter((t) => !heardIds.has(t.id));
  if (pool.length < limit) pool = opts.candidates; // thin pool → relax the rule

  const scored = pool.map((track) => {
    const rel = taste.size ? tasteScore(taste, track) : 0.4;
    const pop = Math.min(1, (track.popularity ?? 40) / 100);
    return { track, score: 0.72 * rel + 0.28 * pop };
  });
  scored.sort((a, b) => b.score - a.score);
  return diversify(scored.slice(0, limit * 2).map((s) => s.track)).slice(0, limit);
}
