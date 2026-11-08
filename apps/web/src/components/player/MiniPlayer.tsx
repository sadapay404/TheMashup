/**
 * Mini-player. The lower half of "The Melt": dragging up commits the full player sheet.
 * It is deliberately the only element that overlaps the nav pill — glass, 64px, art left.
 */

import { motion, useMotionValue, useTransform } from 'framer-motion';
import type { Track } from '@themashup/core';
import { useApp } from '@/state/store';
import { melt, snap } from '@/components/ui/primitives';
import { NextIcon, PauseIcon, PlayIcon } from '@/components/ui/icons';

export function MiniPlayer({
  track,
  playing,
  progress,
  onToggle,
  onNext,
  onOpen,
}: {
  track: Track;
  playing: boolean;
  progress: number;
  onToggle: () => void;
  onNext: () => void;
  onOpen: () => void;
}) {
  const dragY = useMotionValue(0);
  const opacity = useTransform(dragY, [0, -80], [1, 0.85]);
  const scale = useTransform(dragY, [-160, 0], [1.02, 1]);

  return (
    <motion.div
      layoutId="player-sheet"
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.18, bottom: 0 }}
      style={{ y: dragY, opacity, scale }}
      onDragEnd={(_, info) => {
        if (info.offset.y < -70 || info.velocity.y < -520) onOpen();
        dragY.set(0);
      }}
      transition={melt}
      className="glass gpu pointer-events-auto fixed inset-x-3 z-40 flex items-center gap-3 overflow-hidden rounded-3xl p-2.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)]"
      // Sits above the nav pill.
      // (position is fixed so the sheet can share layoutId with the full player)
      role="region"
      aria-label="Now playing"
    >
      {/* Artwork */}
      <motion.button
        type="button"
        onClick={onOpen}
        aria-label="Expand artwork to full player"
        className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-white/10"
      >
        {track.thumbs[0] ? (
          <img
            src={track.thumbs[0].url}
            alt=""
            className="h-full w-full object-cover"
            decoding="async"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-[var(--color-text-3)]">♪</div>
        )}
      </motion.button>

      {/* Title block */}
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left" aria-label="Open full player">
        <div className="truncate text-[13.5px] font-semibold leading-tight">{track.title}</div>
        <div className="truncate text-[11.5px] text-[var(--color-text-2)]">{track.artist}</div>
      </button>

      <motion.button
        type="button"
        onClick={onToggle}
        whileTap={{ scale: 0.9 }}
        transition={snap}
        aria-label={playing ? 'Pause' : 'Play'}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--color-text)]"
      >
        {playing ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} />}
      </motion.button>
      <motion.button
        type="button"
        onClick={onNext}
        whileTap={{ scale: 0.9 }}
        transition={snap}
        aria-label="Next track"
        className="mr-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--color-text-2)]"
      >
        <NextIcon width={18} height={18} />
      </motion.button>

      {/* Hairline progress along the bottom edge */}
      <div className="absolute inset-x-2.5 bottom-1 h-[2px] overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full rounded-full bg-[var(--accent)]"
          style={{ width: `${Math.min(100, progress * 100)}%` }}
          transition={{ duration: 0.2, ease: 'linear' }}
        />
      </div>
    </motion.div>
  );
}
