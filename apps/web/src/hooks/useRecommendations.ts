/**
 * Home recommendations.
 *
 * The rule the app follows: what you already played belongs to Library, and what you might play
 * next belongs to Home. So Home never re-lists history — it proposes from it.
 *
 * Seeding is song-radio, the way every established client does it: take a few tracks you actually
 * chose, ask for the radio around each, and merge. That is deliberately not "artists you might
 * like" invented locally — a real video id gives YouTube's own recommender something to work with,
 * which is the entire reason its suggestions are better than a local guess.
 *
 * Merging rules, because a shelf of the same song three times reads as broken:
 *   - never suggest something already in history;
 *   - never suggest the same id twice, including across seeds;
 *   - alternate between seeds rather than exhausting one, so the shelf reflects more than one mood.
 *
 * Failure is quiet and non-destructive: if the network is down the shelf does not render and Home
 * falls back to its empty state. Recommendations are a nicety, never an error dialog.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '@themashup/core';
import { useApp } from '@/state/store';
import { service } from '@/lib/service';

/** Enough to feel varied, few enough that scrolling stays cheap. */
const SHELF_SIZE = 12;
/** How many seed tracks to ask radio for. Each is a network round trip. */
const MAX_SEEDS = 3;

export type RecommendationState = {
  tracks: Track[];
  loading: boolean;
};

const empty: RecommendationState = { tracks: [], loading: false };

/**
 * Interleave per-seed lists so the shelf is not one artist's radio in a row.
 * Round-robin, skipping anything already taken.
 */
function interleave(lists: Track[][], excluded: Set<string>): Track[] {
  const out: Track[] = [];
  const cursors = lists.map(() => 0);
  let progressed = true;

  while (out.length < SHELF_SIZE && progressed) {
    progressed = false;
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i]!;
      while (cursors[i]! < list.length) {
        const track = list[cursors[i]!++]!;
        if (excluded.has(track.id)) continue;
        excluded.add(track.id);
        out.push(track);
        progressed = true;
        break;
      }
      if (out.length >= SHELF_SIZE) break;
    }
  }
  return out;
}

export function useRecommendations(enabled: boolean): RecommendationState {
  const history = useApp((s) => s.history);
  const affinity = useApp((s) => s.affinity);
  const [state, setState] = useState<RecommendationState>(empty);
  const requestId = useRef(0);

  /**
   * The seeds: recent tracks, most-loved artist first.
   *
   * `history` is newest-first, but the affinity weight is what actually says which of those plays
   * mattered, so it decides the order. A quieter "less like this" leaves a negative weight and
   * pushes that artist to the back instead of banning it — one skip is not a verdict.
   */
  /*
   * Memoised, not recomputed per render.
   *
   * This walks the whole play history, sorts it by affinity, and builds a set — on every render of
   * the Home screen. Home re-renders on each store change (a route swap, a toast, a download
   * progress tick), so a few hundred plays turned into a few hundred sorts, and the seed *identity*
   * changed each time, which defeated the downstream key comparison as well.
   *
   * The dependency is the two inputs the computation actually reads. `affinity` is replaced rather
   * than mutated by the store, so reference equality is the right test.
   */
  const seeds: Track[] = useMemo(() => {
    const weightOf = (t: Track) =>
      affinity.artists[t.artistId ?? t.artist] ?? 0;
    const ranked = [...history].sort((a, b) => weightOf(b) - weightOf(a));
    const seenArtist = new Set<string>();
    const picked: Track[] = [];
    for (const track of ranked) {
      // One seed per artist: three songs by the same singer is one recommendation, not three.
      const artist = (track.artistId ?? track.artist).trim().toLowerCase();
      if (!artist || seenArtist.has(artist)) continue;
      seenArtist.add(artist);
      picked.push(track);
      if (picked.length >= MAX_SEEDS) break;
    }
    return picked;
  }, [history, affinity]);

  // Refetch when the seed set changes, not on every play: replaying the same artist must not
  // re-issue three network calls.
  const seedKey = seeds.map((t) => t.id).join(',');

  useEffect(() => {
    if (!enabled || !seedKey) {
      setState(empty);
      return;
    }

    const id = ++requestId.current;
    setState((prev) => ({ ...prev, loading: true }));

    void (async () => {
      const excluded = new Set(history.map((t) => t.id));
      const lists: Track[][] = [];

      for (const seed of seeds) {
        try {
          const found = await service.radio(seed);
          if (found.length) lists.push(found);
        } catch {
          // One seed failing is not the shelf failing; keep whatever the others returned.
        }
      }

      if (id !== requestId.current) return; // superseded by a newer request
      setState({ tracks: interleave(lists, excluded), loading: false });
    })();
    // `seeds` is derived from the key below; listing it would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, seedKey, history.length]);

  // Abandoned requests must not write into state after unmount.
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  return state;
}
