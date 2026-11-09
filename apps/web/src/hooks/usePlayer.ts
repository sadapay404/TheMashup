/**
 * Playback engine.
 *
 * One <audio> element + a Web Audio graph (gain → analyser → destination) so we get:
 *   - smooth fades / pause ramps without clicks
 *   - a live analyser for the art-reactive background
 *   - a single place to add EQ + crossfade later (nodes are already chained)
 *
 * Media Session is wired so Android/iOS lockscreen controls and hardware media keys work in the
 * browser today and in the Capacitor shell later.
 *
 * Zero-crash rules honoured here:
 *   - autoplay rejection is caught and surfaced as a paused state, not an exception
 *   - a stall watchdog re-resolves the stream instead of hanging forever
 *   - every async effect checks a generation counter so a fast track switch cannot apply stale state
 */

import { useCallback, useEffect, useRef } from 'react';
import { service } from '@/lib/service';
import {
  hasNativePlayback,
  nativePause,
  nativePlay,
  nativeResume,
  nativeSeek,
  nativeSetVolume,
  nativeState,
  onNativeEvent,
} from '@/lib/native';
import { store, useApp } from '@/state/store';
import type { Track } from '@themashup/core';

const STALL_MS = 8000;

/**
 * Set when the native player reports it is not ready.
 *
 * The Android service can be bound slightly after the first play; when that happens the plugin
 * returns `player_not_ready`. Retrying native forever would loop, so the session permanently
 * downgrades to the WebView <audio> element: audio still plays (just without background support
 * until the next launch).
 */
let nativeDisabled = false;

