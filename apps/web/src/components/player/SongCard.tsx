/**
 * The song card — the compact "now playing" surface above the bottom edge.
 *
 * Rewritten from scratch. The previous mini-player was structurally broken rather than ugly:
 *
 *  1. It set no `bottom` of its own. Its parent in App.tsx positioned it, and that wrapper also
 *     owned the enter/exit animation, so the component could not be used anywhere else and the
 *     layout could not be reasoned about locally.
 *  2. It applied transforms for the drag (`opacity`/`scale` driven by `y`) while its parent applied
 *     a different enter animation to the same box. Two systems animating one element meant the card
 *     drifted and sometimes settled at the wrong height.
 *  3. Geometry lived in two files and disagreed: the card pinned itself near the bottom while the
 *     dock floated 92px up, leaving a gap where the card should have been. Both now read
 *     `lib/layout`, so the dock sits directly on top of this card by construction.
 *  4. It carried `layoutId="player-sheet"`, sharing a layout animation with the full player. That
 *     made opening the player morph the card across the screen instead of sliding a sheet up, and it
 *     left the card briefly visible underneath during the transition.
 *
 * What it is now: a self-positioning card with a thumbnail, two lines of text, transport, and a
 * progress hairline. Dragging up is a shortcut to the full player; tapping it is the plain way.
 */

import { motion, useMotionValue, useTransform } from 'framer-motion';
import type { Track } from '@themashup/core';
import { CloseIcon, DownloadIcon, PauseIcon, PlayIcon } from '@/components/ui/icons';
import { CARD_H, cardBottom } from '@/lib/layout';
import { useApp } from '@/state/store';
import { snap } from '@/components/ui/primitives';

/** Drag this far up, or flick this fast, and the full player opens. */
const DRAG_OPEN_PX = 64;
const DRAG_OPEN_VELOCITY = 500;

/**
 * The card's progress hairline, as its own subscriber.
 *
 * `positionSec` changes every second while a song plays. When `App` subscribed to it, the *whole*
 * shell — route tree, AnimatePresence, dock, every screen's props — re-rendered once a second on a
 * phone, which is the stutter the user described as "lags a bit even though it is a simple app".
 * Pulling the subscription down to the one element that draws it means a tick repaints four pixels
 * of border instead of reconciling the app.
 */
function ProgressHairline() {
  const positionSec = useApp((s) => s.positionSec);
  const durationSec = useApp((s) => s.durationSec);
  const progress = durationSec > 0 ? positionSec / durationSec : 0;
  // Clamped: a stale duration (or a stream that renegotiates mid-song) must never overflow the card.
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div className="pointer-events-none absolute inset-x-2.5 bottom-0 h-[2px] overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--wash)_11%,transparent)]">
      <div
        className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ease-linear"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SongCard({
  track,
  playing,
  onToggle,
  onOpen,
  onClose,
  onDownload,
}: {
  track: Track;
  playing: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onClose: () => void;
  /** Opens the quality sheet. Kept as a prop so the card owns no download logic itself. */
  onDownload: () => void;
}) {
  const dragY = useMotionValue(0);
  // Upward drag reads as "lifting the card towards the full player".
  const lift = useTransform(dragY, [0, -DRAG_OPEN_PX], [0, -10]);
  const hint = useTransform(dragY, [0, -DRAG_OPEN_PX], [0, 1]);

  const art = track.thumbs[0]?.url ?? track.thumbs[track.thumbs.length - 1]?.url;

  return (
    <motion.div
      drag="y"
      dragDirectionLock
      dragConstraints={{ top: -DRAG_OPEN_PX * 1.4, bottom: 0 }}
      dragElastic={{ top: 0.2, bottom: 0.02 }}
      style={{
        y: dragY,
        bottom: cardBottom(),
        height: CARD_H,
        // Translucent, not transparent. The shared `glass` utility mixes the theme wash at 4.5%,
        // which over a busy screen is indistinguishable from nothing — text appeared to float on
        // the artwork behind it. This keeps the blur, so it still reads as a layer over the page,
        // but gives the surface enough body to hold two lines of text anywhere on any theme.
        background: 'color-mix(in oklab, var(--color-raised) 62%, transparent)',
        backdropFilter: 'blur(24px) saturate(150%)',
        WebkitBackdropFilter: 'blur(24px) saturate(150%)',
        border: '1px solid color-mix(in oklab, var(--wash) 13%, transparent)',
      }}
      onDragEnd={(_, info) => {
        if (info.offset.y < -DRAG_OPEN_PX || info.velocity.y < -DRAG_OPEN_VELOCITY) {
          onOpen();
        }
        dragY.set(0);
      }}
      role="region"
      aria-label="Now playing"
      className="fixed inset-x-3 z-40 mx-auto flex max-w-2xl touch-pan-y items-center gap-2.5 overflow-hidden rounded-2xl px-2.5 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.95)]"
    >
      {/* Whole card is the open target, minus the transport buttons which sit above it. */}
      <motion.button
        type="button"
        onClick={onOpen}
        aria-label={`Open player for ${track.title}`}
        style={{ y: lift }}
        className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[color-mix(in_oklab,var(--wash)_11%,transparent)]"
      >
        {art ? (
          <img src={art} alt="" className="h-full w-full object-cover" decoding="async" draggable={false} />
        ) : (
          <span className="grid h-full w-full place-items-center text-[11px] text-[var(--color-text-3)]">♪</span>
        )}
      </motion.button>

      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open player for ${track.title}`}
        className="min-w-0 flex-1 py-1 text-left"
      >
        <div className="truncate text-[13.5px] font-semibold leading-tight">{track.title}</div>
        <div className="truncate text-[11.5px] leading-tight text-[var(--color-text-2)]">{track.artist}</div>
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
        onClick={onDownload}
        whileTap={{ scale: 0.9 }}
        transition={snap}
        aria-label="Save for offline listening"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--color-text-2)]"
      >
        <DownloadIcon width={17} height={17} />
      </motion.button>
      {/*
        End the song outright. Deliberately its own control rather than a long-press or a menu item:
        when someone wants the music to stop they are usually already annoyed, and making them hunt
        for it is how an app gets closed instead.
      */}
      <motion.button
        type="button"
        onClick={onClose}
        whileTap={{ scale: 0.9 }}
        transition={snap}
        aria-label="Stop and close the player"
        className="mr-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--color-text-2)]"
      >
        <CloseIcon width={16} height={16} />
      </motion.button>

      {/* Progress hairline, flush with the card's bottom edge. Subscribes on its own. */}
      <ProgressHairline />

      {/* A grab hint that appears only once the card is actually being lifted. */}
      <motion.div
        aria-hidden
        style={{ opacity: hint }}
        className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-[3px] w-9 rounded-full bg-[var(--color-text-3)]"
      />
    </motion.div>
  );
}
