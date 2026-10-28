import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Download, Play, ListPlus, Loader2, Quote, Radio, Check } from "lucide-react";
import type { ArtistRef, LyricMatch, Track } from "@themashup/shared";
import { formatDuration } from "@themashup/shared";
import { usePlayerStore } from "../../stores/playerStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useUIStore } from "../../stores/uiStore";
import { api } from "../../lib/api";
import { Artwork } from "../ui/Artwork";
import { AddToPlaylistButton } from "../library/AddToPlaylistButton";

/** Shared row actions: play a track (with queue context) / resolve a lyric row. */
export function useSearchActions() {
  const playNow = usePlayerStore((s) => s.playNow);
  const enqueue = usePlayerStore((s) => s.enqueue);

  const playTrack = (track: Track, queue: Track[]) => {
    void playNow(track, queue.length ? queue : [track], "search");
  };

  /** Lyric hit → search the exact "title artist" → play the top result. */
  const playLyricMatch = async (
    match: LyricMatch["matches"][number],
  ): Promise<Track | null> => {
    const sr = await api.search(`${match.track_name} ${match.artist_name}`.trim());
    const top = sr.tracks[0];
    if (!top) return null;
    void playNow(top, sr.tracks, "search");
    return top;
  };

  const addTrack = (track: Track) => enqueue(track, "end");

  return { playTrack, playLyricMatch, addTrack };
}

/** Song row used by the dropdown + search page + library lists. */
export function TrackRow({
  track,
  queue,
  active = false,
  compact = false,
  onPlay,
  trailing,
}: {
  track: Track;
  queue: Track[];
  active?: boolean;
  compact?: boolean;
  onPlay?: () => void;
  trailing?: ReactNode;
}) {
  const { playTrack, addTrack } = useSearchActions();
  const currentId = usePlayerStore((s) => s.current?.id);
  const isCurrent = currentId === track.id;
  const playing = usePlayerStore((s) => s.status === "playing" && s.current?.id === track.id);

  return (
    <div
      className={`group flex items-center gap-3 rounded-xl px-2.5 py-2 transition ${
        active ? "bg-surface-2" : "hover:bg-surface"
      }`}
    >
      <button
        type="button"
        onClick={onPlay ?? (() => playTrack(track, queue))}
        className="relative shrink-0"
        title="Play"
      >
        <Artwork
          src={track.artwork_best ?? track.artwork}
          alt={track.title}
          className={compact ? "h-9 w-9" : "h-11 w-11"}
        />
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 transition group-hover:opacity-100">
          {playing ? (
            <Loader2 className="h-4 w-4 animate-spin text-white" />
          ) : (
            <Play className="h-4 w-4 translate-x-px text-white" fill="currentColor" />
          )}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${isCurrent ? "text-accent" : "text-ink"}`}>
          {track.title}
          {track.explicit && (
            <span className="ml-1.5 rounded bg-surface-2 px-1 text-[9px] font-bold text-faint">E</span>
          )}
        </p>
        <p className="truncate text-xs text-dim">
          {track.artist_names}
          {track.album ? ` · ${track.album}` : ""}
        </p>
      </div>
      {!compact && (
        <span className="shrink-0 text-[11px] tabular-nums text-faint">
          {formatDuration(track.duration_sec)}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <span className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <AddToPlaylistButton track={track} />
        </span>
        <button
          type="button"
          title="Download"
          onClick={() => useUIStore.getState().setDownloadTrack(track)}
          className="rounded-lg p-1.5 text-faint opacity-0 transition hover:text-ink focus:opacity-100 group-hover:opacity-100"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        {trailing}
        <button
          type="button"
          title="Add to queue"
          onClick={() => addTrack(track)}
          className="rounded-lg p-1.5 text-faint opacity-0 transition hover:text-ink focus:opacity-100 group-hover:opacity-100"
        >
          <ListPlus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Start radio"
          onClick={() => {
            void (async () => {
              try {
                const radio = await api.radio({ seed_video_id: track.id, limit: 30 });
                const { playNow } = usePlayerStore.getState();
                if (radio.tracks.length) {
                  void playNow(radio.seed ?? radio.tracks[0], radio.tracks, "radio");
                }
              } catch {
                usePlayerStore.getState().playNow(track, queue, "radio");
              }
            })();
          }}
          className="rounded-lg p-1.5 text-faint opacity-0 transition hover:text-ink focus:opacity-100 group-hover:opacity-100"
        >
          <Radio className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => playTrack(track, queue)}
          className="hidden rounded-full bg-accent p-1.5 text-accent-contrast opacity-0 transition hover:brightness-110 focus:opacity-100 group-hover:opacity-100 sm:block"
        >
          <Play className="h-3.5 w-3.5 translate-x-px" fill="currentColor" />
        </button>
      </div>
    </div>
  );
}

/** Lyric-derived result: shows the matched line and resolves to a playable track. */
export function LyricMatchRow({
  match,
  active = false,
  compact = false,
}: {
  match: LyricMatch["matches"][number];
  active?: boolean;
  compact?: boolean;
}) {
  const { playLyricMatch } = useSearchActions();
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await playLyricMatch(match);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void resolve()}
      onKeyDown={(e) => e.key === "Enter" && void resolve()}
      className={`group flex cursor-pointer items-start gap-3 rounded-xl px-2.5 py-2 transition ${
        active ? "bg-surface-2" : "hover:bg-surface"
      }`}
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Quote className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium italic text-ink">
          “{match.snippet ?? `${match.track_name} — lyrics match`}”
        </p>
        <p className="truncate text-xs text-dim">
          {match.track_name} · {match.artist_name}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
          lyric match
        </span>
        {!compact && (
          <span className="text-[10px] tabular-nums text-faint">
            {Math.round(match.similarity * 100)}%{match.synced ? " · synced" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/** Artist chip with follow toggle (requires sign-in). */
export function ArtistChip({ artist, compact = false }: { artist: ArtistRef; compact?: boolean }) {
  const isFollowing = useLibraryStore((s) => s.isFollowing(artist.channel_id ?? artist.name));
  const toggleFollow = useLibraryStore((s) => s.toggleFollow);
  const mode = useSessionStore((s) => s.mode);
  const setAuthModalOpen = useUIStore((s) => s.setAuthModalOpen);
  const [busy, setBusy] = useState(false);

  const onFollow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (mode === "none") {
      setAuthModalOpen(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await toggleFollow(artist);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={onFollow}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        isFollowing
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-line bg-surface text-dim hover:text-ink"
      } ${compact ? "max-w-40" : ""}`}
      title={isFollowing ? "Following — click to unfollow" : "Follow artist"}
    >
      <Artwork
        src={artist.image}
        alt={artist.name}
        radius="rounded-full"
        className="h-5 w-5"
      />
      <span className="max-w-28 truncate">{artist.name}</span>
      {isFollowing && <Check className="h-3 w-3" />}
    </motion.button>
  );
}
