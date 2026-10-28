/**
 * Phase 7 — desktop (Tauri) bridge tests.
 *
 * Everything here must degrade cleanly under plain node (no window, no Tauri),
 * and detection must key off the webview's location when one exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDesktop, onPlayerAction, saveJobFile } from "./desktop.js";
import { API_BASE, apiUrl } from "./api.js";

test("isDesktop: false without a window (node/test env)", () => {
  assert.equal(isDesktop(), false);
});

test("isDesktop: true on tauri:// and http://tauri.localhost webviews", () => {
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const prev = g.window;
  try {
    g.window = { location: { protocol: "tauri:", hostname: "localhost" } };
    assert.equal(isDesktop(), true);
    g.window = { location: { protocol: "http:", hostname: "tauri.localhost" } };
    assert.equal(isDesktop(), true);
    g.window = { location: { protocol: "http:", hostname: "localhost" } };
    assert.equal(isDesktop(), false, "plain browser must not look desktop");
  } finally {
    if (had) g.window = prev;
    else delete g.window;
  }
});

test("onPlayerAction / saveJobFile no-op off-desktop", async () => {
  let fired = 0;
  const unlisten = await onPlayerAction(() => fired++);
  assert.equal(typeof unlisten, "function");
  unlisten();
  assert.equal(fired, 0);

  const outcome = await saveJobFile({
    id: "x".repeat(32),
    video_id: "mock00000001",
    title: "T",
    container: "mp3",
    quality: "320k",
    status: "completed",
    progress: 100,
    created_at: 0,
    updated_at: 0,
  });
  assert.equal(outcome, "unavailable");
});

test("API base stays same-origin in node (web behavior unchanged)", () => {
  assert.equal(API_BASE, "");
  assert.equal(apiUrl("/api/downloads"), "/api/downloads");
  assert.equal(apiUrl("/other"), "/other", "only /api paths are prefixed");
});
