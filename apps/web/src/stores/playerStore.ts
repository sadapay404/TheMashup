import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StreamCandidate, Track } from "@themashup/shared";
import { getEngine, type EngineStatus } from "../engine/audioEngine";
import { nextIndex, prevIndex, type RepeatMode } from "../engine/playbackLogic";
import { enqueue as enqueueOp, removeAt as removeAtOp } from "./queueLogic";
import { api, ApiError } from "../lib/api";

export type PlayContext = "radio" | "queue" | "search" | "playlist" | "home";

/** A local audio file the user has selected for on-device playback. */
export interface LocalFile {
  id: string;            // stable client id (uuid)
  name: string;          // original filename
  type: string;          // mime type
  size: number;          // bytes
  lastModified: number;  // ms epoch
  /** Data URL or blob URL usable as an <audio> src. Populated lazily on play. */
  url?: string;
}

/** Sleep-timer interval id (module-level so it survives store recreation). */
let sleepTimerInterval: ReturnType<typeof setInterval> | null = null;

/** Gapless playback: pre-resolved candidates for the next queued track, keyed by track id. */
const preflightCandidates = new Map<string, StreamCandidate[]>();

function clearSleepTimer(): void {
  if (sleepTimerInterval != null) {
    clearInterval(sleepTimerInterval);
    sleepTimerInterval = null;
  }
}

/** Gapless: resolve and cache the next queued track's stream candidates. */
async function preflightNext(get: () => PlayerState, set: (p: Partial<PlayerState>) => void): Promise<void> {
  const s = get();
  const n = nextIndex(
    { index: s.index, length: s.queue.length, shuffle: s.shuffle, repeat: s.repeat },
    { manual: false },
  );
  if (n == null) return;
  const track = s.queue[n];
  if (preflightCandidates.has(track.id)) return;
  try {
    const { candidates } = await api.resolveStreams(track.id);
    // A newer play may have superseded this one while we fetched.
    if (get().current?.id !== track.id || get().queue[get().index]?.id !== track.id) return;
    if (candidates.length) preflightCandidates.set(track.id, candidates);
  } catch {
    /* gapless prefetch failure is not fatal — next() falls back to normal load */
  }
}

interface PlayerState {
  current: Track | null;
  queue: Track[];
  index: number;
  history: Track[];

  status: EngineStatus;
  resolving: boolean;
  position: number;
  duration: number;
  error?: string;

  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;

  contextLabel?: string;
  /** Failover diagnostics (subtle UI hints). */
  failoverCount: number;

  /* ── Sleep timer ── */
  /** Timer length in minutes (0 = off). */
  sleepTimerMinutes: number;
  /** Milliseconds remaining on the running timer. */
  sleepTimerRemainingMs: number;

  /* ── Crossfade / gapless ── */
  crossfadeEnabled: boolean;
  crossfadeDurationSec: number;
  gaplessEnabled: boolean;

  /* ── Playback rate ── */
  playbackRate: number;

  /* ── Equalizer ── */
  equalizerEnabled: boolean;
  equalizerPreset: string;

  /* ── Loudness normalization ── */
  normalizationEnabled: boolean;
  normalizationStrength: number;

  /* ── Sharing ── */
  /** Whether the Web Share API is available. */
  shareAvailable: boolean;

  /* ── Local file playback ── */
  /** Local audio files the user has selected (kept as File objects for blob URLs). */
  localFiles: LocalFile[];
  /** Blob URLs currently in use for local playback (revoked on unload/remove). */
  localFileUrls: Record<string, string>;

  /* ── Recently added / smart playlists ── */
  /** Tracks added recently (from downloads + local files + explicit adds), newest first. */
  recentlyAdded: Track[];

  playNow: (track: Track, queue?: Track[], context?: PlayContext) => Promise<void>;
  playAtIndex: (i: number, context?: PlayContext) => Promise<void>;
  enqueue: (track: Track, mode: "next" | "end") => void;
  removeAt: (i: number) => void;
  clearQueue: () => void;
  toggle: () => void;
  next: (manual?: boolean) => Promise<void>;
  prev: () => Promise<void>;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;

  /* ── Sleep timer ── */
  setSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
  /* ── Crossfade / gapless ── */
  setCrossfade: (enabled: boolean, durationSec?: number) => void;
  setGapless: (enabled: boolean) => void;
}

