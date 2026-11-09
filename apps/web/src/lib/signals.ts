/**
 * Behaviour signals: the on-device learning loop.
 *
 * docs/07 specifies that every meaningful interaction (play, completion, skip, like, queue add)
 * updates a local affinity graph which then re-ranks the radio. The ranker existed and was fully
 * unit-tested, but nothing ever *called* it — so the recommender learned nothing and every radio
 * queue stayed exactly as upstream returned it. This module is the missing caller.
 *
 * Design rules:
 *   - Every update is local and synchronous with the UI; nothing is network-bound.
 *   - The state is a plain object already persisted by `persist.ts`, so no second store exists.
 *   - Events are idempotent per call and cheap: one object spread per event.
 */

import { applyEvent, rankQueue } from '@themashup/core';
import type { AffinityState, Track } from '@themashup/core';
import { store } from '@/state/store';

/** Later plays in a long session count slightly less (docs/07 §4 fatigue damp). */
let sessionIndex = 0;

function record(type: 'play' | 'complete' | 'skipEarly' | 'skipMid' | 'like' | 'unlike' | 'queueAdd', track: Track): void {
  const prev = store.getState().affinity;
  const next: AffinityState = applyEvent(prev, {
    type,
    track,
    now: Date.now(),
    sessionIndex,
  });
  store.set({ affinity: next });
}

/** A track started playing. Call once per track start, never per resume. */
export function signalPlay(track: Track): void {
  sessionIndex += 1;
  record('play', track);
}

/** Track reached its natural end. */
export function signalComplete(track: Track | null): void {
  if (!track) return;
  record('complete', track);
}

/**
 * Skipped. docs/07 splits this at 5 s: an immediate skip is an active rejection, a later skip is
 * weaker evidence, and conflating them would let one accidental tap poison an artist.
 */
export function signalSkip(track: Track | null, positionSec: number): void {
  if (!track) return;
  if (positionSec < 5) record('skipEarly', track);
  else if (positionSec < 30) record('skipMid', track);
}

/** Explicit intent: the user added a track to the queue. */
export function signalQueueAdd(track: Track): void {
  record('queueAdd', track);
}

/** True when the track is currently liked. */
export function isLiked(id: string): boolean {
  return store.getState().likes.some((t) => t.id === id);
}

/**
 * Toggle a like. Updates both the favourites list and the affinity graph, per docs/07 (`+= 2.0`
 * on like, `-= 2.0` on unlike), and returns the new state so the caller can animate immediately.
 */
export function toggleLike(track: Track): boolean {
  const s = store.getState();
  const already = s.likes.some((t) => t.id === track.id);
  if (already) {
    store.set({ likes: s.likes.filter((t) => t.id !== track.id) });
    record('unlike', track);
    return false;
  }
  store.set({ likes: [track, ...s.likes].slice(0, 500) });
  record('like', track);
  return true;
}

/** Clear interaction with a track (used by "less like this" in future surfaces). */
export function signalLessLike(track: Track): void {
  record('skipEarly', track);
  const s = store.getState();
  if (s.queue.length) {
    store.set({ queue: s.queue.filter((t) => t.artistId !== track.artistId || t.id === track.id) });
  }
}

/**
 * Turn an upstream radio result into an ordered queue using the local model.
 *
 * `rankQueue` enforces the spec's hard constraints (≤2 consecutive per artist, no repeat of the last
 * 40, frustration damping) and mixes in ε-greedy exploration unless the user asked for strict
 * familiarity. Returns the original order when the ranker yields nothing, so a sparse affinity state
 * can never leave the queue empty.
 */
export function rankRadio(candidates: Track[], seed: Track): Track[] {
  if (candidates.length <= 1) return candidates;
  const s = store.getState();
  const exclude = new Set<string>([
    seed.id,
    ...s.history.slice(0, 40).map((t) => t.id),
  ]);
  const ranked = rankQueue(candidates, s.affinity, {
    seedArtist: seed.artistId ?? seed.artist,
    now: Date.now(),
    epsilon: 0.12,
    exclude,
    limit: candidates.length,
  });
  return ranked.length ? (ranked as Track[]) : candidates;
}

/** Reset the session counter (new listening session, e.g. after a long pause). */
export function resetSession(): void {
  sessionIndex = 0;
}
