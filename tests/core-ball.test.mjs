import assert from "node:assert/strict";
import test from "node:test";
import {
  CORE_BALL_COLORS, CORE_BALL_CORE_RADIUS, CORE_BALL_PIN_RADIUS, CORE_BALL_SHOT_MS,
  activeCoreBallPlayer, applyCoreBallAction, canCoreBallHandoff, coreBallAngle, coreBallAngleAt,
  coreBallElapsed, coreBallLevel, coreBallLocalSnapshot, coreBallShotAngle, createCoreBallGame, restoreCoreBallGame,
} from "../lib/core-ball.ts";

const TAU = Math.PI * 2;
const delta = 2 * Math.asin(CORE_BALL_PIN_RADIUS);
const players = [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }, { id: "c", name: "Clara" }];
const start = (mode = "coop") => createCoreBallGame(players, mode, "a", 1000);
const act = (game, action, now = 1000, actor = game.activePlayerId) => applyCoreBallAction(game, actor, { gameId: game.id, attemptId: game.attemptId, turnId: game.turnId, ...action }, now);
const ready = (game = start(), now = 1000) => act(game, { type: "ready" }, now);
const normalize = (angle) => ((angle % TAU) + TAU) % TAU;
const signedDistance = (angle, target) => normalize(angle - target + Math.PI) - Math.PI;
const chord = (a, b) => Math.hypot(Math.cos(a) - Math.cos(b), Math.sin(a) - Math.sin(b));
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);

/** Find an actual future tap time, including the flight, instead of supplying a desired pin angle. */
function shotTime(game, target, earliest = Math.max(game.runningSince ?? 0, game.lockedUntil) + 1) {
  let previousAt = earliest;
  let previous = signedDistance(coreBallShotAngle(game, previousAt), target);
  for (let at = earliest + 25; at < earliest + 60000; at += 25) {
    const current = signedDistance(coreBallShotAngle(game, at), target);
    if (Math.abs(current - previous) < Math.PI && (current === 0 || Math.sign(current) !== Math.sign(previous))) {
      let low = previousAt, high = at;
      for (let iteration = 0; iteration < 45; iteration++) {
        const middle = (low + high) / 2;
        if (Math.sign(signedDistance(coreBallShotAngle(game, middle), target)) === Math.sign(previous)) low = middle;
        else high = middle;
      }
      const firedAt = (low + high) / 2;
      close(chord(coreBallShotAngle(game, firedAt), target), 0, 1e-9);
      return firedAt;
    }
    previousAt = at;
    previous = current;
  }
  assert.fail("Zielwinkel muss in der begrenzten Rotation erreichbar sein");
}

function shootAngle(game, target) {
  const firedAt = shotTime(game, target);
  return act(game, { type: "shoot", firedAt }, firedAt);
}

function fillLevel(game, afterShot) {
  const { initialPins: p, newPins: n } = coreBallLevel(game.level);
  const targets = [];
  for (let gap = 0; gap < p; gap++) {
    const amount = Math.floor(n / p) + (gap < n % p ? 1 : 0);
    for (let pin = 1; pin <= amount; pin++) targets.push(TAU * (gap + pin / (amount + 1)) / p);
  }
  for (const target of targets) {
    game = shootAngle(game, target);
    assert.notEqual(game.lastEvent.type, "collision");
    if (afterShot) game = afterShot(game);
  }
  return game;
}

test("startet mit 4 vorhandenen und 8 neuen Pins, stabilen Farben und bestätigungspflichtigem Zug", () => {
  const game = start();
  assert.equal(CORE_BALL_CORE_RADIUS, 0.35);
  assert.equal(CORE_BALL_SHOT_MS, 150);
  assert.equal(game.phase, "awaiting-ready");
  assert.equal(game.runningSince, null);
  assert.equal(game.attemptId, 1);
  assert.equal(game.turnId, 1);
  assert.equal(game.pins.length, 4);
  assert.equal(game.remaining, 8);
  assert.deepEqual(game.pins.map((pin) => pin.angle), [0, Math.PI / 2, Math.PI, Math.PI * 1.5]);
  assert.deepEqual(game.players.map((player) => player.color), CORE_BALL_COLORS.slice(0, 3));
  assert.equal(activeCoreBallPlayer(game).id, "a");
  assert.deepEqual(game.contributions, { a: 0, b: 0, c: 0 });
  close(coreBallAngle(game, 1000), Math.PI / 4);
});

