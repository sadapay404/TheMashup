import type { Track } from "@themashup/shared";

/**
 * Pure queue transformations — unit-testable, no store/audio coupling.
 * `cursor` = index of the currently loaded track (-1 when nothing loaded).
 */

export function enqueue(
  queue: Track[],
  cursor: number,
  track: Track,
  mode: "next" | "end",
): { queue: Track[]; cursor: number; insertedAt: number } {
  if (mode === "next") {
    const at = Math.max(0, Math.min(cursor + 1, queue.length));
    const next = [...queue.slice(0, at), track, ...queue.slice(at)];
    return { queue: next, cursor, insertedAt: at };
  }
  return { queue: [...queue, track], cursor, insertedAt: queue.length };
}

export function removeAt(
  queue: Track[],
  cursor: number,
  i: number,
): { queue: Track[]; cursor: number; removedCurrent: boolean } {
  if (i < 0 || i >= queue.length) return { queue, cursor, removedCurrent: false };
  const next = queue.filter((_, idx) => idx !== i);
  let nextCursor = cursor;
  if (i < cursor) nextCursor = cursor - 1;
  if (i === cursor) nextCursor = Math.min(cursor, next.length - 1);
  return { queue: next, cursor: Math.max(-1, nextCursor), removedCurrent: i === cursor };
}

export function moveItem(queue: Track[], from: number, to: number, cursor: number): { queue: Track[]; cursor: number } {
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) {
    return { queue, cursor };
  }
  const next = [...queue];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  let c = cursor;
  if (cursor === from) c = to;
  else if (from < cursor && to >= cursor) c = cursor - 1;
  else if (from > cursor && to <= cursor) c = cursor + 1;
  return { queue: next, cursor: c };
}
