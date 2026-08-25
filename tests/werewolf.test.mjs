import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  ROLE_INFO,
  SELECTABLE_ROLES,
  buildRoleDeck,
  defaultWolfCount,
  determineWinner,
  maxWolfCount,
  nextNightPhase,
  phaseAfterDawn,
  validateRoleSetup,
  weightedVoteLeaders,
} from "../lib/werewolf.ts";
import { AUDIO_ANNOUNCEMENT_GAP_SECONDS, SECRET_AUDIO_PHASES, WEREWOLF_AUDIO_CUES, WEREWOLF_RECORDED_CUES, WEREWOLF_TRANSITION_CUES, WEREWOLF_WINNER_CUES } from "../lib/werewolf-audio.ts";

test("balanciert Wolfsslots auch für kleine Gruppen", () => {
  assert.equal(defaultWolfCount(3), 1);
  assert.equal(defaultWolfCount(8), 2);
  assert.equal(defaultWolfCount(12), 3);
  assert.equal(maxWolfCount(3), 1);
  assert.equal(maxWolfCount(5), 2);
  assert.equal(maxWolfCount(22), 10);
});

test("validiert Rollenplätze und Abhängigkeiten", () => {
  assert.equal(validateRoleSetup(3, 1, []), null);
  assert.match(validateRoleSetup(4, 1, ["thief", "seer", "witch"]), /Dorfbewohner/);
  assert.match(validateRoleSetup(4, 1, ["piper"]), /erst ab 5/);
  assert.match(validateRoleSetup(6, 1, ["white_werewolf"]), /zwei Wolfsslots/);
  assert.equal(validateRoleSetup(6, 2, ["white_werewolf", "seer"]), null);
});

test("erstellt vollständige Decks mit mindestens einem einfachen Dorfbewohner", () => {
  const deck = buildRoleDeck(8, 2, ["seer", "witch", "white_werewolf"], () => 0);
  assert.equal(deck.length, 8);
  assert.equal(deck.filter((role) => role === "werewolf").length, 1);
  assert.equal(deck.filter((role) => role === "white_werewolf").length, 1);
  assert.ok(deck.includes("villager"));
  assert.ok(deck.includes("seer"));
});

test("mischt den Werwolf unabhängig von der Hostposition bei jeder Partie neu", async () => {
  const shuffledDeck = (choices) => {
    let cursor = 0;
    return buildRoleDeck(3, 1, [], (length) => {
      const choice = choices[cursor++];
      assert.ok(Number.isInteger(choice) && choice >= 0 && choice < length);
      return choice;
    });
  };
  const decks = [shuffledDeck([2, 1]), shuffledDeck([2, 0]), shuffledDeck([0, 1])];
  assert.deepEqual(new Set(decks.map((deck) => deck.indexOf("werewolf"))), new Set([0, 1, 2]));
  assert.notDeepEqual(decks[0], decks[1]);

  const route = await readFile(new URL("../app/api/werwolf/route.ts", import.meta.url), "utf8");
  assert.match(route, /buildRoleDeck\(players\.length, lobby\.wolf_count, roles, secureIndex\)/);
});

test("führt alle auswählbaren Rollen mit eigener Erklärung", () => {
  assert.ok(!SELECTABLE_ROLES.includes("werewolf"));
  assert.ok(!SELECTABLE_ROLES.includes("villager"));
  assert.ok(!SELECTABLE_ROLES.includes("little_girl"));
  for (const role of SELECTABLE_ROLES) {
    assert.ok(ROLE_INFO[role].label.length >= 4);
    assert.ok(ROLE_INFO[role].description.length >= 24);
  }
});

test("zählt Bürgermeisterstimmen doppelt und erkennt Gleichstände", () => {
  const result = weightedVoteLeaders([
    { voterId: "mayor", targetId: "a" },
    { voterId: "b", targetId: "c" },
    { voterId: "c", targetId: "c" },
  ], "mayor");
  assert.deepEqual(new Set(result.leaders), new Set(["a", "c"]));
  assert.equal(result.totals.a, 2);
});