test("validiert Personenzahl, Identitäten, Namen, Modus und Spielleitung", () => {
  for (const bad of [[], players.slice(0, 1), Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: String(i) })), [{ id: "a", name: "Anna" }, { id: "a", name: "Ben" }], [{ id: "a", name: "Anna" }, { id: "b", name: " ANNA " }], [{ id: "a", name: "" }, players[1]]]) assert.throws(() => createCoreBallGame(bad));
  assert.throws(() => createCoreBallGame(players, "solo"));
  assert.throws(() => createCoreBallGame(players, "coop", "nobody"));
  assert.throws(() => createCoreBallGame(players, "coop", "a", NaN));
  assert.equal(createCoreBallGame([{ id: "a", name: "  Anna   A. " }, players[1]]).players[0].name, "Anna A.");
});

test("generiert endlose geometrisch lösbare Startlayouts mit begrenztem Tempo und Pinzahlen", () => {
  for (const level of [...Array.from({ length: 1000 }, (_, i) => i + 1), 1000000]) {
    const layout = coreBallLevel(level);
    const free = layout.initialPins * (Math.floor((TAU / layout.initialPins - 1e-6) / delta) - 1);
    assert.ok(free >= layout.newPins, `Level ${level} ist geometrisch platzierbar`);
    assert.ok(layout.initialPins >= 4 && layout.initialPins <= 8);
    assert.ok(layout.newPins >= 8 && layout.newPins <= 16);
    assert.ok(layout.f >= 0.22 && layout.f <= 0.4);
  }
  assert.equal(coreBallLevel(25).initialPins, 8);
  assert.equal(coreBallLevel(25).newPins, 16);
  assert.equal(coreBallLevel(9).a, 0);
  assert.equal(coreBallLevel(10).a, 0.25);
  assert.equal(coreBallLevel(16).a, 1.4);
  for (const level of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => coreBallLevel(level));
});

test("Rotation ist analytisch, normalisiert und einschließlich Richtungswechsel im Spitzentempo begrenzt", () => {
  close(coreBallAngleAt(1, 1000), Math.PI / 4 + TAU * 0.22);
  for (const level of [1, 10, 16, 25, 1000000]) {
    const parameters = coreBallLevel(level);
    let reversed = false;
    for (let ms = 0; ms < parameters.T * 1000; ms += 10) {
      const angle = coreBallAngleAt(level, ms);
      assert.ok(angle >= 0 && angle < TAU);
      const speed = signedDistance(coreBallAngleAt(level, ms + 0.01), angle) / 0.00001 / TAU;
      assert.ok(Math.abs(speed) < parameters.f + 1e-5);
      if (speed * parameters.s < -0.001) reversed = true;
    }
    assert.equal(reversed, level >= 16);
  }
});

test("Bereit startet die Rotation; Warten bewegt sie nicht, und Aktionen ändern ihren Eingang nie", () => {
  const waiting = start();
  close(coreBallAngle(waiting, 100000), coreBallAngle(waiting, 1000));
  const saved = structuredClone(waiting);
  const game = ready(waiting, 2000);
  assert.deepEqual(waiting, saved);
  assert.equal(game.phase, "playing");
  assert.equal(game.runningSince, 2000);
  close(coreBallElapsed(game, 2500), 500);
  close(coreBallAngle(game, 3000), coreBallAngleAt(1, 1000));
  assert.throws(() => act(game, { type: "ready" }, 3000), /läuft bereits/);
  assert.throws(() => act(waiting, { type: "shoot", firedAt: 1000 }), /bereit/);
});