export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const generation = useRef(0);
  const lastTimeUpdate = useRef(Date.now());
  const fadeTimer = useRef<number | null>(null);

  const queue = useApp((s) => s.queue);
  const index = useApp((s) => s.index);
  const playing = useApp((s) => s.playing);
  const volume = useApp((s) => s.volume);
  const muted = useApp((s) => s.muted);
  const rate = useApp((s) => s.rate);
  const repeat = useApp((s) => s.repeat);
  const shuffle = useApp((s) => s.shuffle);

  const track: Track | null = queue[index] ?? null;

  /** Lazily build the audio graph on the first user gesture (browser autoplay policy). */
  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.volume = 1; // actual volume is handled by the gain node
      audioRef.current = el;

      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          const ctx = new Ctor();
          const src = ctx.createMediaElementSource(el);
          const gain = ctx.createGain();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.82;
          src.connect(gain).connect(analyser).connect(ctx.destination);
          ctxRef.current = ctx;
          gainRef.current = gain;
          analyserRef.current = analyser;
          gain.gain.value = 1;
        }
      } catch {
        // Web Audio unavailable (or CORS-tainted source): the element still plays, just no analyser.
        ctxRef.current = null;
      }
    }
    return audioRef.current;
  }, []);

  const getAnalyser = useCallback((): AnalyserNode | null => analyserRef.current, []);

  /** Resolve + load the current track. Generation-guarded against rapid switching. */
  const load = useCallback(
    async (t: Track) => {
      const gen = ++generation.current;
      const el = ensureAudio();
      const art = t.thumbs[t.thumbs.length - 1]?.url;
      store.set({ loading: true, streamError: null, positionSec: 0, stream: null, lyrics: null });

      const resolved = await service.resolveStream(t.id);
      if (gen !== generation.current) return;

      if (!resolved.ok) {
        store.set({ loading: false, playing: false, streamError: resolved.error.message });
        store.notify(resolved.error.message, 'error');
        return;
      }

      const playable = service.playableUrl(resolved.info);
      store.set({ stream: resolved.info });
      if (!playable) {
        store.set({
          loading: false,
          playing: false,
          streamError: 'Every source for this track is signature-locked right now.',
        });
        return;
      }

      // Native shell: Media3 owns playback so audio survives backgrounding + screen-off and
      // appears on the lockscreen. Falls back to the element if the plugin is absent.
      const handedToNative = !nativeDisabled && (await nativePlay({
        url: playable.url,
        title: t.title,
        artist: t.artist,
        ...(art ? { artUrl: art } : {}),
        durationMs: Math.round(t.durationSec * 1000),
      }));
      if (handedToNative) {
        el.removeAttribute('src');
        store.set({ loading: false, durationSec: t.durationSec });
        lastTimeUpdate.current = Date.now();
        store.set({ lyricsLoading: true });
        void service.lyricsFor(t).then((lyrics) => {
          if (gen !== generation.current) return;
          store.set({ lyrics, lyricsLoading: false });
        });
        return;
      }

      el.src = playable.url;
      el.playbackRate = store.getState().rate;
      store.set({ loading: false });
      lastTimeUpdate.current = Date.now();

      // Lyrics load in the background; they never block playback.
      store.set({ lyricsLoading: true });
      void service.lyricsFor(t).then((lyrics) => {
        if (gen !== generation.current) return;
        store.set({ lyrics, lyricsLoading: false });
      });
    },
    [ensureAudio],
  );

  /** Play/pause with a short gain ramp so there is never a click. */
  const setPlaying = useCallback(
    async (next: boolean) => {
      const el = ensureAudio();

      // Native Media3 path: no element src, the service owns transport.
      if (!el.src && hasNativePlayback()) {
        if (next) await nativeResume();
        else await nativePause();
        store.set({ playing: next });
        return;
      }

      if (!el.src) return;
      const ctx = ctxRef.current;
      const gain = gainRef.current;
      if (ctx && ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
      if (gain) {
        const now = ctx?.currentTime ?? 0;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(next ? 1 : 0, now + (next ? 0.06 : 0.09));
      }

      if (next) {
        try {
          await el.play();
          store.set({ playing: true });
        } catch {
          // Autoplay blocked or source invalid: reflect the truth instead of throwing.
          store.set({ playing: false });
          store.notify('Tap play once to allow audio (browser autoplay policy).', 'info');
        }
      } else {
        fadeTimer.current = window.setTimeout(() => {
          el.pause();
        }, 90);
        store.set({ playing: false });
      }
    },
    [ensureAudio],
  );

  const playTrack = useCallback(
    (t: Track, list?: Track[]) => {
      const current = store.getState();
      if (list && list.length) {
        const at = list.findIndex((x) => x.id === t.id);
        store.set({ queue: list, index: at >= 0 ? at : 0 });
      } else {
        const existing = current.queue.findIndex((x) => x.id === t.id);
        if (existing >= 0) store.set({ index: existing });
        else store.set({ queue: [...current.queue, t], index: current.queue.length });
      }
      const next = store.getState();
      const target = next.queue[next.index];
      if (target) {
        void load(target);
        void setPlaying(true);
      }
    },
    [load, setPlaying],
  );

  const next = useCallback(
    (auto = false) => {
      const s = store.getState();
      if (!s.queue.length) return;
      if (s.repeat === 'one' && auto) {
        const el = audioRef.current;
        if (el) el.currentTime = 0;
        void setPlaying(true);
        return;
      }
      let nextIndex = s.index + 1;
      if (s.shuffle) {
        nextIndex = Math.floor(Math.random() * s.queue.length);
        if (s.queue.length > 1 && nextIndex === s.index) nextIndex = (nextIndex + 1) % s.queue.length;
      }
      if (nextIndex >= s.queue.length) {
        if (s.repeat === 'all') nextIndex = 0;
        else if (auto) {
          store.set({ playing: false, positionSec: 0 });
          const el = audioRef.current;
          if (el) el.pause();
          return;
        } else return;
      }
      const t = s.queue[nextIndex];
      if (!t) return;
      store.set({ index: nextIndex });
      void load(t);
      void setPlaying(true);
    },
    [load, setPlaying],
  );

  const prev = useCallback(() => {
    const s = store.getState();
    const el = audioRef.current;
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    const prevIndex = s.index - 1;
    if (prevIndex < 0) {
      if (el) el.currentTime = 0;
      return;
    }
    const t = s.queue[prevIndex];
    if (!t) return;
    store.set({ index: prevIndex });
    void load(t);
    void setPlaying(true);
  }, [load, setPlaying]);

  const seek = useCallback((sec: number) => {
    const el = audioRef.current;
    if (el && !el.src && hasNativePlayback()) {
      void nativeSeek(Math.round(sec * 1000));
      store.set({ positionSec: sec });
      return;
    }
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = Math.max(0, Math.min(el.duration - 0.25, sec));
    store.set({ positionSec: el.currentTime });
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const el = audioRef.current;
      if (el) seek(el.currentTime + delta);
    },
    [seek],
  );

  const setRate = useCallback((r: number) => {
    const el = audioRef.current;
    if (el) el.playbackRate = r;
    store.set({ rate: r });
  }, []);

  // ----- element wiring -----------------------------------------------------
  useEffect(() => {
    const el = ensureAudio();

    const onTime = () => {
      lastTimeUpdate.current = Date.now();
      store.set({ positionSec: el.currentTime, durationSec: Number.isFinite(el.duration) ? el.duration : 0 });
      persistProgress(el.currentTime);
    };
    const onLoaded = () =>
      store.set({ durationSec: Number.isFinite(el.duration) ? el.duration : 0, loading: false });
    const onEnded = () => next(true);
    const onError = () => {
      const s = store.getState();
      const t = s.queue[s.index];
      if (!t) return;
      store.set({ streamError: 'Playback failed — re-resolving source…' });
      void load(t);
    };
    const onWaiting = () => store.set({ loading: true });
    const onPlaying = () => store.set({ loading: false, playing: true });

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onPlaying);

    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onPlaying);
    };
  }, [ensureAudio, load, next]);

  // Native transport polling (Media3 is the source of truth once handed off).
  useEffect(() => {
    if (!hasNativePlayback()) return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const s = store.getState();
      if (!s.playing) return;
      const st = await nativeState();
      if (st && alive) {
        store.set({
          positionSec: st.positionMs / 1000,
          durationSec: st.durationMs > 0 ? st.durationMs / 1000 : s.durationSec,
        });
      }
    };
    const id = window.setInterval(() => void tick(), 1000);
    const offEnded = onNativeEvent('ended', () => next(true));
    const offError = onNativeEvent('error', (data) => {
      const code = (data as { code?: string } | null)?.code ?? '';
      const st = store.getState();
      const t = st.queue[st.index];
      if (!t) return;

      if (code === 'player_not_ready') {
        // Permanent downgrade for this session: the service did not bind in time. Using the element
        // keeps audio working instead of retrying a race we already lost.
        nativeDisabled = true;
        store.notify('Background player unavailable — using in-app playback.', 'info');
        void load(t);
        return;
      }

      store.notify('Native player error — re-resolving…', 'error');
      void load(t);
    });
    return () => {
      alive = false;
      window.clearInterval(id);
      offEnded();
      offError();
    };
  }, [load, next]);

  // Volume mirroring for the native path.
  //
  // Debounced: dragging the slider fires a change per pixel, and each one is a JSON round-trip into
  // Kotlin. At 60 fps that queues faster than the bridge drains and the value visibly lags.
  useEffect(() => {
    if (!hasNativePlayback()) return;
    const id = window.setTimeout(() => void nativeSetVolume(muted ? 0 : volume), 80);
    return () => window.clearTimeout(id);
  }, [volume, muted]);

  // Stall watchdog: "playing" but no progress for 8 s → re-resolve once.
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = store.getState();
      if (!s.playing || s.loading) return;
      if (Date.now() - lastTimeUpdate.current > STALL_MS) {
        lastTimeUpdate.current = Date.now();
        const t = s.queue[s.index];
        if (t) {
          store.notify('Stream stalled — finding another source…', 'info');
          void load(t);
        }
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [load]);

  // Volume / mute → gain node (keeps the analyser fed even when muted).
  useEffect(() => {
    const gain = gainRef.current;
    if (!gain) return;
    const target = muted ? 0.0001 : Math.max(0.0001, volume);
    const ctx = ctxRef.current;
    if (ctx) {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(target, now, 0.02);
    } else if (audioRef.current) {
      audioRef.current.volume = target;
    }
  }, [volume, muted]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  // Media Session: lockscreen + hardware media keys.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return;
    const art = track.thumbs[track.thumbs.length - 1];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album ?? 'TheMashup',
        artwork: track.thumbs.map((t) => ({ src: t.url, sizes: `${t.width}x${t.height}`, type: 'image/jpeg' })),
      });
      if (!art) navigator.mediaSession.metadata.artwork = [];
    } catch {
      /* MediaMetadata can throw on exotic URLs; non-fatal */
    }
    navigator.mediaSession.setActionHandler('play', () => void setPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => void setPlaying(false));
    navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
    navigator.mediaSession.setActionHandler('seekto', (d) => {
      if (typeof d.seekTime === 'number') seek(d.seekTime);
    });
  }, [track, setPlaying, next, prev, seekBy, seek]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  // Resume position for the current track (7-day window).
  useEffect(() => {
    if (!track) return;
    const saved = readProgress(track.id);
    if (saved > 5 && audioRef.current) {
      const el = audioRef.current;
      const apply = () => {
        el.currentTime = saved;
        el.removeEventListener('loadedmetadata', apply);
      };
      el.addEventListener('loadedmetadata', apply);
    }
  }, [track]);

  return {
    track,
    playTrack,
    toggle: () => void setPlaying(!store.getState().playing),
    setPlaying,
    next,
    prev,
    seek,
    seekBy,
    setRate,
    getAnalyser,
    queue,
    index,
    playing,
    repeat,
  };
}

// ----- position persistence (separate from the big state blob) ------------------------------
const PROGRESS_KEY = 'mashup.progress';

function readProgressMap(): Record<string, { at: number; sec: number }> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, { at: number; sec: number }>;
  } catch {
    return {};
  }
}

function readProgress(id: string): number {
  const map = readProgressMap();
  const rec = map[id];
  if (!rec) return 0;
  if (Date.now() - rec.at > 7 * 86_400_000) return 0;
  return rec.sec;
}

let lastPersist = 0;
function persistProgress(sec: number): void {
  const now = Date.now();
  if (now - lastPersist < 4000) return;
  lastPersist = now;
  const s = store.getState();
  const t = s.queue[s.index];
  if (!t) return;
  const map = readProgressMap();
  map[t.id] = { at: now, sec };
  // Keep the map bounded.
  const entries = Object.entries(map).sort((a, b) => b[1].at - a[1].at).slice(0, 200);
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* quota — non-fatal */
  }
}
