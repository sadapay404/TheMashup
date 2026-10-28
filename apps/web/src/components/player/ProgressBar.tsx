import { useState } from "react";
import { useScrub } from "../../hooks/useScrub";
import { usePlayerStore } from "../../stores/playerStore";
import { formatDuration } from "@themashup/shared";

/** Seekable progress bar with drag preview (pointer-capture scrubbing). */
export function ProgressBar({ compact = false }: { compact?: boolean }) {
  const position = usePlayerStore((s) => s.position);
  const duration = usePlayerStore((s) => s.duration);
  const seek = usePlayerStore((s) => s.seek);
  const [preview, setPreview] = useState<number | null>(null);

  const value = preview ?? position;
  const pct = duration > 0 ? Math.min(100, (value / duration) * 100) : 0;

  const { trackRef, handlers } = useScrub({
    onChange: (r) => setPreview(r * duration),
    onCommit: (r) => seek(r * duration),
    onEnd: () => setPreview(null),
  });

  return (
    <div className={`flex w-full items-center gap-2.5 ${compact ? "text-[10px]" : "text-[11px]"}`}>
      <span className="w-9 shrink-0 text-right tabular-nums text-faint">{formatDuration(value)}</span>
      <div
        ref={trackRef}
        {...handlers}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(value)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek(Math.min(duration, position + 5));
          if (e.key === "ArrowLeft") seek(Math.max(0, position - 5));
        }}
        className="group relative h-4 cursor-pointer touch-none select-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2 transition group-hover:h-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-ink shadow transition-transform group-hover:scale-100 group-active:scale-110"
          style={{ left: `${pct}%`, backgroundColor: "var(--accent)", border: "2px solid var(--bg)" }}
        />
      </div>
      <span className="w-9 shrink-0 tabular-nums text-faint">
        {duration > 0 ? formatDuration(duration) : "0:00"}
      </span>
    </div>
  );
}