test("wertet Schüsse am Auftreffen und anhand der Kugel-Endpunkte aus", () => {
  const game = ready();
  const firedAt = 1000;
  const angle = coreBallShotAngle(game, firedAt);
  close(normalize(angle + coreBallAngle(game, firedAt + 150)), Math.PI / 2);
  game.pins.push({ angle: angle - delta / 2, playerId: "b" });
  game.contributions.b = 1;
  game.remaining--;
  const atFire = normalize(Math.PI / 2 - coreBallAngle(game, firedAt));
  assert.ok(chord(atFire, game.pins.at(-1).angle) > 0.22);
  const next = act(game, { type: "shoot", firedAt }, firedAt);
  assert.equal(next.lastEvent.type, "collision");
  close(next.lastEvent.angle, angle);
  assert.equal(next.lastEvent.at, firedAt);
  assert.equal(next.lockedUntil, firedAt + 150);
});

test("Tangentialkontakt und Kollision über den Winkelnullpunkt zählen als Fehler", () => {
  for (const offset of [0, delta, -delta]) {
    const game = ready();
    const angle = coreBallShotAngle(game, 1000);
    game.pins[0].angle = normalize(angle + offset);
    assert.equal(act(game, { type: "shoot", firedAt: 1000 }).lastEvent.type, "collision");
  }
  const game = ready();
  const firedAt = shotTime(game, TAU - 0.001);
  assert.equal(act(game, { type: "shoot", firedAt }, firedAt).lastEvent.type, "collision");
});

test("erfolgreiche Pins bleiben bei derselben Person und vergeben vor Levelende keine Punkte", () => {
  const game = ready(start("competitive"));
  const snapshot = structuredClone(game);
  const next = shootAngle(game, Math.PI / 6);
  assert.deepEqual(game, snapshot);
  assert.equal(next.activePlayerId, "a");
  assert.equal(next.attemptId, game.attemptId);
  assert.equal(next.turnId, game.turnId);
  assert.equal(next.remaining, 7);
  assert.equal(next.turnHits, 1);
  assert.equal(next.contributions.a, 1);
  assert.equal(next.players[0].score, 0);
  assert.equal(next.lastEvent.type, "shot");
  assert.equal(canCoreBallHandoff(next), true);
});

test("Schussflug sperrt alle Folgeaktionen bis zum Auftreffen, auch Übergabe und Beenden", () => {
  const game = shootAngle(ready(), Math.PI / 6);
  const beforeImpact = game.lockedUntil - 1;
  for (const [action, actor] of [[{ type: "shoot", firedAt: beforeImpact }, "a"], [{ type: "handoff", targetPlayerId: "b" }, "a"], [{ type: "skip-player" }, "a"], [{ type: "finish" }, "a"]]) assert.throws(() => act(game, action, beforeImpact, actor), /angekommen/);
  assert.equal(act(game, { type: "handoff", targetPlayerId: "b" }, game.lockedUntil).activePlayerId, "b");
  assert.throws(() => act(game, { type: "shoot", firedAt: game.lockedUntil - 1 }, game.lockedUntil + 1), /nicht mehr aktuell/);
});

test("Übergabe braucht einen Treffer und friert bis zur Bestätigung der gewählten Person ein", () => {
  assert.throws(() => act(ready(), { type: "handoff", targetPlayerId: "b" }), /zuerst einen Punkt/);
  let game = shootAngle(ready(), Math.PI / 6);
  const at = game.lockedUntil + 200;
  const angle = coreBallAngle(game, at);
  assert.throws(() => act(game, { type: "handoff", targetPlayerId: "a" }, at), /andere Person/);
  assert.throws(() => act(game, { type: "handoff", targetPlayerId: "missing" }, at), /andere Person/);
  const pins = structuredClone(game.pins), contributions = { ...game.contributions };
  const oldTurn = game.turnId;
  game = act(game, { type: "handoff", targetPlayerId: "c" }, at);
  assert.equal(game.activePlayerId, "c");
  assert.equal(game.phase, "awaiting-ready");
  assert.equal(game.turnId, oldTurn + 1);
  assert.equal(game.attemptId, 1);
  assert.equal(game.turnHits, 0);
  assert.deepEqual(game.pins, pins);
  assert.deepEqual(game.contributions, contributions);
  close(coreBallAngle(game, at + 100000), angle);
  assert.throws(() => act(game, { type: "ready" }, at + 1000, "a"), /andere Person/);
  game = ready(game, at + 1000);
  close(coreBallAngle(game, at + 1000), angle);
  assert.equal(canCoreBallHandoff(game), false);
});

