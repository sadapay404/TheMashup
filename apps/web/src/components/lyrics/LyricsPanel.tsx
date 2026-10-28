import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, MicVocal, Music2 } from "lucide-react";
import type { Lyrics } from "@themashup/shared";
import { api, ApiError } from "../../lib/api";
import { usePlayerStore } from "../../stores/playerStore";

/**
 * Timestamp-synced lyric scroller.
 * - Active line follows engine position (timeupdate)
 * - Auto-scrolls the active line to center (only when it changes)
 * - Click any line to seek; falls back to plain text when unsynced
 */
export function LyricsPanel({ className = "" }: { className?: string }) {
  const current = usePlayerStore((s) => s.current);
  const position = usePlayerStore((s) => s.position);
  const seek = usePlayerStore((s) => s.seek);

  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let alive = true;
    if (!current) {
      setLyrics(null);
      setNote(null);
      return;
    }
    setLoading(true);
    setNote(null);
    api
      .lyrics(current.id)
      .then((l) => {
        if (alive) setLyrics(l);
      })
      .catch((err) => {
        if (!alive) return;
        setLyrics(null);
        setNote(err instanceof ApiError && err.status === 404 ? null : "Lyrics service unavailable");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [current?.id, current]);

  const lines = lyrics?.synced ?? [];
  const activeIdx = useMemo(() => {
    if (lines.length === 0) return -1;
    let lo = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= position + 0.05) lo = i;
      else break;
    }
    return lo;
  }, [lines, position]);

  const lastScrolled = useRef(-1);
  useEffect(() => {
    if (activeIdx < 0 || activeIdx === lastScrolled.current) return;
    lastScrolled.current = activeIdx;
    const el = lineRefs.current[activeIdx];
    if (!el) return;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [activeIdx]);

  if (!current) {
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-2 text-center ${className}`}>
        <MicVocal className="h-8 w-8 text-faint" />
        <p className="text-sm text-dim">Lyrics appear here during playback</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`space-y-3 p-4 ${className}`}>
        <div className="flex items-center gap-2 text-xs text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Matching lyrics…
        </div>
        {[88, 72, 94, 60, 80].map((w, i) => (
          <div key={i} className="skeleton h-4 rounded" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }

  if (!lyrics) {
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-2 p-6 text-center ${className}`}>
        <Music2 className="h-8 w-8 text-faint" />
        <p className="text-sm font-medium text-dim">No lyrics found</p>
        <p className="text-xs text-faint">
          {note ?? "LRCLIB has no match for this track yet — try another version."}
        </p>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className={`overflow-y-auto p-5 ${className}`}>
        <p className="whitespace-pre-line text-center text-sm leading-relaxed text-dim">
          {lyrics.plain ?? "Instrumental"}
        </p>
      </div>
    );
  }

  return (
    <div className={`relative overflow-y-auto px-5 py-8 ${className}`}>
      <div className="mx-auto max-w-md space-y-4 text-center">
        {lines.map((line, i) => {
          const active = i === activeIdx;
          const past = i < activeIdx;
          return (
            <motion.button
              key={`${line.time}-${i}`}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              type="button"
              onClick={() => seek(line.time)}
              initial={false}
              animate={{
                opacity: past ? (active ? 1 : 0.55) : 0.35,
                scale: active ? 1.03 : 1,
              }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className={`block w-full text-balance rounded-lg px-3 py-1.5 text-lg leading-snug transition-colors hover:bg-surface ${
                active ? "font-display font-extrabold text-ink" : "font-medium text-dim"
              }`}
              style={active ? { textShadow: "0 0 24px color-mix(in srgb, var(--art-1, var(--accent)) 55%, transparent)" } : undefined}
            >
              {line.text || "♪"}
            </motion.button>
          );
        })}
        <div className="h-24" />
      </div>
    </div>
  );
}
