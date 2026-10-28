import { useState } from "react";
import { Volume2, VolumeX, Volume1 } from "lucide-react";
import { useScrub } from "../../hooks/useScrub";
import { usePlayerStore } from "../../stores/playerStore";

export function VolumeControl() {
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const [preview, setPreview] = useState<number | null>(null);

  const shown = muted ? 0 : preview ?? volume;
  const { trackRef, handlers } = useScrub({
    onChange: (r) => setPreview(r),
    onCommit: (r) => setVolume(r),
    onEnd: () => setPreview(null),
  });

  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="group flex items-center gap-2">
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        className="rounded-lg p-1.5 text-dim transition hover:text-ink"
      >
        <Icon className="h-4 w-4" />
      </button>
      <div
        ref={trackRef}
        {...handlers}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setVolume(Math.min(1, volume + 0.05));
          if (e.key === "ArrowLeft") setVolume(Math.max(0, volume - 0.05));
        }}
        className="relative hidden h-4 w-24 cursor-pointer touch-none select-none sm:block"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${shown * 100}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
          style={{
            left: `${shown * 100}%`,
            backgroundColor: "var(--accent)",
            border: "2px solid var(--bg)",
          }}
        />
      </div>
    </div>
  );
}
