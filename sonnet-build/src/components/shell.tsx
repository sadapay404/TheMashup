"use client";
import { useState } from "react";
import { Icon, Logo } from "./ui";
import { useApp, type View } from "./app-context";
import { usePlayer } from "./player-context";
import { HomeView } from "./home-view";
import { SearchView } from "./search-view";
import { LibraryView } from "./library-view";
import { DownloadsView } from "./downloads-view";
import { SettingsView } from "./settings-view";
import { ExpandedPlayer, MiniPlayer, QueueDrawer } from "./player-ui";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "search", label: "Search", icon: "search" },
  { id: "library", label: "Library", icon: "library" },
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function PlaylistModal() {
  const { playlistTarget, pickPlaylist, playlists, addToPlaylist, createPlaylist } = useApp();
  const [name, setName] = useState("");
  if (!playlistTarget) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-end bg-black/60 sm:place-items-center" onClick={() => pickPlaylist(null)}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl border border-outline bg-surface p-5 sm:rounded-3xl">
        <h3 className="text-lg font-bold">Add to playlist</h3>
        <p className="mb-3 truncate text-sm text-muted">{playlistTarget.title}</p>
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {playlists.map((p) => (
            <button
              key={p.id}
              onClick={async () => {
                await addToPlaylist(p.id, playlistTarget);
                pickPlaylist(null);
              }}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-raised"
            >
              <span className="truncate font-medium">{p.name}</span>
              <span className="text-xs text-muted">{p.count}</span>
            </button>
          ))}
          {!playlists.length && <p className="py-2 text-sm text-muted">No playlists yet. Create one below.</p>}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const p = await createPlaylist(name.trim());
            if (p) await addToPlaylist(p.id, playlistTarget);
            setName("");
            pickPlaylist(null);
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist" className="min-w-0 flex-1 rounded-xl border border-outline bg-raised px-3 py-2 text-text outline-none placeholder:text-subtle focus:border-accent" />
          <button className="rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink">Create</button>
        </form>
      </div>
    </div>
  );
}

export function Shell() {
  const { view, setView, toastMsg } = useApp();
  const { current, setQueueOpen } = usePlayer();
  return (
    <div className="min-h-dvh">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-outline bg-surface/60 p-5 backdrop-blur-xl md:flex">
        <Logo />
        <nav className="mt-8 space-y-1">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setView(n.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${view === n.id ? "bg-accent text-accent-ink" : "text-muted hover:bg-raised hover:text-text"}`}>
              <Icon name={n.icon} size={20} /> {n.label}
            </button>
          ))}
        </nav>
        <button onClick={() => setQueueOpen(true)} className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted hover:bg-raised hover:text-text">
          <Icon name="queue" size={20} /> Queue
        </button>
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-outline bg-bg/80 px-4 py-3 backdrop-blur-xl md:hidden">
        <Logo size={30} />
        <button onClick={() => setQueueOpen(true)} aria-label="Queue" className="text-muted"><Icon name="queue" /></button>
      </header>

      <main className={`mx-auto max-w-4xl px-4 py-6 md:ml-64 md:max-w-none md:px-10 md:py-10 ${current ? "pb-44 md:pb-32" : "pb-24"}`}>
        <div className="mx-auto max-w-4xl">
          {view === "home" && <HomeView />}
          {view === "search" && <SearchView />}
          {view === "library" && <LibraryView />}
          {view === "downloads" && <DownloadsView />}
          {view === "settings" && <SettingsView />}
        </div>
      </main>

      <MiniPlayer />

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-outline bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {NAV.map((n) => (
          <button key={n.id} onClick={() => setView(n.id)} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${view === n.id ? "text-accent" : "text-muted"}`}>
            <Icon name={n.icon} size={22} /> {n.label}
          </button>
        ))}
      </nav>

      <ExpandedPlayer />
      <QueueDrawer />
      <PlaylistModal />
      {toastMsg && (
        <div className="fixed left-1/2 top-4 z-[80] -translate-x-1/2 rounded-full border border-outline bg-raised px-5 py-2.5 text-sm font-medium shadow-2xl" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
