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

  /** Crossfade between tracks (overlap + volume ramp). Off by default. */
  private crossfadeEnabled = false;
  private crossfadeDurationSec = 3;
  /** Second audio element used as the crossfade target (next track). */
  private audioNext: HTMLAudioElement | null = null;
  /** Per-track gains feeding the master gain; enables overlap without touching volume. */
  private currentGain: GainNode | null = null;
  private nextGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  /** Post-volume EQ + loudness normalization chain. */
  private normalisationGain: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private readonly eqFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  private equalizerEnabled = false;
  private equalizerPreset = "flat";
  private equalizerBandGains = new Map<number, number>();
  private playbackRateValue = 1;
  private normalizationEnabled = false;
  private normalizationStrength = 100;
  /** Whether a crossfade overlap is currently in progress. */
  private crossfading = false;
  private crossfadeEndTimer: ReturnType<typeof setTimeout> | null = null;

  private listeners: Partial<Record<keyof EngineEvents, Set<(payload: never) => void>>> = {};

  constructor() {
    if (typeof window === "undefined") return;
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous"; // same-origin proxy → analyser stays untainted
    this.audio = audio;

    // Second element used as the crossfade target (next track overlaps current).
    const audioNext = new Audio();
    audioNext.preload = "auto";
    audioNext.crossOrigin = "anonymous";
    this.audioNext = audioNext;

    this.wireElement(audio);
    this.wireElement(audioNext);
  }

  /** Attach playback event listeners to one audio element. Only the active
   *  element (`this.audio`) drives state changes, so crossfade overlap never
   *  double-triggers ended/error/stalled. */
  private wireElement(el: HTMLAudioElement): void {
    const isActive = () => el === this.audio;
    el.addEventListener("timeupdate", () => {
      if (!isActive()) return;
      this.emit("time", { current: el.currentTime, duration: el.duration || 0 });
    });
    el.addEventListener("durationchange", () => {
      if (!isActive()) return;
      if (Number.isFinite(el.duration)) this.emit("meta", { duration: el.duration });
    });
    el.addEventListener("loadedmetadata", () => {
      if (!isActive()) return;
      if (Number.isFinite(el.duration)) this.emit("meta", { duration: el.duration });
      if (this.pendingSeek != null && Number.isFinite(el.duration)) {
        const target = Math.min(this.pendingSeek, Math.max(0, el.duration - 0.25));
        try {
          el.currentTime = target;
        } catch {
          /* seek too early — timeupdate will land near it anyway */
        }
        this.pendingSeek = null;
      }
    });
    el.addEventListener("playing", () => {
      if (!isActive()) return;
      this.failoverAttempts = 0;
      this.setStatus("playing");
      this.startRaf();
    });
    el.addEventListener("pause", () => {
      if (!isActive()) return;
      if (this.status !== "error") this.setStatus("paused");
      this.stopRaf();
    });
    el.addEventListener("ended", () => {
      if (!isActive()) return;
      this.stopRaf();
      this.emit("ended", {});
    });
    el.addEventListener("error", () => {
      if (!isActive()) return;
      const code = el.error?.code;
      const reason =
        code === MediaError.MEDIA_ERR_NETWORK
          ? "network"
          : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? "src"
            : "error";
      this.handleCandidateFailure(reason);
    });
    el.addEventListener("stalled", () => {
      if (!isActive()) return;
      // Long stalls on a dead mirror → try the next candidate.
      if (this.status === "loading" || (this.status === "playing" && el.currentTime === 0)) {
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
      // Master gain owns the user volume; analyser taps off the final output
      // (post-EQ / post-normalisation) so the visualizer reflects what's heard.
      const masterGain = ctx.createGain();
      const normalisationGain = ctx.createGain();
      normalisationGain.gain.value = 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.82;

      // Per-track gains: current track and (during crossfade) the next track.
      const curGain = ctx.createGain();
      curGain.gain.value = 1;
      const nxtGain = ctx.createGain();
      nxtGain.gain.value = 0;

      const source = ctx.createMediaElementSource(this.audio);
      const sourceNext = ctx.createMediaElementSource(this.audioNext!);
      source.connect(curGain);
      sourceNext.connect(nxtGain);
      curGain.connect(masterGain);
      nxtGain.connect(masterGain);

      // Equalizer chain: masterGain → [peaking filters] → normalisationGain → destination.
      const eqFilters: BiquadFilterNode[] = [];
      let prev: AudioNode = masterGain;
      for (const f of this.eqFrequencies) {
        const bq = ctx.createBiquadFilter();
        bq.type = "peaking";
        bq.frequency.value = f;
        bq.Q.value = 1;
        bq.gain.value = 0;
        prev.connect(bq);
        prev = bq;
        eqFilters.push(bq);
      }
      prev.connect(normalisationGain);
      normalisationGain.connect(ctx.destination);
      normalisationGain.connect(analyser); // tap: visualizer reflects post-EQ output

      masterGain.gain.value = this.lastVolume;
      this.audio.volume = 1; // gains own loudness from now on
      this.audioNext!.volume = 1;
      this.ctx = ctx;
      this.masterGain = masterGain;
      this.normalisationGain = normalisationGain;
      this.currentGain = curGain;
      this.nextGain = nxtGain;
      this.analyser = analyser;
      this.eqFilters = eqFilters;
      this.freqData = new Uint8Array(analyser.frequencyBinCount);
      this.applyEqSettings();
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

  /** Point an audio element at the active candidate's proxied URL. */
  private applyCandidateSource(target: HTMLAudioElement = this.audio): void {
    const audio = target;
    const cand = this.candidates[this.activeIndex];
    if (!audio || !cand) return;
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

  /** Enable/disable crossfade and set its duration in seconds. */
  setCrossfade(enabled: boolean, durationSec = 3): void {
    this.crossfadeEnabled = enabled;
    this.crossfadeDurationSec = Math.max(0.5, durationSec);
  }

  getCrossfadeState() {
    return {
      enabled: this.crossfadeEnabled,
      durationSec: this.crossfadeDurationSec,
      crossfading: this.crossfading,
    };
  }

  /**
   * Load [candidates] and, when crossfade is on and a track is playing,
   * overlap the next track with a volume ramp so there's no gap between songs.
   * Falls back to a normal [load] when crossfade is off or nothing is playing.
   */
  crossfadeTo(candidates: StreamCandidate[], opts: { startAt?: number; autoplay?: boolean } = {}): void {
    if (!this.audio || this.destroyed) return;
    if (!candidates.length) {
      this.setStatus("error", "No playable stream candidates");
      return;
    }
    if (!this.crossfadeEnabled || this.status !== "playing") {
      this.candidates = candidates;
      this.activeIndex = 0;
      this.failoverAttempts = 0;
      this.pendingSeek = opts.startAt ?? null;
      this.crossfading = false;
      this.applyCandidateSource(this.audio);
      this.emit("candidates", { candidates, activeIndex: 0 });
      if (opts.autoplay !== false) void this.play();
      else this.setStatus("loading");
      return;
    }

    this.crossfading = true;
    this.stopCrossfadeTimer();
    this.candidates = candidates;
    this.activeIndex = 0;
    this.failoverAttempts = 0;

    this.ensureGraph();
    const next = this.audioNext!;
    this.applyCandidateSource(next);
    const now = this.ctx!.currentTime;
    this.nextGain!.gain.setValueAtTime(0, now);
    this.currentGain!.gain.setValueAtTime(1, now);

    const endTime = now + this.crossfadeDurationSec;
    this.currentGain!.gain.linearRampToValueAtTime(0, endTime);
    this.nextGain!.gain.linearRampToValueAtTime(1, endTime);

    if (opts.autoplay !== false) void next.play();

    this.crossfadeEndTimer = setTimeout(() => this.completeCrossfade(), this.crossfadeDurationSec * 1000);
  }

  /** Promote the crossfade target to primary and retire the old element. */
  private completeCrossfade(): void {
    this.stopCrossfadeTimer();
    if (this.destroyed || !this.audio || !this.audioNext || !this.ctx) return;
    this.crossfading = false;

    // Retire the old primary element.
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();

    // Promote secondary → primary.
    const promoted = this.audioNext;
    this.audio = promoted;
    this.currentGain = this.nextGain;

    // Build a fresh secondary element for the next crossfade.
    const fresh = new Audio();
    fresh.preload = "auto";
    fresh.crossOrigin = "anonymous";
    this.audioNext = fresh;
    const freshGain = this.ctx.createGain();
    freshGain.gain.value = 0;
    const freshSource = this.ctx.createMediaElementSource(fresh);
    freshSource.connect(freshGain);
    freshGain.connect(this.masterGain!);
    this.nextGain = freshGain;
    this.wireElement(fresh);

    // New primary is already playing; restore gains + status.
    this.currentGain!.gain.setValueAtTime(1, this.ctx.currentTime);
    this.nextGain!.gain.setValueAtTime(0, this.ctx.currentTime);
    this.setStatus("playing");
    this.startRaf();
    this.failoverAttempts = 0;
    this.emit("candidates", { candidates: this.candidates, activeIndex: this.activeIndex });
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
    if (this.crossfading) this.audioNext?.pause();
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
      if (this.masterGain) this.masterGain.gain.value = clamped;
      if (this.audio) this.audio.volume = 1; // master gain owns loudness
      if (this.audioNext) this.audioNext.volume = 1;
    } else if (this.audio) {
      this.audio.volume = clamped; // graph not built yet (pre-gesture)
    }
  }

  /* ── playback rate (pitch-preserving where the browser supports it) ───── */

  /** Set playback rate (0.5 → 2.0, default 1). Applied to both audio elements. */
  setPlaybackRate(rate: number): void {
    const clamped = Math.min(2, Math.max(0.5, rate));
    this.playbackRateValue = clamped;
    if (this.audio) this.audio.playbackRate = clamped;
    if (this.audioNext) this.audioNext.playbackRate = clamped;
  }

  getPlaybackRate(): number {
    return this.playbackRateValue;
  }

  /* ── equalizer ────────────────────────────────────────────────────────── */

  private readonly EQ_PRESETS: Record<string, Record<number, number>> = {
    flat: {},
    bass: { 32: 4, 64: 3, 125: 2 },
    treble: { 8000: 3, 16000: 4 },
    vocal: { 1000: 2, 2000: 1, 4000: 1 },
    acoustic: { 64: -1, 500: 1, 1000: 1, 4000: -1 },
    electronic: { 32: 3, 64: 2, 4000: 2, 8000: 2 },
    rock: { 64: 2, 125: 1, 4000: 2, 16000: 1 },
    jazz: { 64: 2, 1000: 1, 16000: 2 },
    classical: { 64: 1, 1000: -1, 8000: 1 },
  };

  /** Enable/disable the equalizer and optionally switch preset. */
  setEqualizer(enabled: boolean, preset?: string): void {
    this.equalizerEnabled = enabled;
    if (preset && preset in this.EQ_PRESETS) this.equalizerPreset = preset;
    this.applyEqSettings();
  }

  /** Set a single EQ band gain in dB (-12 → +12). */
  setEqualizerBand(frequency: number, gain: number): void {
    this.equalizerBandGains.set(frequency, Math.min(12, Math.max(-12, gain)));
    this.equalizerPreset = "custom";
    this.applyEqSettings();
  }

  /** Reset all bands to the current preset. */
  private applyEqSettings(): void {
    const gains = this.equalizerEnabled ? (this.EQ_PRESETS[this.equalizerPreset] ?? {}) : {};
    // Custom band overrides always win.
    for (const [freq, gain] of this.equalizerBandGains) gains[freq] = gain;

    for (const bq of this.eqFilters) {
      const f = bq.frequency.value;
      bq.gain.value = this.equalizerEnabled ? (gains[f] ?? 0) : 0;
    }
  }

  getEqualizerState() {
    return {
      enabled: this.equalizerEnabled,
      preset: this.equalizerPreset,
      bands: Object.fromEntries(this.eqFilters.map((b) => [b.frequency.value, b.gain.value])),
    };
  }

  /* ── loudness normalization ───────────────────────────────────────────── */

  /** Enable/disable loudness normalization (compensatory gain, 0–100%). */
  setNormalization(enabled: boolean, strength?: number): void {
    this.normalizationEnabled = enabled;
    if (strength != null) this.normalizationStrength = Math.min(100, Math.max(0, strength));
    this.applyNormalization();
  }

  private applyNormalization(): void {
    if (!this.normalisationGain) return;
    // Compensatory gain: strength 0 → -6 dB (0.5), 50 → 0 dB (1), 100 → +6 dB (2).
    const t = this.normalizationStrength / 100;
    const gain = Math.pow(2, (t - 0.5) * 2); // 0.5 → 2.0
    this.normalisationGain.gain.value = this.normalizationEnabled ? gain : 1;
  }

  /** Frequency data snapshot for the visualizer (post-EQ output). */
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
    this.stopCrossfadeTimer();
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    if (this.audioNext) {
      this.audioNext.pause();
      this.audioNext.removeAttribute("src");
      this.audioNext.load();
    }
    this.currentGain?.disconnect();
    this.nextGain?.disconnect();
    this.masterGain?.disconnect();
    this.normalisationGain?.disconnect();
    for (const bq of this.eqFilters) bq.disconnect();
    this.analyser?.disconnect();
    void this.ctx?.close().catch(() => undefined);
    this.currentGain = this.nextGain = this.masterGain = this.normalisationGain = this.analyser = this.ctx = null;
    this.eqFilters = [];
    this.freqData = null;
    for (const key of Object.keys(this.listeners) as (keyof EngineEvents)[]) {
      this.listeners[key]?.clear();
    }
    if (typeof window !== "undefined") {
      delete (window as unknown as Record<string, unknown>).__THEMASHUP_ENGINE__;
    }
  }

  private stopCrossfadeTimer(): void {
    if (this.crossfadeEndTimer != null) {
      clearTimeout(this.crossfadeEndTimer);
      this.crossfadeEndTimer = null;
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
