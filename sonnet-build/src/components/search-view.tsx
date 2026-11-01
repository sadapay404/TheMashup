"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResponse } from "@/lib/types";
import { api } from "@/lib/api";
import { Chip, Empty, Icon, SectionTitle, Artwork } from "./ui";
import { TrackList } from "./track-row";
import { useApp } from "./app-context";

type F = "all" | "songs" | "lyrics" | "artists";
const CHIPS: { id: F; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "songs", label: "Songs" },
  { id: "lyrics", label: "Lyrics" },
  { id: "artists", label: "Artists" },
];

export function SearchView() {
  const { searchSeed, searchFor } = useApp();
  const [q, setQ] = useState(searchSeed);
  const [submitted, setSubmitted] = useState("");
  const [filter, setFilter] = useState<F>("all");
  const [sugg, setSugg] = useState<string[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>();
  const reqId = useRef(0);

  const run = useCallback(async (term: string) => {
    const t = term.trim();
    if (!t) return;
    const my = ++reqId.current;
    setSubmitted(t);
    setShowSugg(false);
    setLoading(true);
    setErr(undefined);
    try {
      const r = await api<SearchResponse>(`/api/search?${new URLSearchParams({ q: t, filter: "all" })}`);
      if (my !== reqId.current) return;
      setRes(r);
      if (r.error) setErr(r.error);
    } catch (e) {
      if (my === reqId.current) setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, []);

  // seed from other screens (artist/album clicks)
  useEffect(() => {
    if (searchSeed) {
      setQ(searchSeed);
      void run(searchSeed);
    }
  }, [searchSeed, run]);

  // typeahead, debounced 300ms
  useEffect(() => {
    if (q.trim().length < 2 || q.trim() === submitted) {
      setSugg([]);
      return;
    }
    const id = setTimeout(() => {
      api<string[]>(`/api/suggest?q=${encodeURIComponent(q.trim())}`).then(setSugg).catch(() => setSugg([]));
    }, 300);
    return () => clearTimeout(id);
  }, [q, submitted]);

  const show = (k: F) => filter === "all" || filter === k;
  const empty = res && !res.songs.length && !res.lyrics.length && !res.artists.length && !res.albums.length;

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(q);
        }}
        className="relative"
      >
        <div className="flex items-center gap-3 rounded-2xl border border-outline bg-surface px-4 py-3 focus-within:border-accent">
          <Icon name="search" className="text-muted" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShowSugg(true);
            }}
            onFocus={() => setShowSugg(true)}
            placeholder="Songs, artists, albums, or a line from the lyrics…"
            className="w-full bg-transparent text-base text-text outline-none placeholder:text-subtle"
            autoFocus
            enterKeyHint="search"
          />
          {q && (
            <button type="button" onClick={() => { setQ(""); setSugg([]); }} aria-label="Clear" className="text-muted hover:text-text">
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
        {showSugg && sugg.length > 0 && (
          <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-outline bg-raised shadow-2xl">
            {sugg.map((s) => (
              <button type="button" key={s} onClick={() => { setQ(s); void run(s); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface">
                <Icon name="search" size={16} className="text-subtle" /> {s}
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.label}
          </Chip>
        ))}
      </div>

      <div className="mt-6">
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-surface" />
            ))}
          </div>
        )}
        {!loading && err && !res?.songs.length && <Empty icon="search" title="Search is unavailable" hint={err} />}
        {!loading && !res && !err && (
          <Empty icon="search" title="Find your next favourite" hint="Search the catalog and the lyric index at the same time. Try “is this the real life” or an artist name." />
        )}
        {!loading && empty && !err && <Empty icon="search" title={`No results for “${submitted}”`} hint="Try different keywords or a shorter lyric line." />}
        {!loading && res && (
          <>
            {res.via.length > 0 && <p className="mb-2 text-xs text-subtle">Source: {res.via.join(", ")}</p>}
            {show("artists") && res.artists.length > 0 && (
              <>
                <SectionTitle>Artists</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {res.artists.map((a) => (
                    <button key={a.id} onClick={() => searchFor(a.name)} className="rounded-full border border-outline bg-surface px-4 py-2 text-sm font-medium hover:border-accent">
                      {a.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            {show("artists") && res.albums.length > 0 && (
              <>
                <SectionTitle>Albums</SectionTitle>
                <div className="-mx-4 flex gap-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                  {res.albums.map((a) => (
                    <button key={a.id} onClick={() => searchFor(`${a.artist} ${a.title}`)} className="w-32 shrink-0 text-left">
                      <Artwork src={a.artwork} className="aspect-square w-full" rounded="rounded-xl" />
                      <p className="mt-1.5 truncate text-sm font-semibold">{a.title}</p>
                      <p className="truncate text-xs text-muted">{a.artist}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
            {show("songs") && res.songs.length > 0 && (
              <>
                <SectionTitle>Songs</SectionTitle>
                <TrackList tracks={res.songs} />
              </>
            )}
            {show("lyrics") && res.lyrics.length > 0 && (
              <>
                <SectionTitle>Matched in lyrics</SectionTitle>
                <TrackList tracks={res.lyrics} showLyric />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
