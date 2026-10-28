import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Env must be set before app modules load.
process.env.MOCK_UPSTREAM = "1";
process.env.LOG_LEVEL = "error";
process.env.LIBRARY_DB_PATH = `/tmp/themashup-test-${process.pid}.json`;

const { createApp } = await import("../src/app.js");
const { httpResolver } = await import("../src/services/resolverClient.js");
type ResolverClient = import("../src/services/resolverClient.js").ResolverClient;

/* ── Fake resolver (dependency-injected; no network in tests) ─────────────── */

const fakeTrack = (id: string, title: string, artist: string) => ({
  id,
  source: "ytmusic" as const,
  external_id: id,
  title,
  artists: [{ name: artist }],
  artist_names: artist,
  duration_sec: 200,
  category: "song" as const,
  popularity: 70,
});

const fakeResolver: ResolverClient = {
  health: async () => ({ ok: true, mock: true }),
  search: async (q) => ({
    tracks: [
      fakeTrack("mock00000001", "Midnight Mirage", "Nova Arcade"),
      fakeTrack("mock00000006", "Glasshouse Summer", "Nova Arcade"),
      fakeTrack("mock00000003", "Neon Tide", "Kite Society"),
    ],
    artists: [{ name: "Nova Arcade", channel_id: "UCmock" }],
    albums: [{ title: "Chrome Gardens", artist: "Nova Arcade" }],
    warnings: [],
  }),
  suggest: async (q) => ["midnight mirage", "midnight city"].filter((s) => s.includes(q.toLowerCase().slice(0, 4))),
  streams: async (videoId) => ({
    video_id: videoId,
    candidates: [
      {
        source: "ytdlp",
        url: "", // replaced below once the test server knows its port
        play_url: "",
        mime: "audio/webm; codecs=opus",
        ext: "webm",
        quality: "opus 160k",
        bitrate_kbps: 160,
        has_video: false,
        http_headers: { "User-Agent": "TheMashup-Test/0.1", Referer: "https://www.youtube.com/" },
      },
    ],
    resolution_ms: 12,
    degraded: false,
    warnings: [],
  }),
  formats: async (videoId) => ({
    video_id: videoId,
    title: "Midnight Mirage",
    duration_sec: 214,
    audio: [
      { format_id: "251", ext: "webm", quality: "opus best", has_video: false, target_container: "opus" as const },
      { format_id: "140", ext: "m4a", quality: "m4a 128k", bitrate_kbps: 128, has_video: false, target_container: "mp3" as const },
    ],
    video: [
      { format_id: "137", ext: "mp4", quality: "1080p", width: 1920, height: 1080, has_video: true, target_container: "mp4" as const },
    ],
  }),
  meta: async (videoId) => fakeTrack(videoId, "Midnight Mirage", "Nova Arcade"),
  related: async () => [
    fakeTrack("mock00000002", "Starboy", "Nova Arcade"),
    fakeTrack("mock00000003", "Neon Tide", "Kite Society"),
    fakeTrack("mock00000004", "Paper Crowns", "Elder & Vine"),
  ],
  artist: async () => ({
    artist: { name: "Nova Arcade", channel_id: "UCmock" },
    tracks: [fakeTrack("mock00000001", "Midnight Mirage", "Nova Arcade")],
  }),
  charts: async () => ({
    tracks: [
      fakeTrack("mock00000001", "Midnight Mirage", "Nova Arcade"),
      fakeTrack("mock00000002", "Starboy", "Nova Arcade"),
      fakeTrack("mock00000003", "Neon Tide", "Kite Society"),
      fakeTrack("mock00000004", "Paper Crowns", "Elder & Vine"),
    ],
    warnings: [],
  }),
  startDownload: async (body) => ({
    id: "f".repeat(32),
    video_id: body.video_id,
    title: body.title ?? body.video_id,
    container: body.container as "mp3",
    quality: body.quality,
    status: "completed",
    progress: 100,
    owner: body.owner,
    filename: "/tmp/fake.mp3",
    filesize: 12345,
    created_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
  }),
  listDownloads: async (owner) => [
    {
      id: "f".repeat(32),
      video_id: "mock00000001",
      title: "Midnight Mirage",
      container: "mp3",
      quality: "128k",
      status: "completed",
      progress: 100,
      owner: owner ?? "someone",
      created_at: Date.now() / 1000,
      updated_at: Date.now() / 1000,
    },
  ],
  getDownload: async (id) => ({
    id,
    video_id: "mock00000001",
    title: "Midnight Mirage",
    container: "mp3",
    quality: "128k",
    status: "completed",
    progress: 100,
    owner: "dev:test-user-1234",
    created_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
  }),
  cancelDownload: async (id) => ({
    id,
    video_id: "mock00000001",
    title: "Midnight Mirage",
    container: "mp3",
    quality: "128k",
    status: "failed",
    progress: 0,
    error: "cancelled",
    owner: "dev:test-user-1234",
    created_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
  }),
  downloadFileUrl: (id) => `${base}/api/health?for=${id}`,
};

