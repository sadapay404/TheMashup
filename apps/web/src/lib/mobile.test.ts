/**
 * Capacitor helpers (Phase 8) — detection, scoped-storage filename safety,
 * base64 chunking, hardware-back decision table. All pure/node-safe: the
 * bridge itself only exists inside the Android WebView.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DownloadJob } from "@themashup/shared";
import { isCapacitor, bytesToBase64, downloadFileName, decideBackPress, type BackDecision } from "./mobile";

function fakeJob(over: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "dl-1",
    video_id: "abc123",
    title: "Neon Skyline",
    container: "opus",
    quality: "best",
    status: "done",
    progress: 100,
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

test("isCapacitor: false outside the WebView", () => {
  assert.equal(isCapacitor(), false);
});

test("isCapacitor: true only when the bridge reports a native platform", () => {
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const prev = g.window;
  try {
    g.window = {};
    assert.equal(isCapacitor(), false);
    (g.window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    assert.equal(isCapacitor(), true);
    (g.window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "android" };
    assert.equal(isCapacitor(), true);
    (g.window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => false, getPlatform: () => "web" };
    assert.equal(isCapacitor(), false);
  } finally {
    if (had) g.window = prev;
    else delete g.window;
  }
});

test("bytesToBase64 round-trips across the 0x8000 chunk boundary", () => {
  const sizes = [0, 1, 100, 0x8000, 0x8000 + 123, 0x8000 * 3 + 7];
  for (const n of sizes) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) % 256;
    const b64 = bytesToBase64(bytes);
    assert.equal(b64, btoa(String.fromCharCode(...bytes)), `size ${n}`);
    const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    assert.deepEqual(Array.from(back), Array.from(bytes), `size ${n}`);
  }
});

test("downloadFileName sanitises names and keeps the container extension", () => {
  assert.equal(downloadFileName(fakeJob()), "Neon Skyline.opus");
  // "[^\w .-]+" collapses each adjacent bad run into a single underscore,
  // and the "." in "*.d" is legal → "a/b\c:*.d?" → "a_b_c_.d_".
  assert.equal(
    downloadFileName(fakeJob({ title: "a/b\\c:*.d?", container: "flac" })),
    "a_b_c_.d_.flac",
  );
  const long = downloadFileName(fakeJob({ title: "x".repeat(200), container: "mp3" }));
  assert.equal(long.length, 60 + 1 + 3);
  assert.ok(long.endsWith(".mp3"));
  assert.equal(downloadFileName(fakeJob({ title: "", video_id: "vid42", container: "mp4" })), "vid42.mp4");
});

test("decideBackPress: layers always come first", () => {
  const base = { page: "home", historyLen: 3, msSinceLastNavigate: null };
  assert.equal(decideBackPress({ ...base, playerExpanded: true, queueOpen: true, sidebarOpen: true }), "collapse-player");
  assert.equal(decideBackPress({ ...base, queueOpen: true, sidebarOpen: true }), "close-queue");
  assert.equal(decideBackPress({ ...base, sidebarOpen: true }), "close-sidebar");
});

test("decideBackPress: single press walks history, never exits", () => {
  assert.equal(
    decideBackPress({ playerExpanded: false, queueOpen: false, sidebarOpen: false, page: "library", historyLen: 2, msSinceLastNavigate: null }),
    "navigate",
  );
  // History empty but not home → straight home (first press).
  assert.equal(
    decideBackPress({ playerExpanded: false, queueOpen: false, sidebarOpen: false, page: "downloads", historyLen: 0, msSinceLastNavigate: null }),
    "go-home",
  );
  // At home with no history → press is a no-op (system gesture exits).
  assert.equal(
    decideBackPress({ playerExpanded: false, queueOpen: false, sidebarOpen: false, page: "home", historyLen: 0, msSinceLastNavigate: null }),
    "none",
  );
});

test("decideBackPress: double press (≤400 ms) jumps home from anywhere", () => {
  const inWindow: Array<BackDecision> = [0, 1, 200, 400].map((ms) =>
    decideBackPress({ playerExpanded: false, queueOpen: false, sidebarOpen: false, page: "search", historyLen: 5, msSinceLastNavigate: ms }),
  );
  assert.deepEqual(inWindow, ["go-home", "go-home", "go-home", "go-home"]);
  // Outside the window it is an ordinary back navigation again.
  assert.equal(
    decideBackPress({ playerExpanded: false, queueOpen: false, sidebarOpen: false, page: "search", historyLen: 5, msSinceLastNavigate: 401 }),
    "navigate",
  );
  assert.equal(
    decideBackPress({ playerExpanded: false, queueOpen: false, sidebarOpen: false, page: "search", historyLen: 5, msSinceLastNavigate: null }),
    "navigate",
  );
});
