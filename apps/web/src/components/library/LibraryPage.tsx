import { useEffect, useState } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import {
  Heart,
  ListMusic,
  History as HistoryIcon,
  Plus,
  Trash2,
  ChevronLeft,
  Play,
  Loader2,
  LibraryBig,
  GripVertical,
} from "lucide-react";
import { formatDuration } from "@themashup/shared";
import { useLibraryStore } from "../../stores/libraryStore";
import { useSessionStore } from "../../stores/sessionStore";
import { usePlayerStore } from "../../stores/playerStore";
import { useUIStore } from "../../stores/uiStore";
import { TrackRow } from "../search/SearchRows";
import { Artwork } from "../ui/Artwork";

type Tab = "liked" | "playlists" | "history";

function SignInGate() {
  const setAuthModalOpen = useUIStore((s) => s.setAuthModalOpen);
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-md rounded-3xl border border-line bg-surface/60 p-8 text-center"
    >
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
        <LibraryBig className="h-7 w-7" />
      </span>
      <h2 className="mt-4 font-display text-xl font-extrabold">Your library lives here</h2>
      <p className="mt-2 text-sm leading-relaxed text-dim">
        Sign in to keep likes, playlists, history and followed artists — with demo mode
        everything stays on this device, with Google it syncs through Supabase.
      </p>
      <button
        type="button"
        onClick={() => setAuthModalOpen(true)}
        className="mt-5 rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-accent-contrast transition hover:brightness-110"
      >
        Sign in / Demo mode
      </button>
    </motion.div>
  );
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof Heart; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-8 text-center">
      <Icon className="mx-auto h-8 w-8 text-faint" />
      <p className="mt-3 text-sm font-semibold text-dim">{title}</p>
      <p className="mt-1 text-xs text-faint">{body}</p>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

