"use client";
import { useEffect, useState } from "react";
import type { Track } from "@/lib/types";
import { THEMES } from "@/lib/themes";
import { api } from "@/lib/api";
import { Artwork, Empty, Icon, Logo, SectionTitle } from "./ui";
import { useApp } from "./app-context";
import { usePlayer } from "./player-context";

function Shelf({ tracks }: { tracks: Track[] }) {
  const { playQueue, current } = usePlayer();
  return (
    <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      {tracks.map((t, i) => (
        <button key={`${t.id}-${i}`} onClick={() => playQueue(tracks, i)} className="group w-36 shrink-0 text-left sm:w-40">
          <div className="relative">
            <Artwork src={t.artwork} className="aspect-square w-full" rounded="rounded-xl" />
            <span className="absolute bottom-2 right-2 grid h-10 w-10 translate-y-2 place-items-center rounded-full bg-accent text-accent-ink opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100">
              <Icon name="play" />
            </span>
          </div>
          <p className={`mt-2 truncate text-sm font-semibold ${current?.id === t.id ? "text-accent" : ""}`}>{t.title}</p>
          <p className="truncate text-xs text-muted">{t.artist}</p>
        </button>
      ))}
    </div>
  );
}

export function HomeView() {
  const { setView, settings, update, history, liked, signedIn, accountName } = useApp();
  const [trend, setTrend] = useState<Track[] | null>(null);
  const [made, setMade] = useState<{ title: string; tracks: Track[] }[]>([]);

  useEffect(() => {
    api<Track[]>("/api/trending").then(setTrend).catch(() => setTrend([]));
  }, []);

  useEffect(() => {
    if (!signedIn) return setMade([]);
    const seeds = [history[0], liked[0], history[3]].filter((x): x is Track => !!x).slice(0, 2);
    Promise.all(
      seeds.map((s) =>
        api<Track[]>(`/api/related?${new URLSearchParams({ id: s.id, artist: s.artist, title: s.title })}`).then((tracks) => ({
          title: `More like ${s.artist}`,
          tracks,
        })),
      ),
    )
      .then((r) => setMade(r.filter((x) => x.tracks.length)))
      .catch(() => {});
  }, [signedIn, history, liked]);

  const cycleTheme = () => {
    const i = THEMES.findIndex((t) => t.id === settings.theme);
    update({ theme: THEMES[(i + 1) % THEMES.length].id });
  };
  const recent = history.filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i).slice(0, 12);

  return (
    <div>
      <div className="relative overflow-hidden rounded-3xl border border-outline bg-surface/70 p-6 backdrop-blur-xl sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-40 blur-3xl" style={{ background: "var(--accent)" }} />
        <Logo size={44} />
        <h1 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl">
          {signedIn ? `Welcome back${accountName ? `, ${accountName}` : ""}.` : "Welcome to your sound."}
        </h1>
        <p className="mt-2 max-w-lg text-muted">Search any song or lyric line, build playlists, download for offline. Local-first, no subscription.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            { icon: "search", label: "Search", on: () => setView("search") },
            { icon: "library", label: "Library", on: () => setView("library") },
            { icon: "download", label: "Downloads", on: () => setView("downloads") },
          ].map((a) => (
            <button key={a.label} onClick={a.on} className="flex items-center gap-2 rounded-full border border-outline bg-raised px-4 py-2 text-sm font-semibold hover:border-accent">
              <Icon name={a.icon} size={18} className="text-accent" /> {a.label}
            </button>
          ))}
          <button onClick={cycleTheme} className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
            <span className="h-3 w-3 rounded-full border-2 border-accent-ink/40" style={{ background: "var(--accent2)" }} /> Theme: {THEMES.find((t) => t.id === settings.theme)?.name}
          </button>
        </div>
      </div>

      {!signedIn && (
        <button onClick={() => setView("settings")} className="mt-4 w-full rounded-2xl border border-dashed border-outline p-4 text-left text-sm text-muted hover:border-accent">
          <span className="font-semibold text-text">Sign in to YouTube Music</span> in Settings to unlock personalized recommendation shelves.
        </button>
      )}

      {made.map((m) => (
        <div key={m.title}>
          <SectionTitle>{m.title}</SectionTitle>
          <Shelf tracks={m.tracks} />
        </div>
      ))}

      {recent.length > 0 && (
        <>
          <SectionTitle>Recently played</SectionTitle>
          <Shelf tracks={recent} />
        </>
      )}

      <SectionTitle>Trending charts</SectionTitle>
      {trend === null ? (
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 w-40 shrink-0 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : trend.length ? (
        <Shelf tracks={trend} />
      ) : (
        <Empty icon="note" title="Charts are unavailable right now" hint="Check your connection. Search still works for anything you know the name of." />
      )}
    </div>
  );
}
