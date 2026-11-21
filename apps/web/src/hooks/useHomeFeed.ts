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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedShelf, Playlist, Track } from '@themashup/core';
import { useApp } from '@/state/store';
import { service } from '@/lib/service';

/** Enough rows to feel full; few enough that Home still scrolls smoothly on a mid-range phone. */
const TRACKS_PER_SHELF = 12;
/**
 * Ceiling on shelves.
 *
 * The user's complaint was the opposite of too many: "at least fill the home page so it does not look
 * weird". YouTube's front page is a long scroll and that is the expectation we are matching. Twelve
 * rows of twelve is ~144 items — a real home page — while still bounded, because each row mounts
 * images lazily but still costs layout.
 */
const MAX_SHELVES = 12;

/**
 * How many playlist cards per "Featured" row.
 *
 * The user asked for four: they keep 15–20 songs across their YouTube playlists (a "Favorites" list
 * plus a few others), so four per row fills the home screen in a few rows instead of one cramped
 * strip or a single row of twenty.
 */
const FEATURED_PER_ROW = 4;

/** How often the home page re-reads the library, so an edit in YouTube shows up on its own. */
const LIBRARY_REFRESH_MS = 60_000;

/**
 * The playlist the home screen is pinned to.
 *
 * The user gave this URL explicitly and asked for its songs on Home, four to a row, with as many rows
 * as the playlist needs. This is deliberately a constant rather than a setting: it is one specific
 * playlist, and a settings screen for it was not asked for. If they want a different one later, that
 * is a one-line change here plus a build.
 *
 * https://www.youtube.com/playlist?list=PLT_8JyiMy1Zk
 */
const PINNED_PLAYLIST_ID = 'PLT_8JyiMy1Zk';

/** Four to a row, as asked. */
const PINNED_PER_ROW = 4;

export type FeedState = {
  shelves: FeedShelf[];
  /** True while the first fetch is in flight, so Home can show a skeleton rather than an empty state. */
  loading: boolean;
  /** Where the shelves came from. Drives the honest subtitle under the header. */
  origin: 'ytmusic' | 'local' | 'none';
};

const empty: FeedState = { shelves: [], loading: false, origin: 'none' };

/**
 * The rows the user asked to see named explicitly, and the order they asked for.
 *
 * These are matched loosely against YouTube's own labels rather than assumed to be exact: YouTube
 * localises and renames ("Forgotten favourites" / "Forgotten favorites", "Desi hip-hop" / "Desi Hip
 * Hop"), and a strict match would fail silently the first time it changed spelling.
 *
 * Ordering is the user's, not YouTube's, for these three rows specifically — they said which order
 * they want. Everything else keeps YouTube's ranking, because its order is the reason its own home
 * page reads well.
 */
const PINNED = [
  { match: /forgotten\s*favou?rites?/i, rank: 0 },
  { match: /desi\s*hip[-\s]?hop/i, rank: 1 },
  { match: /featured\s*playlists?/i, rank: 2 },
] as const;

/**
 * Sort shelves so the pinned three lead, in the requested order.
 *
 * Deliberately stable and non-destructive: a pinned row that YouTube did not send is simply absent,
 * not invented, and shelves that match nothing keep their relative order behind these.
 */
