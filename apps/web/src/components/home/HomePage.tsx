import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Play, ListPlus, Radio, RefreshCw, AlertTriangle } from "lucide-react";
import type { RecShelf, Track } from "@themashup/shared";
import { api, ApiError } from "../../lib/api";
import { useSessionStore } from "../../stores/sessionStore";
import { usePlayerStore } from "../../stores/playerStore";
import { Artwork } from "../ui/Artwork";

function TrackCardSkeleton() {
  return (
    <div className="w-40 shrink-0 sm:w-44">
      <div className="skeleton aspect-square w-full rounded-xl" />
      <div className="skeleton mt-2.5 h-3.5 w-3/4 rounded" />
      <div className="skeleton mt-1.5 h-3 w-1/2 rounded" />
    </div>
  );
}

function TrackCard({
  track,
  shelf,
  index,
}: {
  track: Track;
  shelf: Track[];
  index: number;
}) {
  const playNow = usePlayerStore((s) => s.playNow);
  const enqueue = usePlayerStore((s) => s.enqueue);
  const isCurrent = usePlayerStore((s) => s.current?.id === track.id);

  const startRadio = async () => {
    try {
      const radio = await api.radio({ seed_video_id: track.id, limit: 30 });
      if (radio.tracks.length) await playNow(radio.seed ?? radio.tracks[0], radio.tracks, "radio");
    } catch {
      await playNow(track, shelf, "radio");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.32), duration: 0.35, ease: "easeOut" }}
      className="group relative w-40 shrink-0 sm:w-44"
    >
      <div className="relative overflow-hidden rounded-xl bg-surface">
        <Artwork
          src={track.artwork_best ?? track.artwork}
          alt={track.title}
          radius="rounded-none"
          className="aspect-square w-full transition duration-500 group-hover:scale-[1.04]"
        />
        {/* Glow accent from sampled artwork colors */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition duration-500 group-hover:opacity-100"
          style={{
            background:
              "linear-gradient(180deg, transparent 30%, color-mix(in srgb, var(--art-1, var(--accent)) 26%, transparent) 100%)",
          }}
        />
        <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 translate-y-2 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <button
            type="button"
            title="Start radio"
            onClick={() => void startRadio()}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
          >
            <Radio className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Add to queue"
            onClick={() => enqueue(track, "end")}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
          >
            <ListPlus className="h-3.5 w-3.5" />
          </button>
          <motion.button
            type="button"
            title="Play"
            whileTap={{ scale: 0.9 }}
            onClick={() => void playNow(track, shelf, "home")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg hover:brightness-110"
          >
            <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" />
          </motion.button>
        </div>
        {isCurrent && (
          <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-contrast">
            playing
          </span>
        )}
      </div>
      <div className="mt-2.5 min-w-0">
        <p className="truncate text-sm font-semibold text-ink">{track.title}</p>
        <p className="truncate text-xs text-dim">{track.artist_names}</p>
      </div>
    </motion.div>
  );
}

function ShelfSection({ shelf }: { shelf: RecShelf }) {
  return (
    <section className="mb-9">
      <div className="mb-3.5 flex items-baseline gap-3">
        <h2 className="font-display text-xl font-bold tracking-tight">{shelf.title}</h2>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
          {shelf.kind}
        </span>
      </div>
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {shelf.tracks.map((t, i) => (
          <TrackCard key={`${shelf.kind}-${t.id}-${i}`} track={t} shelf={shelf.tracks} index={i} />
        ))}
      </div>
    </section>
  );
}

const ANON_KINDS = ["quick", "discover", "trending"] as const;
const AUTHED_KINDS = ["listen_again", "quick", "discover", "trending"] as const;

export function HomePage() {
  const [shelves, setShelves] = useState<RecShelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const authed = useSessionStore((s) => s.mode !== "none");

  const load = useCallback(async (personal: boolean) => {
    setLoading(true);
    setError(null);
    const kinds = personal ? AUTHED_KINDS : ANON_KINDS;
    const results = await Promise.allSettled(kinds.map((kind) => api.recommendations(kind)));
    const ok = results.filter((r): r is PromiseFulfilledResult<RecShelf> => r.status === "fulfilled");
    const failed = results.find((r) => r.status === "rejected");
    if (ok.length === 0) {
      setError(
        failed && failed.reason instanceof ApiError
          ? failed.reason.message
          : "Could not reach the music API",
      );
    }
    setShelves(ok.map((r) => r.value).filter((sh) => sh.tracks.length > 0));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(authed);
  }, [load, authed]);

  return (
    <div className="pb-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-7 rounded-2xl border border-line bg-gradient-to-r from-accent/15 via-surface to-accent-2/10 p-5 sm:p-6"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">welcome back</p>
        <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Ready when you are.
        </h2>
        <p className="mt-1.5 max-w-xl text-sm text-dim">
          Aggregated streams, lyric search and endless radio — all resolved through your local
          gateway with automatic source failover.
        </p>
      </motion.div>

      {loading && (
        <div className="space-y-9">
          {[0, 1].map((s) => (
            <section key={s}>
              <div className="skeleton mb-3.5 h-6 w-44 rounded" />
              <div className="flex gap-4 overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <TrackCardSkeleton key={i} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
          <p className="mt-3 font-semibold">{error}</p>
          <p className="mt-1 text-sm text-dim">
            Make sure the gateway (<code className="text-accent">pnpm dev</code>) is running on
            port 4000.
          </p>
          <button
            type="button"
            onClick={() => void load(authed)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-contrast hover:brightness-110"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      )}

      {!loading &&
        !error &&
        shelves.map((shelf) => <ShelfSection key={shelf.kind} shelf={shelf} />)}

      {!loading && !error && shelves.length === 0 && (
        <p className="text-sm text-dim">No recommendations available right now.</p>
      )}
    </div>
  );
}
