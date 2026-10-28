import { test } from "node:test";
import assert from "node:assert/strict";
import { nextIndex, prevIndex, insertPosition, type QueueSnapshot } from "./playbackLogic.js";

const base: QueueSnapshot = { index: 0, length: 5, shuffle: false, repeat: "off" };

test("natural progression walks the queue", () => {
  assert.equal(nextIndex({ ...base, index: 1 }, { manual: false }), 2);
  assert.equal(nextIndex({ ...base, index: 4 }, { manual: false }), null, "end stops when repeat off");
});

test("repeat all wraps, manual skip wraps too", () => {
  assert.equal(nextIndex({ ...base, index: 4, repeat: "all" }, { manual: false }), 0);
  assert.equal(nextIndex({ ...base, index: 4 }, { manual: true }), 0);
});

test("repeat one replays on natural end but manual skip advances", () => {
  assert.equal(nextIndex({ ...base, index: 2, repeat: "one" }, { manual: false }), 2);
  assert.equal(nextIndex({ ...base, index: 2, repeat: "one" }, { manual: true }), 3);
});

test("shuffle never returns the same index", () => {
  for (let i = 0; i < 20; i++) {
    const n = nextIndex({ ...base, index: 2, shuffle: true }, { manual: false, rng: Math.random });
    assert.ok(n !== null && n !== 2);
  }
});

test("single-track queue behaves", () => {
  assert.equal(nextIndex({ ...base, length: 1 }, { manual: false }), null);
  assert.equal(nextIndex({ ...base, length: 1, repeat: "all" }, { manual: false }), 0);
  assert.equal(prevIndex({ ...base, length: 1 }), 0);
});

test("prev wraps backwards only when allowed", () => {
  assert.equal(prevIndex({ ...base, index: 0 }), 0, "repeat off + at start stays");
  assert.equal(prevIndex({ ...base, index: 0, repeat: "all" }), 4);
  assert.equal(prevIndex({ ...base, index: 3 }), 2);
});

test("insert positions", () => {
  assert.equal(insertPosition(5, 2, "next"), 3);
  assert.equal(insertPosition(5, 2, "end"), 5);
  assert.equal(insertPosition(0, -1, "next"), 0);
});