test("nur die Spielleitung überspringt die aktive Person ohne Pin-, Beitrags- oder Winkelverlust", () => {
  let game = shootAngle(ready(), Math.PI / 6);
  const at = game.lockedUntil + 1;
  assert.throws(() => act(game, { type: "skip-player" }, at, "b"), /Spielleitung/);
  const before = structuredClone(game), angle = coreBallAngle(game, at);
  game = act(game, { type: "skip-player" }, at, "a");
  assert.equal(game.activePlayerId, "b");
  assert.equal(game.phase, "awaiting-ready");
  assert.equal(game.turnId, before.turnId + 1);
  assert.equal(game.attemptId, before.attemptId);
  assert.deepEqual(game.pins, before.pins);
  assert.deepEqual(game.contributions, before.contributions);
  close(coreBallAngle(game, at + 20000), angle);
  game = act(game, { type: "skip-player" }, at + 20001, "a");
  assert.equal(game.activePlayerId, "c");
});

test("Fehlwürfe wiederholen dasselbe Level beim nächsten Sitz und verwerfen alle unvollendeten Beiträge", () => {
  let game = shootAngle(ready(start("competitive")), Math.PI / 6);
  const firedAt = shotTime(game, 0);
  const before = structuredClone(game);
  game = act(game, { type: "shoot", firedAt }, firedAt);
  assert.equal(game.level, 1);
  assert.equal(game.activePlayerId, "b");
  assert.equal(game.attemptId, 2);
  assert.equal(game.turnId, 2);
  assert.equal(game.phase, "awaiting-ready");
  assert.equal(game.collisions, 1);
  assert.equal(game.remaining, 8);
  assert.equal(game.pins.length, 4);
  assert.deepEqual(game.contributions, { a: 0, b: 0, c: 0 });
  assert.deepEqual(game.players.map((player) => player.score), [0, 0, 0]);
  assert.equal(game.elapsedMs, 0);
  assert.equal(game.runningSince, null);
  assert.throws(() => act(game, { type: "ready" }, game.lockedUntil - 1), /angekommen/);
  assert.equal(before.pins.length, 5);
});

test("Levelerfolg vergibt Wettkampfpunkte für alle Beiträge und startet das nächste Level beim aktiven Nachbarn", () => {
  let game = ready(start("competitive"));
  let shots = 0;
  game = fillLevel(game, (state) => {
    shots++;
    if (shots === 3) {
      const paused = act(state, { type: "handoff", targetPlayerId: "c" }, state.lockedUntil);
      return ready(paused, state.lockedUntil + 100);
    }
    if (shots < 8) assert.deepEqual(state.players.map((player) => player.score), [0, 0, 0]);
    return state;
  });
  assert.equal(game.lastEvent.type, "level-complete");
  assert.equal(game.lastEvent.level, 1);
  assert.equal(game.completedLevels, 1);
  assert.equal(game.level, 2);
  assert.equal(game.activePlayerId, "a", "Nachbar von Clara, nicht vom ursprünglichen Starter");
  assert.equal(game.attemptId, 2);
  assert.equal(game.turnId, 3);
  assert.deepEqual(game.players.map((player) => player.score), [3, 0, 5]);
  assert.deepEqual(game.contributions, { a: 0, b: 0, c: 0 });
  assert.equal(game.phase, "awaiting-ready");
  assert.equal(game.pins.length, 4);
});

