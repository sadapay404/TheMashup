/**
 * Full-screen player. Three faces on one card: Artwork · Queue · Lyrics.
 *
 * Motion: shares `layoutId="player-sheet"` with the mini-player so the transition is a genuine
 * shared-element melt rather than a generic slide. Downward drag dismisses (velocity-aware).
 */

import { AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/state/store';
import type { Lyrics, Track } from '@themashup/core';
import { activeLineIndex, lineProgress } from '@themashup/core';
import { formatTime, IconButton, melt, snap } from '@/components/ui/primitives';
import { toggleLike } from '@/lib/signals';
import {
  ChevronDownIcon,
  DownloadIcon,
  HeartIcon,
  MicIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SparkIcon,
} from '@/components/ui/icons';

type Face = 'art' | 'queue' | 'lyrics';

export function NowPlaying({
  track,
  onClose,
  onToggle,
  onNext,
  onPrev,
  onSeek,
  onDownload,
  onWhy,
  onSelectQueue,
}: {
  track: Track;
  onClose: () => void;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (sec: number) => void;
  onDownload: (t: Track) => void;
  onWhy: (t: Track) => void;
  onSelectQueue: (i: number) => void;
}) {
  const playing = useApp((s) => s.playing);
  const loading = useApp((s) => s.loading);
  const positionSec = useApp((s) => s.positionSec);
  const durationSec = useApp((s) => s.durationSec);
  const queue = useApp((s) => s.queue);
  const index = useApp((s) => s.index);
  const repeat = useApp((s) => s.repeat);
  const shuffle = useApp((s) => s.shuffle);
  const lyrics = useApp((s) => s.lyrics);
  const lyricsLoading = useApp((s) => s.lyricsLoading);
  const streamError = useApp((s) => s.streamError);
  // Subscribing to `likes` is what keeps the heart in sync when the same track is liked elsewhere.
  const likes = useApp((s) => s.likes);
  const liked = likes.some((t) => t.id === track.id);
  const [face, setFace] = useState<Face>('art');

  const dragY = useMotionValue(0);
  const artScale = useTransform(dragY, [0, 300], [1, 0.86]);
  const backdropOpacity = useTransform(dragY, [0, 300], [1, 0.2]);

  const art = track.thumbs[track.thumbs.length - 1]?.url ?? '';
  // SeekBar owns the time read-outs; computing them here as well was dead code.
  const duration = durationSec || track.durationSec;

  const activeIdx = useMemo(
    () => (lyrics?.synced ? activeLineIndex(lyrics.synced, positionSec) : -1),
    [lyrics, positionSec],
  );

  return (
    <motion.div
      layoutId="player-sheet"
      transition={melt}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--color-base)]"
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
    >
      {/* Art-tinted backdrop */}
      <motion.div style={{ opacity: backdropOpacity }} className="pointer-events-none absolute inset-0 -z-10">
        {art ? (
          <img src={art} alt="" className="h-full w-full scale-125 object-cover opacity-25 blur-3xl" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--color-base)]/60 to-[var(--color-base)]" />
      </motion.div>

      {/* Drag handle + close */}
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.4 }}
        style={{ y: dragY }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 700) onClose();
          dragY.set(0);
        }}
        className="gpu relative flex items-center justify-between px-4 pb-1 pt-[max(12px,env(safe-area-inset-top))]"
      >
        <IconButton label="Close player" onClick={onClose} size="sm">
          <ChevronDownIcon width={22} height={22} />
        </IconButton>
        <div className="pointer-events-none absolute left-1/2 top-[max(14px,env(safe-area-inset-top))] h-1 w-10 -translate-x-1/2 rounded-full bg-[color-mix(in_oklab,var(--wash)_22%,transparent)]" />
        <IconButton label="Why this track" onClick={() => onWhy(track)} size="sm">
          <SparkIcon width={19} height={19} />
        </IconButton>
      </motion.div>

      {/* Face switcher */}
      <div className="flex items-center justify-center gap-1 pb-1">
        {(
          [
            ['art', 'Artwork'],
            ['queue', 'Queue'],
            ['lyrics', 'Lyrics'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFace(id)}
            className="relative rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-3)]"
            aria-pressed={face === id}
          >
            {face === id ? (
              <motion.span
                layoutId="face-pill"
                className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--wash)_11%,transparent)]"
                transition={snap}
              />
            ) : null}
            <span className={face === id ? 'relative z-10 text-[var(--color-text)]' : 'relative z-10'}>{label}</span>
          </button>
        ))}
      </div>

      {/* Faces */}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          {face === 'art' ? (
            <motion.div
              key="art"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={snap}
              className="flex h-full flex-col items-center justify-center px-6"
            >
              <motion.div
                style={{ scale: artScale }}
                className="aspect-square w-full max-w-[min(78vw,340px)] overflow-hidden rounded-[28px] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)]"
              >
                {art ? (
                  <motion.img
                    key={track.id}
                    initial={{ opacity: 0, filter: 'blur(12px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    transition={{ duration: 0.45 }}
                    src={art}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-[color-mix(in_oklab,var(--wash)_6%,transparent)] text-4xl">♪</div>
                )}
              </motion.div>

              <div className="mt-6 w-full max-w-[min(88vw,420px)] text-center">
                <h1 className="truncate font-[family-name:var(--font-display)] text-[30px] leading-tight">{track.title}</h1>
                <p className="mt-1 truncate text-sm text-[var(--color-text-2)]">{track.artist}</p>
              </div>
            </motion.div>
          ) : null}

          {face === 'queue' ? (
            <motion.div
              key="queue"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={snap}
              className="h-full overflow-y-auto px-4 pb-4"
            >
              <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-3)]">
                Up next · {Math.max(0, queue.length - index - 1)} tracks
              </div>
              {queue.map((t, i) => (
                <button
                  key={`${t.id}-${i}`}
                  type="button"
                  onClick={() => onSelectQueue(i)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left ${
                    i === index ? 'bg-[color-mix(in_oklab,var(--wash)_9%,transparent)]' : 'hover:bg-[color-mix(in_oklab,var(--wash)_5%,transparent)]'
                  }`}
                >
                  <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-[var(--color-text-3)]">
                    {i === index ? '▶' : i + 1}
                  </span>
                  {t.thumbs[0] ? (
                    <img src={t.thumbs[0].url} alt="" className="h-10 w-10 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-[color-mix(in_oklab,var(--wash)_6%,transparent)]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] ${i === index ? 'font-semibold' : ''}`}>{t.title}</span>
                    <span className="block truncate text-[11.5px] text-[var(--color-text-2)]">{t.artist}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-text-3)]">
                    {formatTime(t.durationSec)}
                  </span>
                </button>
              ))}
            </motion.div>
          ) : null}

          {face === 'lyrics' ? (
            <motion.div
              key="lyrics"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={snap}
              className="h-full overflow-y-auto px-6 pb-6"
            >
              <LyricsFace lyrics={lyrics} loading={lyricsLoading} activeIdx={activeIdx} positionSec={positionSec} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className="px-6 pb-[max(18px,env(safe-area-inset-bottom))]">
        {streamError ? (
          <div className="mb-2 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]">
            {streamError}
          </div>
        ) : null}

        <SeekBar positionSec={positionSec} durationSec={duration} onSeek={onSeek} />

        <div className="mt-3 flex items-center justify-between">
          <IconButton label="Shuffle" active={shuffle} size="sm" onClick={() => useAppToggle('shuffle')}>
            <ShuffleIcon width={19} height={19} />
          </IconButton>

          <div className="flex items-center gap-3">
            <IconButton label="Previous" onClick={onPrev}>
              <PrevIcon width={24} height={24} />
            </IconButton>
            <motion.button
              type="button"
              onClick={onToggle}
              whileTap={{ scale: 0.92 }}
              transition={snap}
              aria-label={playing ? 'Pause' : 'Play'}
              className="relative grid h-16 w-16 place-items-center rounded-full bg-[var(--accent)] text-[var(--on-accent)] shadow-[0_16px_40px_-14px_var(--accent-glow)]"
            >
              {loading ? (
                <motion.span
                  className="absolute inset-0 rounded-full border-2 border-black/20 border-t-black/70"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
                />
              ) : null}
              {playing ? <PauseIcon width={30} height={30} /> : <PlayIcon width={30} height={30} />}
            </motion.button>
            <IconButton label="Next" onClick={onNext}>
              <NextIcon width={24} height={24} />
            </IconButton>
          </div>

          <IconButton
            label={`Repeat: ${repeat}`}
            active={repeat !== 'off'}
            size="sm"
            onClick={() => useAppCycleRepeat()}
          >
            {repeat === 'one' ? <RepeatOneIcon width={19} height={19} /> : <RepeatIcon width={19} height={19} />}
          </IconButton>
        </div>

        <div className="mt-3 flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => onDownload(track)}
            className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[12px] text-[var(--color-text-2)] transition hover:text-[var(--color-text)]"
          >
            <DownloadIcon width={17} height={17} /> Download
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[12px] text-[var(--color-text-2)] transition hover:text-[var(--color-text)]"
            onClick={() => setFace('lyrics')}
          >
            <MicIcon width={17} height={17} /> Lyrics
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[12px] text-[var(--color-text-2)] transition hover:text-[var(--color-text)]"
            onClick={() => setFace('queue')}
          >
            <QueueIcon width={17} height={17} /> Queue
          </button>
          <IconButton
            label={liked ? 'Unlike' : 'Like'}
            active={liked}
            size="sm"
            onClick={() => {
              const now = toggleLike(track);
              store.notify(now ? 'Added to your likes' : 'Removed from your likes', now ? 'success' : 'info');
            }}
          >
            <HeartIcon filled={liked} width={18} height={18} />
          </IconButton>
        </div>
      </div>
    </motion.div>
  );
}

