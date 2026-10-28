/**
 * TheMashup audio engine — a framework-agnostic singleton.
 *
 * - Wraps one <audio> element + one AudioContext graph:
 *     MediaElementSource → Gain → Destination, Gain → Analyser (visualizer)
 * - Loads an ORDERED candidate list from POST /api/streams (proxied URLs).
 * - Silent failover: on media error / dead token (proxy410) it advances to the
 *   next candidate while preserving playback position.
 * - Single rAF loop only while playing; full teardown on destroy() (HMR-safe
 *   via globalThis singleton — no duplicate contexts, no leaks).
 */

import type { StreamCandidate } from "@themashup/shared";

export type EngineStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface EngineEvents {
  status: { status: EngineStatus; error?: string };
  time: { current: number; duration: number };
  /** Position/duration became known (metadata loaded). */
  meta: { duration: number };
  ended: Record<string, never>;
  /** Fired when the engine moved to candidates[i+1] after a failure. */
  failover: { attempt: number; total: number; reason: string };
  candidates: { candidates: StreamCandidate[]; activeIndex: number };
}

type Handler<K extends keyof EngineEvents> = (payload: EngineEvents[K]) => void;

const MAX_FAILOVER_ATTEMPTS = 6;

export class AudioEngine {
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;

  private candidates: StreamCandidate[] = [];
  private activeIndex = 0;
  private failoverAttempts = 0;
  private lastSwitchAt = 0;
  private lastVolume = 1;
  private pendingSeek: number | null = null;
  private status: EngineStatus = "idle";
  private destroyed = false;

  private listeners: Partial<Record<keyof EngineEvents, Set<(payload: never) => void>>> = {};

