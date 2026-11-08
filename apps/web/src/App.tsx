/**
 * App shell. Route transitions, the mini-player, the player sheet, the download sheet and toasts.
 * Everything here is defensive: the player never unmounts because a route failed.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Track } from '@themashup/core';
import { store, useApp, currentTrack } from '@/state/store';
import { usePlayer } from '@/hooks/usePlayer';
import { service } from '@/lib/service';
import { applyPalette, extractPalette } from '@/lib/palette';
import { Boundary } from '@/components/shell/Boundary';
import { NavPill } from '@/components/shell/NavPill';
import { MiniPlayer } from '@/components/player/MiniPlayer';
import { NowPlaying } from '@/components/player/NowPlaying';
import { DownloadSheet } from '@/components/player/DownloadSheet';
import { HomeScreen } from '@/components/home/HomeScreen';
import { SearchScreen } from '@/components/search/SearchScreen';
import { LibraryScreen } from '@/components/library/LibraryScreen';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { glide } from '@/components/ui/primitives';

export default function App() {
  const route = useApp((s) => s.route);
  const playerOpen = useApp((s) => s.playerOpen);
  const toast = useApp((s) => s.toast);
  const queue = useApp((s) => s.queue);
  const index = useApp((s) => s.index);
  const playing = useApp((s) => s.playing);
  const positionSec = useApp((s) => s.positionSec);
  const durationSec = useApp((s) => s.durationSec);

  const player = usePlayer();
  const [download, setDownload] = useState<Track | null>(null);
  const [routeFade, setRouteFade] = useState(0);

  const track = queue[index] ?? null;

  // Route detection once per session. Probes the public API ladder because that is what the browser
  // actually uses; never blocks paint, and degrades to an honest "offline" label.
  useEffect(() => {
    let cancelled = false;
    void service.provider
      .probe()
      .then((health) => {
        if (cancelled) return;
        const ok = health.filter((h) => h.ok).sort((a, b) => a.latencyMs - b.latencyMs)[0];
        store.set({ transportRoute: ok ? `${ok.instance} · ${ok.latencyMs}ms` : 'offline (no route)' });
      })
      .catch(() => store.set({ transportRoute: 'offline (no route)' }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Palette follows the current track.
  useEffect(() => {
    const art = track?.thumbs[track.thumbs.length - 1]?.url;
    if (!art) return;
    void extractPalette(art).then((p) => applyPalette(p));
  }, [track]);

  // Record history + feed the recommender. One entry per track change.
  useEffect(() => {
    if (!track) return;
    store.set((s) => ({
      history: s.history.some((h) => h.id === track.id) ? s.history : [track, ...s.history].slice(0, 300),
    }));
  }, [track]);

  // Keyboard shortcuts (desktop): space = play/pause, arrows = seek.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        void player.setPlaying(!store.getState().playing);
      }
      if (e.code === 'ArrowRight' && e.shiftKey) player.seekBy(10);
      if (e.code === 'ArrowLeft' && e.shiftKey) player.seekBy(-10);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  const goSearch = () => store.set({ route: 'search' });
  const onPlay = (t: Track, list: Track[]) => player.playTrack(t, list);

  const progress = durationSec > 0 ? positionSec / durationSec : 0;

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      {/* Route content */}
      <main className="relative flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={route}
            initial={{ opacity: 0, y: 14, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={glide}
            onAnimationComplete={() => setRouteFade((n) => n + 1)}
          >
            {route === 'home' ? (
              <Boundary scope="Home">
                <HomeScreen onPlay={onPlay} onGoSearch={goSearch} />
              </Boundary>
            ) : null}
            {route === 'search' ? (
              <Boundary scope="Search">
                <SearchScreen onPlay={onPlay} />
              </Boundary>
            ) : null}
            {route === 'library' ? (
              <Boundary scope="Library">
                <LibraryScreen onPlay={onPlay} />
              </Boundary>
            ) : null}
            {route === 'settings' ? (
              <Boundary scope="Settings">
                <SettingsScreen />
              </Boundary>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mini player sits above the nav pill; extra bottom padding keeps content clear. */}
      <AnimatePresence>
        {track && !playerOpen ? (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={glide}
            className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+78px)] z-40 mx-auto max-w-2xl px-3"
          >
            <MiniPlayer
              track={track}
              playing={playing}
              progress={progress}
              onToggle={() => void player.setPlaying(!playing)}
              onNext={() => player.next(false)}
              onOpen={() => store.set({ playerOpen: true })}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <NavPill />

      {/* Full player */}
      <AnimatePresence>
        {playerOpen && track ? (
          <NowPlaying
            track={track}
            onClose={() => store.set({ playerOpen: false })}
            onToggle={() => void player.setPlaying(!playing)}
            onNext={() => player.next(false)}
            onPrev={player.prev}
            onSeek={player.seek}
            onDownload={(t) => setDownload(t)}
            onWhy={(t) => {
              const w = (t as Track & { why?: { source: string; score: number } }).why;
              store.notify(
                w ? `Picked by ${w.source} (score ${w.score})` : 'Played from your selection',
                'info',
              );
            }}
            onSelectQueue={(i) => {
              const t = queue[i];
              if (t) {
                store.set({ index: i });
                void player.setPlaying(true);
              }
            }}
          />
        ) : null}
      </AnimatePresence>

      {/* Download sheet */}
      <AnimatePresence>
        {download ? <DownloadSheet track={download} onClose={() => setDownload(null)} /> : null}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast ? (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={glide}
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+148px)] z-[70] mx-auto w-fit max-w-[92vw] rounded-full border border-[var(--hairline)] bg-[var(--color-raised)]/95 px-4 py-2.5 text-[12.5px] shadow-xl backdrop-blur"
          >
            <span
              className={
                toast.kind === 'error'
                  ? 'text-[var(--color-danger)]'
                  : toast.kind === 'success'
                    ? 'text-[var(--color-ok)]'
                    : ''
              }
            >
              {toast.text}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Keep the unused var meaningful for future route-level instrumentation. */}
      <span className="hidden">{routeFade}</span>
    </div>
  );
}