/* ---- helpers that avoid threading setters everywhere ---- */
import { store } from '@/state/store';
function useAppToggle(key: 'shuffle') {
  const s = store.getState();
  store.set({ [key]: !s[key] });
}
function useAppCycleRepeat() {
  const s = store.getState();
  store.set({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' });
}

/** Seek bar with a liquid leading fill and keyboard support. */
function SeekBar({
  positionSec,
  durationSec,
  onSeek,
}: {
  positionSec: number;
  durationSec: number;
  onSeek: (sec: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? positionSec;
  const pct = durationSec > 0 ? Math.min(1, shown / durationSec) : 0;

  const handle = (clientX: number) => {
    const el = ref.current;
    if (!el || durationSec <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setPreview(ratio * durationSec);
  };

  return (
    <div className="w-full">
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${formatTime(shown)} of ${formatTime(durationSec)}`}
        className="group relative h-8 cursor-pointer touch-none select-none"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          handle(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) handle(e.clientX);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          handle(e.clientX);
          const el = ref.current;
          if (el && durationSec > 0) {
            const rect = el.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            onSeek(ratio * durationSec);
          }
          setPreview(null);
        }}
        onPointerCancel={() => {
          // A cancelled pointer (system gesture, notification shade, app switch) never fires
          // pointerup, which left the thumb frozen at the preview position for the rest of the
          // session. Abandon the drag without seeking.
          dragging.current = false;
          setPreview(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(Math.min(durationSec, positionSec + 5));
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, positionSec - 5));
          if (e.key === 'Home') onSeek(0);
          if (e.key === 'End') onSeek(Math.max(0, durationSec - 1));
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--wash)_13%,transparent)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-150 ease-linear"
            style={{ width: `${pct * 100}%` }}
          />
          {/* 6px "liquid" lead so the fill appears to flow ahead of the thumb */}
          <div
            className="absolute top-0 h-full w-[6px] rounded-full bg-[var(--accent)] opacity-60 blur-[2px]"
            style={{ left: `calc(${pct * 100}% - 3px)` }}
          />
        </div>
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--knob)] shadow-md transition-transform group-active:scale-125"
          style={{ left: `${pct * 100}%` }}
        />
      </div>
      <div className="flex justify-between font-[family-name:var(--font-mono)] text-[11px] tabular-nums text-[var(--color-text-3)]">
        <span>{formatTime(shown)}</span>
        <span>{formatTime(durationSec)}</span>
      </div>
    </div>
  );
}

/** Lyrics face: synced scroll with karaoke wipe, or plain-text fallback with an honest empty state. */
function LyricsFace({
  lyrics,
  loading,
  activeIdx,
  positionSec,
}: {
  lyrics: Lyrics | null;
  loading: boolean;
  activeIdx: number;
  positionSec: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const el = lineRefs.current[activeIdx];
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIdx]);

  if (loading) {
    return (
      <div className="space-y-3 pt-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-[color-mix(in_oklab,var(--wash)_7%,transparent)]" style={{ width: `${60 + ((i * 13) % 35)}%` }} />
        ))}
      </div>
    );
  }

  if (!lyrics) {
    return (
      <div className="pt-16 text-center text-sm text-[var(--color-text-3)]">
        No lyrics found for this track.
        <div className="mt-2 text-xs">Lyrics come from LRCLIB, and are indexed locally for phrase search.</div>
      </div>
    );
  }

  if (lyrics.instrumental) {
    return <div className="pt-16 text-center text-sm text-[var(--color-text-2)]">This track is instrumental.</div>;
  }

  if (lyrics.synced?.length) {
    return (
      <div ref={containerRef} className="space-y-3 pt-4" aria-live="polite">
        {lyrics.synced.map((line, i) => {
          const isActive = i === activeIdx;
          const p = isActive ? lineProgress(lyrics.synced ?? [], i, positionSec) : 0;
          return (
            <div
              key={`${line.t}-${i}`}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              className={`text-balance text-[22px] font-semibold leading-snug transition-all duration-300 ${
                isActive ? 'text-[var(--color-text)]' : 'text-[var(--color-text-3)]/60'
              }`}
            >
              <span
                className="bg-clip-text"
                style={{
                  backgroundImage: isActive ? `linear-gradient(90deg, var(--accent) ${p * 100}%, transparent ${p * 100}%)` : 'none',
                  color: isActive ? undefined : undefined,
                }}
              >
                {line.text}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <pre className="whitespace-pre-wrap pt-4 font-[family-name:var(--font-sans)] text-[15px] leading-relaxed text-[var(--color-text-2)]">
      {lyrics.plain}
    </pre>
  );
}
