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
import type { Playlist, SearchFilter, Track } from '@themashup/core';
import { looksLikeLyrics } from '@themashup/core';
import { service } from '@/lib/service';
import { downloadPlaylist } from '@/lib/playlist';
import { store } from '@/state/store';
import { Chip, EmptyState, Skeleton, snap } from '@/components/ui/primitives';
import { DownloadIcon, MicIcon, QueueIcon, SearchIcon, SparkIcon } from '@/components/ui/icons';
import { TrackRow } from '@/components/library/TrackRow';
import { useDebounced } from '@/hooks/useDebounced';
import { describeLink, parseLink } from '@/lib/link';
import { haptic } from '@/lib/haptics';
import { useContentBottom } from '@/hooks/useContentBottom';

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
  const paddingBottom = useContentBottom();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [results, setResults] = useState<Track[]>([]);
  // Playlists are a first-class result, not metadata: a playlist can be opened as a queue or
  // downloaded whole into its own folder.
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [lyricResults, setLyricResults] = useState<Track[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [routeNote, setRouteNote] = useState<string>('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const debounced = useDebounced(query, 320);
  // A pasted link is not a search. Detecting it in the field means the user does not have to find a
  // separate "open link" screen: paste, confirm, play.
  const pasted = useMemo(() => parseLink(query), [query]);
  const [linkBusy, setLinkBusy] = useState(false);

  const openLink = async () => {
    if (!pasted || pasted.kind === 'unsupported') return;
    setLinkBusy(true);
    try {
      // A playlist link that also carries a video id opens that video first; a bare playlist opens
      // the whole list. Narrowing happens here so the branches stay obvious.
      const videoId = pasted.videoId;
      const playlistId = pasted.kind === 'playlist' ? pasted.playlistId : undefined;
      if (!videoId) {
        const list = await service.playlistTracks(playlistId!);
        if (list.length) {
          setResults(list);
          setSearched(true);
          haptic('success');
          return;
        }
        store.notify('That playlist came back empty or private.', 'error');
        return;
      }
      const track = await service.trackFromId(videoId);
      if (!track) {
        store.notify('That video could not be read. It may be private, age-restricted or removed.', 'error');
        return;
      }
      haptic('success');
      onPlay(track, [track]);
    } catch {
      store.notify('Could not open that link.', 'error');
    } finally {
      setLinkBusy(false);
    }
  };
  const lyricMode = useMemo(() => looksLikeLyrics(debounced), [debounced]);

  useEffect(() => {
    let cancelled = false;
    if (debounced.trim().length < 2) {
      setResults([]);
      setPlaylists([]);
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
        const lists: Playlist[] = [];
        for (const section of res.result.sections) {
          if (section.kind === 'songs') flat.push(...section.items);
          if (section.kind === 'top') flat.unshift(section.track);
          // A playlist section used to be dropped here, which is why a search for a playlist name
          // returned songs and silently hid the playlist itself.
          if (section.kind === 'playlists') lists.push(...section.items);
        }
        setResults(flat);
        setPlaylists(lists);
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
  // The Playlists chip filters the page down to playlists; 'All' and 'Songs' keep the song list.
  const visiblePlaylists = useMemo(
    () => (lyricMode || filter === 'songs' ? [] : playlists),
    [lyricMode, filter, playlists],
  );
  const songsHidden = filter === 'playlists' || filter === 'albums' || filter === 'artists';

  /**
   * Open a playlist, or download the whole thing into its own folder.
   *
   * Downloading reuses the queue path rather than playing: the user asked for the files, so nothing
   * should start making noise because they tapped download.
   */
  const [busyPlaylist, setBusyPlaylist] = useState<string | null>(null);
  const openPlaylist = async (pl: Playlist, download: boolean) => {
    if (busyPlaylist) return;
    setBusyPlaylist(pl.id);
    try {
      const tracks = await service.playlistTracks(pl.id);
      if (!tracks.length) {
        store.notify('That playlist came back empty or private.', 'error');
        return;
      }
      if (!download) {
        haptic('success');
        onPlay(tracks[0]!, tracks);
        return;
      }
      haptic('success');
      // Headers from the most recent resolve, per track. Filled by `resolve` below and read by the
      // engine when it starts the transfer, so a URL that needs its Referer is fetched with one.
      const headersByTrack = new Map<string, Record<string, string>>();
      await downloadPlaylist({
        name: pl.title,
        tracks,
        ...(tracks.every((t) => t.kind === 'video') ? { kind: 'video' as const } : {}),
        resolve: async (track: Track) => {
          /*
           * Ask the service for the best URL rather than indexing `urls` with a hard-coded itag.
           *
           * `playlistTarget()` used to name itag 140 and this line looked it up directly. That breaks
           * as soon as the URL comes from the native extractor, which offers the tier it chose — the
           * lookup finds nothing and a perfectly downloadable track is reported as unavailable.
           * `downloadUrl` returns whatever the resolver actually produced.
           */
          const res = await service.resolveStream(track.id);
          if (!res.ok) return null;
          const headers = res.info.headers;
          if (headers && Object.keys(headers).length > 0) headersByTrack.set(track.id, headers);
          return service.downloadUrl(res.info, track.durationSec);
        },
        headers: (track: Track) => headersByTrack.get(track.id),
      });
    } catch {
      store.notify('Could not open that playlist.', 'error');
    } finally {
      setBusyPlaylist(null);
    }
  };

  return (
    <div className="px-4 pt-2" style={{ paddingBottom }}>
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

        {/* Link paste. Appears only when the field actually contains a link, so it never adds noise
            to normal searching. */}
        <AnimatePresence>
          {pasted && query.trim().length > 10 ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 flex items-center gap-2 rounded-2xl border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--wash)_5%,transparent)] px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--color-text-2)]">
                  {pasted.kind === 'unsupported' ? pasted.reason : `Open ${describeLink(pasted)}`}
                </span>
                {pasted.kind === 'unsupported' ? null : (
                  <button
                    type="button"
                    onClick={() => void openLink()}
                    disabled={linkBusy}
                    className="shrink-0 rounded-full bg-[var(--accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--on-accent)] disabled:opacity-60"
                  >
                    {linkBusy ? 'Opening…' : pasted.kind === 'playlist' ? 'Open playlist' : 'Play it'}
                  </button>
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

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
          {!lyricMode && visiblePlaylists.length ? (
            <div className="mb-3">
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
                Playlists
              </div>
              <div className="space-y-1">
                {visiblePlaylists.map((pl) => (
                  <PlaylistRow
                    key={pl.id}
                    playlist={pl}
                    busy={busyPlaylist === pl.id}
                    onOpen={() => void openPlaylist(pl, false)}
                    onDownload={() => void openPlaylist(pl, true)}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {/* Single tap plays just this track: queueing is an explicit action on the row, never a
              side effect of pressing play. */}
          {(songsHidden ? [] : shown).map((t, i) => (
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
      ) : searched && debounced.trim().length >= 2 && filter === 'playlists' && playlists.length === 0 ? (
        <EmptyState
          icon={<QueueIcon width={30} height={30} />}
          title="No playlists for that search"
          detail="The source did not return a playlist. Searching the album or artist name usually finds the songs."
        />
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

/**
 * A playlist result.
 *
 * Two explicit actions rather than one ambiguous tap: play it now, or take the files. Each is
 * labelled, because "download" and "play" are different intents and a playlist is large enough that
 * guessing wrong is expensive.
 */
function PlaylistRow({
  playlist,
  busy,
  onOpen,
  onDownload,
}: {
  playlist: Playlist;
  busy: boolean;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const art = playlist.thumbs[0]?.url ?? playlist.thumbs[playlist.thumbs.length - 1]?.url;
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-row)] bg-[color-mix(in_oklab,var(--wash)_5%,transparent)] px-2.5 py-2">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {art ? (
          <img src={art} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" loading="lazy" />
        ) : (
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]">
            <QueueIcon width={18} height={18} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]">{playlist.title}</div>
          <div className="truncate text-[11px] text-[var(--color-text-3)]">
            {playlist.author ? `${playlist.author} · ` : ''}
            {playlist.trackCount ? `${playlist.trackCount} tracks` : 'Playlist'}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onDownload}
        disabled={busy}
        aria-label={`Download playlist ${playlist.title}`}
        className="shrink-0 rounded-full border border-[var(--hairline)] px-3 py-1.5 text-[11.5px] font-semibold disabled:opacity-50"
      >
        {busy ? 'Loading…' : 'Download'}
      </button>
    </div>
  );
}
