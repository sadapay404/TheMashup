import { motion } from "framer-motion";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Loader2,
} from "lucide-react";
import { usePlayerStore } from "../../stores/playerStore";

/** Shared transport controls (used by player bar + expanded player). */
export function PlayerControls({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const status = usePlayerStore((s) => s.status);
  const resolving = usePlayerStore((s) => s.resolving);
  const current = usePlayerStore((s) => s.current);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);

  const busy = resolving || status === "loading";
  const playing = status === "playing" || (busy && status !== "error");
  const disabled = !current;

  const icon = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const playSize =
    size === "lg" ? "h-16 w-16" : size === "sm" ? "h-9 w-9" : "h-11 w-11";

  return (
    <div className="flex items-center justify-center gap-3 sm:gap-4">
      <button
        type="button"
        title={shuffle ? "Shuffle on" : "Shuffle"}
        aria-pressed={shuffle}
        disabled={disabled}
        onClick={toggleShuffle}
        className={`relative rounded-lg p-2 transition hover:text-ink disabled:opacity-40 ${
          shuffle ? "text-accent" : "text-dim"
        }`}
      >
        <Shuffle className={icon} />
        {shuffle && (
          <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
        )}
      </button>

      <button
        type="button"
        title="Previous"
        disabled={disabled}
        onClick={() => void prev()}
        className="rounded-full p-2 text-dim transition hover:text-ink disabled:opacity-40"
      >
        <SkipBack className={`${icon}`} fill="currentColor" />
      </button>

      <motion.button
        type="button"
        title={playing ? "Pause" : "Play"}
        disabled={disabled}
        whileTap={{ scale: 0.92 }}
        onClick={toggle}
        className={`flex ${playSize} items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40`}
        style={{ boxShadow: disabled ? undefined : "var(--ring)" }}
      >
        {busy ? (
          <Loader2 className={`${icon} animate-spin`} />
        ) : playing ? (
          <Pause className={icon} fill="currentColor" />
        ) : (
          <Play className={`${icon} translate-x-[1px]`} fill="currentColor" />
        )}
      </motion.button>

      <button
        type="button"
        title="Next"
        disabled={disabled}
        onClick={() => void next(true)}
        className="rounded-full p-2 text-dim transition hover:text-ink disabled:opacity-40"
      >
        <SkipForward className={icon} fill="currentColor" />
      </button>

      <button
        type="button"
        title={`Repeat: ${repeat}`}
        aria-pressed={repeat !== "off"}
        disabled={disabled}
        onClick={cycleRepeat}
        className={`relative rounded-lg p-2 transition hover:text-ink disabled:opacity-40 ${
          repeat !== "off" ? "text-accent" : "text-dim"
        }`}
      >
        {repeat === "one" ? <Repeat1 className={icon} /> : <Repeat className={icon} />}
        {repeat !== "off" && (
          <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
        )}
      </button>
    </div>
  );
}
