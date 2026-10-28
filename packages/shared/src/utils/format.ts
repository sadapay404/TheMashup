/** Duration in seconds → "m:ss" (or "h:mm:ss"). */
export function formatDuration(totalSec?: number): string {
  if (totalSec == null || !Number.isFinite(totalSec) || totalSec < 0) return "0:00";
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Bytes → human string (downloads UI). */
export function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Bits/s → "1.2 MB/s". */
export function formatSpeed(bytesPerSec?: number): string {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "—";
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Parse LRC text into timed lines (skips metadata tags). */
export function parseLrc(lrc: string): { time: number; text: string }[] {
  const lines: { time: number; text: string }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (tags.length === 0) continue; // [ar:], [ti:] metadata etc.
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of tags) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracRaw = m[3] ?? "0";
      const frac = parseInt(fracRaw, 10) / 10 ** fracRaw.length;
      lines.push({ time: min * 60 + sec + frac, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** ETA line for download rows: "42s left", "3m 12s left", "1h 5m left". */
export function formatTimeLeft(seconds?: number | null): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s left`;
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m < 60) return `${m}m ${sec}s left`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m left`;
}