test("prüft die priorisierten Siegbedingungen", () => {
  const state = (id, role, team, alive = true, charmed = false) => ({ id, role, team, alive, charmed });
  assert.equal(determineWinner([state("w", "werewolf", "wolf", false), state("v", "villager", "village")]), "village");
  assert.equal(determineWinner([state("w", "werewolf", "wolf"), state("v", "villager", "village")]), "wolves");
  assert.equal(determineWinner([state("x", "white_werewolf", "solo")]), "white_werewolf");
  assert.equal(determineWinner([state("p", "piper", "solo"), state("v", "villager", "village", true, true), state("w", "werewolf", "wolf", true, true)]), "piper");
});

test("ordnet die Nachtphasen inklusive Weißer Werwölfin", () => {
  const odd = nextNightPhase(["healer", "seer", "witch", "white_werewolf", "piper"], 1);
  assert.deepEqual(odd, ["healer", "seer", "wolves", "witch", "piper"]);
  const even = nextNightPhase(["healer", "seer", "witch", "white_werewolf", "piper"], 2);
  assert.deepEqual(even, ["healer", "seer", "wolves", "witch", "white_werewolf", "piper"]);
});

test("gibt jeder aktiven Rolle ein unverwechselbares Audiosignal", () => {
  const phases = ["thief", "cupid", "wild_child", "healer", "seer", "wolves", "witch", "white_werewolf", "piper", "hunter"];
  const signatures = phases.map((phase) => {
    const cue = WEREWOLF_AUDIO_CUES[phase];
    assert.ok(cue?.length >= 2, `${phase} braucht ein mehrteiliges Signal`);
    return JSON.stringify(cue);
  });
  assert.equal(new Set(signatures).size, phases.length);
});

test("verwendet die gelieferten Werwolf-Ansagen nur für passende aktive Phasen", async () => {
  assert.equal(WEREWOLF_RECORDED_CUES.wolves, "/audio/werwolf/wolves.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.witch, "/audio/werwolf/witch.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.elder, undefined);
  assert.equal(WEREWOLF_RECORDED_CUES.scapegoat, undefined);
  for (const path of [...Object.values(WEREWOLF_RECORDED_CUES), ...Object.values(WEREWOLF_TRANSITION_CUES), ...Object.values(WEREWOLF_WINNER_CUES)]) {
    await access(new URL(`../public${path}`, import.meta.url));
  }
});

test("spielt die neue Ansage einmal je Dorfabstimmungsphase", async () => {
  const votePath = "/audio/werwolf/village-vote.mp3";
  assert.equal(WEREWOLF_RECORDED_CUES.day_vote, votePath);
  assert.equal(WEREWOLF_RECORDED_CUES.runoff, votePath);
  assert.ok(SECRET_AUDIO_PHASES.includes("day_vote"));
  assert.ok(SECRET_AUDIO_PHASES.includes("runoff"));
  await access(new URL(`../public${votePath}`, import.meta.url));
  const pageSource = await readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /\["mayor_vote", "day_vote", "runoff", "hunter"\]\.includes/);
  const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(serviceWorker, /gameson-shell-v6/);
  assert.match(serviceWorker, /\/audio\/werwolf\/village-vote\.mp3/);
});

test("lässt fünf Sekunden zwischen zwei aufeinanderfolgenden Ansagen", async () => {
  assert.equal(AUDIO_ANNOUNCEMENT_GAP_SECONDS, 5);
  const audioSource = await readFile(new URL("../lib/werewolf-audio.ts", import.meta.url), "utf8");
  assert.match(audioSource, /transitionDuration \+ AUDIO_ANNOUNCEMENT_GAP_SECONDS/);
});

test("spielt die neuen Ansagen nur für Dorf- und Rudelsieg", () => {
  assert.equal(WEREWOLF_WINNER_CUES.village, "/audio/werwolf/victory-village.mp3");
  assert.equal(WEREWOLF_WINNER_CUES.wolves, "/audio/werwolf/victory-wolves.mp3");
  assert.equal(WEREWOLF_WINNER_CUES.piper, undefined);
  assert.equal(WEREWOLF_WINNER_CUES.white_werewolf, undefined);
});

test("enthält beide Übergänge zwischen Nacht und Tag", () => {
  assert.equal(phaseAfterDawn("night"), "discussion");
  assert.equal(phaseAfterDawn("day"), "night");
  assert.equal(WEREWOLF_TRANSITION_CUES["night-start"], "/audio/werwolf/night-start.mp3");
  assert.equal(WEREWOLF_TRANSITION_CUES["day-start"], "/audio/werwolf/day-start.mp3");
});
