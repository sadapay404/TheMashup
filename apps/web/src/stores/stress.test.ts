/**
 * Phase 6 stress tests — leak & correctness under churn (no DOM required).
 *
 * Covers the architecture's "verified in Phase 6 stress tests" claims:
 *  - SSE stream client: split-chunk frame parsing, ping skip, abort semantics
 *  - downloadsStore: single stream instance under rapid ensure/stop churn,
 *    bounded job map (replace-in-place, never accumulate)
 *  - recommendation engine: thousands of history entries, bounded output time
 *  - queue invariants across long deterministic shuffle runs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DownloadJob, Track } from "@themashup/shared";
import { listenAgainWithLikes, discoverMix } from "@themashup/shared";
import { api } from "../lib/api.js";
import { useDownloadsStore, activeJobs, doneJobs } from "./downloadsStore.js";
import { nextIndex, type QueueSnapshot } from "../engine/playbackLogic.js";

/* ────────────────────────── helpers ────────────────────────── */

const track = (i: number): Track =>
  ({
    id: `stress${String(i).padStart(6, "0")}`,
    source: "ytdlp",
    external_id: `stress${i}`,
    title: `Track ${i}`,
    artists: [],
    artist_names: `Artist ${i % 40}`,
    duration_sec: 180,
    popularity: i % 100,
  }) as unknown as Track;

const job = (id: string, status: DownloadJob["status"]): DownloadJob =>
  ({
    id,
    video_id: id,
    title: id,
    container: "mp3",
    quality: "128k",
    status,
    progress: status === "completed" ? 100 : 10,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_001,
  }) as DownloadJob;

/* ────────────────────── 1. SSE stream client ────────────────────── */

test("stress: SSE parser handles 17-byte split chunks without losing frames", async () => {
  const frames: string[] = [];
  for (let i = 0; i < 120; i++) {
    frames.push(`data: {"jobs":[{"id":"j${i}"}]}\n\n`);
    if (i % 10 === 0) frames.push(`: ping\n\n`); // comment frames must be skipped
  }
  const bytes = new TextEncoder().encode(frames.join(""));
  // Slice on a deliberately odd width so frame boundaries never align.
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += 17) chunks.push(bytes.slice(i, i + 17));

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch);
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;

  try {
    const seen: string[][] = [];
    const errors: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      const cancel = api.downloads.stream(
        (jobs) => seen.push(jobs.map((j) => j.id)),
        () => errors.push(new Error("stream error")),
      );
      // Resolve when the reader drains: poll the collected frames.
      const t = setInterval(() => {
        if (seen.length >= 120) {
          clearInterval(t);
          cancel();
          resolve();
        }
      }, 5);
      setTimeout(() => {
        clearInterval(t);
        reject(new Error(`stream stalled at ${seen.length}/120 frames`));
      }, 3000);
    });
    assert.equal(seen.length, 120, "every data frame parsed exactly once");
    assert.equal(seen[0][0], "j0");
    assert.equal(seen[119][0], "j119");
    assert.equal(errors.length, 0, "healthy stream never errors");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("stress: aborting the SSE stream cancels quietly (no error callback)", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        // Never closes — only the abort ends it.
        signal?.addEventListener("abort", () =>
          c.error(new DOMException("The operation was aborted", "AbortError")),
        );
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;

  try {
    let errorCount = 0;
    const cancel = api.downloads.stream(
      () => undefined,
      () => errorCount++,
    );
    await new Promise((r) => setTimeout(r, 20));
    cancel(); // AbortController.abort() → reader rejects with AbortError
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(errorCount, 0, "AbortError must not be reported as stream failure");
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ─────────────────── 2. downloadsStore instance churn ─────────────────── */

test("stress: ensureStream under 50× churn keeps exactly one live stream", () => {
  const original = api.downloads.stream;
  let starts = 0;
  let cancels = 0;
  try {
    api.downloads.stream = (onSnapshot) => {
      starts++;
      void onSnapshot;
      return () => {
        cancels++;
      };
    };
    const s = useDownloadsStore.getState();
    for (let i = 0; i < 50; i++) s.ensureStream();
    assert.equal(starts, 1, "repeated ensure must not fan out streams");
    assert.equal(useDownloadsStore.getState().connected, true);

    useDownloadsStore.getState().stopStream();
    useDownloadsStore.getState().stopStream();
    assert.equal(cancels, 1, "double stop must cancel once");

    useDownloadsStore.getState().ensureStream();
    assert.equal(starts, 2, "stream restarts after stop");
    useDownloadsStore.getState().stopStream();
    assert.equal(cancels, 2);
    assert.equal(useDownloadsStore.getState().connected, false);
  } finally {
    api.downloads.stream = original;
  }
});

test("stress: 30× replace with 1000 jobs never accumulates", () => {
  const s = useDownloadsStore.getState();
  for (let round = 0; round < 30; round++) {
    s.setJobs(
      Array.from({ length: 1000 }, (_, i) => job(`r${round}-${i}`, round % 2 === 0 ? "completed" : "downloading")),
    );
  }
  const keys = Object.keys(useDownloadsStore.getState().jobs);
  assert.equal(keys.length, 1000, "map mirrors latest snapshot exactly");
  assert.ok(keys.every((k) => k.startsWith("r29-")), "stale rounds fully replaced");

  const st = useDownloadsStore.getState();
  assert.equal(activeJobs(st.jobs).length, 1000);
  assert.equal(doneJobs(st.jobs).length, 0);
  st.setJobs([job("a", "completed"), job("b", "queued")]);
  assert.equal(doneJobs(useDownloadsStore.getState().jobs).length, 1);
  assert.equal(activeJobs(useDownloadsStore.getState().jobs).length, 1);
});

test("stress: 100 rapid create calls upsert by id without clobbering", async () => {
  const originalCreate = api.downloads.create;
  const originalStream = api.downloads.stream;
  try {
    api.downloads.create = (async (body: { video_id: string; container: string; quality: string }) => ({
      job: { ...job(body.video_id, "queued"), video_id: body.video_id, container: body.container, quality: body.quality },
    })) as typeof api.downloads.create;
    api.downloads.stream = (() => () => undefined) as typeof api.downloads.stream;

    const s = useDownloadsStore.getState();
    s.setJobs([]); // isolate from previous tests' snapshots
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => s.create({ id: `bulk${i}`, title: `Bulk ${i}` }, "mp3", "128k")),
    );
    const keys = Object.keys(useDownloadsStore.getState().jobs);
    assert.equal(keys.length, 100);
    assert.equal(keys.filter((k) => k.startsWith("bulk")).length, 100);
  } finally {
    api.downloads.create = originalCreate;
    api.downloads.stream = originalStream;
    useDownloadsStore.getState().clearBanner();
    useDownloadsStore.getState().setJobs([]);
  }
});

