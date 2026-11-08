/**
 * On-device recommender (docs/07). Pure, deterministic, allocation-light.
 * Inputs are plain data; persistence lives in the app layer.
 */

import type { Track } from '../domain.js';

export interface AffinityState {
  /** artistId|artistName → weight */
  artists: Record<string, number>;
  tracks: Record<string, number>;
  /** "from→to" → weight */
  edges: Record<string, number>;
  /** videoId → last played epoch ms */
  lastPlayed: Record<string, number>;
  /** artistName → epoch ms of the last play */
  lastArtistPlayed: Record<string, number>;
}

export const emptyAffinity = (): AffinityState => ({ artists: {}, tracks: {}, edges: {}, lastPlayed: {}, lastArtistPlayed: {} });

export type EventType = 'play' | 'complete' | 'skipEarly' | 'skipMid' | 'like' | 'unlike' | 'queueAdd' | 'lessLikeThis';

export interface PlayEvent {
  type: EventType;
  track: Pick<Track, 'id' | 'artist' | 'artistId'>;
  seedArtist?: string;
  sessionIndex?: number;
  now: number;
}

const HALF_LIFE_DAYS = 14;
const DAY_MS = 86_400_000;

function decay(weight: number, lastAt: number | undefined, now: number): number {
  if (!lastAt) return weight;
  const days = Math.max(0, (now - lastAt) / DAY_MS);
  return weight * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

const artistKey = (t: Pick<Track, 'artist' | 'artistId'>): string => t.artistId ?? t.artist;

/** Apply one behaviour event. Returns a *new* state (never mutates the input). */
export function applyEvent(state: AffinityState, e: PlayEvent): AffinityState {
  const next: AffinityState = {
    artists: { ...state.artists },
    tracks: { ...state.tracks },
    edges: { ...state.edges },
    lastPlayed: { ...state.lastPlayed },
    lastArtistPlayed: { ...state.lastArtistPlayed },
  };
  // Fatigue damp: later plays in a long session count slightly less.
  const w = 1 / (1 + (e.sessionIndex ?? 0) / 10);
  const key = artistKey(e.track);
  const bump = (map: Record<string, number>, k: string, amount: number) => {
    map[k] = Math.max(-5, Math.min(20, (map[k] ?? 0) + amount * w));
  };

  switch (e.type) {
    case 'play':
      bump(next.artists, key, 1);
      bump(next.tracks, e.track.id, 1);
      next.lastPlayed[e.track.id] = e.now;
      next.lastArtistPlayed[key] = e.now;
      if (e.seedArtist) {
        const edge = `${e.seedArtist}→${key}`;
        next.edges[edge] = Math.min(20, (next.edges[edge] ?? 0) + 1);
      }
      break;
    case 'complete':
      bump(next.artists, key, 0.5);
      bump(next.tracks, e.track.id, 0.5);
      break;
    case 'skipEarly':
      bump(next.artists, key, -0.6);
      bump(next.tracks, e.track.id, -0.6);
      break;
    case 'skipMid':
      bump(next.artists, key, -0.25);
      bump(next.tracks, e.track.id, -0.25);
      break;
    case 'like':
      bump(next.artists, key, 0.5);
      bump(next.tracks, e.track.id, 2);
      break;
    case 'unlike':
      bump(next.tracks, e.track.id, -2);
      break;
    case 'queueAdd':
      bump(next.tracks, e.track.id, 1.5);
      break;
    case 'lessLikeThis':
      next.artists[key] = -5;
      next.lastArtistPlayed[key] = e.now;
      break;
  }
  return next;
}

export interface RankOptions {
  seedArtist: string;
  now: number;
  /** 0 = familiar, 1 = adventurous. Default 0.12 (docs/07 §3.4). */
  epsilon?: number;
  rand?: () => number;
  /** Recently played videoIds to exclude. */
  exclude?: Set<string>;
  /** How many to return. */
  limit?: number;
}

export interface RankedTrack extends Track {
  why: { source: 'radio' | 'graph' | 'affinity' | 'explore'; score: number };
}

function normalize(map: Record<string, number>, key: string): number {
  const values = Object.values(map);
  const max = values.length ? Math.max(...values) : 0;
  if (max <= 0) return 0;
  return Math.max(0, (map[key] ?? 0) / max);
}

/**
 * Score + select. Hard constraints from docs/07 §3.3:
 *   ≤2 consecutive tracks per artist, no repeat of the last 40, frustration damping.
 */
export function rankQueue(
  candidates: Track[],
  state: AffinityState,
  opts: RankOptions,
): RankedTrack[] {
  const {
    seedArtist,
    now,
    epsilon = 0.12,
    rand = Math.random,
    exclude = new Set<string>(),
    limit = 25,
  } = opts;

  const pool = candidates.filter((c) => !exclude.has(c.id));
  if (!pool.length) return [];

  const n = pool.length;
  const scored = pool.map((t, rank) => {
    const key = artistKey(t);
    const structural = 1 - rank / Math.max(1, n);
    const affinity = normalize(state.artists, key);
    const graph = Math.min(1, (state.edges[`${seedArtist}→${key}`] ?? 0) / 3);
    const trackAff = normalize(state.tracks, t.id);
    const lastArtist = state.lastArtistPlayed[key];
    const days = lastArtist ? (now - lastArtist) / DAY_MS : 999;
    const novelty = Math.exp(-days / 14);
    // Hard block: an artist the user explicitly rejected must not out-rank a fresh one.
    const artistWeight = state.artists[key] ?? 0;
    const skipPenalty = artistWeight < 0 ? 1 + Math.min(3, -artistWeight) : 0;

    const score =
      0.5 * structural + 0.22 * affinity + 0.1 * graph + 0.08 * trackAff + 0.1 * novelty - 0.35 * skipPenalty;

    return { track: t, score, source: (graph > 0.3 ? 'graph' : rank < 8 ? 'radio' : 'affinity') as RankedTrack['why']['source'] };
  });

  scored.sort((a, b) => b.score - a.score);

  const out: RankedTrack[] = [];
  const artistRun: string[] = [];
  for (const s of scored) {
    if (out.length >= limit) break;
    const key = artistKey(s.track);

    // Constraint: no more than 2 consecutive from the same artist.
    if (artistRun.length >= 2 && artistRun[artistRun.length - 1] === key && artistRun[artistRun.length - 2] === key) {
      continue;
    }

    // ε-greedy exploration: occasionally promote a deep cut instead of the next-best.
    let pick = s;
    if (rand() < epsilon && scored.length > 4) {
      const idx = 3 + Math.floor(rand() * Math.min(17, scored.length - 3));
      const deep = scored[idx];
      if (deep && !out.some((o) => o.id === deep.track.id)) {
        pick = { ...deep, source: 'explore' };
      }
    }
    if (out.some((o) => o.id === pick.track.id)) continue;

    artistRun.push(key);
    out.push({ ...pick.track, why: { source: pick.source, score: Number(pick.score.toFixed(4)) } });
  }

  return out;
}
