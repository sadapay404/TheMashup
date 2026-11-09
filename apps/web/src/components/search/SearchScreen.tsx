/**
 * Search.
 *
 * Three modes, chosen automatically from what the user typed:
 *   structured ("Artist - Title") → direct search
 *   lyric-like (long phrase, many function words) → local BM25 → upstream text fallback
 *   default → unified search with filter chips
 *
 * The mode is shown honestly in the UI ("Searching lyrics on this device"), because a silent
 * change in behaviour is exactly the kind of thing that makes an app feel unreliable.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { SearchFilter, Track } from '@themashup/core';
import { looksLikeLyrics } from '@themashup/core';
import { service } from '@/lib/service';
import { Chip, EmptyState, Skeleton, snap } from '@/components/ui/primitives';
import { MicIcon, SearchIcon, SparkIcon } from '@/components/ui/icons';
import { TrackRow } from '@/components/library/TrackRow';
import { useDebounced } from '@/hooks/useDebounced';

const FILTERS: Array<{ id: SearchFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
];

export function SearchScreen({
  onPlay,
  onQueue,
  onDownload,
}: {
  onPlay: (t: Track, list: Track[]) => void;
  onQueue?: (t: Track) => void;
  onDownload?: (t: Track) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [results, setResults] = useState<Track[]>([]);
  const [lyricResults, setLyricResults] = useState<Track[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [routeNote, setRouteNote] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const debounced = useDebounced(query, 320);
  const lyricMode = useMemo(() => looksLikeLyrics(debounced), [debounced]);

  useEffect(() => {
    let cancelled = false;
    if (debounced.trim().length < 2) {
      setResults([]);
      setLyricResults(null);
      setSearched(false);
      setError(null);
      return;
    }

    setBusy(true);
    setError(null);
    setSearched(true);

    const run = async () => {
      if (lyricMode) {
        const hits = await service.lyricSearch(debounced);
        if (cancelled) return;
        setLyricResults(hits);
        setResults([]);
        setBusy(false);
        return;
      }

      setLyricResults(null);
      const res = await service.search(debounced, filter);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error?.message ?? 'Search is unavailable right now.');
        setResults([]);
      } else {
        const flat: Track[] = [];
        for (const section of res.result.sections) {
          if (section.kind === 'songs') flat.push(...section.items);
          if (section.kind === 'top') flat.unshift(section.track);
        }
        setResults(flat);
        setRouteNote(res.route);
      }
      setBusy(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [debounced, filter, lyricMode]);

  const shown = lyricMode ? (lyricResults ?? []) : results;

  return (
    <div className="px-4 pb-[var(--content-bottom)] pt-2">
      {/* Search field */}
      <div className="sticky top-0 z-10 -mx-4 px-4 pb-3 pt-1 backdrop-blur-xl">
        <div className="relative">
          <SearchIcon
            width={19}
            height={19}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Songs, artists, or a lyric you remember…"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--wash)_6%,transparent)] pl-11 pr-[4.5rem] text-[15px] text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-3)] focus:border-[var(--accent)]/60 focus:bg-[color-mix(in_oklab,var(--wash)_9%,transparent)]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 flex h-8 -translate-y-1/2 items-center rounded-full px-2.5 text-xs font-medium text-[var(--color-text-3)] transition hover:bg-[color-mix(in_oklab,var(--wash)_9%,transparent)] hover:text-[var(--color-text)]"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {!lyricMode
            ? FILTERS.map((f) => (
                <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                </Chip>
              ))
            : null}
        </div>
      </div>

      {/* Mode banner */}
      <AnimatePresence>
        {lyricMode ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={snap}
            className="mb-3 flex items-center gap-2 rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-3 py-2 text-[12.5px] text-[var(--color-text-2)]"
          >
            <MicIcon width={16} height={16} />
            <span>
              Lyric match · searched <strong className="text-[var(--color-text)]">on this device</strong>
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* States */}
      {busy ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[62px] w-full" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Couldn't reach the catalogue"
          detail={`${error} — this is usually the browser blocking the request. Open Settings → Diagnostics to test routes.`}
          action={{ label: 'Open diagnostics', onClick: () => (window.location.hash = '#diagnostics') }}
        />
      ) : shown.length ? (
        <motion.div layout className="space-y-1">
          {/* Which route actually answered. Without this the app is a black box when a host is
              blocked, and the user cannot tell "no results" from "no network". */}
          {routeNote ? (
            <div className="mb-2 px-2 font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--color-text-3)]">
              via {routeNote}
            </div>
          ) : null}
          {lyricMode ? (
            <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
              Best lyric matches
            </div>
          ) : null}
          {/* Single tap plays just this track: queueing is an explicit action on the row, never a
              side effect of pressing play. */}
          {shown.map((t, i) => (
            <TrackRow
              key={`${t.id}-${i}`}
              track={t}
              onPlay={() => onPlay(t, [t])}
              index={i}
              {...(onQueue ? { onQueue } : {})}
              {...(onDownload ? { onDownload } : {})}
            />
          ))}
        </motion.div>
      ) : searched && debounced.trim().length >= 2 ? (
        <EmptyState
          icon={<SparkIcon width={30} height={30} />}
          title={lyricMode ? 'No lyric match on this device yet' : 'No results'}
          detail={
            lyricMode
              ? 'The local lyric index only knows songs you have played, and the upstream text fallback found nothing. Play a few tracks and it will learn their lyrics.'
              : 'Try a different spelling, or search by album or artist.'
          }
        />
      ) : (
        <EmptyState
          icon={<SearchIcon width={30} height={30} />}
          title="Find anything"
          detail="Search a song, an artist, or paste a lyric you half-remember — TheMashup will match it."
        />
      )}
    </div>
  );
}