/** Resolve stream candidates for a track and hand them to the engine. */
async function loadIntoEngine(
  track: Track,
  get: () => PlayerState,
  set: (partial: Partial<PlayerState>) => void,
): Promise<void> {
  const engine = getEngine();
  set({ resolving: true, error: undefined, status: "loading", position: 0, duration: track.duration_sec ?? 0 });
  try {
    const { candidates } = await api.resolveStreams(track.id);
    // A newer play request may have superseded this one while we fetched.
    if (get().current?.id !== track.id) return;
    if (!candidates.length) throw new ApiError(502, "No playable streams", "NO_STREAMS");
    engine.load(candidates, { autoplay: true });
    engine.setVolume(get().muted ? 0 : get().volume);
    set({ resolving: false });
    api.event({ type: "play", track_id: track.id, context: get().contextLabel });

    // Gapless: pre-resolve the next track's candidates so transitions are instant.
    if (get().gaplessEnabled) {
      void preflightNext(get, set);
    }
  } catch (err) {
    if (get().current?.id !== track.id) return;
    const msg = err instanceof ApiError ? err.message : "Playback failed";
    set({ resolving: false, status: "error", error: msg });
  }
}

function bindEngineToStore(): void {
  const engine = getEngine();
  engine.on("status", ({ status, error }) => {
    usePlayerStore.setState({ status, ...(error ? { error } : {}) });
  });
  engine.on("time", ({ current, duration }) => {
    usePlayerStore.setState({
      position: current,
      ...(duration && Number.isFinite(duration) ? { duration } : {}),
    });
  });
  engine.on("meta", ({ duration }) => {
    usePlayerStore.setState({ duration });
  });
  engine.on("failover", () => {
    usePlayerStore.setState((s) => ({ failoverCount: s.failoverCount + 1 }));
  });
  engine.on("candidates", () => {
    /* candidate switches are intentionally silent */
  });
  engine.on("ended", () => {
    void usePlayerStore.getState().next(false);
  });
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      current: null,
      queue: [],
      index: -1,
      history: [],

      status: "idle",
      resolving: false,
      position: 0,
      duration: 0,

      volume: 0.85,
      muted: false,
      shuffle: false,
      repeat: "off",

      contextLabel: undefined,
      failoverCount: 0,

      sleepTimerMinutes: 0,
      sleepTimerRemainingMs: 0,

      crossfadeEnabled: false,
      crossfadeDurationSec: 3,
      gaplessEnabled: false,

      playbackRate: 1,

      equalizerEnabled: false,
      equalizerPreset: "flat",

      normalizationEnabled: false,
      normalizationStrength: 100,

      shareAvailable: typeof navigator !== "undefined" && "share" in navigator,

      localFiles: [],
      localFileUrls: {},

      recentlyAdded: [],

      playNow: async (track, queue, context) => {
        const q = queue && queue.length ? queue : [track];
        const idx = Math.max(
          0,
          q.findIndex((t) => t.id === track.id),
        );
        const prevTrack = get().current;
        const history = prevTrack ? [...get().history, prevTrack].slice(-50) : get().history;
        set({
          current: track,
          queue: q,
          index: idx,
          history,
          contextLabel: context ?? get().contextLabel,
        });
        await loadIntoEngine(track, get, set);
      },

      playAtIndex: async (i, context) => {
        const { queue, current, history } = get();
        if (i < 0 || i >= queue.length) return;
        const track = queue[i];
        if (current) set({ history: [...history, current].slice(-50) });
        set({ index: i, current: track, ...(context ? { contextLabel: context } : {}) });
        await loadIntoEngine(track, get, set);
      },

      enqueue: (track, mode) => {
        const { queue, index, current } = get();
        if (!current) {
          void get().playNow(track, [track]);
          return;
        }
        const r = enqueueOp(queue, index, track, mode);
        set({ queue: r.queue, index: r.cursor });
      },

      removeAt: (i) => {
        const { queue, index } = get();
        const r = removeAtOp(queue, index, i);
        set({ queue: r.queue, index: r.cursor });
        if (r.removedCurrent) {
          const nextTrack = r.queue[r.cursor];
          if (nextTrack) void get().playAtIndex(r.cursor);
          else {
            getEngine().pause();
            set({ current: null, index: -1, status: "idle", position: 0, duration: 0 });
          }
        }
      },

      clearQueue: () => set({ queue: get().current ? [get().current as Track] : [], index: get().current ? 0 : -1 }),

      toggle: () => {
        const { current, status } = get();
        if (!current) return;
        if (status === "error") {
          void get().playAtIndex(get().index);
          return;
        }
        getEngine().toggle();
      },

      next: async (manual = true) => {
        const s = get();
        const finished = s.current;
        /** complete = track ran out; skip = user jumped away. Feeds listen_again. */
        const emit = (type: "complete" | "skip") => {
          if (!finished) return;
          api.event({
            type,
            track_id: finished.id,
            context: s.contextLabel,
            listened_ms: Math.max(
              0,
              Math.round((type === "complete" ? s.duration : s.position) * 1000),
            ),
          });
        };
        const n = nextIndex(
          { index: s.index, length: s.queue.length, shuffle: s.shuffle, repeat: s.repeat },
          { manual },
        );
        if (n == null) {
          emit(manual ? "skip" : "complete");
          getEngine().pause();
          set({ status: "paused", position: s.duration });
          return;
        }
        if (n === s.index && !manual && s.repeat === "one") {
          // Replay same track (fresh candidates — previous URLs may have expired).
          emit("complete");
          await get().playAtIndex(n);
          return;
        }
        emit(manual ? "skip" : "complete");
        const track = s.queue[n];
        const history = s.current ? [...s.history, s.current].slice(-50) : s.history;
        const engine = getEngine();

        // Crossfade + gapless: overlap the next track with a volume ramp when
        // its candidates were pre-resolved (gapless). Otherwise fall back to
        // the normal (resolve-then-load) path.
        if (s.crossfadeEnabled && s.status === "playing") {
          const preflight = preflightCandidates.get(track.id);
          if (preflight?.length) {
            preflightCandidates.delete(track.id);
            set({
              current: track,
              index: n,
              history,
              contextLabel: s.contextLabel,
            });
            engine.crossfadeTo(preflight, { autoplay: true });
            engine.setVolume(s.muted ? 0 : s.volume);
            return;
          }
        }

        await get().playAtIndex(n);
      },

      prev: async () => {
        const s = get();
        if (s.position > 3) {
          getEngine().seek(0);
          set({ position: 0 });
          return;
        }
        const p = prevIndex(
          { index: s.index, length: s.queue.length, shuffle: s.shuffle, repeat: s.repeat },
        );
        if (p == null) return;
        if (s.current) {
          api.event({
            type: "skip",
            track_id: s.current.id,
            context: s.contextLabel,
            listened_ms: Math.max(0, Math.round(s.position * 1000)),
          });
        }
        await get().playAtIndex(p);
      },

      seek: (seconds) => {
        getEngine().seek(seconds);
        set({ position: seconds });
      },

      setVolume: (v) => {
        const clamped = Math.min(1, Math.max(0, v));
        set({ volume: clamped, muted: clamped === 0 ? true : get().muted && clamped === 0 });
        if (clamped > 0 && get().muted) set({ muted: false });
        getEngine().setVolume(get().muted ? 0 : clamped);
      },

      toggleMute: () => {
        const muted = !get().muted;
        set({ muted });
        getEngine().setVolume(muted ? 0 : get().volume);
      },

      toggleShuffle: () => set({ shuffle: !get().shuffle }),

      cycleRepeat: () =>
        set((s) => ({ repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" })),

      /* ── Sleep timer ── */
      setSleepTimer: (minutes) => {
        clearSleepTimer();
        set({ sleepTimerMinutes: minutes, sleepTimerRemainingMs: minutes * 60_000 });
        if (minutes <= 0) return;
        const endTime = Date.now() + minutes * 60_000;
        sleepTimerInterval = setInterval(() => {
          const remaining = endTime - Date.now();
          set({ sleepTimerRemainingMs: Math.max(0, remaining) });
          if (remaining <= 0) {
            clearSleepTimer();
            set({ sleepTimerMinutes: 0, sleepTimerRemainingMs: 0 });
            const engine = getEngine();
            engine.pause();
            set({ status: "paused" });
          }
        }, 1000);
      },

      cancelSleepTimer: () => {
        clearSleepTimer();
        set({ sleepTimerMinutes: 0, sleepTimerRemainingMs: 0 });
      },

      /* ── Crossfade / gapless ── */
      setCrossfade: (enabled, durationSec) => {
        set({ crossfadeEnabled: enabled, crossfadeDurationSec: durationSec ?? 3 });
        getEngine().setCrossfade(enabled, durationSec ?? 3);
      },

      setGapless: (enabled) => set({ gaplessEnabled: enabled }),

      /* ── Playback rate ── */
      setPlaybackRate: (rate) => {
        const clamped = Math.min(2, Math.max(0.5, rate));
        set({ playbackRate: clamped });
        getEngine().setPlaybackRate(clamped);
      },

      /* ── Equalizer ── */
      setEqualizer: (enabled, preset) => {
        set({ equalizerEnabled: enabled, equalizerPreset: preset ?? "flat" });
        getEngine().setEqualizer(enabled, preset);
      },

      setEqualizerBand: (frequency, gain) => {
        getEngine().setEqualizerBand(frequency, gain);
        set({ equalizerPreset: "custom" });
      },

      /* ── Loudness normalization ── */
      setNormalization: (enabled, strength) => {
        set({ normalizationEnabled: enabled, normalizationStrength: strength ?? 100 });
        getEngine().setNormalization(enabled, strength);
      },

      /* ── Sharing ── */
      shareTrack: async (track) => {
        const shareData: ShareData = {
          title: track.title,
          text: `${track.artist_names} — ${track.title}`,
          url: typeof location !== "undefined" ? location.origin : undefined,
        };
        const nav = typeof navigator !== "undefined" ? navigator : null;
        try {
          if (nav?.share) {
            await nav.share(shareData);
            return;
          }
        } catch {
          /* user cancelled or share failed — fall through to clipboard */
        }
        // Fallback: copy a shareable link to the clipboard.
        const link = `${typeof location !== "undefined" ? location.origin : ""}/track/${track.id}`;
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          /* clipboard unavailable — nothing more we can do */
        }
      },

      /* ── Local file playback ── */
      setLocalFiles: (files) => {
        // Revoke any URLs for files being removed.
        const incomingIds = new Set(files.map((f) => f.id));
        for (const id of Object.keys(get().localFileUrls)) {
          if (!incomingIds.has(id)) {
            const url = get().localFileUrls[id];
            if (url) try { URL.revokeObjectURL(url); } catch { /* ignore */ }
          }
        }
        set({ localFiles: files });
      },

      addLocalFile: (file) => {
        const id = crypto.randomUUID?.() ?? `${file.name}-${file.lastModified}`;
        const existing = get().localFiles.find((f) => f.id === id || f.name === file.name);
        // Create a revocable blob URL for immediate playback.
        const url = URL.createObjectURL(file);
        const lf: LocalFile = existing
          ? { ...existing, id: existing.id, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, url }
          : { id, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, url };
        set((s) => ({
          localFiles: existing
            ? s.localFiles.map((f) => (f.id === lf.id ? lf : f))
            : [lf, ...s.localFiles],
          localFileUrls: { ...s.localFileUrls, [lf.id]: url },
        }));
      },

      removeLocalFile: (id) => {
        const s = get();
        const url = s.localFileUrls[id];
        if (url) try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        set((s) => ({
          localFiles: s.localFiles.filter((f) => f.id !== id),
          localFileUrls: Object.fromEntries(Object.entries(s.localFileUrls).filter(([k]) => k !== id)),
        }));
      },

      playLocalFile: (fileId) => {
        const file = get().localFiles.find((f) => f.id === fileId);
        if (!file) return;
        // Use the blob URL created when the file was added.
        const engine = getEngine();
        const track: Track = {
          id: `local:${fileId}`,
          source: "local",
          external_id: fileId,
          title: file.name,
          artists: [{ name: "Local File" }],
          artist_names: "Local File",
          duration_sec: undefined,
          artwork: undefined,
          category: "song",
        };
        const url = file.url;
        if (!url) return;
        const candidate: StreamCandidate = {
          id: track.id,
          source: "local",
          url,
          play_url: url,
          mime: file.type,
          ext: file.name.split(".").pop() ?? "bin",
          quality: "local",
          has_video: false,
        };
        engine.load([candidate], { autoplay: true });
        set({ current: track, queue: [track], index: 0, status: "loading", resolving: false });
        void get().addToRecentlyAdded(track);
      },

      /* ── Recently added / smart playlist ── */
      addToRecentlyAdded: (track) => {
        set((s) => {
          const next = [track, ...s.recentlyAdded.filter((t) => t.id !== track.id)].slice(0, 50);
          return { recentlyAdded: next };
        });
      },

      clearRecentlyAdded: () => set({ recentlyAdded: [] }),
    }),
    {
      name: "themashup.player",
      // Playback prefs survive restart; queue/session state does not.
      partialize: (s) => ({
        volume: s.volume,
        muted: s.muted,
        shuffle: s.shuffle,
        repeat: s.repeat,
        crossfadeEnabled: s.crossfadeEnabled,
        crossfadeDurationSec: s.crossfadeDurationSec,
        gaplessEnabled: s.gaplessEnabled,
        playbackRate: s.playbackRate,
        equalizerEnabled: s.equalizerEnabled,
        equalizerPreset: s.equalizerPreset,
        normalizationEnabled: s.normalizationEnabled,
        normalizationStrength: s.normalizationStrength,
    },
  ),
);

bindEngineToStore();
