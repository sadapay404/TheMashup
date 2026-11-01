"use client";
import { useEffect, useState } from "react";
import type { Playlist, Track } from "@/lib/types";
import { api } from "@/lib/api";
import { Chip, Empty, Icon, IconButton, SectionTitle } from "./ui";
import { TrackList } from "./track-row";
import { useApp } from "./app-context";
import { usePlayer } from "./player-context";

type Tab = "playlists" | "liked" | "queue" | "history" | "recent";

export function LibraryView() {
  const { playlists, liked, history, createPlaylist, refreshLibrary, toast } = useApp();
  const { queue, index, playQueue, removeFromQueue, clearQueue, jumpTo } = usePlayer();
  const [tab, setTab] = useState<Tab>("playlists");
  const [open, setOpen] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const load = async (p: Playlist) => {
    setOpen(p);
    setRenaming(false);
    setName(p.name);
    const r = await api<{ tracks: Track[] }>(`/api/playlists/${p.id}`);
    setTracks(r.tracks);
  };

  // keep opened playlist fresh (name/count) after library refresh
  useEffect(() => {
    if (open) {
      const fresh = playlists.find((p) => p.id === open.id);
      if (!fresh) setOpen(null);
      else if (fresh.name !== open.name) setOpen(fresh);
    }
  }, [playlists, open]);

  if (open) {
    return (
      <div>
        <button onClick={() => setOpen(null)} className="mb-4 flex items-center gap-1 text-sm text-muted hover:text-text">
          <Icon name="down" className="rotate-90" size={18} /> Library
        </button>
        <div className="flex flex-wrap items-center gap-3">
          {renaming ? (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                await api(`/api/playlists/${open.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
                setRenaming(false);
                await refreshLibrary();
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="rounded-xl border border-outline bg-surface px-3 py-2 text-text outline-none focus:border-accent" />
              <button className="rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink">Save</button>
            </form>
          ) : (
            <h1 className="text-3xl font-extrabold tracking-tight">{open.name}</h1>
          )}
          <div className="ml-auto flex gap-2">
            <button disabled={!tracks.length} onClick={() => playQueue(tracks, 0)} className="flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink disabled:opacity-40">
              <Icon name="play" size={18} /> Play
            </button>
            <IconButton icon="settings" label="Rename" onClick={() => setRenaming((r) => !r)} />
            <IconButton
              icon="trash"
              label="Delete playlist"
              onClick={async () => {
                if (!confirm(`Delete “${open.name}”?`)) return;
                await api(`/api/playlists/${open.id}`, { method: "DELETE" });
                setOpen(null);
                toast("Playlist deleted");
                await refreshLibrary();
              }}
            />
          </div>
        </div>
        <p className="mb-4 mt-1 text-sm text-muted">{tracks.length} songs</p>
        {tracks.length ? (
          <TrackList
            tracks={tracks}
            removeLabel="Remove from playlist"
            onRemove={async (t) => {
              await api(`/api/playlists/${open.id}?trackId=${encodeURIComponent(t.id)}`, { method: "DELETE" });
              setTracks((x) => x.filter((y) => y.id !== t.id));
              await refreshLibrary();
            }}
          />
        ) : (
          <Empty icon="queue" title="This playlist is empty" hint="Use the ⋯ menu on any song and choose “Add to playlist”." />
        )}
      </div>
    );
  }

  const uniqueHistory = history;
  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">Library</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        {([["playlists", "Playlists"], ["liked", "Liked songs"], ["queue", "Queue"], ["history", "History"], ["recent", "Recently added"]] as [Tab, string][]).map(([id, l]) => (
          <Chip key={id} active={tab === id} onClick={() => setTab(id)}>
            {l}
          </Chip>
        ))}
      </div>

      {tab === "playlists" && (
        <>
          <form
            className="mt-6 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              await createPlaylist(name.trim());
              setName("");
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist name" className="min-w-0 flex-1 rounded-xl border border-outline bg-surface px-4 py-2.5 text-text outline-none placeholder:text-subtle focus:border-accent" />
            <button className="flex items-center gap-1 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink">
              <Icon name="plus" size={18} /> Create
            </button>
          </form>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <button onClick={() => setTab("liked")} className="rounded-2xl border border-outline p-4 text-left" style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}>
              <Icon name="heart" className="text-accent-ink" size={28} />
              <p className="mt-6 font-bold text-accent-ink">Liked songs</p>
              <p className="text-xs text-accent-ink/70">{liked.length} songs</p>
            </button>
            {playlists.map((p) => (
              <button key={p.id} onClick={() => void load(p)} className="rounded-2xl border border-outline bg-surface p-4 text-left hover:border-accent">
                <Icon name="queue" className="text-accent" size={28} />
                <p className="mt-6 truncate font-bold">{p.name}</p>
                <p className="text-xs text-muted">{p.count} songs</p>
              </button>
            ))}
          </div>
          {!playlists.length && <p className="mt-4 text-sm text-muted">No playlists yet — create your first one above.</p>}
        </>
      )}
      {tab === "liked" && (
        <div className="mt-6">
          {liked.length ? (
            <>
              <button onClick={() => playQueue(liked, 0)} className="mb-3 flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-ink">
                <Icon name="play" size={18} /> Play all
              </button>
              <TrackList tracks={liked} />
            </>
          ) : (
            <Empty icon="heart" title="No liked songs yet" hint="Tap the heart on any track to collect it here." />
          )}
        </div>
      )}
      {tab === "queue" && (
        <div className="mt-6">
          {queue.length ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-muted">{queue.length} in queue · now playing #{index + 1}</p>
                <button onClick={clearQueue} className="text-sm font-semibold text-accent">Clear queue</button>
              </div>
              <div className="space-y-0.5">
                {queue.map((t, i) => (
                  <div key={`${t.id}-${i}`} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${i === index ? "bg-raised" : ""}`}>
                    <button onClick={() => jumpTo(i)} className="min-w-0 flex-1 text-left">
                      <p className={`truncate text-sm font-semibold ${i === index ? "text-accent" : ""}`}>{t.title}</p>
                      <p className="truncate text-xs text-muted">{t.artist}</p>
                    </button>
                    <IconButton icon="trash" label="Remove" size={18} onClick={() => removeFromQueue(i)} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty icon="queue" title="Queue is empty" hint="Play something or add songs from the ⋯ menu." />
          )}
        </div>
      )}
      {tab === "history" && (
        <div className="mt-6">
          {uniqueHistory.length ? (
            <>
              <div className="mb-3 flex justify-between">
                <p className="text-sm text-muted">Last {uniqueHistory.length} plays</p>
                <button onClick={async () => { await api("/api/history", { method: "DELETE" }); await refreshLibrary(); }} className="text-sm font-semibold text-accent">Clear history</button>
              </div>
              <TrackList tracks={uniqueHistory} />
            </>
          ) : (
            <Empty icon="note" title="Nothing played yet" />
          )}
        </div>
      )}
      {tab === "recent" && (
        <div className="mt-6">
          {liked.length || history.length ? (
            <TrackList tracks={[...liked, ...history].filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i).slice(0, 20)} />
          ) : (
            <Empty icon="note" title="Nothing here yet" hint="Songs you like or play will appear here." />
          )}
        </div>
      )}
      <SectionTitle>{""}</SectionTitle>
    </div>
  );
}
