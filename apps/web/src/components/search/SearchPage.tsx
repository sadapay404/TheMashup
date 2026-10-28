import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Loader2, Music4, MicVocal, Users } from "lucide-react";
import { mergeHybrid } from "@themashup/shared";
import { useUIStore } from "../../stores/uiStore";
import { useHybridSearch } from "../../hooks/useHybridSearch";
import { TrackRow, LyricMatchRow, ArtistChip } from "./SearchRows";

type Filter = "all" | "songs" | "lyrics" | "artists";

const FILTERS: { id: Filter; label: string; icon: typeof Music4 }[] = [
  { id: "all", label: "Everything", icon: Search },
  { id: "songs", label: "Songs", icon: Music4 },
  { id: "lyrics", label: "Lyrics", icon: MicVocal },
  { id: "artists", label: "Artists", icon: Users },
];

/** Full-page hybrid results (entered via “See all results” or Enter). */
export function SearchPage() {
  const query = useUIStore((s) => s.searchQuery);
  const [filter, setFilter] = useState<Filter>("all");
  const results = useHybridSearch(query, true);
  const rows = useMemo(
    () => mergeHybrid(results.tracks, results.matches, results.query),
    [results],
  );

  const visibleRows = rows.filter((r) => {
    if (filter === "songs") return r.kind === "track";
    if (filter === "lyrics") return r.kind === "lyric";
    return true;
  });
  const showArtists = filter === "all" || filter === "artists";

  if (query.trim().length < 2) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-2xl rounded-2xl border border-dashed border-line p-10 text-center"
      >
        <Search className="mx-auto h-9 w-9 text-faint" />
        <h2 className="mt-4 font-display text-xl font-bold">Search anything</h2>
        <p className="mt-2 text-sm leading-relaxed text-dim">
          Type a <strong className="text-ink">song</strong>, an{" "}
          <strong className="text-ink">artist</strong> — or a{" "}
          <strong className="text-ink">lyric line you half-remember</strong>. The dual-mode
          engine queries the catalog and the lyric index in parallel and merges the hits.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-faint">
          <span className="rounded-full border border-line px-3 py-1">“blinding lights”</span>
          <span className="rounded-full border border-line px-3 py-1">
            “city hums in ultraviolet”
          </span>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="pb-8">
      {/* filter tabs */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const Icon = f.icon;
          const count =
            f.id === "songs"
              ? rows.filter((r) => r.kind === "track").length
              : f.id === "lyrics"
                ? results.matches.length
                : f.id === "artists"
                  ? results.artists.length
                  : rows.length;
          if (count === 0 && f.id !== "all") return null;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                filter === f.id
                  ? "border-accent bg-accent text-accent-contrast"
                  : "border-line bg-surface text-dim hover:text-ink"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {f.label}
              <span className="opacity-70">{count}</span>
            </button>
          );
        })}
        {results.loading && (
          <span className="flex items-center gap-1.5 px-2 text-xs text-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> searching…
          </span>
        )}
      </div>

      {/* artists */}
      {showArtists && results.artists.length > 0 && (
        <section className="mb-7">
          <h3 className="mb-3 font-display text-lg font-bold">Artists</h3>
          <div className="flex flex-wrap gap-2">
            {results.artists.map((a) => (
              <ArtistChip key={a.channel_id ?? a.name} artist={a} />
            ))}
          </div>
        </section>
      )}

      {/* rows */}
      <section>
        {results.loading && visibleRows.length === 0 && results.artists.length === 0 && (
          <div className="space-y-1" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                <div className="skeleton h-11 w-11 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton h-3.5 rounded" style={{ width: `${58 + ((i * 7) % 30)}%` }} />
                  <div className="skeleton h-3 w-1/3 rounded" />
                </div>
                <div className="skeleton h-3 w-10 rounded" />
              </div>
            ))}
          </div>
        )}
        {visibleRows.length > 0 && (
          <div className="space-y-1">
            {visibleRows.map((row, i) =>
              row.kind === "track" ? (
                <motion.div
                  key={row.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                >
                  <TrackRow track={row.track} queue={results.tracks} />
                </motion.div>
              ) : (
                <motion.div
                  key={row.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                >
                  <LyricMatchRow match={row.match} />
                </motion.div>
              ),
            )}
          </div>
        )}

        {!results.loading && visibleRows.length === 0 && results.artists.length === 0 && (
          <div className="rounded-2xl border border-line bg-surface/50 p-8 text-center">
            <Music4 className="mx-auto h-8 w-8 text-faint" />
            <p className="mt-3 text-sm font-medium text-dim">Nothing matched “{results.query}”</p>
            <p className="mt-1 text-xs text-faint">Check spelling, or try fewer lyric words.</p>
          </div>
        )}
        {results.error && (
          <p className="rounded-xl border border-red-400/30 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {results.error}
          </p>
        )}
      </section>
    </div>
  );
}
