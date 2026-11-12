/**
 * The Home feed: YT Music's own shelves, with the local engine as a fallback.
 *
 * ## Why this exists
 *
 * The previous Home screen built its own recommendations: it took tracks the user had played here,
 * asked YouTube for the radio around each, and merged the results. That is a defensible technique and
 * it produced *plausible* music — which was exactly the problem. The user's report was precise:
 *
 *   "When I open YT music, the songs which are suggested to me are the ones I DO wanna listen. But
 *    you are suggesting something else. Yes they are the Urdu/Hindi songs which I like but not the
 *    category I like."
 *
 * Seeding from local history can only recombine what has already been played *in this app*. It has no
 * idea that the user is currently in a ghazal mood rather than a filmi one, because that knowledge
 * lives in YouTube's model of their account, trained on years of listening across every device.
 * Inferring it locally is guessing; asking for it is not.
 *
 * So: fetch `FEmusic_home`, which is the same personalized page music.youtube.com shows, and render
 * whatever shelves come back — "Quick picks", "Listen again", "Mixed for you", or whatever YouTube is
 * calling them this month. The names are passed through verbatim rather than mapped onto a fixed
 * enum, precisely so a renamed shelf does not silently disappear.
 *
 * The local engine is kept as a *fallback* for two cases it genuinely handles better:
 *   - no signed-in account (the personalized feed is unavailable, and YouTube's anonymous home page
 *     is generic charts — worse than seeding from what this user actually plays);
 *   - a brand-new account whose home feed is empty.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FeedShelf, Track } from '@themashup/core';
import { useApp } from '@/state/store';
import { service } from '@/lib/service';

/** Enough rows to feel full; few enough that Home still scrolls smoothly on a mid-range phone. */
const TRACKS_PER_SHELF = 12;
/** Ceiling on shelves. YouTube can return a dozen; more is a scroll marathon, not a home screen. */
const MAX_SHELVES = 6;

export type FeedState = {
  shelves: FeedShelf[];
  /** True while the first fetch is in flight, so Home can show a skeleton rather than an empty state. */
  loading: boolean;
  /** Where the shelves came from. Drives the honest subtitle under the header. */
  origin: 'ytmusic' | 'local' | 'none';
};

const empty: FeedState = { shelves: [], loading: false, origin: 'none' };

/** Trim each shelf and drop the ones that ended up empty. */
function normalize(shelves: FeedShelf[]): FeedShelf[] {
  return shelves
    .map((s) => ({ title: s.title.trim(), tracks: s.tracks.slice(0, TRACKS_PER_SHELF) }))
    .filter((s) => s.title.length > 0 && s.tracks.length > 0)
    .slice(0, MAX_SHELVES);
}

export function useHomeFeed(enabled: boolean): FeedState {
  const history = useApp((s) => s.history);
  const affinity = useApp((s) => s.affinity);
  const [state, setState] = useState<FeedState>(empty);
  const requestId = useRef(0);

  /*
   * Refetch on sign-in, and when the local history changes enough to matter for the fallback.
   *
   * The home feed itself does not depend on local history — that is the point — but the fallback
   * does, and re-issuing the browse call on every play would be a network request per track for a
   * page that changes at most daily. `history.length` is the same coarse key the local hook used.
   */
  const localKey = useMemo(() => `${history.length}:${Object.keys(affinity.artists).length}`, [history.length, affinity]);

  useEffect(() => {
    if (!enabled) {
      setState(empty);
      return;
    }
    const id = ++requestId.current;
    setState((prev) => ({ ...prev, loading: true }));

    void (async () => {
      // 1) The real thing: the account's own YT Music home page.
      const feed = await service.homeFeed();
      if (id !== requestId.current) return;

      const normalized = normalize(feed);
      if (normalized.length > 0) {
        setState({ shelves: normalized, loading: false, origin: 'ytmusic' });
        return;
      }

      /*
       * 2) Fallback: the local engine.
       *
       * Deliberately one shelf with a plain name rather than inventing YouTube-sounding labels. A
       * made-up "Mixed for you" that is really three radios merged locally would be a lie about where
       * the music came from, and the user is specifically asking for YouTube's taste, not a
       * simulation of it.
       */
      const seeds = pickSeeds(history, affinity);
      if (!seeds.length) {
        setState({ shelves: [], loading: false, origin: 'none' });
        return;
      }

      const lists: Track[][] = [];
      for (const seed of seeds) {
        try {
          const found = await service.radio(seed);
          if (found.length) lists.push(found);
        } catch {
          // One seed failing is not the shelf failing.
        }
      }
      if (id !== requestId.current) return;

      const excluded = new Set(history.map((t) => t.id));
      const merged = interleave(lists, excluded).slice(0, TRACKS_PER_SHELF);
      setState({
        shelves: merged.length ? [{ title: 'Picked for you', tracks: merged }] : [],
        loading: false,
        origin: merged.length ? 'local' : 'none',
      });
    })();

    return () => {
      // Supersede: any in-flight branch above will see a newer id and drop its result.
      requestId.current += 1;
    };
  }, [enabled, localKey, history, affinity]);

  return state;
}

/** Most-loved artist first, one seed per artist. Same rule the local ranker used. */
function pickSeeds(
  history: Track[],
  affinity: { artists: Record<string, number> },
): Track[] {
  const weightOf = (t: Track) => affinity.artists[t.artistId ?? t.artist] ?? 0;
  const ranked = [...history].sort((a, b) => weightOf(b) - weightOf(a));
  const seen = new Set<string>();
  const picked: Track[] = [];
  for (const track of ranked) {
    const artist = (track.artistId ?? track.artist).trim().toLowerCase();
    if (!artist || seen.has(artist)) continue;
    seen.add(artist);
    picked.push(track);
    if (picked.length >= 3) break;
  }
  return picked;
}

/** Round-robin merge so one seed's radio does not run in a block. */
function interleave(lists: Track[][], excluded: Set<string>): Track[] {
  const out: Track[] = [];
  const cursors = lists.map(() => 0);
  let progressed = true;
  while (out.length < TRACKS_PER_SHELF && progressed) {
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
      if (out.length >= TRACKS_PER_SHELF) break;
    }
  }
  return out;
}