test("Koop zählt gemeinsame Level und behält Beiträge ohne persönliches Scoring", () => {
  let game = shootAngle(ready(), Math.PI / 6);
  assert.equal(game.contributions.a, 1);
  assert.equal(game.pins.at(-1).playerId, "a");
  game = ready(act(game, { type: "handoff", targetPlayerId: "b" }, game.lockedUntil), game.lockedUntil + 1);
  for (const angle of [Math.PI / 3, Math.PI * 2 / 3, Math.PI * 5 / 6, Math.PI * 7 / 6, Math.PI * 4 / 3, Math.PI * 5 / 3, Math.PI * 11 / 6]) game = shootAngle(game, angle);
  assert.equal(game.completedLevels, 1);
  assert.deepEqual(game.players.map((player) => player.score), [0, 0, 0]);
});

test("beendet auf Hostwunsch, wertet nur abgeschlossene Level und löst Punktgleichstand als gemeinsame Sieger auf", () => {
  let game = shootAngle(ready(start("competitive")), Math.PI / 6);
  assert.throws(() => act(game, { type: "finish" }, game.lockedUntil, "b"), /Spielleitung/);
  game = act(game, { type: "finish" }, game.lockedUntil, "a");
  assert.equal(game.phase, "finished");
  assert.equal(game.runningSince, null);
  assert.deepEqual(game.result, { winnerIds: ["a", "b", "c"], completedLevels: 0 });
  assert.throws(() => act(game, { type: "ready" }, game.lockedUntil + 1000), /beendet/);
  assert.deepEqual(restoreCoreBallGame(JSON.stringify(game), game.lockedUntil), game);
  const coop = act(start(), { type: "finish" }, 1000);
  assert.deepEqual(coop.result, { winnerIds: [], completedLevels: 0 });
  const won = fillLevel(ready(start("competitive")));
  assert.deepEqual(act(won, { type: "finish" }, won.lockedUntil, "a").result, { winnerIds: ["a"], completedLevels: 1 });
});

test("verwirft veraltete Zug-/Versuchskennungen, fremde Personen und technisch ungültige Schusszeiten ohne Mutation", () => {
  const game = ready();
  const before = structuredClone(game);
  const action = { gameId: game.id, attemptId: game.attemptId, turnId: game.turnId, type: "shoot", firedAt: 1000 };
  for (const overrides of [{ gameId: "other" }, { attemptId: 0 }, { turnId: 0 }, { firedAt: NaN }, { firedAt: Infinity }, { firedAt: 999 }, { firedAt: 1051 }]) assert.throws(() => applyCoreBallAction(game, "a", { ...action, ...overrides }, 1000), /nicht mehr aktuell/);
  assert.throws(() => applyCoreBallAction(game, "missing", action, 1000), /nicht mit/);
  assert.throws(() => applyCoreBallAction(game, "b", action, 1000), /andere Person/);
  assert.throws(() => act(game, { type: "shoot", firedAt: 1999 }, 3000), /nicht mehr aktuell/);
  assert.deepEqual(game, before);
  assert.equal(act(game, { type: "shoot", firedAt: 1050 }, 1000).lastEvent.at, 1050);
  assert.equal(act(game, { type: "shoot", firedAt: 2000 }, 3000).lastEvent.at, 2000);
});

test("gültige Pins erzeugen selbst bei einem danach unlösbaren Restlayout keinen zusätzlichen Fehlwurf", () => {
  const game = ready();
  game.level = 25;
  game.completedLevels = 24;
  game.attemptId = 25;
  game.turnId = 25;
  game.pins = Array.from({ length: 8 }, (_, i) => ({ angle: TAU * i / 8, playerId: null }));
  for (let gap = 0; gap < 7; gap++) for (let point = 1; point <= 2; point++) game.pins.push({ angle: TAU * (gap + point / 3) / 8, playerId: "a" });
  game.contributions.a = 14;
  game.remaining = 2;
  game.turnHits = 14;
  const next = shootAngle(game, TAU * 7.5 / 8);
  assert.equal(next.remaining, 1);
  assert.equal(next.phase, "playing");
  assert.equal(next.lastEvent.type, "shot");
  assert.equal(next.collisions, 0);
  const angles = next.pins.map((pin) => pin.angle).sort((a, b) => a - b);
  const capacity = angles.reduce((sum, angle, i) => sum + Math.max(0, Math.floor(((angles[(i + 1) % angles.length] - angle + TAU) % TAU - 1e-6) / delta) - 1), 0);
  assert.equal(capacity, 0);
});