/* ──────────────── 3. recommendation engine at scale ──────────────── */

test("stress: listenAgain + discoverMix over 5k plays stay bounded & fast", () => {
  const history = Array.from({ length: 5_000 }, (_, i) => ({
    track: track(i),
    at: new Date(Date.now() - i * 60_000).toISOString(),
    context: "radio",
  }));
  const likes = Array.from({ length: 200 }, (_, i) => track(i));
  const likedIds = new Set(likes.map((t) => t.id));

  const t0 = Date.now();
  const again = listenAgainWithLikes(history, likes, 24);
  const mix = discoverMix({
    history,
    likedIds,
    candidates: Array.from({ length: 800 }, (_, i) => track(10_000 + i)),
    limit: 24,
  });
  const elapsed = Date.now() - t0;

  assert.ok(again.length > 0 && again.length <= 24);
  assert.ok(mix.length > 0 && mix.length <= 24);
  // Same-artist adjacency must never survive the diversify pass.
  for (let i = 1; i < mix.length; i++) {
    assert.notEqual(mix[i].artist_names, mix[i - 1].artist_names, `adjacent dupes at ${i}`);
  }
  assert.ok(elapsed < 2_000, `engine churn took ${elapsed}ms`);
});

/* ──────────────────── 4. queue invariant churn ──────────────────── */

test("stress: 50k deterministic shuffle steps keep index invariants", () => {
  let seed = 0x2545f491;
  const rng = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0xffffffff;
  };
  const state: QueueSnapshot = { index: 0, length: 40, shuffle: true, repeat: "context" };
  let idx = 0;
  for (let i = 0; i < 50_000; i++) {
    const manual = rng() < 0.3;
    const next = nextIndex({ ...state, index: idx }, { manual, rng });
    assert.ok(next === null || (next >= 0 && next < 40), `out-of-range index ${next} at step ${i}`);
    if (next !== null) idx = next;
  }
  assert.ok(idx >= 0 && idx < 40);
});
