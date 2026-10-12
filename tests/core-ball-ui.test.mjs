import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = new URL("../", import.meta.url).pathname;
const output = resolve(root, `.wrangler/test-artifacts/core-ball-ui-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({ stdin: { contents: 'export * from "./components/core-ball/game-ui"; export * from "./components/core-ball/board"; export * from "./lib/core-ball";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent" });
after(() => rm(output, { force: true }));
const { CoreBallGameUI, CoreBallBoard, CoreBallRulesContent, coreBallInputAllowed, coreBallRemoteFlight, coreBallFlightRemaining, createCoreBallGame, applyCoreBallAction, coreBallLocalSnapshot, restoreCoreBallGame } = createRequire(import.meta.url)(output);
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const players = ["Anna", "Ben", "Clara", "David", "Eva"].map((name, i) => ({ id: String(i), name }));
const start = (mode = "coop") => createCoreBallGame(players, mode, "0", 1000);
const action = (game, type, extra = {}) => ({ type, gameId: game.id, attemptId: game.attemptId, turnId: game.turnId, ...extra });
const playing = (mode = "coop") => { const game = start(mode); return applyCoreBallAction(game, "0", action(game, "ready"), 1000); };
const props = (game, meId = "0") => ({ game, meId, now: () => 1000, onAction: async () => true, onRematch() {} });
const shootButton = (html) => html.match(/<button[^>]*aria-label="Kugel setzen"[^>]*>/)?.[0];
const boardButton = (html) => html.match(/<button[^>]*aria-label="Kugel setzen – Spielfeld"[^>]*>/)?.[0];

test("eine Runde wartet beim Start auf die erste Person und zeigt die gesamte Crew", () => {
  const game = start(); const mine = render(CoreBallGameUI, props(game));
  assert.match(mine, /Anna ist dran/); assert.match(mine, /Dein Kreis wartet/); assert.match(mine, />Bereit</);
  for (const player of players) assert.match(mine, new RegExp(player.name));
  assert.match(boardButton(mine), /disabled=""/);
  const guest = render(CoreBallGameUI, props(game, "1"));
  assert.match(guest, /Anna übernimmt/); assert.match(guest, /Warten auf Anna/);
  assert.match(guest.match(/<button[^>]*disabled=""[^>]*>Warten auf Anna/)?.[0], /disabled=""/);
  const local = render(CoreBallGameUI, { ...props(game), local: true }); assert.match(local, /Weitergeben an Anna/);
});

test("nur aktive, verbundene und zeitlich abgeglichene Personen können schießen", () => {
  const game = playing(); const mine = render(CoreBallGameUI, props(game));
  assert.doesNotMatch(shootButton(mine), /disabled=""/); assert.doesNotMatch(boardButton(mine), /disabled=""/);
  assert.match(mine, /8.*KUGELN ÜBRIG/);
  for (const overrides of [{ meId: "1" }, { connected: false }, { clockReady: false }, { busy: true }]) {
    const html = render(CoreBallGameUI, { ...props(game), ...overrides });
    assert.match(shootButton(html), /disabled=""/); assert.match(boardButton(html), /disabled=""/);
  }
  assert.equal(coreBallInputAllowed(game, "0", false, false, true, true, 1000), true);
  assert.equal(coreBallInputAllowed(game, "1", false, false, true, true, 1000), false);
  assert.equal(coreBallInputAllowed(game, "1", true, false, true, true, 1000), true);
  for (const args of [[true, true, true, 1000, false], [false, false, true, 1000, false], [false, true, false, 1000, false], [false, true, true, 1000, true]]) {
    assert.equal(coreBallInputAllowed(game, "0", false, ...args), false);
  }
  assert.equal(coreBallInputAllowed({ ...game, lockedUntil: 1150 }, "0", false, false, true, true, 1149), false);
  assert.equal(coreBallInputAllowed({ ...game, lockedUntil: 1150 }, "0", false, false, true, true, 1150), true);
});

test("Abgeben wird erst nach einer eigenen erfolgreichen Kugel möglich und zeigt vorläufige Punkte", () => {
  let game = playing("competitive");
  const initial = render(CoreBallGameUI, props(game));
  assert.match(initial.match(/<button[^>]*disabled=""[^>]*>.*?Abgeben/s)?.[0], /Abgeben/);
  game = applyCoreBallAction(game, "0", action(game, "shoot", { firedAt: 1000 }), 1000);
  assert.equal(game.lastEvent.type, "shot");
  const played = render(CoreBallGameUI, { ...props(game), now: () => 1150 });
  assert.match(played, /\+1 vorläufig/);
  assert.match(played, /core-ball-active-score.*?aria-label="Punkte von Anna".*?<b>0<\/b> gesichert.*?<b>\+1<\/b> vorläufig/);
  const handoffButton = played.match(/<button[^>]*class="[^"]*core-ball-handoff-button[^"]*"[^>]*>/)?.[0];
  assert.doesNotMatch(handoffButton, /disabled=""/);
  game = applyCoreBallAction(game, "0", action(game, "handoff", { targetPlayerId: "4" }), 1150);
  const next = render(CoreBallGameUI, props(game, "4"));
  assert.match(next, /Eva ist dran/); assert.match(next, /Dein Kreis wartet/); assert.match(next, /Der Kreis wartet auf die nächste Person/);
  assert.match(next, /\+1 vorläufig/); assert.match(boardButton(next), /disabled=""/);
});

test("gespeicherte lokale Partien pausieren ohne den laufenden Zustand zu verändern", () => {
  const game = playing(); const snapshot = coreBallLocalSnapshot(game, 1600);
  assert.equal(game.phase, "playing"); assert.equal(game.runningSince, 1000);
  const restored = restoreCoreBallGame(JSON.stringify(snapshot), 9999);
  const html = render(CoreBallGameUI, { ...props(restored), local: true });
  assert.match(html, /Weitergeben an Anna/); assert.match(html, />Bereit</); assert.match(boardButton(html), /disabled=""/);
});

test("Spielfeld zeigt Spielerfarben und Namen und mutiert auch mit Flugvorschau keinen Zustand", () => {
  const before = playing(); const after = applyCoreBallAction(before, "0", action(before, "shoot", { firedAt: 1000 }), 1000);
  const unchanged = structuredClone(after);
  const html = render(CoreBallBoard, { game: after, now: () => 1100, disabled: true, onShoot() {} });
  assert.match(html, /Anna, Kugel 5/); assert.match(html, /fill="#38bdf8"/); assert.match(html, /core-ball-flying-pin/); assert.match(html, /aria-label="Kugel setzen – Spielfeld"/);
  const flying = render(CoreBallBoard, { game: after, now: () => 1100, flight: { game: before, firedAt: 1000, playerId: "0" }, onShoot() {} });
  assert.doesNotMatch(flying, /Anna, Kugel 5/); assert.deepEqual(after, unchanged);
});

test("Zuschauer sehen einen frischen Schuss am bisherigen Kreis, ohne nach Reload alte Flüge abzuspielen", () => {
  const before = playing(); const after = applyCoreBallAction(before, "0", action(before, "shoot", { firedAt: 1000 }), 1000);
  const flight = coreBallRemoteFlight(before, after, null, 1100);
  assert.equal(flight.game, before); assert.equal(flight.firedAt, 1000); assert.equal(flight.playerId, "0");
  assert.equal(coreBallRemoteFlight(before, after, after.lastEvent.id, 1100), null);
  assert.equal(coreBallRemoteFlight(before, after, null, 1150), null);
  assert.equal(coreBallRemoteFlight(after, after, null, 1100), null);
  // A level transition still animates against the preceding arrangement, not the new level.
  const nextLevel = { ...after, level: 2, attemptId: 2, lastEvent: { ...after.lastEvent, type: "level-complete" } };
  assert.equal(coreBallRemoteFlight(before, nextLevel, null, 1100).game.level, 1);
});

test("Flugtimer bleiben auch nach einer Uhrkorrektur auf maximal 150 ms begrenzt", () => {
  assert.equal(coreBallFlightRemaining(1000, 1000), 150);
  assert.equal(coreBallFlightRemaining(1000, 1100), 50);
  assert.equal(coreBallFlightRemaining(1000, 2000), 0);
  assert.equal(coreBallFlightRemaining(600000, 1000), 150);
});

test("Ergebnis berücksichtigt gesicherte Punkte, Gleichstände und den aktuellen Lobbyhost", () => {
  const game = start("competitive"); game.players[0].score = 3; game.players[1].score = 3; game.contributions["2"] = 7;
  const finished = applyCoreBallAction(game, "0", action(game, "finish"), 1000);
  const guest = render(CoreBallGameUI, props(finished, "2"));
  assert.match(guest, /Gemeinsamer Sieg!/); assert.match(guest, /Anna und Ben liegen gleichauf/); assert.match(guest, /Unfertige Punkte sind verfallen/);
  assert.match(guest, /Ihr wart in Level 1/);
  assert.doesNotMatch(guest, /Zurück in die Lobby/); assert.doesNotMatch(guest, /\+7 vorläufig/);
  const newHost = render(CoreBallGameUI, { ...props(finished, "2"), hostPlayerId: "2" }); assert.match(newHost, /Zurück in die Lobby/);
  const coop = start(); const coopEnd = applyCoreBallAction(coop, "0", action(coop, "finish"), 1000);
  assert.match(render(CoreBallGameUI, { ...props(coopEnd), local: true }), /Neue Runde vorbereiten/);
});

test("Spielregeln erklären Übergaben, Kollisionen und beide Wertungen", () => {
  const rules = render(CoreBallRulesContent, {});
  assert.match(rules, /an jede andere Person abgeben/); assert.match(rules, /Dieses Level beginnt vollständig neu/);
  assert.match(rules, /erst ein geschafftes Level sichert diese Punkte/); assert.match(rules, /kein Zeitlimit/);
});