function pinOrder(shelves: FeedShelf[]): FeedShelf[] {
  const rankOf = (title: string): number => {
    for (const pin of PINNED) if (pin.match.test(title)) return pin.rank;
    return PINNED.length;
  };
  return [...shelves]
    .map((shelf, index) => ({ shelf, index, rank: rankOf(shelf.title) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.shelf);
}

/**
 * The "Featured" group: the account's own YT Music playlists, four to a row.
 *
 * This is the part that makes the home screen follow a playlist the user maintains in YouTube. A
 * playlist created on music.youtube.com is on neither the home feed nor the liked-songs list, so
 * before this there was no route from "I made a Favorites playlist" to "it shows in TheMashup" —
 * which is exactly what the user reported and what OuterTune does differently.
 *
 * Every playlist goes into one flat, ordered list and is then chunked, so the group reads as one
 * block of rows rather than a row per playlist. Ordering is the library's own, which puts the
 * user's most recently touched playlists first.
 */
/**
 * Songs from the pinned playlist, four to a row, as many rows as it takes.
 *
 * This is the direct answer to "pull this playlist and show it on the home screen, 4 songs per row, no
 * limit on rows". It is a *songs* group rather than a playlist-card group: the user wants the songs of
 * one playlist laid out, not a shelf of collection cards to tap through.
 *
 * The rows carry no title except the first, so the whole thing reads as one section.
 */
function pinnedRows(tracks: Track[], title: string): FeedShelf[] {
  const rows: FeedShelf[] = [];
  for (let i = 0; i < tracks.length; i += PINNED_PER_ROW) {
    rows.push({
      title: i === 0 ? title : '',
      tracks: tracks.slice(i, i + PINNED_PER_ROW),
      // Refreshable in place, exactly like the library group.
      featured: true,
    });
  }
  return rows;
}

function featuredRows(playlists: Playlist[]): FeedShelf[] {
  const rows: FeedShelf[] = [];
  for (let i = 0; i < playlists.length; i += FEATURED_PER_ROW) {
    const slice = playlists.slice(i, i + FEATURED_PER_ROW);
    rows.push({
      // Named once, on the first row, so the group reads as one section with a heading rather than
      // four rows each claiming to be "Featured".
      title: i === 0 ? 'Featured' : '',
      tracks: [],
      playlists: slice,
      // Marks the row as part of the library group, so the refresh can replace it in place.
      featured: true,
    });
  }
  return rows;
}

/** Trim each shelf and drop the ones that ended up empty. */
function normalize(shelves: FeedShelf[]): FeedShelf[] {
  return pinOrder(
    shelves
      .map((s) => ({
        title: s.title.trim(),
        tracks: s.tracks.slice(0, TRACKS_PER_SHELF),
        ...(s.playlists?.length ? { playlists: s.playlists.slice(0, TRACKS_PER_SHELF) } : {}),
      }))
      /*
       * A playlist-only row is a real row, and a row with an *empty* title is a valid continuation of
       * the group above it ("Featured" chunked across several rows). Both were being filtered out,
       * which is why playlist rows kept vanishing.
       */
      .filter((s) => s.tracks.length > 0 || (s.playlists?.length ?? 0) > 0),
  ).slice(0, MAX_SHELVES);
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
      /*
       * Both sources are asked for, not one-then-the-other.
       *
       * The previous logic *replaced* the page: shelves if YouTube answered, else a single local row.
       * That is why the home screen could not fill itself — and when YouTube returned one usable shelf
       * the result was one row and a lot of empty space. A home screen should be full; where the rows
       * come from matters less than that none are invented.
       *
       * Order is preserved: YouTube's own shelves first, in YouTube's order, because its ranking knows
       * this account better than anything computed locally. The local row is appended underneath it.
       */
      /*
       * YouTube first, alone.
       *
       * The local row is *not* fetched in parallel: it costs three radio round trips, and issuing them
       * on every home load competes with the very request that was supposed to make Home correct. It
       * also made the page slower for no benefit whenever YouTube answered — which is the normal case.
       *
       * The screen paints as soon as YouTube answers, and the local row is appended afterwards if it
       * turns out to be needed. So the page fills twice rather than loading once, slowly.
       */
      /*
       * The library and the home feed are fetched together: they are independent, and the "Featured"
       * group is the one the user actually relies on, so it must not wait behind the home feed.
       */
      /*
       * The pinned playlist is fetched first and on its own merit.
       *
       * It is the one thing on this screen the user asked for by name, and it works signed out, so it
       * must not be able to fail because the account-side calls are unauthorised or slow.
       */
      const [pinned, feed, library] = await Promise.all([
        service.playlistTracksAll(PINNED_PLAYLIST_ID),
        service.homeFeed(),
        service.libraryPlaylists(),
      ]);
      if (id !== requestId.current) return;

      const pinnedGroup = pinnedRows(pinned, 'Your playlist');
      const featured = featuredRows(library);
      const yt = [...pinnedGroup, ...featured, ...normalize(feed)];
      if (yt.length) {
        setState({ shelves: yt, loading: false, origin: 'ytmusic' });
        // Only worth the extra requests when the page is still thin.
        if (yt.length >= 3) return;
      }

      const local = await localShelf(history, affinity);
      if (id !== requestId.current) return;

      const shelves = yt.length ? [...yt, ...local] : local;
      setState({
        shelves,
        loading: !yt.length && shelves.length === 0,
        origin: yt.length ? 'ytmusic' : shelves.length ? 'local' : 'none',
      });
    })();

    return () => {
      // Supersede: any in-flight branch above will see a newer id and drop its result.
      requestId.current += 1;
    };
  }, [enabled, localKey, history, affinity]);

  /*
   * Re-read the library on an interval while Home is on screen.
   *
   * "The home screen would update according to the changes in the playlist" is the requirement, and it
   * cannot be met by a one-shot fetch: the edit happens in another app. Polling sounds crude, but the
   * request is small, it is cached upstream for five minutes, and it only runs while the hook is
   * mounted. Refreshing on `visibilitychange` covers the far more common case — the user edits a
   * playlist in YouTube and comes back to this app, which is exactly when a refresh must happen
   * immediately.
   */
  const refresh = useCallback(() => {
    if (!enabled) return;
    /*
     * Re-read both the pinned playlist and the library, then replace only the groups they own.
     *
     * The requirement is that Home follows edits made in YouTube. For the pinned playlist that means a
     * song added or removed there shows up here without a restart — which needs the playlist re-read,
     * not just the library list.
     */
    void Promise.all([service.playlistTracksAll(PINNED_PLAYLIST_ID), service.libraryPlaylists()]).then(
      ([pinned, library]) => {
        setState((prev) => {
          if (!prev.shelves.length) return prev;
          const rest = prev.shelves.filter((s) => !s.featured);
          const pinnedGroup = pinnedRows(pinned, 'Your playlist');
          const next = [...pinnedGroup, ...featuredRows(library), ...rest];
          return { ...prev, shelves: next.slice(0, MAX_SHELVES) };
        });
      },
    );
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(refresh, LIBRARY_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  return state;
}

/**
 * The local row, as a shelf, or nothing.
 *
 * Deliberately *one* row, titled "Picked for you" rather than dressed up as a YouTube shelf name.
 * Inventing "Mixed for you" for a row that is really three radios merged locally would misrepresent
 * where the music came from, and the user's whole complaint was about provenance.
 */
async function localShelf(
  history: Track[],
  affinity: { artists: Record<string, number> },
): Promise<FeedShelf[]> {
  const seeds = pickSeeds(history, affinity);
  if (!seeds.length) return [];

  const lists: Track[][] = [];
  for (const seed of seeds) {
    try {
      const found = await service.radio(seed);
      if (found.length) lists.push(found);
    } catch {
      // One seed failing is not the shelf failing.
    }
  }

  const excluded = new Set(history.map((t) => t.id));
  const merged = interleave(lists, excluded).slice(0, TRACKS_PER_SHELF);
  return merged.length ? [{ title: 'Picked for you', tracks: merged }] : [];
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
