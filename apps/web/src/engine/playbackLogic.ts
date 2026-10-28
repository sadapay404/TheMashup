/**
 * Pure playback decision logic — kept free of DOM/audio so it can be unit
 * tested and shared between the store and (later) native shells.
 */

export type RepeatMode = "off" | "all" | "one";

export interface QueueSnapshot {
  index: number;
  length: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

/**
 * Index of the track to play next, or null when playback should stop.
 * - repeat "one"  → same index (caller replays)
 * - shuffle       → random other index (rng injectable for tests)
 * - wrap at end   → when repeat "all" or manual skip past the end
 */
export function nextIndex(state: QueueSnapshot, opts: { manual: boolean; rng?: () => number }): number | null {
  const { index, length, shuffle, repeat } = state;
  if (length === 0) return null;
  if (repeat === "one" && !opts.manual) return index;
  if (shuffle && length > 1) {
    const rng = opts.rng ?? Math.random;
    let pick = index;
    while (pick === index) pick = Math.floor(rng() * length);
    return pick;
  }
  const next = index + 1;
  if (next < length) return next;
  // End of queue
  if (repeat === "all") return 0;
  if (opts.manual) return length > 1 ? 0 : null; // manual skip wraps for convenience
  return null; // natural end → stop
}

/** Previous track index (wraps backwards), or null at start. */
export function prevIndex(state: QueueSnapshot, rng?: () => number): number | null {
  const { index, length, shuffle, repeat } = state;
  if (length === 0) return null;
  if (shuffle && length > 1) {
    const r = rng ?? Math.random;
    let pick = index;
    while (pick === index) pick = Math.floor(r() * length);
    return pick;
  }
  const prev = index - 1;
  if (prev >= 0) return prev;
  if (length > 1) return repeat === "off" ? index : length - 1;
  return index;
}

/** Where a "play next" insert lands; "add to queue" appends after the cursor. */
export function insertPosition(queueLength: number, index: number, mode: "next" | "end"): number {
  if (mode === "next") return Math.min(index + 1, queueLength);
  return queueLength;
}
