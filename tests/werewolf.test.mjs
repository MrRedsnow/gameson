import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEATH_CAUSE_INFO,
  ROLE_INFO,
  SELECTABLE_ROLES,
  buildRoleDeck,
  countVillageDecisionDeaths,
  defaultWolfCount,
  determineWinner,
  maxWolfCount,
  nextNightPhase,
  parseDeathCauses,
  phaseAfterDawn,
  validateRoleSetup,
  villageGuiltIntensity,
  weightedVoteLeaders,
} from "../lib/werewolf.ts";
import { AUDIO_ANNOUNCEMENT_GAP_SECONDS, WEREWOLF_AUDIO_CUES, WEREWOLF_AUDIO_PHASES, WEREWOLF_RECORDED_CUES, WEREWOLF_TRANSITION_CUES, WEREWOLF_WINNER_CUES } from "../lib/werewolf-audio.ts";

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

test("führt jede Todesart mit öffentlicher Erklärung und sicherer Persistenz", () => {
  const causes = ["wolf_attack", "witch_poison", "white_werewolf", "village_vote", "scapegoat", "hunter_shot", "heartbreak"];
  assert.deepEqual(Object.keys(DEATH_CAUSE_INFO), causes);
  assert.ok(causes.every((cause) => DEATH_CAUSE_INFO[cause].label.length >= 18));
  assert.deepEqual(parseDeathCauses(JSON.stringify(["wolf_attack", "witch_poison", "unknown"])), ["wolf_attack", "witch_poison"]);
  assert.deepEqual(parseDeathCauses("kein JSON"), []);
});

test("zählt die gemeinschaftlich verursachten Dorf-Tode genau einmal pro Opfer", () => {
  assert.equal(countVillageDecisionDeaths([]), 0);
  assert.equal(countVillageDecisionDeaths([
    { deathCauses: ["village_vote"] },
    { deathCauses: ["scapegoat", "heartbreak"] },
    { deathCauses: ["village_vote", "scapegoat"] },
    { deathCauses: ["wolf_attack"] },
    { deathCauses: ["witch_poison", "hunter_shot"] },
  ]), 3);
});

test("rechnet nur die durch ein Dorfurteil ausgelösten Liebestode der Dorfschuld zu", () => {
  assert.equal(countVillageDecisionDeaths([
    { deathCauses: ["village_vote"] },
    { deathCauses: ["heartbreak", "village_vote"] },
    { deathCauses: ["heartbreak"] },
  ]), 2);
  assert.equal(countVillageDecisionDeaths([
    { deathCauses: ["wolf_attack"] },
    { deathCauses: ["heartbreak"] },
  ]), 0);
});

test("steigert die Blutschuld mit jedem weiteren Dorf-Tod ohne harte Obergrenze", () => {
  assert.equal(villageGuiltIntensity(0), 0);
  let previous = villageGuiltIntensity(1);
  for (let deaths = 2; deaths <= 22; deaths += 1) {
    const current = villageGuiltIntensity(deaths);
    assert.ok(current > previous, `Tod ${deaths} muss den Rand weiter verdichten`);
    previous = current;
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
  assert.equal(WEREWOLF_RECORDED_CUES.role_reveal, "/audio/werwolf/role-reveal.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.mayor_vote, "/audio/werwolf/mayor-vote.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.healer, "/audio/werwolf/healer.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.wolves, "/audio/werwolf/wolves.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.witch, "/audio/werwolf/witch.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.white_werewolf, "/audio/werwolf/white-werewolf.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.piper, "/audio/werwolf/piper.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.discussion, "/audio/werwolf/discussion-start.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.day_vote, "/audio/werwolf/day-vote.mp3");
  assert.equal(WEREWOLF_RECORDED_CUES.runoff, "/audio/werwolf/runoff.mp3");
  for (const phase of Object.keys(WEREWOLF_RECORDED_CUES)) assert.ok(WEREWOLF_AUDIO_PHASES.includes(phase), `${phase} muss automatisch abgespielt werden können`);
  assert.equal(WEREWOLF_RECORDED_CUES.elder, undefined);
  assert.equal(WEREWOLF_RECORDED_CUES.scapegoat, undefined);
  for (const path of [...Object.values(WEREWOLF_RECORDED_CUES), ...Object.values(WEREWOLF_TRANSITION_CUES), ...Object.values(WEREWOLF_WINNER_CUES)]) {
    await access(new URL(`../public${path}`, import.meta.url));
  }
});

test("verwendet standardmäßig drei Sekunden zwischen zwei aufeinanderfolgenden Ansagen", async () => {
  assert.equal(AUDIO_ANNOUNCEMENT_GAP_SECONDS, 3);
  const audioSource = await readFile(new URL("../lib/werewolf-audio.ts", import.meta.url), "utf8");
  assert.match(audioSource, /transitionDuration \+ gapSeconds/);
});

test("macht die Redepause in beiden Spielmodi einstellbar und speichert sie je Lobby", async () => {
  const [pageSource, routeSource, schemaSource] = await Promise.all([
    readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/werwolf/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(pageSource.match(/<strong>Redepause<\/strong>/g)?.length, 2);
  assert.match(pageSource, /audioGapSeconds/);
  assert.match(routeSource, /audio_gap_seconds/);
  assert.match(schemaSource, /audioGapSeconds: integer\("audio_gap_seconds"\)\.notNull\(\)\.default\(3\)/);
});

test("spielt für jede mögliche Siegerpartei eine eigene Ansage", () => {
  assert.equal(WEREWOLF_WINNER_CUES.village, "/audio/werwolf/victory-village.mp3");
  assert.equal(WEREWOLF_WINNER_CUES.wolves, "/audio/werwolf/victory-wolves.mp3");
  assert.equal(WEREWOLF_WINNER_CUES.piper, "/audio/werwolf/victory-piper.mp3");
  assert.equal(WEREWOLF_WINNER_CUES.white_werewolf, "/audio/werwolf/victory-white-werewolf.mp3");
});

test("enthält beide Übergänge zwischen Nacht und Tag", () => {
  assert.equal(phaseAfterDawn("night"), "discussion");
  assert.equal(phaseAfterDawn("day"), "night");
  assert.equal(WEREWOLF_TRANSITION_CUES["night-start"], "/audio/werwolf/night-start.mp3");
  assert.equal(WEREWOLF_TRANSITION_CUES["day-start"], "/audio/werwolf/day-start.mp3");
  assert.equal(WEREWOLF_TRANSITION_CUES["day-resolution"], "/audio/werwolf/day-resolution.mp3");
});
