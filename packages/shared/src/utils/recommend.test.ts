import { test } from "node:test";
import assert from "node:assert/strict";
import type { Track } from "../types.js";
import {
  listenAgain,
  listenAgainWithLikes,
  tasteVector,
  discoverMix,
  diversify,
  type HeardEntry,
} from "./recommend.js";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const DAY = 86_400_000;

const t = (id: string, artist: string, pop = 50): Track => ({
  id,
  source: "ytmusic",
  external_id: id,
  title: `Song ${id}`,
  artists: [{ name: artist }],
  artist_names: artist,
  popularity: pop,
});

const heard = (track: Track, daysAgo: number): HeardEntry => ({
  track,
  at: new Date(NOW - daysAgo * DAY).toISOString(),
});

test("listenAgain prefers recent over old, dedupes, liked boost", () => {
  const fresh = t("fresh", "Alpha");
  const old = t("old", "Beta");
  const liked = t("liked", "Gamma");
  const out = listenAgain(
    [heard(old, 30), heard(fresh, 1), heard(liked, 10), heard(fresh, 0.2)],
    new Set(["liked"]),
    10,
    NOW,
  );
  assert.equal(out[0].id, "liked", "recent favorite (liked boost) leads");
  const ids = out.map((x) => x.id);
  assert.ok(
    ids.indexOf("fresh") < ids.indexOf("old"),
    "recent plain play outranks a stale one",
  );
  assert.equal(new Set(ids).size, ids.length, "no duplicates");
  assert.ok(ids.includes("old"), "old plays still appear");
});

test("listenAgain caps at limit", () => {
  const many = Array.from({ length: 40 }, (_, i) => heard(t(`t${i}`, `A${i % 5}`), i));
  assert.equal(listenAgain(many, new Set(), 12, NOW).length, 12);
});

test("listenAgainWithLikes injects unplayed favorites", () => {
  const played = heard(t("p1", "Alpha"), 1);
  const fav = t("fav", "Zeta");
  const out = listenAgainWithLikes([played], [t("p1", "Alpha"), fav], 10, NOW);
  assert.ok(out.some((x) => x.id === "fav"), "unplayed like included");
  assert.equal(new Set(out.map((x) => x.id)).size, out.length, "still deduped");
});

test("tasteVector weights liked artists higher", () => {
  const v = tasteVector(
    [heard(t("a1", "Alpha"), 1), heard(t("b1", "Beta"), 1), heard(t("a2", "Alpha"), 2)],
    new Set(["a1"]),
    NOW,
  );
  assert.ok((v.get("alpha") ?? 0) > (v.get("beta") ?? 0));
});

test("discoverMix excludes recently heard when pool allows", () => {
  const heardTrack = t("h1", "Alpha");
  const fresh1 = t("f1", "Beta");
  const fresh2 = t("f2", "Gamma");
  const out = discoverMix({
    history: [heard(heardTrack, 1)],
    likedIds: new Set(),
    candidates: [heardTrack, fresh1, fresh2],
    limit: 2,
    now: NOW,
  });
  assert.ok(!out.some((x) => x.id === "h1"));
  assert.equal(out.length, 2);
});

test("discoverMix relaxes exclusion for thin pools", () => {
  const only = t("only", "Solo");
  const out = discoverMix({
    history: [heard(only, 1)],
    likedIds: new Set(),
    candidates: [only],
    limit: 5,
    now: NOW,
  });
  assert.equal(out.length, 1, "thin pool still yields the track");
});

test("discoverMix respects taste affinity when data exists", () => {
  const favArtist = t("fa", "FavArtist", 30);
  const other = t("ot", "Other", 95);
  const out = discoverMix({
    history: [heard(t("x", "FavArtist"), 1), heard(t("y", "FavArtist"), 2)],
    likedIds: new Set(["x"]),
    candidates: [other, favArtist],
    limit: 2,
    now: NOW,
  });
  assert.equal(out[0].id, "fa", "taste beats raw popularity");
});

test("diversify never leaves adjacent same-artist when avoidable", () => {
  const list = [t("1", "A"), t("2", "A"), t("3", "B"), t("4", "A"), t("5", "C")];
  const out = diversify(list);
  for (let i = 1; i < out.length; i++) {
    if (out[i].artist_names === out[i - 1].artist_names) {
      // allowed only if every remaining candidate shares the artist
      const remaining = out.slice(i);
      assert.ok(remaining.every((x) => x.artist_names === out[i].artist_names));
    }
  }
  assert.equal(out.length, list.length, "diversify keeps all items");
});
