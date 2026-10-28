import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StreamCandidate, Track } from "@themashup/shared";
import { getEngine, type EngineStatus } from "../engine/audioEngine";
import { nextIndex, prevIndex, type RepeatMode } from "../engine/playbackLogic";
import { enqueue as enqueueOp, removeAt as removeAtOp } from "./queueLogic";
import { api, ApiError } from "../lib/api";

export type PlayContext = "radio" | "queue" | "search" | "playlist" | "home";

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
    }),
    {
      name: "themashup.player",
      // Playback prefs survive restart; queue/session state does not.
      partialize: (s) => ({
        volume: s.volume,
        muted: s.muted,
        shuffle: s.shuffle,
        repeat: s.repeat,
      }),
    },
  ),
);

bindEngineToStore();