test("lokaler Snapshot und Restore pausieren dieselbe Person am selben Winkel und behalten die Übergabeberechtigung", () => {
  const game = shootAngle(ready(), Math.PI / 6);
  const at = game.lockedUntil + 100;
  const before = structuredClone(game);
  const snapshot = coreBallLocalSnapshot(game, at);
  assert.deepEqual(game, before);
  assert.equal(snapshot.phase, "awaiting-ready");
  assert.equal(snapshot.runningSince, null);
  assert.equal(snapshot.activePlayerId, game.activePlayerId);
  assert.equal(snapshot.turnId, game.turnId);
  assert.equal(snapshot.attemptId, game.attemptId);
  close(coreBallAngle(snapshot, at + 10000), coreBallAngle(game, at));
  const restored = restoreCoreBallGame(JSON.stringify(snapshot), at + 10000);
  assert.deepEqual(restored, snapshot);
  assert.equal(canCoreBallHandoff(ready(restored, at + 10000)), true);
  const pausedRaw = restoreCoreBallGame(game, at);
  close(coreBallAngle(pausedRaw, at + 10000), coreBallAngle(game, at));
  assert.equal(pausedRaw.phase, "awaiting-ready");
  const extra = { ...snapshot, unboundedHistory: ["ignored"], players: snapshot.players.map((player) => ({ ...player, secret: "ignored" })) };
  assert.deepEqual(restoreCoreBallGame(extra, at), snapshot);
});

test("Restore verwirft beschädigte Zustände, fremde Eigentümer, überlappende Pins und falsche Resultate", () => {
  for (const mutate of [
    (game) => { game.version = 2; }, (game) => { game.level = 0; }, (game) => { game.remaining = 0; },
    (game) => { game.players[0].id = game.players[1].id; }, (game) => { game.players[0].color = "transparent"; },
    (game) => { game.players[0].score = 1; }, (game) => { game.activePlayerId = "missing"; },
    (game) => { game.hostPlayerId = "missing"; }, (game) => { game.attemptId = 3; },
    (game) => { game.elapsedMs = Infinity; }, (game) => { game.runningSince = 1000; },
    (game) => { game.pins[0].angle = NaN; }, (game) => { game.pins[0].angle = TAU; },
    (game) => { game.pins[1].angle = game.pins[0].angle; }, (game) => { game.pins[0].playerId = "missing"; },
    (game) => { game.contributions.a = 1; }, (game) => { game.contributions.extra = 0; },
    (game) => { game.turnHits = 1; }, (game) => { game.result = { winnerIds: [], completedLevels: 0 }; },
    (game) => { game.lastEvent = { id: "bad", type: "shot", at: 1000, playerId: "a", level: 1 }; },
  ]) {
    const game = start(); mutate(game);
    assert.throws(() => restoreCoreBallGame(game, 1000), /nicht gelesen/);
  }
  for (const raw of [null, "kein JSON", "{}", " ".repeat(65537)]) assert.throws(() => restoreCoreBallGame(raw, 1000), /nicht gelesen/);
  const finished = act(start("competitive"), { type: "finish" });
  finished.result.winnerIds = ["missing"];
  assert.throws(() => restoreCoreBallGame(finished, 1000), /nicht gelesen/);
});

test("lange Runden halten nur das aktuelle Level und ein Ereignis statt wachsender Historie vor", () => {
  let game = ready();
  for (let level = 1; level <= 40; level++) {
    game = fillLevel(game);
    assert.equal(game.completedLevels, level);
    assert.equal(game.level, level + 1);
    assert.ok(game.pins.length <= 8);
    assert.ok(JSON.stringify(game).length < 5000);
    assert.equal(Object.hasOwn(game, "history"), false);
    game = restoreCoreBallGame(JSON.stringify(game), game.lockedUntil);
    game = ready(game, game.lockedUntil + 1);
  }
});