  constructor() {
    if (typeof window === "undefined") return;
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous"; // same-origin proxy → analyser stays untainted
    this.audio = audio;

    audio.addEventListener("timeupdate", () => {
      this.emit("time", { current: audio.currentTime, duration: audio.duration || 0 });
    });
    audio.addEventListener("durationchange", () => {
      if (Number.isFinite(audio.duration)) this.emit("meta", { duration: audio.duration });
    });
    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration)) this.emit("meta", { duration: audio.duration });
      if (this.pendingSeek != null && Number.isFinite(audio.duration)) {
        const target = Math.min(this.pendingSeek, Math.max(0, audio.duration - 0.25));
        try {
          audio.currentTime = target;
        } catch {
          /* seek too early — timeupdate will land near it anyway */
        }
        this.pendingSeek = null;
      }
    });
    audio.addEventListener("playing", () => {
      this.failoverAttempts = 0;
      this.setStatus("playing");
      this.startRaf();
    });
    audio.addEventListener("pause", () => {
      if (this.status !== "error") this.setStatus("paused");
      this.stopRaf();
    });
    audio.addEventListener("ended", () => {
      this.stopRaf();
      this.emit("ended", {});
    });
    audio.addEventListener("error", () => {
      const code = audio.error?.code;
      const reason =
        code === MediaError.MEDIA_ERR_NETWORK
          ? "network"
          : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? "src"
            : "error";
      this.handleCandidateFailure(reason);
    });
    audio.addEventListener("stalled", () => {
      // Long stalls on a dead mirror → try the next candidate.
      if (this.status === "loading" || (this.status === "playing" && audio.currentTime === 0)) {
        this.handleCandidateFailure("stalled");
      }
    });
  }

  /* ── events ──────────────────────────────────────────────────────── */

  on<K extends keyof EngineEvents>(event: K, fn: Handler<K>): () => void {
    let set = this.listeners[event];
    if (!set) {
      set = new Set();
      this.listeners[event] = set;
    }
    const typed = set as unknown as Set<Handler<K>>;
    typed.add(fn);
    return () => typed.delete(fn);
  }

  private emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]): void {
    const set = this.listeners[event];
    if (set) for (const fn of [...set]) (fn as (p: EngineEvents[K]) => void)(payload);
  }

  private setStatus(status: EngineStatus, error?: string): void {
    if (this.status === status && !error) return;
    this.status = status;
    this.emit("status", { status, error });
  }

  /* ── audio graph ─────────────────────────────────────────────────── */

  /** Lazily build the Web Audio graph — must be called from a user gesture. */
  private ensureGraph(): boolean {
    if (!this.audio) return false;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return true;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(this.audio);
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(gain);
      gain.connect(ctx.destination);
      gain.connect(analyser);
      gain.gain.value = this.lastVolume;
      this.audio.volume = 1; // gain owns loudness from now on
      this.ctx = ctx;
      this.source = source;
      this.gain = gain;
      this.analyser = analyser;
      this.freqData = new Uint8Array(analyser.frequencyBinCount);
      if (ctx.state === "suspended") void ctx.resume();
      return true;
    } catch (err) {
      // Without Web Audio we can still play (no visualizer) — degrade, never crash.
      console.warn("[engine] Web Audio unavailable, plain playback only", err);
      return true;
    }
  }

  /* ── public API ──────────────────────────────────────────────────── */

  load(candidates: StreamCandidate[], opts: { startAt?: number; autoplay?: boolean } = {}): void {
    if (!this.audio || this.destroyed) return;
    if (!candidates.length) {
      this.setStatus("error", "No playable stream candidates");
      return;
    }
    this.candidates = candidates;
    this.activeIndex = 0;
    this.failoverAttempts = 0;
    this.pendingSeek = opts.startAt ?? null;
    this.applyCandidateSource();
    this.emit("candidates", { candidates, activeIndex: 0 });
    if (opts.autoplay !== false) void this.play();
    else this.setStatus("loading");
  }

  private applyCandidateSource(): void {
    const audio = this.audio;
    const cand = this.candidates[this.activeIndex];
    if (!audio || !cand) return;
    this.setStatus("loading");
    audio.src = cand.play_url;
    audio.load();
  }

  private handleCandidateFailure(reason: string): void {
    if (this.destroyed || !this.audio) return;
    // Debounce: error+stalled can fire together for one dead candidate.
    const now = Date.now();
    if (now - this.lastSwitchAt < 900) return;
    this.lastSwitchAt = now;
    const hasMore = this.activeIndex + 1 < this.candidates.length;
    if (!hasMore || this.failoverAttempts >= MAX_FAILOVER_ATTEMPTS) {
      this.setStatus(
        "error",
        hasMore ? "All stream candidates failed" : `Stream failed (${reason})`,
      );
      this.stopRaf();
      return;
    }
    // Preserve position across the switch (seamless failover).
    const keep = this.audio.currentTime;
    this.pendingSeek = keep > 1 ? keep : this.pendingSeek;
    this.failoverAttempts += 1;
    this.activeIndex += 1;
    this.emit("failover", {
      attempt: this.failoverAttempts,
      total: this.candidates.length,
      reason,
    });
    this.emit("candidates", { candidates: this.candidates, activeIndex: this.activeIndex });
    this.applyCandidateSource();
    if (this.audio.paused) void this.play();
  }

  /** Skip the current candidate immediately (user-triggered "next stream"). */
  useNextCandidate(): boolean {
    if (this.activeIndex + 1 >= this.candidates.length) return false;
    this.handleCandidateFailure("manual");
    return true;
  }

  async play(): Promise<void> {
    if (!this.audio || this.destroyed) return;
    this.ensureGraph();
    try {
      await this.audio.play();
      this.setStatus("playing");
    } catch (err) {
      // Autoplay policy or transient error — surface as paused, not a crash.
      const msg = (err as Error)?.message ?? "playback blocked";
      this.setStatus(this.audio.paused && this.audio.src ? "paused" : "error", msg);
    }
  }

  pause(): void {
    this.audio?.pause();
  }

  toggle(): void {
    if (!this.audio) return;
    if (this.audio.paused && this.audio.src) void this.play();
    else this.pause();
  }

  seek(seconds: number): void {
    const audio = this.audio;
    if (!audio) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      const clamped = Math.min(Math.max(0, seconds), audio.duration - 0.1);
      try {
        audio.currentTime = clamped;
        this.emit("time", { current: clamped, duration: audio.duration });
      } catch {
        this.pendingSeek = clamped; // retry on loadedmetadata
      }
    } else {
      this.pendingSeek = seconds;
    }
  }

  setVolume(v: number): void {
    const clamped = Math.min(1, Math.max(0, v));
    this.lastVolume = clamped;
    if (this.ctx) {
      if (this.gain) this.gain.gain.value = clamped;
      if (this.audio) this.audio.volume = 1; // gain node owns loudness
    } else if (this.audio) {
      this.audio.volume = clamped; // graph not built yet (pre-gesture)
    }
  }

  /** Analyser snapshot for the visualizer — null until graph + playback exist. */
  getFrequencyData(): Uint8Array<ArrayBuffer> | null {
    if (!this.analyser || !this.freqData) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  get currentSource(): StreamCandidate | null {
    return this.candidates[this.activeIndex] ?? null;
  }

  get isPlaying(): boolean {
    return this.status === "playing";
  }

  destroy(): void {
    this.destroyed = true;
    this.stopRaf();
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.source?.disconnect();
    this.gain?.disconnect();
    this.analyser?.disconnect();
    void this.ctx?.close().catch(() => undefined);
    this.source = this.gain = this.analyser = this.ctx = null;
    this.freqData = null;
    for (const key of Object.keys(this.listeners) as (keyof EngineEvents)[]) {
      this.listeners[key]?.clear();
    }
    if (typeof window !== "undefined") {
      delete (window as unknown as Record<string, unknown>).__THEMASHUP_ENGINE__;
    }
  }

  /* ── rAF heartbeat (only while playing) ──────────────────────────── */

  private rafId: number | null = null;

  private startRaf(): void {
    if (this.rafId != null || typeof requestAnimationFrame === "undefined") return;
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      if (this.audio && this.status === "playing") {
        this.emit("time", {
          current: this.audio.currentTime,
          duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
        });
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRaf(): void {
    if (this.rafId != null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

/** HMR-safe global singleton — one context, one element, ever. */
export function getEngine(): AudioEngine {
  const w = globalThis as unknown as { __THEMASHUP_ENGINE__?: AudioEngine };
  if (!w.__THEMASHUP_ENGINE__) w.__THEMASHUP_ENGINE__ = new AudioEngine();
  return w.__THEMASHUP_ENGINE__;
}
