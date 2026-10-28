import { test } from "node:test";
import assert from "node:assert/strict";
import type { Track } from "../types.js";
import { rankSearchResults } from "./rank.js";
import { parseLrc, formatDuration } from "./format.js";

function track(id: string, title: string, artist: string, popularity = 50): Track {
  return {
    id,
    source: "ytmusic",
    external_id: id,
    title,
    artists: [{ name: artist }],
    artist_names: artist,
    popularity,
  };
}

test("exact title matches outrank fuzzy ones", () => {
  const tracks = [
    track("a", "Shape of You", "Ed Sheeran"),
    track("b", "Shape of You (Remix)", "Various"),
    track("c", "Perfect", "Ed Sheeran", 99),
  ];
  const ranked = rankSearchResults(tracks, "shape of you");
  assert.equal(ranked[0].id, "a");
});

test("lyric-derived similarity boosts ranking", () => {
  const tracks = [
    track("a", "Mystery Song", "Nobody", 10),
    track("b", "Levitating", "Dua Lipa"),
  ];
  const lyricIds = new Map([[ "b", { similarity: 0.95, snippet: "text" } ]]);
  const ranked = rankSearchResults(tracks, "i got levi tating in the dark for you", { lyricIds });
  assert.equal(ranked[0].id, "b");
});

test("parseLrc handles timestamps, metadata and sorting", () => {
  const lrc = [
    "[ar:Artist]",
    "[00:12.50]first line",
    "[00:03.1]early line",
    "[01:02:50]bad tag ignored? no — hh:mm:ss not matched",
    "[00:20.00][00:40.00]chorus",
  ].join("\n");
  const lines = parseLrc(lrc);
  assert.equal(lines[0].text, "early line");
  assert.equal(lines[0].time, 3.1);
  assert.equal(lines[1].text, "first line");
  assert.equal(lines[1].time, 12.5);
  const chorus = lines.filter((l) => l.text === "chorus");
  assert.equal(chorus.length, 2, "multi-tag lines expand");
  assert.ok(lines.every((l, idx) => idx === 0 || l.time >= lines[idx - 1].time));
});

test("formatDuration renders m:ss and h:mm:ss", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3661), "1:01:01");
  assert.equal(formatDuration(undefined), "0:00");
});
