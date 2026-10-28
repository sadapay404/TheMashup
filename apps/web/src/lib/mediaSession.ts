/**
 * Android lock-screen / notification-shade controls (Phase 8).
 *
 * Drives the OS media session from the player store: metadata + artwork,
 * action handlers (play/pause/next/prev/seek), playback state and a throttled
 * position state so the system seek bar stays honest. No-ops everywhere
 * `navigator.mediaSession` doesn't exist (browsers without it, node tests).
 */
import { usePlayerStore } from "../stores/playerStore";

export type MediaSessionCleanup = () => void;

export function setupMediaSession(): MediaSessionCleanup {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return () => undefined;
  }
  const ms = navigator.mediaSession;
  if (typeof MediaMetadata === "undefined") {
    return () => undefined;
  }

  const applyMetadata = () => {
    const cur = usePlayerStore.getState().current;
    if (!cur) {
      ms.metadata = null;
      return;
    }
    const src = cur.artwork_best ?? cur.artwork ?? "";
    try {
      ms.metadata = new MediaMetadata({
        title: cur.title,
        artist: cur.artist_names,
        album: cur.album ?? "TheMashup",
        artwork: src
          ? [{ src, sizes: "512x512", type: src.endsWith(".webp") ? "image/webp" : "image/jpeg" }]
          : [],
      });
    } catch {
      /* malformed artwork URL — controls still work without it */
    }
  };

  const applyPlaybackState = () => {
    const status = usePlayerStore.getState().status;
    try {
      ms.playbackState = status === "playing" ? "playing" : "paused";
    } catch {
      /* ignore */
    }
  };

  let lastPositionSync = 0;
  const applyPosition = (force = false) => {
    const s = usePlayerStore.getState();
    if (!s.current) return;
    const now = Date.now();
    if (!force && now - lastPositionSync < 1000) return;
    lastPositionSync = now;
    try {
      ms.setPositionState({
        duration: s.duration || 0,
        position: Math.min(s.position, s.duration || s.position),
        playbackRate: 1,
      });
    } catch {
      /* position state unsupported */
    }
  };

  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    [
      "play",
      () => {
        const p = usePlayerStore.getState();
        if (p.status !== "playing") p.toggle();
      },
    ],
    [
      "pause",
      () => {
        const p = usePlayerStore.getState();
        if (p.status === "playing") p.toggle();
      },
    ],
    ["nexttrack", () => void usePlayerStore.getState().next(true)],
    ["previoustrack", () => void usePlayerStore.getState().prev()],
    [
      "seekto",
      (details) => {
        if (typeof details.seekTime === "number" && details.seekTime >= 0) {
          usePlayerStore.getState().seek(details.seekTime);
          applyPosition(true);
        }
      },
    ],
  ];

  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* action not supported on this platform */
    }
  }

  applyMetadata();
  applyPlaybackState();
  applyPosition(true);

  const unsubscribe = usePlayerStore.subscribe((state, prev) => {
    if (state.current?.id !== prev.current?.id || state.current?.artwork !== prev.current?.artwork) {
      applyMetadata();
      applyPosition(true);
    }
    if (state.status !== prev.status) applyPlaybackState();
    if (state.position !== prev.position) applyPosition();
  });

  return () => {
    unsubscribe();
    for (const [action] of handlers) {
      try {
        ms.setActionHandler(action, null);
      } catch {
        /* ignore */
      }
    }
    try {
      ms.metadata = null;
      ms.playbackState = "none";
    } catch {
      /* ignore */
    }
  };
}
