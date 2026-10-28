/**
 * mediaSession wiring (Phase 8) — guard path in node (no navigator.mediaSession)
 * plus a stubbed platform: metadata/playbackState mirroring, action handlers,
 * and cleanup. Player methods are spied so no audio engine is ever touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { usePlayerStore } from "../stores/playerStore";
import { setupMediaSession } from "./mediaSession";
import type { Track } from "@themashup/shared";

type SessionStub = {
  metadata: { title: string; artist: string; album: string; artwork: Array<{ src: string }> } | null;
  playbackState: string;
  handlers: Record<string, ((d: { seekTime?: number }) => void) | null>;
  setActionHandler: (action: string, handler: ((d: { seekTime?: number }) => void) | null) => void;
  setPositionState: (state: { duration: number; position: number; playbackRate: number }) => void;
  positions: Array<{ duration: number; position: number; playbackRate: number }>;
};

function makeSessionStub(): SessionStub {
  const stub: SessionStub = {
    metadata: null,
    playbackState: "none",
    handlers: {},
    positions: [],
    setActionHandler(action, handler) {
      stub.handlers[action] = handler;
    },
    setPositionState(state) {
      stub.positions.push(state);
    },
  };
  return stub;
}

function installNavigatorStub(stub: SessionStub) {
  const nav = globalThis.navigator as { mediaSession?: unknown } | undefined;
  if (!nav) throw new Error("node navigator missing");
  Object.defineProperty(nav, "mediaSession", { value: stub, configurable: true, writable: true });
  (globalThis as { MediaMetadata?: unknown }).MediaMetadata = class {
    title: string;
    artist: string;
    album: string;
    artwork: Array<{ src: string }>;
    constructor(init: { title: string; artist: string; album: string; artwork: Array<{ src: string }> }) {
      this.title = init.title;
      this.artist = init.artist;
      this.album = init.album;
      this.artwork = init.artwork;
    }
  };
  return () => {
    delete (nav as { mediaSession?: unknown }).mediaSession;
    delete (globalThis as { MediaMetadata?: unknown }).MediaMetadata;
  };
}

const fakeTrack: Track = {
  id: "t-1",
  video_id: "vid1",
  title: "Paper Moon",
  artist_names: "The Ink",
  album: "Blueprint",
  artwork_best: "https://img.example/cover.webp",
  artwork: "https://img.example/cover.jpg",
  duration_sec: 200,
} as unknown as Track;

test("setupMediaSession: no-op cleanup when the platform lacks mediaSession", () => {
  const had = "mediaSession" in (globalThis.navigator as object);
  assert.equal(had, false); // node has no mediaSession — guard must trip
  const cleanup = setupMediaSession();
  assert.equal(typeof cleanup, "function");
  cleanup();
});

test("setupMediaSession: mirrors metadata/state, registers actions, cleans up", () => {
  const stub = makeSessionStub();
  const restore = installNavigatorStub(stub);
  const before = usePlayerStore.getState();
  try {
    const cleanup = setupMediaSession();

    // Track present → metadata + position pushed.
    usePlayerStore.setState({ current: fakeTrack, duration: 200, position: 42, status: "paused" });
    assert.equal(stub.metadata?.title, "Paper Moon");
    assert.equal(stub.metadata?.artist, "The Ink");
    assert.equal(stub.metadata?.artwork[0]?.src, "https://img.example/cover.webp");
    assert.equal(stub.playbackState, "paused");
    assert.ok(stub.positions.length >= 1);
    const lastPos = stub.positions[stub.positions.length - 1]!;
    assert.equal(lastPos.duration, 200);
    assert.equal(lastPos.position, 42);

    // Status flip → playbackState follows.
    usePlayerStore.setState({ status: "playing" });
    assert.equal(stub.playbackState, "playing");

    // All five system actions registered.
    for (const action of ["play", "pause", "nexttrack", "previoustrack", "seekto"]) {
      assert.equal(typeof stub.handlers[action], "function", action);
    }

    // Action handlers hit the store (methods spied — engine never constructed).
    const calls: string[] = [];
    const orig = {
      toggle: before.toggle,
      next: before.next,
      prev: before.prev,
      seek: before.seek,
    };
    usePlayerStore.setState({
      toggle: () => void calls.push("toggle"),
      next: async () => void calls.push("next"),
      prev: () => void calls.push("prev"),
      seek: () => void calls.push("seek"),
    });
    try {
      // The store is "playing" from the step above → play is ignored…
      stub.handlers.play?.({});
      assert.deepEqual(calls, []);
      // …pause fires once…
      stub.handlers.pause?.({});
      assert.deepEqual(calls, ["toggle"]);
      // …and with status back to "paused", play fires again.
      usePlayerStore.setState({ status: "paused" });
      stub.handlers.play?.({});
      assert.deepEqual(calls, ["toggle", "toggle"]);
      stub.handlers.nexttrack?.({});
      stub.handlers.previoustrack?.({});
      stub.handlers.seekto?.({ seekTime: 77 });
      assert.deepEqual(calls, ["toggle", "toggle", "next", "prev", "seek"]);
    } finally {
      usePlayerStore.setState(orig);
    }

    cleanup();
    for (const action of ["play", "pause", "nexttrack", "previoustrack", "seekto"]) {
      assert.equal(stub.handlers[action], null, `${action} cleared`);
    }
    assert.equal(stub.metadata, null);
    assert.equal(stub.playbackState, "none");

    // Post-cleanup store changes no longer reach the platform.
    usePlayerStore.setState({ status: "playing" });
    assert.equal(stub.playbackState, "none");
  } finally {
    usePlayerStore.setState({
      current: before.current,
      status: before.status,
      position: before.position,
      duration: before.duration,
    });
    restore();
  }
});

test("setupMediaSession: play handler is state-guarded (no double toggle while playing)", () => {
  const stub = makeSessionStub();
  const restore = installNavigatorStub(stub);
  const before = usePlayerStore.getState();
  try {
    const cleanup = setupMediaSession();
    const calls: string[] = [];
    const origToggle = before.toggle;
    usePlayerStore.setState({
      status: "playing",
      toggle: () => void calls.push("toggle"),
    });
    try {
      stub.handlers.play?.({}); // status already playing → ignored
      assert.deepEqual(calls, []);
      stub.handlers.pause?.({}); // playing → toggles off
      assert.deepEqual(calls, ["toggle"]);
    } finally {
      usePlayerStore.setState({ status: before.status, toggle: origToggle });
    }
    cleanup();
  } finally {
    usePlayerStore.setState({ status: before.status });
    restore();
  }
});