export function LibraryPage() {
  const mode = useSessionStore((s) => s.mode);
  const { likes, playlists, history, activePlaylist, loading, hydrate, openPlaylist, closePlaylist, createPlaylist, deletePlaylist, removeTrackFromPlaylist, reorderActivePlaylist } =
    useLibraryStore();
  const playNow = usePlayerStore((s) => s.playNow);
  const [tab, setTab] = useState<Tab>("liked");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "none") void hydrate();
  }, [mode, hydrate]);

  if (mode === "none") return <SignInGate />;

  const tabs: { id: Tab; label: string; icon: typeof Heart; count: number }[] = [
    { id: "liked", label: "Liked", icon: Heart, count: likes.length },
    { id: "playlists", label: "Playlists", icon: ListMusic, count: playlists.length },
    { id: "history", label: "Recently played", icon: HistoryIcon, count: history.length },
  ];

  const onCreate = async () => {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await createPlaylist(title);
      setNewTitle("");
      setCreating(false);
      setTab("playlists");
    } finally {
      setBusy(false);
    }
  };

  /* ── playlist detail ── */
  if (activePlaylist) {
    const { meta, tracks } = activePlaylist;
    const handleReorder = (next: typeof tracks) => {
      void reorderActivePlaylist(
        meta.id,
        next.map((t) => t.id),
      ).catch(() => undefined);
    };
    return (
      <div className="pb-8">
        <button
          type="button"
          onClick={closePlaylist}
          className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-dim transition hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> All playlists
        </button>
        <div className="mb-6 flex items-end gap-4">
          <Artwork src={meta.cover_url} alt={meta.title} radius="rounded-2xl" className="h-32 w-32 shadow-2xl" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">playlist</p>
            <h2 className="truncate font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{meta.title}</h2>
            <p className="mt-1 text-sm text-dim">
              {meta.track_count} track{meta.track_count === 1 ? "" : "s"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={() => tracks[0] && void playNow(tracks[0], tracks, "playlist")}
                className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-bold text-accent-contrast transition hover:brightness-110 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" fill="currentColor" /> Play all
              </button>
              <button
                type="button"
                onClick={() => void deletePlaylist(meta.id)}
                className="flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-semibold text-dim transition hover:border-red-400/50 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          </div>
        </div>
        {loading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        )}
        {!loading && tracks.length === 0 && (
          <EmptyState icon={ListMusic} title="Empty playlist" body="Hover any search result or card → ⋯ → add to this playlist." />
        )}
        <Reorder.Group
          axis="y"
          values={tracks}
          onReorder={handleReorder}
          className="space-y-1"
        >
          {tracks.map((t) => (
            <Reorder.Item
              key={t.id}
              value={t}
              whileDrag={{ scale: 1.01 }}
              transition={{ type: "spring", stiffness: 520, damping: 42 }}
              className="w-full cursor-grab list-none rounded-xl active:cursor-grabbing"
            >
              <TrackRow
                track={t}
                queue={tracks}
                trailing={
                  <span className="flex items-center gap-0.5">
                    <span
                      title="Drag to reorder"
                      className="rounded-lg p-1.5 text-faint opacity-0 transition group-hover:opacity-100"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </span>
                    <button
                      type="button"
                      title="Remove from playlist"
                      onClick={() => void removeTrackFromPlaylist(meta.id, t.id)}
                      className="rounded-lg p-1.5 text-faint opacity-0 transition hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                }
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>
        {tracks.length > 1 && (
          <p className="mt-3 text-center text-[11px] text-faint">
            drag rows to reorder — order syncs to your library
          </p>
        )}
      </div>
    );
  }

  /* ── tabs ── */
  return (
    <div className="pb-8">
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === t.id
                  ? "border-accent bg-accent text-accent-contrast"
                  : "border-line bg-surface text-dim hover:text-ink"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
              <span className="opacity-70">{t.count}</span>
            </button>
          );
        })}
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-faint" />}
      </div>

      {/* liked */}
      {tab === "liked" && (
        <div className="space-y-1">
          {likes.length === 0 && !loading && (
            <EmptyState icon={Heart} title="No liked songs yet" body="Tap the heart on any track to keep it here." />
          )}
          {likes.map((t) => (
            <TrackRow key={t.id} track={t} queue={likes} />
          ))}
        </div>
      )}

      {/* playlists */}
      {tab === "playlists" && (
        <div>
          <div className="mb-4 flex items-center gap-2">
            {!creating ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-accent/60 px-4 py-2 text-xs font-bold text-accent transition hover:bg-accent/10"
              >
                <Plus className="h-3.5 w-3.5" /> New playlist
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void onCreate()}
                  placeholder="Playlist name…"
                  maxLength={120}
                  className="w-56 rounded-full border border-accent/60 bg-surface-2 px-4 py-2 text-sm outline-none placeholder:text-faint"
                />
                <button
                  type="button"
                  onClick={() => void onCreate()}
                  disabled={busy || !newTitle.trim()}
                  className="rounded-full bg-accent px-4 py-2 text-xs font-bold text-accent-contrast disabled:opacity-50"
                >
                  {busy ? "…" : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setNewTitle("");
                  }}
                  className="text-xs text-faint hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {playlists.length === 0 && !loading ? (
            <EmptyState icon={ListMusic} title="No playlists yet" body="Create one, then add tracks from search results." />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              <AnimatePresence initial={false}>
                {playlists.map((p, i) => (
                  <motion.button
                    key={p.id}
                    type="button"
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ delay: Math.min(i * 0.04, 0.3) }}
                    onClick={() => void openPlaylist(p.id)}
                    className="group rounded-2xl border border-line bg-surface/60 p-3 text-left transition hover:border-accent/40 hover:bg-surface-2"
                  >
                    <Artwork src={p.cover_url} alt={p.title} radius="rounded-xl" className="aspect-square w-full" />
                    <p className="mt-2.5 truncate text-sm font-bold text-ink">{p.title}</p>
                    <p className="text-xs text-faint">
                      {p.track_count} track{p.track_count === 1 ? "" : "s"}
                    </p>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* history */}
      {tab === "history" && (
        <div className="space-y-1">
          {history.length === 0 && !loading && (
            <EmptyState icon={HistoryIcon} title="Nothing played yet" body="Start a track and it shows up here instantly." />
          )}
          {history.map((h, i) => (
            <div key={`${h.track.id}-${i}`} className="relative">
              <TrackRow track={h.track} queue={history.map((x) => x.track)} />
              <span className="pointer-events-none absolute right-3 top-1 hidden text-[10px] text-faint sm:block">
                {relativeTime(h.at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