/* ── Boot test server ─────────────────────────────────────────────────────── */

const app = createApp({ resolver: fakeResolver });
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function get(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function post(path: string, payload: unknown, headers: Record<string, string> = {}) {
  return get(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

/* ── Tests ────────────────────────────────────────────────────────────────── */

test("GET /api/health reports gateway + resolver + lyrics provider", async () => {
  const { status, body } = await get("/api/health");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.resolver.ok, true);
  assert.equal(body.lyrics_provider, "mock");
});

test("GET /api/search returns ranked metadata results", async () => {
  const { status, body } = await get("/api/search?q=midnight");
  assert.equal(status, 200);
  assert.equal(body.query, "midnight");
  assert.equal(body.tracks[0].title, "Midnight Mirage");
  assert.ok(Array.isArray(body.artists));
});

test("GET /api/search validates query params", async () => {
  const { status, body } = await get("/api/search");
  assert.equal(status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("GET /api/search/suggest returns autocomplete strings", async () => {
  const { status, body } = await get("/api/search/suggest?q=mid");
  assert.equal(status, 200);
  assert.ok(body.suggestions.includes("midnight mirage"));
});

test("GET /api/lyrics/match resolves free text to lyric candidates", async () => {
  const { status, body } = await get("/api/lyrics/match?q=city hums in ultraviolet");
  assert.equal(status, 200);
  assert.ok(body.matches.length >= 1, "expected at least one lyric match");
  assert.ok(body.matches[0].synced === true || body.matches[0].plain === true);
  // matched lyric snippet for the dropdown UI
  assert.equal(body.matches[0].snippet, "City hums in ultraviolet");
});

test("GET /api/lyrics/:id returns synced LRC lines for a track", async () => {
  const { status, body } = await get("/api/lyrics/mock00000001");
  assert.equal(status, 200);
  assert.equal(body.provider, "mock");
  assert.ok(Array.isArray(body.synced) && body.synced.length > 0);
  assert.equal(typeof body.synced[0].time, "number");
});

test("POST /api/streams issues proxy tokens and /api/stream/:token proxies bytes", async () => {
  // Make the fake candidate point at this very test server.
  (fakeResolver.streams as any) = async (videoId: string) => ({
    video_id: videoId,
    candidates: [
      {
        source: "ytdlp",
        url: `${base}/api/health`,
        play_url: "",
        mime: "application/json",
        ext: "json",
        quality: "test",
        has_video: false,
      },
    ],
    resolution_ms: 5,
    degraded: false,
    warnings: [],
  });

  const created = await post("/api/streams", { video_id: "mock00000001" });
  assert.equal(created.status, 200);
  assert.equal(created.body.candidates.length, 1);
  const playUrl = created.body.candidates[0].play_url;
  assert.match(playUrl, /^\/api\/stream\/[A-Za-z0-9_-]{10,}$/);

  const proxied = await get(playUrl);
  assert.equal(proxied.status, 200);
  assert.equal(proxied.body.ok, true); // /api/health payload piped through proxy
});

test("proxy rejects unknown/expired tokens with 410", async () => {
  const { status, body } = await get("/api/stream/definitely-not-a-real-token-123");
  assert.equal(status, 410);
  assert.equal(body.error.code, "TOKEN_EXPIRED");
});

test("POST /api/streams validates body", async () => {
  const { status, body } = await post("/api/streams", {});
  assert.equal(status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("POST /api/radio builds a diversified queue from a seed", async () => {
  const { status, body } = await post("/api/radio", { seed_video_id: "mock00000001", limit: 5 });
  assert.equal(status, 200);
  assert.equal(body.mode, "seed");
  assert.equal(body.seed.id, "mock00000001");
  assert.ok(body.tracks.length >= 3);
  assert.ok(!body.tracks.some((t: any) => t.id === "mock00000001"), "seed excluded from queue");
  const ids = body.tracks.map((t: any) => t.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate queue entries");
});

test("POST /api/radio from query mode uses first result as seed", async () => {
  const { status, body } = await post("/api/radio", { query: "midnight", limit: 5 });
  assert.equal(status, 200);
  assert.equal(body.mode, "query");
  assert.ok(body.tracks.length >= 1);
});

test("POST /api/radio rejects empty payloads", async () => {
  const { status } = await post("/api/radio", {});
  assert.equal(status, 400);
});

test("GET /api/recommendations returns a shelf", async () => {
  const { status, body } = await get("/api/recommendations?kind=quick");
  assert.equal(status, 200);
  assert.equal(body.kind, "quick");
  assert.equal(body.personalized, false);
  assert.ok(body.tracks.length >= 1);
});

test("GET /api/track/:id returns detail with related", async () => {
  const { status, body } = await get("/api/track/mock00000001");
  assert.equal(status, 200);
  assert.equal(body.title, "Midnight Mirage");
  assert.ok(Array.isArray(body.related));
});

test("POST /api/events accepts and buffers listening events", async () => {
  const accepted = await post("/api/events", { type: "play", track_id: "mock00000001", listened_ms: 12_345, context: "radio" });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.ok, true);

  const recent = await get("/api/events/recent?limit=5");
  assert.equal(recent.status, 200);
  assert.ok(recent.body.events.length >= 1);
  assert.equal(recent.body.events[0].type, "play");

  const invalid = await post("/api/events", { type: "nonsense", track_id: "x" });
  assert.equal(invalid.status, 400);
});

test("unknown routes return structured 404", async () => {
  const { status, body } = await get("/api/definitely-missing");
  assert.equal(status, 404);
  assert.equal(body.error.code, "NOT_FOUND");
});

/* ── Phase 4: identity + library (local backend) ───────────────────────── */

const DEV = { "x-dev-user": "test-user-1234" };
const FAKE_TRACK = {
  id: "mock00000001",
  source: "ytmusic",
  external_id: "mock00000001",
  title: "Midnight Mirage",
  artists: [{ name: "Nova Arcade" }],
  artist_names: "Nova Arcade",
  duration_sec: 214,
};

test("library requires identity (401 without)", async () => {
  const { status, body } = await get("/api/library/likes");
  assert.equal(status, 401);
  assert.equal(body.error.code, "AUTH_REQUIRED");
});

test("likes: put → list → delete with demo identity", async () => {
  const put = await get("/api/library/likes", {
    method: "PUT",
    headers: { "content-type": "application/json", ...DEV },
    body: JSON.stringify({ track: FAKE_TRACK, kind: "up" }),
  });
  assert.equal(put.status, 200);

  const list = await get("/api/library/likes", { headers: DEV });
  assert.equal(list.status, 200);
  assert.ok(list.body.likes.some((t: any) => t.id === "mock00000001"));

  const del = await get("/api/library/likes/mock00000001", { method: "DELETE", headers: DEV });
  assert.equal(del.status, 200);
  const after = await get("/api/library/likes", { headers: DEV });
  assert.ok(!after.body.likes.some((t: any) => t.id === "mock00000001"));
});

test("playlists: drag reorder persists and validates", async () => {
  const created = await get("/api/library/playlists", {
    method: "POST",
    headers: { "content-type": "application/json", ...DEV },
    body: JSON.stringify({ title: "Reorder me" }),
  });
  const pid = created.body.playlist.id;
  for (const tid of ["mock00000001", "mock00000002", "mock00000003"]) {
    await get(`/api/library/playlists/${pid}/tracks`, {
      method: "POST",
      headers: { "content-type": "application/json", ...DEV },
      body: JSON.stringify({ track: fakeTrack(tid, `Track ${tid.slice(-4)}`, "Reorder Artist") }),
    });
  }
  const before = await get(`/api/library/playlists/${pid}`, { headers: DEV });
  assert.deepEqual(
    before.body.tracks.map((t: any) => t.id),
    ["mock00000001", "mock00000002", "mock00000003"],
  );

  const reordered = await get(`/api/library/playlists/${pid}/tracks/order`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...DEV },
    body: JSON.stringify({ track_ids: ["mock00000003", "mock00000001", "mock00000002"] }),
  });
  assert.equal(reordered.status, 200, JSON.stringify(reordered.body));
  assert.deepEqual(
    reordered.body.tracks.map((t: any) => t.id),
    ["mock00000003", "mock00000001", "mock00000002"],
  );

  // invalid permutations → 400
  const bad = await get(`/api/library/playlists/${pid}/tracks/order`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...DEV },
    body: JSON.stringify({ track_ids: ["mock00000001", "mock00000001", "mock00000002"] }),
  });
  assert.equal(bad.status, 400);
  await get(`/api/library/playlists/${pid}`, { method: "DELETE", headers: DEV });
});

test("playlists: create → add track → get → delete", async () => {
  const created = await get("/api/library/playlists", {
    method: "POST",
    headers: { "content-type": "application/json", ...DEV },
    body: JSON.stringify({ title: "Late Night Drive" }),
  });
  assert.equal(created.status, 201);
  const pid = created.body.playlist.id;
  assert.match(pid, /^[0-9a-f-]{36}$/);

  await get(`/api/library/playlists/${pid}/tracks`, {
    method: "POST",
    headers: { "content-type": "application/json", ...DEV },
    body: JSON.stringify({ track: FAKE_TRACK }),
  });

  const got = await get(`/api/library/playlists/${pid}`, { headers: DEV });
  assert.equal(got.status, 200);
  assert.equal(got.body.meta.title, "Late Night Drive");
  assert.equal(got.body.tracks.length, 1);

  const del = await get(`/api/library/playlists/${pid}`, { method: "DELETE", headers: DEV });
  assert.equal(del.status, 200);
  const gone = await get(`/api/library/playlists/${pid}`, { headers: DEV });
  assert.equal(gone.status, 404);
});

test("events persist into per-user history when identified", async () => {
  const res = await post(
    "/api/events",
    { type: "complete", track_id: "mock00000001", listened_ms: 1000, context: "home" },
    DEV,
  );
  assert.equal(res.status, 202);
  assert.equal(res.body.persisted, true);

  const hist = await get("/api/library/history", { headers: DEV });
  assert.equal(hist.status, 200);
  assert.ok(hist.body.history.length >= 1);
  assert.equal(hist.body.history[0].track.id, "mock00000001");
});

test("events without identity still buffer (not persisted)", async () => {
  const res = await post("/api/events", { type: "play", track_id: "mock00000002" });
  assert.equal(res.status, 202);
  assert.equal(res.body.persisted, false);
});

test("follows: follow → list → unfollow", async () => {
  const put = await get("/api/library/follows", {
    method: "PUT",
    headers: { "content-type": "application/json", ...DEV },
    body: JSON.stringify({ artist: { name: "Nova Arcade", channel_id: "UCmock0000000A" } }),
  });
  assert.equal(put.status, 200);

  const list = await get("/api/library/follows", { headers: DEV });
  assert.ok(list.body.follows.some((a: any) => a.name === "Nova Arcade"));

  const del = await get("/api/library/follows/UCmock0000000A", { method: "DELETE", headers: DEV });
  assert.equal(del.status, 200);
  const after = await get("/api/library/follows", { headers: DEV });
  assert.ok(!after.body.follows.some((a: any) => a.channel_id === "UCmock0000000A"));
});

test("dev identity via Bearer dev: token also accepted", async () => {
  const res = await get("/api/library/likes", {
    headers: { authorization: "Bearer dev:abcdef12-3456" },
  });
  assert.equal(res.status, 200);
});

/* ── Phase 5: downloads + personalized recommendations ─────────────────── */

test("downloads require identity", async () => {
  const { status } = await post("/api/downloads", { video_id: "mock00000001", container: "mp3", quality: "128k" });
  assert.equal(status, 401);
});

test("create download validates quality per container", async () => {
  const bad = await post(
    "/api/downloads",
    { video_id: "mock00000001", container: "mp3", quality: "4k" },
    DEV,
  );
  assert.equal(bad.status, 400);
  const ok = await post(
    "/api/downloads",
    { video_id: "mock00000001", container: "mp3", quality: "128k" },
    DEV,
  );
  assert.equal(ok.status, 201);
  assert.equal(ok.body.job.status, "completed");
  assert.equal(ok.body.job.owner, "dev:test-user-1234");
});

test("list + get + cancel + file download flow", async () => {
  const list = await get("/api/downloads", { headers: DEV });
  assert.equal(list.status, 200);
  assert.ok(list.body.jobs.length >= 1);

  const jobId = "f".repeat(32);
  const single = await get(`/api/downloads/${jobId}`, { headers: DEV });
  assert.equal(single.status, 200);

  const cancel = await get(`/api/downloads/${jobId}`, { method: "DELETE", headers: DEV });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.job.status, "failed");

  const file = await get(`/api/downloads/${jobId}/file?dev_user=test-user-1234`);
  assert.equal(file.status, 200, "file streams via query identity (anchor downloads)");
});

test("SSE progress stream emits initial snapshot", async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/downloads/stream`, { headers: DEV, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("content-type")?.includes("text/event-stream"));
  const reader = res.body!.getReader();
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value);
  assert.ok(text.includes("data: {"), `expected SSE data frame, got: ${text.slice(0, 80)}`);
  assert.ok(text.includes('"jobs"'));
  ctrl.abort();
});

test("listen_again shelf requires identity and personalizes", async () => {
  const anon = await get("/api/recommendations?kind=listen_again");
  assert.equal(anon.status, 401);

  // Seed history via event (persists for dev identity), then read shelf.
  await post(
    "/api/events",
    { type: "complete", track_id: "mock00000001", context: "radio" },
    DEV,
  );
  const shelf = await get("/api/recommendations?kind=listen_again", { headers: DEV });
  assert.equal(shelf.status, 200);
  assert.equal(shelf.body.kind, "listen_again");
  assert.equal(shelf.body.personalized, true);
  assert.ok(shelf.body.tracks.some((t: any) => t.id === "mock00000001"));
});

test("discover shelf carries personalization flag", async () => {
  const shelf = await get("/api/recommendations?kind=discover", { headers: DEV });
  assert.equal(shelf.status, 200);
  assert.equal(shelf.body.kind, "discover");
  assert.equal(typeof shelf.body.personalized, "boolean");
  assert.ok(shelf.body.tracks.length >= 1);
});

test("CORS: Tauri desktop origins pass preflight and read filenames", async () => {
  const pre = await fetch(`${base}/api/downloads`, {
    method: "OPTIONS",
    headers: {
      Origin: "tauri://localhost",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-dev-user",
    },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "tauri://localhost");
  assert.ok(pre.headers.get("access-control-allow-headers")?.toLowerCase().includes("x-dev-user"));
  assert.ok(pre.headers.get("access-control-allow-methods")?.includes("DELETE"));

  const pre2 = await fetch(`${base}/api/health`, {
    method: "OPTIONS",
    headers: { Origin: "http://tauri.localhost", "Access-Control-Request-Method": "GET" },
  });
  assert.equal(pre2.headers.get("access-control-allow-origin"), "http://tauri.localhost");

  const res = await fetch(`${base}/api/downloads`, {
    headers: { Origin: "tauri://localhost" },
  });
  assert.equal(res.headers.get("access-control-allow-origin"), "tauri://localhost");
  assert.equal(res.headers.get("access-control-expose-headers")?.toLowerCase(), "content-disposition");

  // Capacitor Android WebView (origin https://localhost) — same guarantees.
  const pre3 = await fetch(`${base}/api/health`, {
    method: "OPTIONS",
    headers: { Origin: "https://localhost", "Access-Control-Request-Method": "GET" },
  });
  assert.equal(pre3.status, 204);
  assert.equal(pre3.headers.get("access-control-allow-origin"), "https://localhost");
});

test("real resolver client module exports a health probe", () => {
  assert.equal(typeof httpResolver.health, "function");
  assert.equal(typeof httpResolver.streams, "function");
});
