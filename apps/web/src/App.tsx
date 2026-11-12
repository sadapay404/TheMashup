/**
 * App shell. Route transitions, the mini-player, the player sheet, the download sheet and toasts.
 * Everything here is defensive: the player never unmounts because a route failed.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Track } from '@themashup/core';
import { store, useApp, currentTrack, navigate, goBack, type QueueOrigin } from '@/state/store';
import { usePlayer } from '@/hooks/usePlayer';
import { service } from '@/lib/service';
import { isDesktop, onDesktopAction, onWindowHidden } from '@/lib/desktop';
import { loadPersisted, startAutosave } from '@/lib/persist';
import { dismissTopOverlay } from '@/lib/overlays';
import { applyPalette, extractPalette } from '@/lib/palette';
import { applyTheme } from '@/lib/theme';
import { signalQueueAdd } from '@/lib/signals';
import { setHapticsEnabled, setHapticSettings, haptic } from '@/lib/haptics';
import { themeMeta } from '@/lib/theme';
import { Boundary } from '@/components/shell/Boundary';
import { SmartDock } from '@/components/shell/SmartDock';
import { toastBottom } from '@/lib/layout';
import { takePendingRoute } from '@/lib/notifications';
import { watchSafeArea } from '@/lib/safe-area';
import { SongCard } from '@/components/player/SongCard';
import { NowPlaying } from '@/components/player/NowPlaying';
import { DownloadSheet } from '@/components/player/DownloadSheet';
import { HomeScreen } from '@/components/home/HomeScreen';
import { SearchScreen } from '@/components/search/SearchScreen';
import { LibraryScreen } from '@/components/library/LibraryScreen';
import { DownloadsScreen } from '@/components/downloads/DownloadsScreen';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { glide } from '@/components/ui/primitives';

/** Restore a previous session exactly once per page load. */
let restored = false;
function restoreOnce(): void {
  if (restored) return;
  restored = true;
  const saved = loadPersisted();
  if (!saved) return;
  store.set({
    route: saved.route,
    /*
     * Rebuild a history for the restored page.
     *
     * Only `route` was restored before, while `navHistory` kept its initial `['home']`. Reopening the
     * app on Library therefore produced a state that claimed to be one page deep: `goBack()` saw
     * `length <= 1`, returned false, and the platform closed the app on the first back press. From
     * the user's side the back button worked — it just had nowhere to go, every single session.
     */
    navHistory: saved.route === 'home' ? ['home'] : ['home', saved.route],
    queue: saved.queue,
    index: saved.index,
    // Never resume playing automatically: browsers block it, and users find it startling.
    playing: false,
    positionSec: saved.positionSec,
    volume: saved.volume,
    muted: saved.muted,
    repeat: saved.repeat,
    shuffle: saved.shuffle,
    rate: saved.rate,
    history: saved.history,
    affinity: saved.affinity,
    likes: saved.likes,
    amoled: saved.amoled,
    theme: saved.theme,
  });

  // Apply immediately after restore so the first paint is already correct. Previously `amoled` was
  // persisted nowhere and applied nowhere on load, so the toggle silently reset on every reload.
  applyTheme(saved.theme, saved.amoled);
  // Haptics live in module state so any handler can fire them without a context lookup.
  setHapticsEnabled(saved.haptics);
  setHapticSettings(saved.hapticEvents as never);
}
restoreOnce();

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

  /**
   * Hardware back, driven from the native side.
   *
   * Order matters: an open surface is "deeper" than a page, so closing it is what back should do
   * first. Only once nothing is open does back become a page step. Returning false means "nothing
   * left" and lets the platform exit — no "press again to exit" prompt, which would just be an
   * apology for navigation that should have worked.
   */
  useEffect(() => {
    const onBack = (): boolean => {
      // Overlays first, in the order they stack. A sheet is the most recently opened thing, so it
      // is the first thing back should take away.
      //
      // Anything that opens an overlay must register its close here, or back will skip straight to
      // navigation and leave the overlay on screen — which is exactly how the "add to" sheet trapped
      // the user.
      if (dismissTopOverlay()) return true;
      const s = store.getState();
      if (s.playerOpen) {
        // Back is navigation. Stopping the music on a back press is the behaviour that made the
        // player feel like a trap; the X and the card's X are the explicit stop controls.
        store.set({ playerOpen: false });
        return true;
      }
      if (s.lyricsOpen) {
        store.set({ lyricsOpen: false });
        return true;
      }
      return goBack();
    };
    (window as unknown as { __mashupBack?: () => boolean }).__mashupBack = onBack;
    return () => {
      delete (window as unknown as { __mashupBack?: () => boolean }).__mashupBack;
    };
  }, []);

  /**
   * Measure the real system bars once the shell mounts.
   *
   * `env(safe-area-inset-top)` reports 0 in this WebView, which is what put the title under the
   * clock. The measurement replaces the CSS fallback with the device's true geometry and re-runs on
   * rotation, where a notched phone in landscape has a different top inset.
   */
  useEffect(() => watchSafeArea(), []);

  /**
   * Notification taps.
   *
   * A notification that opens the app on Home is a dead end — the user tapped "Downloaded: 12 tracks"
   * and wants the Downloads screen. The route is read on mount (cold start) and on every resume (tap
   * while running, and taps that arrive while the page was frozen in the background).
   */
  useEffect(() => {
    const applyRoute = (r: string) => {
      const known = ['home', 'search', 'library', 'downloads', 'settings'] as const;
      if ((known as readonly string[]).includes(r)) {
        navigate(r as (typeof known)[number]);
      }
    };
    void takePendingRoute(applyRoute);
    const onResume = () => void takePendingRoute(applyRoute);
    document.addEventListener('resume', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      document.removeEventListener('resume', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, []);

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

  // Desktop shell: tray + OS media keys drive the same player the UI uses, so there is exactly one
  // transport authority. Registered once; unlistened on teardown to avoid duplicate handlers.
  useEffect(() => {
    if (!isDesktop()) return;
    let off: () => void = () => undefined;
    void onDesktopAction((action) => {
      const p = store.getState();
      if (action === 'toggle-play') void player.setPlaying(!p.playing);
      else if (action === 'next') player.next(false);
      else if (action === 'prev') player.prev();
      else if (action === 'stop') void player.setPlaying(false);
    }).then((fn) => {
      off = fn;
    });
    return () => off();
  }, [player]);

  // Persist the queue when the window is hidden rather than closed.
  useEffect(() => {
    if (!isDesktop()) return;
    let off: () => void = () => undefined;
    void onWindowHidden(() => {
      try {
        const s = store.getState();
        localStorage.setItem('mashup.queue', JSON.stringify({ queue: s.queue, index: s.index }));
      } catch {
        /* quota or private mode — the session simply will not resume */
      }
    }).then((fn) => {
      off = fn;
    });
    return () => off();
  }, []);

  // Autosave: throttled, flushed on hide/unload so a kill loses at most a few seconds.
  useEffect(() => startAutosave(store.getState, store.subscribe), []);

  const goSearch = () => navigate('search');
  /**
   * One entry point for playback, with an explicit queue origin.
   *
   * The third argument is not decoration: the Downloads screen is the only surface that must never
   * reach for network radio, and that decision is made by the player when a track ends. Passing it here
   * keeps the policy in the one place that knows about playback instead of spreading a flag through
   * every screen.
   */
  const onPlay = (t: Track, list: Track[], origin: QueueOrigin = 'library') =>
    player.playTrack(t, list, origin);

  /**
   * Explicit queue append. Separate from `onPlay` on purpose: tapping play on a search result used
   * to replace the whole queue with the result page, which is why one song queued twenty.
   */
  const onQueue = (t: Track) => {
    const s = store.getState();
    if (s.queue.some((q) => q.id === t.id)) {
      store.notify('Already in the queue', 'info');
      return;
    }
    store.set({ queue: [...s.queue, t] });
    signalQueueAdd(t);
    store.notify(`Added ${t.title} to the queue`, 'success');
  };

  /** Open the download sheet for any track, from any surface. */
  const onDownload = (t: Track) => setDownload(t);

  const progress = durationSec > 0 ? positionSec / durationSec : 0;
  // A toast must clear the dock and, when one is showing, the song card below it. The old fixed
  // 148px only cleared the dock, so notifications landed on top of the card's transport row.
  const hasCard = index >= 0 && queue.length > 0;

  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      {/*
        The status-bar separator.

        The app is edge-to-edge, so the status bar is drawn over the page. Something has to make the
        boundary legible. The first attempt was an opaque band in the theme's ground colour, which on a
        dark theme is a black bar sitting above the content — it read as a letterbox, not as part of the
        app, and the user said so.

        This version is a *layer* rather than a block:

          - The base is the accent wash already used by every glass surface, so it belongs to the theme
            instead of fighting it — it tints toward the album-art accent like the rest of the chrome.
          - It blurs what scrolls under it, so content passing beneath reads as *behind* the bar rather
            than clipped by it. That is what makes it feel like part of the interface.
          - It fades out rather than ending on a hard edge: the tint dissolves into the page, so there is
            no visible seam to call "out of place".
          - The hairline is drawn as a soft gradient that is strongest in the middle and vanishes at both
            ends, which is the same motif the dock and the song card use.

        `pointer-events-none` and no layout: it costs nothing and cannot swallow a tap.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-0"
        style={{ height: 'var(--safe-t)' }}
      >
        {/* The tinted, blurred layer. `backdrop-filter` is what makes it sit *over* the page. */}
        <div
          className="absolute inset-x-0 top-0"
          style={{
            height: 'calc(var(--safe-t) + 6px)',
            background:
              'linear-gradient(to bottom, color-mix(in oklab, var(--accent) 14%, var(--color-void)) 0%, color-mix(in oklab, var(--accent) 8%, var(--color-void)) 62%, transparent 100%)',
            backdropFilter: 'blur(18px) saturate(150%)',
            WebkitBackdropFilter: 'blur(18px) saturate(150%)',
          }}
        />
        {/* The seam between system chrome and app content: soft at the edges, present in the middle. */}
        <div
          className="absolute inset-x-0"
          style={{
            top: 'calc(var(--safe-t) - 1px)',
            height: '1px',
            background:
              'linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--accent) 34%, transparent) 22%, color-mix(in oklab, var(--accent) 34%, transparent) 78%, transparent 100%)',
          }}
        />
      </div>

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
                <SearchScreen onPlay={onPlay} onQueue={onQueue} onDownload={onDownload} />
              </Boundary>
            ) : null}
            {route === 'library' ? (
              <Boundary scope="Library">
                <LibraryScreen onPlay={onPlay} />
              </Boundary>
            ) : null}
            {route === 'downloads' ? (
              <Boundary scope="Downloads">
                <DownloadsScreen onPlay={onPlay} />
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
          // The card positions and animates itself. Wrapping it in another motion.div meant two
          // systems animating the same box, which is why it used to drift and settle wrong.
          <SongCard
            track={track}
            playing={playing}
            progress={progress}
            onToggle={() => void player.setPlaying(!playing)}
            onOpen={() => store.set({ playerOpen: true })}
            onClose={() => void player.stop()}
            onDownload={() => setDownload(track)}
            onSleepTimer={() => {
              const s = store.getState();
              const next = s.sleepTimerActive
                ? s.sleepTimerMs === 900000
                  ? 0
                  : s.sleepTimerMs === 1800000
                    ? 2700000
                    : s.sleepTimerMs === 2700000
                      ? 3600000
                      : 900000
                : 900000;
              store.set({ sleepTimerMs: next, sleepTimerActive: next > 0 });
            }}
            sleepTimerActive={store.getState().sleepTimerActive}
            sleepTimerMs={store.getState().sleepTimerMs}
          />
        ) : null}
      </AnimatePresence>

      <SmartDock />

      {/* Full player */}
      <AnimatePresence>
        {playerOpen && track ? (
          <NowPlaying
            track={track}
            // The X: stop and clear (the dock's card carries the same control).
            onClose={() => void player.stop()}
            // The chevron / downward drag: put the sheet away, keep the music.
            onHide={() => store.set({ playerOpen: false })}
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
            style={{ bottom: toastBottom(hasCard) }}
            className="pointer-events-none fixed inset-x-0 z-[70] mx-auto w-fit max-w-[92vw] rounded-full border border-[var(--hairline)] bg-[var(--color-raised)]/95 px-4 py-2.5 text-[12.5px] shadow-xl backdrop-blur"
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
