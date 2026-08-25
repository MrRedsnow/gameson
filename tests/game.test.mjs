import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORIES, WORD_PAIRS, defaultImposterCount, maxImposterCount, normalizeName } from "../lib/game.ts";

test("wählt die sinnvolle Standardanzahl an Impostern", () => {
  assert.equal(defaultImposterCount(3), 1);
  assert.equal(defaultImposterCount(7), 1);
  assert.equal(defaultImposterCount(8), 2);
  assert.equal(defaultImposterCount(12), 2);
  assert.equal(defaultImposterCount(13), 3);
  assert.equal(defaultImposterCount(18), 4);
  assert.equal(defaultImposterCount(22), 4);
});

test("erlaubt nie die Hälfte der Gruppe als Imposter", () => {
  assert.equal(maxImposterCount(3), 1);
  assert.equal(maxImposterCount(4), 1);
  assert.equal(maxImposterCount(8), 3);
  assert.equal(maxImposterCount(22), 10);
});

test("Wortpaare sind vollständig, verschieden und korrekt eingestuft", () => {
  const categoryIds = new Set(CATEGORIES.map((item) => item.id));
  assert.ok(WORD_PAIRS.length >= 60);
  for (const pair of WORD_PAIRS) {
    assert.ok(pair.crew.length >= 2);
    assert.ok(pair.imposter.length >= 2);
    assert.notEqual(normalizeName(pair.crew), normalizeName(pair.imposter));
    assert.ok(categoryIds.has(pair.category));
    assert.ok(pair.rating === "family" || pair.rating === "adult");
  }
  assert.ok(WORD_PAIRS.some((pair) => pair.rating === "adult"));
  assert.ok(WORD_PAIRS.filter((pair) => pair.rating === "family").every((pair) => pair.rating !== "adult"));
});

test("normalisiert Gruppen- und Spielernamen stabil", () => {
  assert.equal(normalizeName("  Die   Runde  "), "die runde");
  assert.equal(normalizeName("WOHNZIMMER"), "wohnzimmer");
});
