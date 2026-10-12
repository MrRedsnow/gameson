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
  const categories = new Map(CATEGORIES.filter((item) => !["random", "custom"].includes(item.id)).map((item) => [item.id, item]));
  const seen = new Set();
  for (const pair of WORD_PAIRS) {
    for (const word of [pair.crew, pair.imposter]) {
      assert.ok(word.length >= 2 && word.length <= 40, word);
      assert.equal(word, word.trim(), word);
    }
    assert.notEqual(normalizeName(pair.crew), normalizeName(pair.imposter));
    assert.ok(categories.has(pair.category), pair.category);
    assert.equal(pair.rating, categories.get(pair.category).rating, pair.category);
    const key = JSON.stringify([normalizeName(pair.crew), normalizeName(pair.imposter)].sort());
    assert.ok(!seen.has(key), `Doppeltes Wortpaar: ${pair.crew} / ${pair.imposter}`);
    seen.add(key);
  }
  for (const category of categories.values()) {
    assert.ok(WORD_PAIRS.filter((pair) => pair.category === category.id).length >= 100, category.id);
  }
});

test("normalisiert Gruppen- und Spielernamen stabil", () => {
  assert.equal(normalizeName("  Die   Runde  "), "die runde");
  assert.equal(normalizeName("WOHNZIMMER"), "wohnzimmer");
});

test("Imposterwörter verraten keinen gemeinsamen Hauptbestandteil", () => {
  // Guard lexical giveaways; semantic distance still needs editorial review.
  const stems = [
    "foto", "date", "sex", "kuss", "party", "spiel", "vibrator", "dildo", "plug", "piercing", "fetisch", "hotel", "club", "bar", "brust", "penis", "beziehung",
    "bier", "wein", "kaffee", "cocktail", "salat", "kuchen", "brot", "milch", "saft", "reis", "soße", "schokolade",
    "maschine", "gerät", "automat", "schlüssel", "helm", "handschuh", "schuh", "tasche", "korb", "brief", "haus", "zimmer", "stuhl", "brille", "jacke", "kasten", "stift", "schirm",
    "wasser", "schlaf", "garten", "tanz", "film", "kino", "buch", "stern", "tier", "maus", "katze", "hund", "pferd", "bär", "fisch", "vogel", "schwimm", "wander",
  ];
  for (const pair of WORD_PAIRS) {
    const crew = normalizeName(pair.crew);
    const imposter = normalizeName(pair.imposter);
    const label = `${pair.crew} / ${pair.imposter}`;
    assert.ok(!(crew.length >= 4 && imposter.includes(crew)), label);
    assert.ok(!(imposter.length >= 4 && crew.includes(imposter)), label);
    for (const stem of stems) {
      assert.ok(!(crew.includes(stem) && imposter.includes(stem)), `${label}: ${stem}`);
    }
  }
});
