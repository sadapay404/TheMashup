"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlayerState, Track } from "@/lib/types";
import { api, post } from "@/lib/api";
import { getOfflineByTrack } from "@/lib/offline";
import { useApp } from "./app-context";

type Resolved = { url: string; kind: string };

type PlayerCtx = {
  queue: Track[];
  index: number;
  current: Track | null;
  state: PlayerState;
  position: number;
  duration: number;
  error?: string;
  note?: string;
  playQueue: (tracks: Track[], start?: number) => void;
  jumpTo: (i: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  addToQueue: (t: Track) => void;
  playNext: (t: Track) => void;
  removeFromQueue: (i: number) => void;
  moveInQueue: (i: number, dir: -1 | 1) => void;
  clearQueue: () => void;
  sleepEnd: number | null;
  setSleep: (minutes: number) => void;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  queueOpen: boolean;
  setQueueOpen: (v: boolean) => void;
};

const C = createContext<PlayerCtx | null>(null);
export const usePlayer = () => {
  const c = useContext(C);
  if (!c) throw new Error("PlayerProvider missing");
  return c;
};

const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { settings, update, toast } = useApp();
  const [queue, setQueueState] = useState<Track[]>([]);
  const [index, setIndexState] = useState(0);
  const [state, setState] = useState<PlayerState>("idle");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [sleepEnd, setSleepEnd] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const els = useRef<HTMLAudioElement[]>([]);
  const act = useRef(0);
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(0);
  const stateRef = useRef<PlayerState>("idle");
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const cache = useRef(new Map<string, Resolved>());
  const preloaded = useRef<{ idx: number; id: string } | null>(null);
  const pendingNext = useRef<number | null>(null);
  const token = useRef(0);
  const fading = useRef(false);
  const ramps = useRef(new Map<HTMLAudioElement, number>());
  const sleepTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const setSt = (s: PlayerState) => {
    stateRef.current = s;
    setState(s);
  };
  const setQ = (q: Track[], i: number) => {
    queueRef.current = q;
    indexRef.current = i;
    setQueueState(q);
    setIndexState(i);
  };
  const setIdx = (i: number) => {
    indexRef.current = i;
    setIndexState(i);
  };

  const active = () => els.current[act.current];
  const idle = () => els.current[1 - act.current];

  const targetVol = () => {
    const s = settingsRef.current;
    return clamp(s.volume * (s.normalize ? 1 - 0.3 * (s.normStrength / 100) : 1));
  };

  const cancelRamps = () => {
    ramps.current.forEach((id) => clearInterval(id));
    ramps.current.clear();
    fading.current = false;
  };

  const ramp = (el: HTMLAudioElement, from: number, to: number, ms: number, done?: () => void) => {
    const prev = ramps.current.get(el);
    if (prev) clearInterval(prev);
    const start = performance.now();
    el.volume = clamp(from);
    const id = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - start) / ms);
      el.volume = clamp(from + (to - from) * p);
      if (p >= 1) {
        clearInterval(id);
        ramps.current.delete(el);
        done?.();
      }
    }, 50);
    ramps.current.set(el, id);
  };

  const resolve = async (t: Track): Promise<Resolved> => {
    const hit = cache.current.get(t.id);
    if (hit) return hit;
    const off = await getOfflineByTrack(t.id);
    if (off) {
      const r = { url: URL.createObjectURL(off.blob), kind: "offline" };
      cache.current.set(t.id, r);
      return r;
    }
    const qs = new URLSearchParams({ id: t.id, title: t.title, artist: t.artist });
    if (t.previewUrl) qs.set("preview", t.previewUrl);
    const r = await api<Resolved>(`/api/stream?${qs}`);
    cache.current.set(t.id, r);
    return r;
  };

  const logHistory = (t: Track) => {
    void post("/api/history", { id: t.id, title: t.title, artist: t.artist, album: t.album, artwork: t.artwork, duration: t.duration, previewUrl: t.previewUrl }).catch(() => {});
  };

  const noteFor = (kind: string) =>
    kind === "preview" ? "Full-length sources are unavailable — playing a 30s preview." : kind === "offline" ? "Playing offline copy" : undefined;

  const computeNext = (auto: boolean): number | null => {
    const q = queueRef.current;
    const i = indexRef.current;
    const s = settingsRef.current;
    if (!q.length) return null;
    if (auto && s.repeat === "one") return i;
    if (s.shuffle && q.length > 1) {
      if (pendingNext.current !== null && pendingNext.current < q.length && pendingNext.current !== i) return pendingNext.current;
      let r = i;
      while (r === i) r = Math.floor(Math.random() * q.length);
      pendingNext.current = r;
      return r;
    }
    if (i + 1 < q.length) return i + 1;
    if (s.repeat === "all") return 0;
    return null;
  };

  const preloadNext = () => {
    if (!settingsRef.current.gapless) return;
    const n = computeNext(true);
    const at = indexRef.current;
    if (n === null || n === at) return;
    const t = queueRef.current[n];
    if (!t) return;
    resolve(t)
      .then((r) => {
        if (indexRef.current !== at) return;
        const el = idle();
        el.pause();
        el.src = r.url;
        el.preload = "auto";
        el.load();
        preloaded.current = { idx: n, id: t.id };
      })
      .catch(() => {
        preloaded.current = null;
      });
  };

  const loadAndPlay = async (idx: number) => {
    const t = queueRef.current[idx];
    if (!t) return;
    const my = ++token.current;
    cancelRamps();
    preloaded.current = null;
    pendingNext.current = null;
    idle().pause();
    setIdx(idx);
    setSt("loading");
    setError(undefined);
    setNote(undefined);
    setPosition(0);
    setDuration(t.duration ?? 0);
    try {
      const r = await resolve(t);
      if (my !== token.current) return;
      const el = active();
      el.src = r.url;
      el.volume = targetVol();
      el.playbackRate = settingsRef.current.rate;
      await el.play();
      if (my !== token.current) return;
      setNote(noteFor(r.kind));
      logHistory(t);
      preloadNext();
    } catch (e) {
      if (my !== token.current) return;
      setSt("error");
      setError(e instanceof Error ? e.message : "Playback failed");
    }
  };

  const swapTo = (n: number, fadeSec: number) => {
    const from = active();
    const to = idle();
    act.current = 1 - act.current;
    setIdx(n);
    preloaded.current = null;
    pendingNext.current = null;
    token.current++;
    const t = queueRef.current[n];
    const target = targetVol();
    to.playbackRate = settingsRef.current.rate;
    to.volume = fadeSec > 0 ? 0 : target;
    to.play().catch(() => setSt("error"));
    setPosition(0);
    setDuration(t?.duration ?? 0);
    setNote(undefined);
    setSt("playing");
    if (t) logHistory(t);
    if (fadeSec > 0) {
      ramp(to, 0, target, fadeSec * 1000, () => {
        fading.current = false;
      });
      ramp(from, from.volume, 0, fadeSec * 1000, () => from.pause());
    } else {
      cancelRamps();
      from.pause();
      to.volume = target;
    }
    setTimeout(preloadNext, 400);
  };

  const advance = (auto: boolean) => {
    const n = computeNext(auto);
    if (n === null) {
      if (auto) {
        setSt("stopped");
        setPosition(0);
      }
      return;
    }
    const pre = preloaded.current;
    if (pre && pre.idx === n && n !== indexRef.current && pre.id === queueRef.current[n]?.id && auto) {
      swapTo(n, 0);
    } else {
      void loadAndPlay(n);
    }
  };

  // Always point event handlers at the freshest closures.
  const fns = useRef({ advance, loadAndPlay, swapTo, computeNext });
  fns.current = { advance, loadAndPlay, swapTo, computeNext };

  useEffect(() => {
    const a = [new Audio(), new Audio()];
    a.forEach((e) => (e.preload = "auto"));
    els.current = a;
    a.forEach((el, i) => {
      const mine = () => act.current === i;
      el.addEventListener("timeupdate", () => {
        if (!mine()) return;
        setPosition(el.currentTime);
        const cf = settingsRef.current.crossfade;
        const dur = el.duration;
        if (cf > 0 && !fading.current && isFinite(dur) && dur > cf * 2 && dur - el.currentTime <= cf) {
          const n = fns.current.computeNext(true);
          const pre = preloaded.current;
          if (n !== null && n !== indexRef.current && pre && pre.idx === n) {
            fading.current = true;
            fns.current.swapTo(n, Math.min(cf, dur - el.currentTime));
          }
        }
      });
      el.addEventListener("durationchange", () => mine() && isFinite(el.duration) && setDuration(el.duration));
      el.addEventListener("playing", () => mine() && setSt("playing"));
      el.addEventListener("waiting", () => mine() && stateRef.current === "playing" && setSt("loading"));
      el.addEventListener("pause", () => {
        if (mine() && !el.ended && (stateRef.current === "playing" || stateRef.current === "loading")) setSt("paused");
      });
      el.addEventListener("ended", () => mine() && fns.current.advance(true));
      el.addEventListener("error", () => {
        if (!mine() || !el.src) return;
        cache.current.clear();
        setSt("error");
        setError("This stream failed to load. Try the next track or play again.");
      });
    });
    return () => {
      a.forEach((e) => {
        e.pause();
        e.removeAttribute("src");
      });
      cancelRamps();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live settings -> audio
  useEffect(() => {
    els.current.forEach((e) => (e.playbackRate = settings.rate));
    if (!fading.current && els.current[act.current]) els.current[act.current].volume = targetVol();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.rate, settings.volume, settings.normalize, settings.normStrength]);

  useEffect(() => {
    pendingNext.current = null;
  }, [settings.shuffle, settings.repeat]);

  const current = queue[index] ?? null;

  // Media Session = notification + lock-screen controls
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!current) return;
    ms.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album ?? "",
      artwork: current.artwork ? [{ src: current.artwork, sizes: "400x400" }] : [],
    });
  }, [current]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = state === "playing" ? "playing" : state === "paused" ? "paused" : "none";
  }, [state]);

  const toggle = useCallback(() => {
    const el = active();
    if (!el) return;
    const s = stateRef.current;
    if (s === "playing" || s === "loading") {
      token.current++;
      el.pause();
      setSt("paused");
    } else if (s === "paused" && el.src) {
      void el.play();
    } else if (queueRef.current.length) {
      void loadAndPlay(s === "stopped" ? 0 : indexRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const next = useCallback(() => {
    const n = computeNext(false);
    if (n === null) {
      toast("End of queue");
      return;
    }
    void loadAndPlay(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prev = useCallback(() => {
    const el = active();
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    const i = indexRef.current;
    if (i > 0) void loadAndPlay(i - 1);
    else if (settingsRef.current.repeat === "all" && queueRef.current.length) void loadAndPlay(queueRef.current.length - 1);
    else if (el) el.currentTime = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seek = useCallback((sec: number) => {
    const el = active();
    if (el && isFinite(sec)) {
      el.currentTime = sec;
      setPosition(sec);
    }
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* unsupported */
      }
    };
    set("play", () => toggle());
    set("pause", () => toggle());
    set("nexttrack", () => next());
    set("previoustrack", () => prev());
    set("seekto", (d) => d.seekTime != null && seek(d.seekTime));
  }, [toggle, next, prev, seek]);

  const playQueue = useCallback((tracks: Track[], start = 0) => {
    if (!tracks.length) return;
    setQ(tracks, start);
    void loadAndPlay(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jumpTo = useCallback((i: number) => {
    if (queueRef.current[i]) void loadAndPlay(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addToQueue = useCallback(
    (t: Track) => {
      if (!queueRef.current.length) return playQueue([t], 0);
      setQ([...queueRef.current, t], indexRef.current);
      preloaded.current = null;
      toast("Added to queue");
    },
    [playQueue, toast],
  );

  const playNext = useCallback(
    (t: Track) => {
      if (!queueRef.current.length) return playQueue([t], 0);
      const q = [...queueRef.current];
      q.splice(indexRef.current + 1, 0, t);
      setQ(q, indexRef.current);
      pendingNext.current = null;
      preloaded.current = null;
      setTimeout(preloadNext, 50);
      toast("Playing next");
    },
    [playQueue, toast],
  );

  const removeFromQueue = useCallback((i: number) => {
    const q = [...queueRef.current];
    const cur = indexRef.current;
    q.splice(i, 1);
    preloaded.current = null;
    pendingNext.current = null;
    if (i < cur) {
      setQ(q, cur - 1);
    } else if (i === cur) {
      if (!q.length) {
        token.current++;
        active().pause();
        active().removeAttribute("src");
        setQ([], 0);
        setSt("idle");
      } else {
        const ni = Math.min(cur, q.length - 1);
        setQ(q, ni);
        void loadAndPlay(ni);
      }
    } else {
      setQ(q, cur);
      setTimeout(preloadNext, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveInQueue = useCallback((i: number, dir: -1 | 1) => {
    const j = i + dir;
    const q = [...queueRef.current];
    if (j < 0 || j >= q.length) return;
    [q[i], q[j]] = [q[j], q[i]];
    let cur = indexRef.current;
    if (cur === i) cur = j;
    else if (cur === j) cur = i;
    preloaded.current = null;
    pendingNext.current = null;
    setQ(q, cur);
    setTimeout(preloadNext, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearQueue = useCallback(() => {
    const cur = queueRef.current[indexRef.current];
    preloaded.current = null;
    if (cur && (stateRef.current === "playing" || stateRef.current === "paused" || stateRef.current === "loading")) setQ([cur], 0);
    else {
      setQ([], 0);
      setSt("idle");
    }
    toast("Queue cleared");
  }, [toast]);

  const setSleep = useCallback(
    (minutes: number) => {
      clearTimeout(sleepTimer.current);
      if (minutes <= 0) {
        setSleepEnd(null);
        toast("Sleep timer off");
        return;
      }
      setSleepEnd(Date.now() + minutes * 60000);
      sleepTimer.current = setTimeout(() => {
        els.current.forEach((e) => e.pause());
        setSt("paused");
        setSleepEnd(null);
        toast("Sleep timer: playback paused");
      }, minutes * 60000);
      toast(`Sleep timer set for ${minutes} min`);
    },
    [toast],
  );

  useEffect(() => () => clearTimeout(sleepTimer.current), []);

  // keep `update` referenced for exhaustive deps friendliness
  void update;

  const value = useMemo<PlayerCtx>(
    () => ({
      queue, index, current, state, position, duration, error, note,
      playQueue, jumpTo, toggle, next, prev, seek, addToQueue, playNext, removeFromQueue, moveInQueue, clearQueue,
      sleepEnd, setSleep, expanded, setExpanded, queueOpen, setQueueOpen,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, index, state, position, duration, error, note, sleepEnd, expanded, queueOpen, playQueue, jumpTo, toggle, next, prev, seek, addToQueue, playNext, removeFromQueue, moveInQueue, clearQueue, setSleep],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
