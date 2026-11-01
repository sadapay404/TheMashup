"use client";
import { useState } from "react";
import type { Track } from "@/lib/types";
import { fmtTime } from "@/lib/format";
import { Artwork, Icon, IconButton } from "./ui";
import { useApp } from "./app-context";
import { usePlayer } from "./player-context";
import { QUALITIES, useDownloads } from "./downloads-context";

export function TrackMenu({ track, onRemove, removeLabel = "Remove" }: { track: Track; onRemove?: () => void; removeLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [dl, setDl] = useState(false);
  const { addToQueue, playNext } = usePlayer();
  const { pickPlaylist, toggleLike, likedIds } = useApp();
  const { start } = useDownloads();
  const close = () => {
    setOpen(false);
    setDl(false);
  };
  const Item = ({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) => (
    <button
      onClick={() => {
        onClick();
        close();
      }}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface"
    >
      <Icon name={icon} size={18} className="text-muted" /> {label}
    </button>
  );
  return (
    <div className="relative">
      <IconButton icon="more" label="More" onClick={() => setOpen((o) => !o)} />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-xl border border-outline bg-raised py-1 shadow-2xl">
            {!dl ? (
              <>
                <Item icon="play" label="Play next" onClick={() => playNext(track)} />
                <Item icon="queue" label="Add to queue" onClick={() => addToQueue(track)} />
                <Item icon="plus" label="Add to playlist" onClick={() => pickPlaylist(track)} />
                <Item icon="heart" label={likedIds.has(track.id) ? "Unlike" : "Like"} onClick={() => void toggleLike(track)} />
                <button onClick={() => setDl(true)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface">
                  <Icon name="download" size={18} className="text-muted" /> Download…
                </button>
                {onRemove && <Item icon="trash" label={removeLabel} onClick={onRemove} />}
              </>
            ) : (
              QUALITIES.map((q) => <Item key={q.id} icon="download" label={q.label} onClick={() => start(track, q.id)} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function TrackRow({ track, list, index, onRemove, removeLabel, showLyric }: { track: Track; list: Track[]; index: number; onRemove?: () => void; removeLabel?: string; showLyric?: boolean }) {
  const { current, state, playQueue } = usePlayer();
  const { likedIds, toggleLike } = useApp();
  const { isOffline } = useDownloads();
  const isCur = current?.id === track.id;
  const liked = likedIds.has(track.id);
  return (
    <div className={`group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-raised/70 ${isCur ? "bg-raised/60" : ""}`}>
      <button onClick={() => playQueue(list, index)} className="relative shrink-0" aria-label={`Play ${track.title}`}>
        <Artwork src={track.artwork} size={48} />
        <span className={`absolute inset-0 grid place-items-center rounded-lg bg-black/50 text-white ${isCur ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          {isCur && state === "playing" ? <Eq /> : <Icon name={isCur && state === "loading" ? "more" : "play"} size={22} />}
        </span>
      </button>
      <button onClick={() => playQueue(list, index)} className="min-w-0 flex-1 text-left">
        <p className={`truncate text-sm font-semibold ${isCur ? "text-accent" : ""}`}>{track.title}</p>
        <p className="truncate text-xs text-muted">
          {track.artist}
          {track.album ? ` · ${track.album}` : ""}
        </p>
        {showLyric && track.lyricLine && <p className="mt-0.5 truncate text-xs italic text-accent2">“{track.lyricLine}”</p>}
      </button>
      {isOffline(track.id) && <span title="Available offline" className="text-accent"><Icon name="download" size={16} /></span>}
      <IconButton icon="heart" label={liked ? "Unlike" : "Like"} active={liked} outline={!liked} size={20} onClick={() => void toggleLike(track)} className="hidden sm:inline-flex" />
      <span className="hidden w-12 text-right text-xs tabular-nums text-subtle sm:block">{fmtTime(track.duration)}</span>
      <TrackMenu track={track} onRemove={onRemove} removeLabel={removeLabel} />
    </div>
  );
}

function Eq() {
  return (
    <span className="flex h-4 items-end gap-0.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-1 animate-pulse rounded-sm bg-white" style={{ height: `${55 + i * 20}%`, animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}

export function TrackList({ tracks, onRemove, removeLabel, showLyric }: { tracks: Track[]; onRemove?: (t: Track) => void; removeLabel?: string; showLyric?: boolean }) {
  return (
    <div className="space-y-0.5">
      {tracks.map((t, i) => (
        <TrackRow key={`${t.id}-${i}`} track={t} list={tracks} index={i} showLyric={showLyric} removeLabel={removeLabel} onRemove={onRemove ? () => onRemove(t) : undefined} />
      ))}
    </div>
  );
}
