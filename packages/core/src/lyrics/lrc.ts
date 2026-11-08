/** LRC / synced-lyrics parser. Handles multi-timestamp lines, [offset:], and enhanced (word) timing. */

import type { LyricLine } from '../domain.js';

const TIME_TAG = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_TAG = /\[offset:\s*([+-]?\d+)\s*\]/i;
const META_TAG = /^\[(ar|ti|al|by|re|ve|length):/i;
/** Enhanced LRC word timing: `<00:12.34>` inside a line. */
const WORD_TAG = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;

export function parseSyncedLyrics(lrc: string): LyricLine[] {
  if (typeof lrc !== 'string' || !lrc.trim()) return [];

  const offsetMs = Number(lrc.match(OFFSET_TAG)?.[1] ?? 0) || 0;
  const out: LyricLine[] = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || META_TAG.test(line)) continue;

    const stamps: number[] = [];
    TIME_TAG.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TIME_TAG.exec(line))) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const fracRaw = m[3] ?? '0';
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
      stamps.push(min * 60 + sec + frac);
    }
    if (!stamps.length) continue;

    // Strip tags to get the text (also removes word-level tags if present).
    const text = line
      .replace(TIME_TAG, '')
      .replace(WORD_TAG, '')
      .trim();
    if (!text) continue;

    for (const t of stamps) {
      out.push({ t: Math.max(0, t + offsetMs / 1000), text });
    }
  }

  return out.sort((a, b) => a.t - b.t);
}

/** Which line is active at time `t` (seconds). Returns -1 before the first line. */
export function activeLineIndex(lines: LyricLine[], t: number): number {
  if (!lines.length) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = lines[mid];
    if (!line) break;
    if (line.t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Fraction of the current line already sung, for karaoke wipe effects. */
export function lineProgress(lines: LyricLine[], index: number, t: number): number {
  const cur = lines[index];
  if (!cur) return 0;
  const next = lines[index + 1];
  const end = next ? next.t : cur.t + 4;
  if (end <= cur.t) return 1;
  return Math.min(1, Math.max(0, (t - cur.t) / (end - cur.t)));
}
