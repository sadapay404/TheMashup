import { useEffect, useState } from "react";
import type { ArtistRef, LyricMatch, Track } from "@themashup/shared";
import { api, ApiError } from "../lib/api";

export interface HybridSearchState {
  query: string;
  loading: boolean;
  tracks: Track[];
  artists: ArtistRef[];
  matches: LyricMatch["matches"];
  suggestions: string[];
  error?: string;
}

const EMPTY: HybridSearchState = {
  query: "",
  loading: false,
  tracks: [],
  artists: [],
  matches: [],
  suggestions: [],
};

/**
 * Debounced fan-out: metadata search + lyric match + autocomplete in parallel
 * (the "dual-mode search algorithm" from the spec). Stale responses are
 * discarded; individual source failures degrade instead of erroring the bar.
 */
export function useHybridSearch(rawQuery: string, enabled = true): HybridSearchState {
  const [state, setState] = useState<HybridSearchState>(EMPTY);

  useEffect(() => {
    const q = rawQuery.trim();
    if (!enabled || q.length < 2) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...EMPTY, query: q, loading: true }));
      const [searchRes, lyricRes, suggestRes] = await Promise.allSettled([
        api.search(q),
        api.lyricsMatch(q),
        api.suggest(q),
      ]);
      if (cancelled) return;

      const tracks = searchRes.status === "fulfilled" ? searchRes.value.tracks : [];
      const artists = searchRes.status === "fulfilled" ? searchRes.value.artists : [];
      const matches =
        lyricRes.status === "fulfilled" && Array.isArray(lyricRes.value.matches)
          ? lyricRes.value.matches
          : [];
      const suggestions = suggestRes.status === "fulfilled" ? suggestRes.value : [];

      let error: string | undefined;
      if (searchRes.status === "rejected" && lyricRes.status === "rejected") {
        const err = (searchRes.reason ?? lyricRes.reason) as ApiError;
        error = err?.message ?? "Search failed";
      }
      setState({ query: q, loading: false, tracks, artists, matches, suggestions, error });
    }, 170);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rawQuery, enabled]);

  return state;
}
