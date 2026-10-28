import { test } from "node:test";
import assert from "node:assert/strict";
import type { Track } from "@themashup/shared";
import { enqueue, removeAt, moveItem } from "./queueLogic.js";

const t = (id: string): Track => ({
  id,
  source: "ytmusic",
  external_id: id,
  title: id,
  artists: [{ name: "A" }],
  artist_names: "A",
});

const Q = [t("a"), t("b"), t("c")];

test("enqueue end appends without touching cursor", () => {
  const r = enqueue(Q, 1, t("d"), "end");
  assert.deepEqual(r.queue.map((x) => x.id), ["a", "b", "c", "d"]);
  assert.equal(r.cursor, 1);
  assert.equal(r.insertedAt, 3);
});

test("enqueue next inserts right after cursor", () => {
  const r = enqueue(Q, 1, t("d"), "next");
  assert.deepEqual(r.queue.map((x) => x.id), ["a", "b", "d", "c"]);
  assert.equal(r.cursor, 1);
  assert.equal(r.insertedAt, 2);
});

test("enqueue next on empty queue", () => {
  const r = enqueue([], -1, t("a"), "next");
  assert.equal(r.queue.length, 1);
  assert.equal(r.cursor, -1);
});

test("removeAt before cursor shifts cursor left", () => {
  const r = removeAt(Q, 2, 0);
  assert.deepEqual(r.queue.map((x) => x.id), ["b", "c"]);
  assert.equal(r.cursor, 1);
  assert.equal(r.removedCurrent, false);
});

test("removeAt current keeps valid cursor", () => {
  const r = removeAt(Q, 1, 1);
  assert.deepEqual(r.queue.map((x) => x.id), ["a", "c"]);
  assert.equal(r.cursor, 1); // now points at 'c'
  assert.equal(r.removedCurrent, true);
});

test("removeAt current at end clamps", () => {
  const r = removeAt(Q, 2, 2);
  assert.equal(r.queue.length, 2);
  assert.equal(r.cursor, 1);
});

test("moveItem preserves which track is current", () => {
  const r = moveItem(Q, 0, 2, 0);
  assert.deepEqual(r.queue.map((x) => x.id), ["b", "c", "a"]);
  assert.equal(r.cursor, 2, "cursor follows the moved current track");
});

test("moveItem across cursor adjusts cursor", () => {
  const r = moveItem(Q, 0, 2, 1);
  assert.equal(r.cursor, 0, "cursor slides left when another item moves past it");
});
