import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ListPlus, Check, Loader2, ListMusic } from "lucide-react";
import type { Track } from "@themashup/shared";
import { useLibraryStore } from "../../stores/libraryStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useUIStore } from "../../stores/uiStore";

/** “Add to playlist” popover available on every track row. */
export function AddToPlaylistButton({ track }: { track: Track }) {
  const mode = useSessionStore((s) => s.mode);
  const setAuthModalOpen = useUIStore((s) => s.setAuthModalOpen);
  const { playlists, hydrated, hydrate, addTrackToPlaylist, createPlaylist } = useLibraryStore();
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKey, setDoneKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open || mode === "none") return;
    if (!hydrated) void hydrate();
  }, [open, mode, hydrated, hydrate]);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === "none") {
      setAuthModalOpen(true);
      return;
    }
    setOpen((o) => !o);
  };

  const add = async (playlistId: string) => {
    setBusyKey(playlistId);
    try {
      await addTrackToPlaylist(playlistId, track);
      setDoneKey(playlistId);
      setTimeout(() => {
        setDoneKey(null);
        setOpen(false);
      }, 700);
    } finally {
      setBusyKey(null);
    }
  };

  const quickCreate = async () => {
    setBusyKey("__new__");
    try {
      const pl = await createPlaylist("My Playlist");
      if (pl) await add(pl.id);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        title="Add to playlist"
        onClick={onClick}
        className="rounded-lg p-1.5 text-faint transition hover:text-ink"
      >
        <ListPlus className="h-3.5 w-3.5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            onClick={(e) => e.stopPropagation()}
            className="glass absolute bottom-[calc(100%+6px)] right-0 z-[65] w-60 rounded-2xl border border-line p-2 shadow-2xl"
          >
            <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-faint">
              Add to playlist
            </p>
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {playlists.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void add(p.id)}
                  disabled={busyKey !== null}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-dim transition hover:bg-surface-2 hover:text-ink"
                >
                  <ListMusic className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  {busyKey === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {doneKey === p.id && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                </button>
              ))}
              {playlists.length === 0 && !busyKey && (
                <p className="px-2 py-2 text-xs text-faint">No playlists yet.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void quickCreate()}
              disabled={busyKey !== null}
              className="mt-1.5 flex w-full items-center gap-2 border-t border-line px-2.5 pt-2.5 text-left text-xs font-semibold text-accent transition hover:opacity-80"
            >
              {busyKey === "__new__" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ListPlus className="h-3.5 w-3.5" />
              )}
              Create playlist & add
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
