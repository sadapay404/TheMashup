import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

interface ScrubOptions {
  /** Live preview ratio (0–1) while dragging. */
  onChange: (ratio: number) => void;
  /** Commit (seek / volume) — fires on down, move, up. */
  onCommit: (ratio: number) => void;
  /** Drag ended. */
  onEnd?: (ratio: number) => void;
}

/**
 * Shared pointer-scrub logic for progress + volume bars.
 * Pointer capture keeps drags smooth outside the element bounds.
 */
export function useScrub({ onChange, onCommit, onEnd }: ScrubOptions) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(false);
  const lastRef = useRef(0);

  const ratioAt = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      activeRef.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const r = ratioAt(e.clientX);
      lastRef.current = r;
      onChange(r);
      onCommit(r);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!activeRef.current) return;
      const r = ratioAt(e.clientX);
      lastRef.current = r;
      onChange(r);
      onCommit(r);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      const r = ratioAt(e.clientX);
      lastRef.current = r;
      onCommit(r);
      onEnd?.(r);
    },
    onPointerCancel: () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      onEnd?.(lastRef.current);
    },
  };

  return { trackRef, handlers, isActive: () => activeRef.current };
}
