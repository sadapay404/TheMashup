import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, similarity, exactBoost, matchScore } from "./fuzzy.js";

test("normalize strips case, punctuation and diacritics", () => {
  assert.equal(normalize('Blinding Lights!'), "blinding lights");
  assert.equal(normalize("Beyoncé's  Déjà Vu"), "beyonce s deja vu");
  assert.equal(normalize("  spaced   out  "), "spaced out");
});

test("similarity is order-insensitive and bounded", () => {
  assert.equal(similarity("blinding lights", "lights blinding"), 1);
  // "lights" vs "light" are distinct tokens → Dice = 0.5, still well above noise
  assert.ok(similarity("blinding lights", "blinding light") > 0.4);
  assert.ok(similarity("blinding lights", "blinding light") < 1);
  assert.ok(similarity("blinding lights", "bohemian rhapsody") < 0.2);
  assert.equal(similarity("anything", ""), 0);
});

test("exactBoost rewards equality and containment", () => {
  assert.equal(exactBoost("Hello", "hello"), 1);
  assert.ok(exactBoost("Hello", "Hello World") === 0.6);
  assert.equal(exactBoost("Hello", "Goodbye"), 0);
});

test("matchScore ranks true matches above unrelated text", () => {
  const good = matchScore("never gonna give you up", "Never Gonna Give You Up - Rick Astley");
  const bad = matchScore("never gonna give you up", "Blinding Lights - The Weeknd");
  assert.ok(good > 0.6, `expected good > 0.6, got ${good}`);
  assert.ok(bad < good - 0.3, `expected bad << good (${bad} vs ${good})`);
});
