import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, ListMusic, MicVocal, Disc3 } from "lucide-react";
import { usePlayerStore } from "../../stores/playerStore";
import { useUIStore } from "../../stores/uiStore";
import { Artwork } from "../ui/Artwork";
import { ProgressBar } from "./ProgressBar";
import { PlayerControls } from "./PlayerControls";
import { VolumeControl } from "./VolumeControl";
import { LikeButton } from "../ui/LikeButton";

/** Floating bottom player bar — always visible, tap meta to expand. */
export function PlayerBar() {
  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const setExpanded = useUIStore((s) => s.setPlayerExpanded);
  const setQueueOpen = useUIStore((s) => s.setQueueOpen);
  const queueOpen = useUIStore((s) => s.queueOpen);
  const setPlayerTab = useUIStore((s) => s.setPlayerTab);
  const playerTab = useUIStore((s) => s.playerTab);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 lg:left-64">
      <div className="pointer-events-auto border-t border-line bg-bg/85 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur-xl sm:px-4">
        {/* Progress (full width above the row on all sizes) */}
        <div className="mx-auto mb-1.5 max-w-4xl">
          <ProgressBar compact />
        </div>

        <div className="mx-auto flex max-w-6xl items-center gap-3">
          {/* Meta */}
          <button
            type="button"
            disabled={!current}
            onClick={() => current && setExpanded(true)}
            className="group flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default sm:w-[30%] sm:flex-none"
          >
            <div className="relative h-11 w-11 shrink-0 sm:h-12 sm:w-12">
              <AnimatePresence mode="wait">
                <motion.div
                  key={current?.id ?? "none"}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.22 }}
                  className="h-full w-full"
                >
                  <Artwork
                    src={current?.artwork_best ?? current?.artwork}
                    alt={current?.title ?? "Nothing playing"}
                    className="h-full w-full shadow"
                  />
                </motion.div>
              </AnimatePresence>
              {current && (
                <ChevronUp className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 rounded-full bg-surface-2 p-px text-dim opacity-0 transition group-hover:opacity-100 sm:block" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">
                {current?.title ?? "Nothing playing"}
              </p>
              <p className="truncate text-xs text-dim">
                {current?.artist_names ?? "Pick a track to start"}
              </p>
            </div>
          </button>

          {/* Transport */}
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <PlayerControls size="md" />
          </div>

          {/* Actions */}
          <div className="hidden items-center justify-end gap-1 sm:flex sm:w-[30%]">
            {current && <LikeButton track={current} size="md" />}
            <button
              type="button"
              title="Lyrics"
              onClick={() => {
                setPlayerTab("lyrics");
                setExpanded(true);
              }}
              className={`rounded-lg p-2 transition hover:text-ink ${
                current && playerTab === "lyrics" ? "text-accent" : "text-dim"
              }`}
            >
              <MicVocal className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Queue"
              onClick={() => setQueueOpen(!queueOpen)}
              className={`rounded-lg p-2 transition hover:text-ink ${
                queueOpen ? "text-accent" : "text-dim"
              }`}
            >
              <ListMusic className="h-4 w-4" />
            </button>
            <VolumeControl />
            <button
              type="button"
              title="Expand player"
              disabled={!current}
              onClick={() => setExpanded(true)}
              className="rounded-lg p-2 text-dim transition hover:text-ink disabled:opacity-40"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>

          {/* Mobile: queue + expand only */}
          <div className="flex items-center gap-1 sm:hidden">
            <button
              type="button"
              title="Queue"
              onClick={() => setQueueOpen(!queueOpen)}
              className="rounded-lg p-2 text-dim"
            >
              <ListMusic className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Expand"
              disabled={!current}
              onClick={() => setExpanded(true)}
              className="rounded-lg p-2 text-dim disabled:opacity-40"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Status ribbon: resolving / failover hints / errors */}
        <AnimatePresence>
          {status === "error" && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mx-auto mt-1 max-w-6xl truncate text-center text-[11px] text-red-400"
            >
              {usePlayerStore.getState().error ?? "Playback failed"}
            </motion.p>
          )}
        </AnimatePresence>
        {status !== "error" && !current && (
          <div className="mx-auto mt-0.5 flex max-w-6xl items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest text-faint">
            <Disc3 className="h-3 w-3" /> queue is empty
          </div>
        )}
      </div>
    </div>
  );
}
