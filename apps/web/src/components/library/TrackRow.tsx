/** A track row. Deliberately boring internally — all the delight is in the press/hover physics. */

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import type { Track } from '@themashup/core';
import { snap } from '@/components/ui/primitives';
import { DotsIcon, DownloadIcon, PlayIcon, QueueIcon } from '@/components/ui/icons';
import { formatTime } from '@/components/ui/primitives';
import { AddToSheet } from '@/components/library/AddToSheet';

export function TrackRow({
  track,
  onPlay,
  onDownload,
  onQueue,
  index,
  active = false,
}: {
  track: Track;
  onPlay: () => void;
  onDownload?: (t: Track) => void;
  /** Explicit "play after this". Absent when the surface *is* the queue. */
  onQueue?: (t: Track) => void;
  index?: number;
  active?: boolean;
}) {
  const art = track.thumbs[0]?.url ?? track.thumbs[track.thumbs.length - 1]?.url;
  // One "add to" affordance instead of a queue button that cannot also fill a playlist. Always
  // present: building a playlist has to be possible from any list of songs, not only the ones that
  // happen to have been given a queue handler.
  const [addOpen, setAddOpen] = useState(false);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...snap, delay: Math.min(6, index ?? 0) * 0.018 }}
      whileTap={{ scale: 0.985 }}
      className={`group flex items-center gap-3 rounded-[var(--radius-row)] px-2 py-2 transition-colors ${
        active ? 'bg-[color-mix(in_oklab,var(--wash)_9%,transparent)]' : 'hover:bg-[color-mix(in_oklab,var(--wash)_6%,transparent)]'
      }`}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${track.title} by ${track.artist}`}
        className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]"
      >
        {art ? (
          <img src={art} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <span className="grid h-full w-full place-items-center text-sm text-[var(--color-text-3)]">♪</span>
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
          <PlayIcon width={18} height={18} />
        </span>
      </button>

      <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left">
        <span className={`block truncate text-[14px] leading-tight ${active ? 'text-[var(--accent)]' : ''}`}>
          {track.title}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-[var(--color-text-2)]">
          {track.artist}
          {track.album ? <span className="text-[var(--color-text-3)]"> · {track.album}</span> : null}
        </span>
      </button>

      {track.durationSec ? (
        <span className="shrink-0 font-[family-name:var(--font-mono)] text-[11px] tabular-nums text-[var(--color-text-3)]">
          {formatTime(track.durationSec)}
        </span>
      ) : null}

      {/* Row actions. Kept always visible rather than hover-only: this is a touch-first app, and
          a control that only appears on hover does not exist on a phone. */}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        aria-label={`Add ${track.title} to a queue or playlist`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--color-text-3)] transition hover:bg-[color-mix(in_oklab,var(--wash)_9%,transparent)] hover:text-[var(--color-text)]"
      >
        <DotsIcon width={17} height={17} />
      </button>

      {onDownload ? (
        <button
          type="button"
          onClick={() => onDownload(track)}
          aria-label={`Download ${track.title}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--color-text-3)] transition hover:bg-[color-mix(in_oklab,var(--wash)_9%,transparent)] hover:text-[var(--color-text)]"
        >
          <DownloadIcon width={17} height={17} />
        </button>
      ) : null}

      <AnimatePresence>
        {addOpen ? (
          <AddToSheet
            track={track}
            {...(onQueue ? { onQueue } : {})}
            onClose={() => setAddOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
