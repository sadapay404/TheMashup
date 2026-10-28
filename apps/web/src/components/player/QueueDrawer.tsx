import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, ListMusic } from "lucide-react";
import type { Track } from "@themashup/shared";
import { formatDuration } from "@themashup/shared";
import { usePlayerStore } from "../../stores/playerStore";
import { useUIStore } from "../../stores/uiStore";
import { Artwork } from "../ui/Artwork";

/** Scrollable queue list (shared by drawer + expanded player tab). */
export function QueueList({ onPick }: { onPick?: () => void }) {
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const current = usePlayerStore((s) => s.current);
  const playAtIndex = usePlayerStore((s) => s.playAtIndex);
  const removeAt = usePlayerStore((s) => s.removeAt);

  if (queue.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ListMusic className="h-8 w-8 text-faint" />
        <p className="text-sm font-medium text-dim">Your queue is empty</p>
        <p className="text-xs text-faint">Play a track or hit “Start radio” on any card.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-1 p-2">
      <AnimatePresence initial={false}>
        {queue.map((t: Track, i) => {
          const isCurrent = current?.id === t.id && i === index;
          return (
            <motion.li
              key={`${t.id}-${i}`}
              layout
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24, height: 0 }}
              transition={{ duration: 0.2 }}
              className={`group flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition ${
                isCurrent ? "bg-surface-2 ring-1 ring-accent/40" : "hover:bg-surface"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  void playAtIndex(i);
                  onPick?.();
                }}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-faint">
                  {isCurrent ? "▶" : i + 1}
                </span>
                <Artwork
                  src={t.artwork_best ?? t.artwork}
                  alt={t.title}
                  className="h-9 w-9 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm ${isCurrent ? "font-semibold text-accent" : "text-ink"}`}
                  >
                    {t.title}
                  </span>
                  <span className="block truncate text-xs text-dim">{t.artist_names}</span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-faint">
                  {formatDuration(t.duration_sec)}
                </span>
              </button>
              <button
                type="button"
                title="Remove from queue"
                onClick={() => removeAt(i)}
                className="rounded-lg p-1.5 text-faint opacity-0 transition hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

/** Right-hand slide-in queue drawer. */
export function QueueDrawer() {
  const open = useUIStore((s) => s.queueOpen);
  const setOpen = useUIStore((s) => s.setQueueOpen);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const count = usePlayerStore((s) => s.queue.length);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/45"
            onClick={() => setOpen(false)}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-line bg-bg-soft/95 backdrop-blur-xl"
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="font-display text-base font-bold">Queue</h2>
                <p className="text-[11px] text-faint">{count} track{count === 1 ? "" : "s"}</p>
              </div>
              <div className="flex items-center gap-1">
                {count > 0 && (
                  <button
                    type="button"
                    title="Clear queue"
                    onClick={clearQueue}
                    className="rounded-lg p-2 text-dim transition hover:bg-surface hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  title="Close queue"
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-2 text-dim transition hover:bg-surface hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <QueueList onPick={() => setOpen(false)} />
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
