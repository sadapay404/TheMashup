import { test } from "node:test";
import assert from "node:assert/strict";
import type { Track } from "../types.js";
import { buildRadioQueue } from "./radio.js";

function track(id: string, title: string, artist: string): Track {
  return {
    id,
    source: "ytmusic",
    external_id: id,
    title,
    artists: [{ name: artist }],
    artist_names: artist,
  };
}

const seed = track("seed", "Blinding Lights", "The Weeknd");
const pool: Track[] = [
  track("seed", "Blinding Lights", "The Weeknd"), // same id as seed → excluded
  track("t2", "Starboy", "The Weeknd"),
  track("t3", "Save Your Tears", "The Weeknd"),
  track("t4", "Levitating", "Dua Lipa"),
  track("t5", "Don't Start Now", "Dua Lipa"),
  track("t6", "As It Was", "Harry Styles"),
  track("t7", "Flowers", "Miley Cyrus"),
  track("t8", "Cruel Summer", "Taylor Swift"),
];

// Deterministic RNG for reproducible assertions.
let i = 0;
const rng = () => (i++ % 7) / 7;

test("excludes seed and dedupes by id", () => {
  const q = buildRadioQueue(seed, [...pool, ...pool], { limit: 20, rng });
  const ids = q.map((t) => t.id);
  assert.ok(!ids.includes("seed"));
  assert.equal(new Set(ids).size, ids.length, "no duplicates allowed");
});

test("respects the requested limit", () => {
  const q = buildRadioQueue(seed, pool, { limit: 3, rng });
  assert.equal(q.length, 3);
});

test("never repeats the same artist back-to-back when pool allows", () => {
  const q = buildRadioQueue(seed, pool, { limit: 8, rng });
  for (let k = 1; k < q.length; k++) {
    assert.notEqual(
      q[k].artist_names,
      q[k - 1].artist_names,
      `adjacent same-artist tracks at ${k}: ${q[k].title} after ${q[k - 1].title}`,
    );
  }
});

test("handles empty pool and no seed", () => {
  assert.deepEqual(buildRadioQueue(seed, [], { rng }), []);
  const q = buildRadioQueue(undefined, pool, { limit: 4, rng });
  assert.equal(q.length, 4);
  assert.equal(new Set(q.map((t) => t.id)).size, 4);
});
