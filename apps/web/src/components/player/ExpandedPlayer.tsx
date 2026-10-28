import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, ChevronDown, Download, ListMusic, MicVocal, Sparkles } from "lucide-react";
import { usePlayerStore } from "../../stores/playerStore";
import { useUIStore } from "../../stores/uiStore";
import { applyArtworkAccent } from "../../lib/colors";
import { Artwork } from "../ui/Artwork";
import { LikeButton } from "../ui/LikeButton";
import { ProgressBar } from "./ProgressBar";
import { PlayerControls } from "./PlayerControls";
import { Visualizer } from "./Visualizer";
import { QueueList } from "./QueueDrawer";
import { LyricsPanel } from "../lyrics/LyricsPanel";

/** Full-screen player: dynamic art background, synced lyrics, visualizer. */
export function ExpandedPlayer() {
  const setExpanded = useUIStore((s) => s.setPlayerExpanded);
  const tab = useUIStore((s) => s.playerTab);
  const setTab = useUIStore((s) => s.setPlayerTab);
  const visualizerOn = useUIStore((s) => s.visualizerOn);
  const toggleVisualizer = useUIStore((s) => s.toggleVisualizer);
  const contextLabel = usePlayerStore((s) => s.contextLabel);
  const current = usePlayerStore((s) => s.current);
  const status = usePlayerStore((s) => s.status);
  const failoverCount = usePlayerStore((s) => s.failoverCount);
  const bgRef = useRef<HTMLDivElement>(null);

  // Sample artwork colors → --art-1 / --art-2 for glows + visualizer.
  useEffect(() => {
    void applyArtworkAccent(bgRef.current, current?.artwork_best ?? current?.artwork, current?.id);
  }, [current?.id, current?.artwork, current?.artwork_best]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setExpanded]);

  const playing = status === "playing";

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="fixed inset-0 z-[60] flex flex-col bg-bg"
    >
      {/* Dynamic blurred artwork background */}
      <div ref={bgRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.img
            key={current?.artwork_best ?? current?.artwork ?? "none"}
            initial={{ opacity: 0, scale: 1.15 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            src={current?.artwork_best ?? current?.artwork}
            alt=""
            className="art-drift absolute inset-0 h-full w-full object-cover blur-3xl"
            style={{ opacity: "var(--art-opacity)" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-b from-bg/50 via-bg/75 to-bg" />
        <div
          className="absolute inset-0 mix-blend-overlay opacity-40"
          style={{
            background:
              "radial-gradient(60% 50% at 30% 20%, color-mix(in srgb, var(--art-1, transparent) 40%, transparent), transparent 70%)",
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 py-3.5 sm:px-8">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-medium text-dim transition hover:bg-surface-2 hover:text-ink"
        >
          <ChevronDown className="h-4 w-4" /> Collapse
        </button>
        <div className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
            {contextLabel === "radio" ? "endless radio" : contextLabel ?? "now playing"}
          </p>
          {failoverCount > 0 && (
            <p className="text-[10px] text-faint">
              <Sparkles className="mr-1 inline h-3 w-3" />
              seamless fallback used ×{failoverCount}
            </p>
          )}
        </div>
        <div className="flex w-[104px] shrink-0 items-center justify-end gap-1.5">
          <button
            type="button"
            title={visualizerOn ? "Visualizer on" : "Visualizer off"}
            aria-pressed={visualizerOn}
            onClick={toggleVisualizer}
            className={`rounded-lg p-2.5 transition hover:bg-white/10 ${
              visualizerOn ? "text-white" : "text-white/50"
            }`}
          >
            <Activity className="h-5 w-5" />
          </button>
          {current && (
            <>
              <button
                type="button"
                title="Download"
                aria-label="Download"
                onClick={() => useUIStore.getState().setDownloadTrack(current)}
                className="rounded-lg p-2.5 text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <Download className="h-5 w-5" />
              </button>
              <LikeButton track={current} size="lg" />
            </>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 pb-6 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8">
        {/* Left: artwork + info + controls */}
        <div className="flex min-h-0 flex-col items-center justify-center gap-5 overflow-y-auto py-2">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            className="relative"
          >
            {/* decorative vinyl peeking behind the cover */}
            <div
              aria-hidden
              className={`spin-art absolute -right-10 top-1/2 hidden h-56 w-56 -translate-y-1/2 rounded-full sm:block ${
                playing ? "" : ""
              }`}
              data-paused={!playing}
              style={{
                background:
                  "repeating-radial-gradient(circle at center, #0c0c0f 0 3px, rgba(255,255,255,0.045) 3px 4px), #0c0c0f",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
              }}
            >
              <span
                className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: "var(--art-1, var(--accent))" }}
              />
              <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg" />
            </div>

            <Artwork
              src={current?.artwork_best ?? current?.artwork}
              alt={current?.title ?? "No track"}
              radius="rounded-2xl"
              className="h-[min(44vh,340px)] w-[min(44vh,340px)] shadow-2xl"
            />
          </motion.div>

          <div className="w-full max-w-lg text-center">
            <h2 className="truncate font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              {current?.title ?? "Nothing playing"}
            </h2>
            <p className="mt-1 truncate text-sm text-dim sm:text-base">
              {current?.artist_names ?? "Choose something from Home"}
            </p>
            <div className="mt-4 w-full">
              <ProgressBar />
            </div>
            <div className="mt-4">
              <PlayerControls size="lg" />
            </div>
            {/* Visualizer strip */}
            <div className="mx-auto mt-5 h-16 w-full max-w-lg opacity-90">
              <Visualizer bars={44} active />
            </div>
          </div>
        </div>

        {/* Right: lyrics / queue tabs */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface/40 backdrop-blur-xl">
          <div className="flex shrink-0 items-center gap-1 border-b border-line p-2">
            <button
              type="button"
              onClick={() => setTab("lyrics")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                tab === "lyrics" ? "bg-surface-2 text-ink" : "text-dim hover:text-ink"
              }`}
            >
              <MicVocal className="h-4 w-4" /> Lyrics
            </button>
            <button
              type="button"
              onClick={() => setTab("queue")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                tab === "queue" ? "bg-surface-2 text-ink" : "text-dim hover:text-ink"
              }`}
            >
              <ListMusic className="h-4 w-4" /> Queue
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === "lyrics" ? (
              <LyricsPanel className="h-full overflow-y-auto" />
            ) : (
              <div className="h-full overflow-y-auto">
                <QueueList />
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
