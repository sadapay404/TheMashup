import { test } from "node:test";
import assert from "node:assert/strict";
import type { LyricMatch, Track } from "../types.js";
import { mergeHybrid } from "./hybrid.js";

const track = (id: string, title: string, artist: string, pop = 60): Track => ({
  id,
  source: "ytmusic",
  external_id: id,
  title,
  artists: [{ name: artist }],
  artist_names: artist,
  popularity: pop,
});

const match = (
  id: number,
  track_name: string,
  artist_name: string,
  similarity: number,
): LyricMatch["matches"][number] => ({
  track_name,
  artist_name,
  similarity,
  synced: true,
  plain: true,
  lrclib_id: id,
});

test("merges and interleaves track + lyric rows by score", () => {
  const rows = mergeHybrid(
    [track("a", "Blinding Lights", "The Weeknd")],
    [match(1, "Mystery Tune", "Nobody", 0.9)],
    "city hums in ultraviolet",
  );
  assert.equal(rows.length, 2);
  assert.ok(rows[0].rank_score >= rows[1].rank_score);
  assert.ok(rows.some((r) => r.kind === "track"));
  assert.ok(rows.some((r) => r.kind === "lyric"));
});

test("drops lyric rows duplicating an existing track (case-insensitive)", () => {
  const rows = mergeHybrid(
    [track("a", "Blinding Lights", "The Weeknd")],
    [match(1, "blinding lights", "the weeknd", 0.95)],
    "blinding lights",
  );
  assert.ok(rows.every((r) => r.kind === "track"), "duplicate lyric row removed");
  assert.equal(rows.length, 1);
});

test("low-similarity lyric matches are filtered out", () => {
  const rows = mergeHybrid([], [match(1, "Random Song", "Someone", 0.18)], "totally different");
  assert.equal(rows.length, 0);
});

test("exact metadata query ranks the track first", () => {
  const rows = mergeHybrid(
    [track("a", "Levitating", "Dua Lipa"), track("b", "Levitating Remix", "Other", 99)],
    [],
    "levitating",
  );
  assert.equal(rows[0].kind, "track");
  assert.equal(rows[0].kind === "track" ? rows[0].track.id : null, "a");
});

test("keys are stable and unique-ish for react rendering", () => {
  const rows = mergeHybrid(
    [track("a", "Song A", "X"), track("b", "Song B", "Y")],
    [match(7, "Other Song", "Z", 0.7)],
    "q",
  );
  const keys = rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
});
