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
  nativeBootMark,
  nativePause,
  nativePlay,
  nativeResume,
  nativeSeek,
  nativeSetRate,
  nativeSetVolume,
  nativeState,
  nativeStop,
  onNativeEvent,
} from '@/lib/native';
import { haptic } from '@/lib/haptics';
import { rankRadio, signalComplete, signalPlay, signalSkip, toggleLike } from '@/lib/signals';
import { StallDetector } from '@/lib/stall';
import { store, useApp } from '@/state/store';
import type { StreamInfo, Track } from '@themashup/core';

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

/**
 * Watches the polled Media3 position. Module-level on purpose: it must survive re-renders, and the
 * poll interval outlives any single effect run.
 */
const nativeStall = new StallDetector(STALL_MS);
/** One-time notice when the native transport reports no usable position. */
let nativePositionWarned = false;

/**
 * Is Media3, rather than the <audio> element, the transport right now?
 *
 * `hasAttribute('src')` rather than `!el.src`. The two agree for an untouched element, but they stop
 * agreeing the moment a source is *removed*: `el.removeAttribute('src')` — what the hand-over to Media3
 * does — leaves `.src` returning the resolved page URL on some WebView versions, so a `!el.src` test
 * can evaluate false while the element is genuinely empty. That is the state in which a press of play
 * reached `el.play()` on an empty element and silently did nothing.
 *
 * Defined once and used everywhere: eight copies of a nearly-right condition is how that survived.
 */
