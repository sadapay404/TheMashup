import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X, Loader2, ArrowRight, MicVocal, CornerDownLeft } from "lucide-react";
import { mergeHybrid, type HybridRow } from "@themashup/shared";
import { useUIStore } from "../../stores/uiStore";
import { usePlayerStore } from "../../stores/playerStore";
import { useHybridSearch } from "../../hooks/useHybridSearch";
import { TrackRow, LyricMatchRow, ArtistChip, useSearchActions } from "./SearchRows";

/**
 * Smart hybrid search bar (spec §3.2):
 *  - instant suggestions while typing (debounced fan-out)
 *  - dual-mode results: exact title/artist rows + fuzzy LYRIC rows
 *  - rich dropdown: track rows with inline play, artist chips, lyric snippets
 *  - keyboard: ↑ ↓ navigate · ↵ play · Esc close · ⌘K/CtrlK focus
 */
export function SearchBar({ autoFocusRef }: { autoFocusRef?: React.RefObject<HTMLInputElement | null> }) {
  const query = useUIStore((s) => s.searchQuery);
  const setQuery = useUIStore((s) => s.setSearchQuery);
  const setPage = useUIStore((s) => s.setPage);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [resolving, setResolving] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { playTrack, playLyricMatch } = useSearchActions();

  const results = useHybridSearch(query, open);
  const rows = useMemo<HybridRow[]>(
    () => mergeHybrid(results.tracks, results.matches, results.query).slice(0, 10),
    [results],
  );
  const artists = results.artists.slice(0, 4);

  // ⌘K / Ctrl+K / "/" focuses the bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
        (autoFocusRef?.current ?? inputRef.current)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autoFocusRef]);

  // click-outside closes
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => setActive(0), [query, results.query]);

  const activate = async (row: HybridRow) => {
    if (row.kind === "track") {
      playTrack(row.track, results.tracks);
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    setResolving(row.key);
    try {
      const played = await playLyricMatch(row.match);
      if (played) {
        setOpen(false);
        inputRef.current?.blur();
      }
    } finally {
      setResolving(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, rows.length - 1 + (artists.length ? 1 : 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) void activate(row);
      else if (query.trim()) {
        // no row → go to full results page
        setPage("search");
        setOpen(false);
      }
      return;
    }
    if (e.key === "Tab") setOpen(false);
  };

  const showDropdown = open && (results.loading || query.trim().length >= 2);

  return (
    <div ref={wrapRef} className="relative w-full">
      <div
        className={`flex items-center gap-2 rounded-full border px-3.5 py-2 transition ${
          open ? "border-accent/70 bg-surface-2 shadow-lg" : "border-line bg-surface hover:bg-surface-2"
        }`}
      >
        {results.loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
        ) : (
          <Search className="h-4 w-4 shrink-0 text-faint" />
        )}
        <input
          ref={autoFocusRef ?? inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder='Search songs, artists, or even a lyric you half-remember…'
          aria-label="Search music"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
        {query && (
          <button
            type="button"
            title="Clear"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="rounded-full p-1 text-faint transition hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <kbd className="hidden shrink-0 rounded border border-line bg-bg px-1.5 py-0.5 text-[10px] font-medium text-faint sm:block">
          ⌘K
        </kbd>
      </div>

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="glass absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-line p-2 shadow-2xl"
          >
            {/* autocomplete suggestions */}
            {results.suggestions.length > 0 && rows.length === 0 && !results.loading && (
              <div className="mb-1 flex flex-wrap gap-1.5 p-1">
                {results.suggestions.slice(0, 6).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setQuery(s)}
                    className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-dim transition hover:border-accent/50 hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* hybrid result rows */}
            {rows.length > 0 && (
              <div className="space-y-0.5">
                {rows.map((row, i) =>
                  row.kind === "track" ? (
                    <TrackRow
                      key={row.key}
                      track={row.track}
                      queue={results.tracks}
                      active={i === active}
                      compact
                      onPlay={() => void activate(row)}
                    />
                  ) : (
                    <div key={row.key} className={i === active ? "rounded-xl bg-surface-2" : ""}>
                      {resolving === row.key ? (
                        <div className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm text-dim">
                          <Loader2 className="h-4 w-4 animate-spin text-accent" />
                          Resolving lyric → track…
                        </div>
                      ) : (
                        <LyricMatchRow match={row.match} active={i === active} compact />
                      )}
                    </div>
                  ),
                )}
              </div>
            )}

            {/* artist chips */}
            {artists.length > 0 && (
              <div className="mt-2 border-t border-line px-1 pb-1 pt-2.5">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-faint">
                  Artists
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {artists.map((a) => (
                    <ArtistChip key={a.channel_id ?? a.name} artist={a} compact />
                  ))}
                </div>
              </div>
            )}

            {/* empty / loading */}
            {results.loading && rows.length === 0 && (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-dim">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching catalog & lyric index…
              </div>
            )}
            {!results.loading && rows.length === 0 && query.trim().length >= 2 && (
              <div className="px-3 py-6 text-center">
                <p className="text-sm text-dim">No matches for “{results.query}”</p>
                <p className="mt-1 text-xs text-faint">
                  Try a partial lyric line — fuzzy matching searches the lyric index too.
                </p>
              </div>
            )}
            {results.error && (
              <p className="px-3 py-2 text-xs text-red-400">{results.error}</p>
            )}

            {/* footer */}
            <div className="mt-1.5 flex items-center justify-between border-t border-line px-2 pb-0.5 pt-2 text-[10px] text-faint">
              <span className="flex items-center gap-2.5">
                <span className="flex items-center gap-1">
                  <MicVocal className="h-3 w-3" /> lyric mode on
                </span>
                <span>
                  <CornerDownLeft className="mr-1 inline h-3 w-3" />play
                </span>
                <span>↑↓ navigate</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setPage("search");
                  setOpen(false);
                }}
                className="flex items-center gap-1 rounded-full px-2 py-1 font-semibold text-accent transition hover:bg-accent/10"
              >
                See all results <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