function elementOwnsPlayback(el: HTMLAudioElement | null, nativeAvailable: boolean): boolean {
  return Boolean(el && !el.hasAttribute('src') && nativeAvailable);
}

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
    /**
     * Resolve and start a track.
     *
     * `resumeAt` exists for recovery, not for the user. When a stream stalls mid-song, reloading it
     * from zero throws away everything already heard — the user pressed play once and got the intro
     * three times. Any recovery path that restarts a track has to be able to say "continue from
     * here", otherwise "recovering" looks exactly like "the song restarts itself".
     */
    async (t: Track, resumeAt = 0) => {
      const gen = ++generation.current;
      const el = ensureAudio();
      const art = t.thumbs[t.thumbs.length - 1]?.url;
      store.set({
        loading: true,
        streamError: null,
        positionSec: Math.max(0, resumeAt),
        stream: null,
        lyrics: null,
      });

      /*
       * Local file first.
       *
       * This is the whole point of downloading: a file already on the device cannot be truncated by
       * a token gate, cannot 403 after a megabyte, and does not need the network at all. Until now
       * `load` went straight to `resolveStream` and never looked at the downloads list, so a
       * downloaded song still streamed — and still stopped.
       *
       * The native service plays a plain filesystem path directly; Media3 hands `file://` to its own
       * data source without a socket. The web element needs the same URL. If the file has vanished
       * since it was downloaded, fall through to the network rather than failing outright.
       */
      const onDisk = store.getState().downloads.find((d) => d.state === 'done' && d.track.id === t.id && d.path);
      if (onDisk?.path) {
        const localUrl = `file://${onDisk.path}`;
        nativeBootMark(`play ${t.id}: local file ${onDisk.path}`);
        store.set({ stream: null });
        signalPlay(t);
        if (!nativeDisabled && (await nativePlay({
          url: localUrl,
          title: t.title,
          artist: t.artist,
          ...(art ? { artUrl: art } : {}),
          durationMs: Math.round((t.durationSec || 0) * 1000),
          shouldPlay: true,
        }))) {
          store.set({ loading: false, playing: true, positionSec: Math.max(0, resumeAt) });
          // A local file can stall too (a slow SD card is enough). Recovery must continue, and
          // Media3 only accepts a seek once it holds the item.
          if (resumeAt > 0.5) void nativeSeek(resumeAt);
          return;
        }
        if (el) {
          el.src = localUrl;
          void el.play().catch(() => undefined);
          store.set({ loading: false, playing: true, positionSec: Math.max(0, resumeAt) });
          if (resumeAt > 0.5) el.currentTime = resumeAt;
          return;
        }
      }

      const resolved = await service.resolveStream(t.id);
      if (gen !== generation.current) return;

      if (!resolved.ok) {
        store.set({ loading: false, playing: false, streamError: resolved.error.message });
        store.notify(resolved.error.message, 'error');
        return;
      }

      // The track's own runtime goes into the picker so a 30-second preview cannot masquerade as
      // a complete stream. `t.durationSec` is 0 for some link-sourced tracks, which the picker
      // treats as "unknown" rather than as "zero length".
      const playable = service.playableUrl(resolved.info, t.durationSec);
      // The headers belong to this exact URL and travel on the StreamInfo that carries it, so there is
      // no per-track cache to go stale: resolving again produces a new StreamInfo with its own set.
      const requestHeaders = resolved.info.headers;
      store.set({ stream: resolved.info });
      // Count the attempt only once a source resolved: a failed resolve is not a listening choice.
      signalPlay(t);
      if (!playable) {
        store.set({
          loading: false,
          playing: false,
          streamError: 'Every source for this track is signature-locked right now.',
        });
        return;
      }

      // Every stream available was a preview clip. Play it — partial audio beats silence — but say
      // so up front. An app that renders thirty seconds and then goes quiet without explanation is
      // indistinguishable from one that cannot play anything, which is the report we are answering.
      if (playable.preview) {
        store.notify('Only a 30-second preview is available for this track right now.', 'info');
      }

      // Which stream, from which client, at what rate. If a report says "it stopped", this line
      // says whether the player chose a token-gated stream or a short one.
      const chosen = resolved.info.audio.find((a) => a.itag === playable.itag);
      nativeBootMark(
        `play ${t.id}: profile=${service.lastProfile || service.lastRoute} itag=${playable.itag} ` +
          `kbps=${chosen?.nominalKbps ?? '?'} declared=${chosen?.durationSec ? chosen.durationSec + 's' : 'n/a'} ` +
          `preview=${playable.preview} track=${t.durationSec}s`,
      );

      // Native shell: Media3 owns playback so audio survives backgrounding + screen-off and
      // appears on the lockscreen. Falls back to the element if the plugin is absent.
      // A new track is only ever loaded in order to play it, so the native handover must start
      // playback itself. Passing the flag keeps the contract explicit rather than relying on the
      // service's default, and it is what makes recovery-after-error audible again.
      const handedToNative = !nativeDisabled && (await nativePlay({
        url: playable.url,
        title: t.title,
        artist: t.artist,
        ...(art ? { artUrl: art } : {}),
        durationMs: Math.round(t.durationSec * 1000),
        shouldPlay: true,
        // The resolver's request headers, when it reported any. A CDN that needs its Referer answers
        // 403 without them, which is indistinguishable from the stream dying.
        ...(requestHeaders && Object.keys(requestHeaders).length > 0 ? { headers: requestHeaders } : {}),
      }));
      if (handedToNative) {
        el.removeAttribute('src');
        // Report the real track duration immediately; Media3 only learns it after buffering, and a
        // zero duration makes the seek bar jump from 0 to the true length a second later.
        store.set({ loading: false, durationSec: t.durationSec, playing: true, positionSec: Math.max(0, resumeAt) });
        lastTimeUpdate.current = Date.now();
        // Seek after handing over: Media3 cannot accept a position before it has a media item.
        // This is what makes a mid-song recovery continue instead of replaying the intro.
        if (resumeAt > 0.5) void nativeSeek(resumeAt);
        void nativeSetRate(store.getState().rate);
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
      if (resumeAt > 0.5) {
        // Seeking before playback starts is cheaper than seeking a live stream: no range request has
        // been issued for the region we are skipping.
        el.currentTime = resumeAt;
      }

      /*
       * Start it.
       *
       * Assigning `src` only *loads* the media; nothing plays until `play()` is called. This branch
       * used to return here and rely on the caller to call `setPlaying(true)` — and `setPlaying` bails
       * immediately when the element has no `src` attribute yet (`loading` has not produced one at
       * that instant on a fast tap), which is exactly the "tap a song, nothing happens, press play,
       * still nothing" report. A rejected promise here means autoplay policy or a bad source; both are
       * reported to the UI, and neither is allowed to escape as an unhandled rejection.
       */
      try {
        await el.play();
        store.set({ playing: true });
      } catch {
        store.set({ playing: false });
      }

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
      if (elementOwnsPlayback(el, hasNativePlayback())) {
        haptic('player');
        if (!next) {
          await nativePause();
          store.set({ playing: false });
          return;
        }

        /*
         * Ask the native player to resume, and *believe its answer*.
         *
         * `nativeResume()` is false when Media3 holds no media item — the state after a cold start
         * that restored a queue but never loaded a track, or after the notification's Stop. Setting
         * `playing: true` on top of that is the frozen player the user reported: the icon flips to
         * pause, the timer stays at 0:00, and nothing says why. Load the current track instead, which
         * is what a press of play means in that state.
         */
        const resumed = await nativeResume();
        if (resumed) {
          store.set({ playing: true });
          return;
        }
        const s = store.getState();
        const t = s.queue[s.index];
        if (t) void load(t, s.positionSec > 1 ? s.positionSec : 0);
        return;
      }

      /*
       * No element source and no native transport: there is nothing to play *yet*.
       *
       * Pressing play in that state must start the current track rather than return silently. This is
       * the shape of the "open the app and press play, nothing happens" report: the session restores
       * a queue but never resolves a stream, `setPlaying(true)` found no src, and returned.
       */
      if (!el.hasAttribute('src')) {
        const s = store.getState();
        const t = s.queue[s.index];
        if (next && t) {
          haptic('player');
          void load(t, s.positionSec > 1 ? s.positionSec : 0);
        }
        return;
      }
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
          haptic('player');
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
    [ensureAudio, load],
  );

  /**
   * Play a track.
   *
   * `list` is only passed when the user has explicitly chosen to play a *collection* (an album, a
   * playlist, their likes, or a queue row). Tapping a single search result must never replace the
   * queue with every result on screen — that used to happen, so one tap on "Jhol" queued the entire
   * result page, which is never what anyone wants.
   */
  const playTrack = useCallback(
    (t: Track, list?: Track[]) => {
      const current = store.getState();
      if (list && list.length > 1) {
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

  /**
   * Keep the music going when the queue runs out.
   *
   * Fetches radio for the most recent track, ranks it locally against the affinity graph, then
   * appends only tracks that are not already queued. If radio yields nothing (offline, or every
   * upstream endpoint exhausted) playback stops cleanly rather than looping on a dead stream.
   */
  const extendWithRadio = useCallback(async () => {
    const s = store.getState();
    const seed = s.queue[s.index] ?? s.queue[s.queue.length - 1] ?? null;
    if (!seed) {
      store.set({ playing: false, positionSec: 0 });
      return;
    }

    store.set({ loading: true });
    let extra: Track[] = [];
    try {
      extra = rankRadio(await service.radio(seed), seed);
    } catch {
      extra = [];
    }

    const seen = new Set(store.getState().queue.map((t) => t.id));
    const fresh = extra.filter((t) => !seen.has(t.id)).slice(0, 25);
    if (!fresh.length) {
      store.set({ loading: false, playing: false, positionSec: 0 });
      store.notify('End of queue — nothing new to add.', 'info');
      return;
    }

    const startAt = store.getState().queue.length;
    store.set({ queue: [...store.getState().queue, ...fresh], index: startAt, loading: false });
    const t = store.getState().queue[startAt];
    if (t) {
      void load(t);
      void setPlaying(true);
    }
  }, [load, setPlaying]);

  const next = useCallback(
    (auto = false) => {
      const s = store.getState();
      if (!s.queue.length) return;
      // `auto` means the track ended by itself: positive evidence. A manual advance is a skip, and
      // how far into the track the user got says whether it was rejection or boredom.
      if (auto) signalComplete(s.queue[s.index] ?? null);
      else signalSkip(s.queue[s.index] ?? null, s.positionSec);
      if (s.repeat === 'one' && auto) {
        // Restart through whichever transport owns playback; `el.currentTime = 0` is a no-op in
        // native mode (no src), which made repeat-one silently advance to the next track instead.
        const el = audioRef.current;
        if (elementOwnsPlayback(el, hasNativePlayback())) {
          void nativeSeek(0);
          store.set({ positionSec: 0 });
          void setPlaying(true);
          return;
        }
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
          // End of queue: keep playing instead of dying silently. This is the behaviour every music
          // app has and the one docs/07 exists to serve — the radio is re-ranked locally, so the
          // extension reflects what this device has actually learned.
          void extendWithRadio();
          return;
        } else {
          // Manual "next" past the end: stay stopped rather than surprising the user with audio.
          store.set({ playing: false, positionSec: 0 });
          const el = audioRef.current;
          if (elementOwnsPlayback(el, hasNativePlayback())) {
            void nativePause();
            return;
          }
          if (el) el.pause();
          return;
        }
      }
      const t = s.queue[nextIndex];
      if (!t) return;
      store.set({ index: nextIndex });
      void load(t);
      void setPlaying(true);
    },
    [extendWithRadio, load, setPlaying],
  );

  const prev = useCallback(() => {
    const s = store.getState();
    const el = audioRef.current;
    // Native mode has no element position: el.currentTime is always 0, so pressing previous jumped
    // backwards instead of restarting the song the way every player does.
    const nativeMode = elementOwnsPlayback(el, hasNativePlayback());
    const position = nativeMode ? s.positionSec : (el?.currentTime ?? 0);
    const restart = () => {
      if (nativeMode) void nativeSeek(0);
      else if (el) el.currentTime = 0;
      store.set({ positionSec: 0 });
    };
    if (position > 3) {
      restart();
      return;
    }
    const prevIndex = s.index - 1;
    if (prevIndex < 0) {
      restart();
      return;
    }
    signalSkip(s.queue[s.index] ?? null, position);
    const t = s.queue[prevIndex];
    if (!t) return;
    store.set({ index: prevIndex });
    void load(t);
    void setPlaying(true);
  }, [load, setPlaying]);

  const seek = useCallback((sec: number) => {
    const el = audioRef.current;
    if (elementOwnsPlayback(el, hasNativePlayback())) {
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
      if (elementOwnsPlayback(el, hasNativePlayback())) {
        const s = store.getState();
        seek(Math.max(0, s.positionSec + delta));
        return;
      }
      if (el) seek(el.currentTime + delta);
    },
    [seek],
  );

  const setRate = useCallback((r: number) => {
    const el = audioRef.current;
    if (el) el.playbackRate = r;
    // In native mode the element has no src, so the rate must be pushed to Media3 or the control
    // would silently do nothing on Android.
    if (hasNativePlayback()) void nativeSetRate(r);
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

  // Sleep timer (OuterTune feature): counts down every second and pauses playback when it
  // expires. Works with both native and WebView playback because it acts on the transport
  // directly rather than on store state alone.
  useEffect(() => {
    let alive = true;
    const id = window.setInterval(() => {
      const s = store.getState();
      if (!s.sleepTimerActive || s.sleepTimerMs <= 0 || !s.playing) return;

      const next = s.sleepTimerMs - 1000;
      if (next <= 0) {
        store.set({ sleepTimerMs: 0, sleepTimerActive: false });
        if (hasNativePlayback()) {
          void nativePause();
        } else {
          const el = ensureAudio();
          el.pause();
        }
        store.notify('Sleep timer — playback stopped.', 'info');
        return;
      }
      store.set({ sleepTimerMs: next });
    }, 1000);
    return () => { alive = false; window.clearInterval(id); };
  }, [ensureAudio]);

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
      const d = data as {
        code?: string;
        status?: number;
        positionMs?: number;
        host?: string;
        detail?: string;
      } | null;
      const code = d?.code ?? '';
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

      /*
       * Surface the full error instead of a single code, so "it stopped" becomes a number we can
       * act on. positionMs tells us how far the song got; status tells us whether the CDN refused
       * (403/404), the edge failed (5xx), or the socket closed before either; host says which URL
       * failed, without leaking the signed token in its query string.
       */
      const bits = [code];
      if (typeof d?.status === 'number') bits.push(`HTTP ${d.status}`);
      if (typeof d?.positionMs === 'number') bits.push(`at ${Math.round(d.positionMs / 1000)}s`);
      if (d?.host) bits.push(d.host);
      if (d?.detail) bits.push(d.detail.slice(0, 120));

      store.notify(`Native player error — ${bits.join(' — ')} — re-resolving…`, 'error');
      void load(t, store.getState().positionSec);
    });

    /*
     * Stop tapped *in the notification*.
     *
     * The service has already cleared its media item, so the audio is gone; if the page did not react,
     * the card would keep offering a track that no longer exists in the player. Clearing the queue is
     * the same thing the card's own X does, which is the whole point of a "stop" control.
     */
    const offStopped = onNativeEvent('stopped', () => {
      store.set({
        playing: false,
        loading: false,
        positionSec: 0,
        queue: [],
        index: -1,
        stream: null,
        playerOpen: false,
      });
    });

    // Custom notification buttons — shuffle / repeat / like — tapped in the media notification.
    // The native side posts these; JS owns the state and updates the store.
    const offToggleShuffle = onNativeEvent('toggleShuffle', () => {
      const s = store.getState();
      store.set({ shuffle: !s.shuffle });
      store.notify(s.shuffle ? 'Shuffle off' : 'Shuffle on', 'info');
    });
    const offToggleRepeat = onNativeEvent('toggleRepeat', () => {
      const s = store.getState();
      const next = s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off';
      store.set({ repeat: next });
      store.notify(`Repeat: ${next}`, 'info');
    });
    const offToggleLike = onNativeEvent('toggleLike', () => {
      const s = store.getState();
      const t = s.queue[s.index];
      if (!t) return;
      const now = toggleLike(t);
      store.notify(now ? 'Added to your likes' : 'Removed from your likes', now ? 'success' : 'info');
    });

    return () => {
      alive = false;
      window.clearInterval(id);
      offEnded();
      offError();
      offStopped();
      offToggleShuffle();
      offToggleRepeat();
      offToggleLike();
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
  //
  // `lastTimeUpdate` is only written by the element's `timeupdate` listener, which never fires in
  // native mode (the element has no src). Without the native branch below the watchdog concluded the
  // stream had stalled roughly every 11 s on Android and reloaded the track from zero — playback
  // restarted mid-song forever. Native progress is therefore measured from the polled position.
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = store.getState();
      if (!s.playing || s.loading) return;

      if (hasNativePlayback()) {
        /*
         * The native stall detector is only trustworthy when the transport is reporting a position
         * it actually measured.
         *
         * This cost a release. The Kotlin cache was updated only on player events, and a track that
         * is playing normally fires none, so `getState()` returned positionMs = 0 forever. The
         * detector saw a position that never moved, declared a stall, and the recovery reloaded the
         * stream — every few seconds, for as long as the song lasted. The audio was fine the whole
         * time; the instrument was broken.
         *
         * Two guards, so a broken instrument can never act again:
         *  - a position of 0 while playing is treated as "no measurement", not as "stuck at the
         *    start", and no stall is inferred from it;
         *  - the detector is only reset when a real position arrives, so it cannot accumulate a
         *    bogus stall window across a run of zero readings.
         */
        if (s.positionSec > 0) {
          if (nativeStall.check(s.positionSec)) {
            nativeStall.reset(s.positionSec);
            const t = s.queue[s.index];
            if (t) {
              store.notify('Playback stalled — continuing from here…', 'info');
              // Resume from the frozen position. Restarting a two-minute song at 1:50 because of a
              // buffer dip is the difference between a player and a toy.
              void load(t, s.positionSec);
            }
          }
        } else {
          // Report the instrument failure once per session instead of acting on it. Silence here
          // would hide a genuinely stuck player; acting on it is what caused the restarts.
          if (!nativePositionWarned) {
            nativePositionWarned = true;
            store.notify('Progress meter unavailable — playback continues.', 'info');
          }
        }
        return;
      }

      if (Date.now() - lastTimeUpdate.current > STALL_MS) {
        lastTimeUpdate.current = Date.now();
        const t = s.queue[s.index];
        if (t) {
          store.notify('Stream stalled — continuing from here…', 'info');
          void load(t, store.getState().positionSec);
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
    // Media3, not the element, is the transport on Android. Wiring absolute positions here keeps
    // the lockscreen scrubber tracking the real stream instead of a permanently-zero element.
    const nativeMode = Boolean(audioRef.current && !audioRef.current.src && hasNativePlayback());
    const setPosition = (d: MediaSessionActionDetails) => {
      if (typeof d.seekTime !== 'number') return;
      if (nativeMode) {
        void nativeSeek(Math.round(d.seekTime * 1000));
        store.set({ positionSec: d.seekTime });
      } else {
        seek(d.seekTime);
      }
    };
    try {
      navigator.mediaSession.setPositionState?.({
        duration: Math.max(0, track.durationSec || store.getState().durationSec || 0),
        position: Math.min(store.getState().positionSec, Math.max(0, track.durationSec || store.getState().durationSec || 0)),
        playbackRate: store.getState().rate || 1,
      });
    } catch {
      /* some browsers reject transient positions; cosmetic only */
    }
    navigator.mediaSession.setActionHandler('seekto', setPosition);
    navigator.mediaSession.setActionHandler('play', () => void setPlaying(true));
    navigator.mediaSession.setActionHandler('pause', () => void setPlaying(false));
    navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
  }, [track, setPlaying, next, prev, seekBy, seek]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  // Resume position for the current track (7-day window).
  useEffect(() => {
    if (!track) return;
    /*
     * Never restore a position while a resolve is in flight.
     *
     * A recovery reload calls `load(track, resumeAt)` for the *same* track object, so this effect does
     * not re-run — but the effect's 350 ms timer from the previous mount may still be pending, and it
     * would seek to the saved position on top of the explicit `resumeAt` the recovery asked for. Two
     * seeks in flight is how a resume lands a few seconds off.
     */
    if (store.getState().loading) return;
    const saved = readProgress(track.id);
    if (saved <= 5) return;
    const el = audioRef.current;

    // Native mode never fires loadedmetadata on the (src-less) element, so the saved position was
    // silently discarded and every resumed song restarted from zero. Seek the service directly.
    if (elementOwnsPlayback(el, hasNativePlayback())) {
      const id = window.setTimeout(() => {
        void nativeSeek(Math.round(saved * 1000));
        store.set({ positionSec: saved });
      }, 350);
      return () => window.clearTimeout(id);
    }

    if (!el) return;
    const apply = () => {
      el.currentTime = saved;
      el.removeEventListener('loadedmetadata', apply);
    };
    el.addEventListener('loadedmetadata', apply);
    return () => el.removeEventListener('loadedmetadata', apply);
  }, [track]);

  /**
   * End the song outright.
   *
   * Not a pause: the queue is cleared, the native service is told to stop, and the element is
   * unloaded. Anything less leaves the notification alive with a phantom track, which is exactly
   * what "I pressed the X and it is still in my shade" looks like.
   */
  const stop = useCallback(async () => {
    generation.current += 1; // invalidate any in-flight resolve
    const el = audioRef.current;
    if (hasNativePlayback()) {
      /*
       * `stop`, not `pause + seek(0)`.
       *
       * A paused Media3 session keeps its media item, its lockscreen entry and its notification, so
       * the previous implementation left the player sitting in the shade showing a track the user had
       * explicitly closed — the "I pressed the X and it is still there" report. `nativeStop` clears the
       * item, which is what makes the notification go away.
       */
      await nativeStop().catch(() => undefined);
    }
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    store.set({
      playing: false,
      loading: false,
      positionSec: 0,
      queue: [],
      index: -1,
      stream: null,
      streamError: null,
      playerOpen: false,
      lyricsOpen: false,
    });
    haptic('tap');
  }, []);

  return {
    track,
    playTrack,
    stop,
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
