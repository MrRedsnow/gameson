import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = new URL("../", import.meta.url).pathname;
const output = resolve(root, `.wrangler/test-artifacts/hive-ui-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({ stdin: { contents: 'export * from "./components/hive/game-ui"; export * from "./components/hive/board"; export * from "./components/hive/tutorial"; export * from "./lib/hive"; export * from "./lib/hive-tutorial";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent" });
after(() => rm(output, { force: true }));
const { HiveGameUI, HiveBoard, HiveTutorial, createHiveGame, createHiveLesson, HIVE_LESSONS, applyHiveAction, hiveTargets, hivePieceHint, queenSurroundCount } = createRequire(import.meta.url)(output);
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const start = () => createHiveGame([{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }]);
const send = async () => true;
const props = (game, meId = "a") => ({ game, meId, onAction: send, onRematch() {} });

test("zeigt den aktiven Namen, alle Reserven und sperrt Eingaben der anderen Person", () => {
  const game = start(); const mine = render(HiveGameUI, props(game));
  assert.match(mine, /Anna ist am Zug/); assert.match(mine, /Königin, 1 in Reserve/); assert.match(mine, /Ameise, 3 in Reserve/);
  const waiting = render(HiveGameUI, props(game, "b"));
  assert.equal((waiting.match(/<button[^>]*disabled=""[^>]*aria-label="[^"]+in Reserve"/g) ?? []).length, 5);
  const offline = render(HiveGameUI, { ...props(game), connected: false });
  assert.equal((offline.match(/<button[^>]*disabled=""[^>]*aria-label="[^"]+in Reserve"/g) ?? []).length, 5);
});

test("Spielfeld bietet nur berechnete Ziele, fokussierbare Steine, Stapelzahlen und Ansichtssteuerung", () => {
  const game = start(); const pieceId = game.pieces.find((p) => p.kind === "queen").id;
  let html = render(HiveBoard, { game, selectedId: pieceId, targets: hiveTargets(game, pieceId), pending: { q: 0, r: 0 }, busy: false, onSelect() {}, onTarget() {} });
  assert.match(html, /aria-label="Erlaubtes Zielfeld 0, 0" aria-pressed="true"/);
  assert.match(html, /Spielfeld vergrößern/); assert.match(html, /Gesamten Schwarm anzeigen/);
  game.pieces[0].position = { q: 0, r: 0 }; game.pieces[0].level = 1;
  const beetle = game.pieces.find((p) => p.ownerId === "b" && p.kind === "beetle"); beetle.position = { q: 0, r: 0 }; beetle.level = 2;
  html = render(HiveBoard, { game, selectedId: null, targets: [], pending: null, busy: false, onSelect() {}, onTarget() {} });
  assert.match(html, /Käfer von Ben, Feld 0, 0, Stapel aus 2 Steinen/); assert.match(html, /Unten: Königin \(Anna\)/);
  assert.match(html, /role="button" tabindex="0"/);
});

test("erkennt beide Ergebnisarten und zeigt Revanche nur lokal oder für den Host", () => {
  const game = start(); const ended = applyHiveAction(game, "b", { type: "resign", gameId: game.id, ply: 0 });
  const guest = render(HiveGameUI, props(ended, "b")); assert.match(guest, /Anna gewinnt!/); assert.doesNotMatch(guest, /Lobby für Revanche öffnen/);
  const host = render(HiveGameUI, { ...props(ended), isHost: true }); assert.match(host, /Lobby für Revanche öffnen/);
  const offer = applyHiveAction(game, "a", { type: "offer-draw", gameId: game.id, ply: 0 });
  const offered = render(HiveGameUI, props(offer, "b")); assert.match(offered, /Anna bietet ein Remis an/); assert.match(offered, /Remis annehmen/);
  const tied = applyHiveAction(offer, "b", { type: "answer-draw", accept: true, gameId: game.id, ply: 0 });
  const local = render(HiveGameUI, { ...props(tied), local: true }); assert.match(local, /Unentschieden!/); assert.match(local, /Revanche spielen/);
});

test("Zugvorschau zeigt den gewählten Stein, den Weg und getrennte Gruppen ohne Spielstandsänderung", () => {
  const lesson = createHiveLesson(3); const original = structuredClone(lesson.game);
  const html = render(HiveBoard, { game: lesson.game, selectedId: lesson.pieceId, targets: hiveTargets(lesson.game, lesson.pieceId), pending: { q: 0, r: 0 }, busy: false, onSelect() {}, onTarget() {} });
  assert.match(html, /Zugvorschau: Käfer/); assert.match(html, /hive-preview-path/); assert.match(html, /is-preview-source/); assert.deepEqual(lesson.game, original);
  const blocked = createHiveLesson(2); const hint = hivePieceHint(blocked.game, blocked.pieceId);
  const explained = render(HiveBoard, { game: blocked.game, selectedId: blocked.pieceId, targets: [], pending: null, hint, busy: false, onSelect() {}, onTarget() {} });
  assert.match(explained, /is-blocker/); assert.match(explained, /hive-group-label/); assert.match(explained, /Nummerierte Gruppen/);
});

test("Rücknahme ist nur in lokalen Partien sichtbar und erst nach einem Spielzug verfügbar", () => {
  const game = start(); const localProps = { ...props(game), local: true, onUndo: () => true };
  const undoButton = (html) => html.match(/<button[^>]*aria-label="Letzten Zug zurücknehmen"[^>]*>/)?.[0];
  const empty = render(HiveGameUI, localProps); assert.match(undoButton(empty), /disabled=""/);
  const played = applyHiveAction(game, "a", { type: "place", pieceId: "a:queen:0", to: { q: 0, r: 0 }, gameId: game.id, ply: 0 });
  const local = render(HiveGameUI, { ...localProps, game: played, meId: "b" }); assert.ok(undoButton(local)); assert.doesNotMatch(undoButton(local), /disabled=""/);
  const online = render(HiveGameUI, { ...props(played), onUndo: () => true }); assert.doesNotMatch(online, /Letzten Zug zurücknehmen/);
});

test("alle sechs Übungen sind regelkonform lösbar, erklären die Blockade und enden mit einem Gewinn", () => {
  const html = render(HiveTutorial, { onClose() {} }); assert.match(html, /Schritt 1 von 6/); assert.match(html, /Übungsreserve/);
  for (const [index, lesson] of HIVE_LESSONS.entries()) {
    const { game, pieceId } = createHiveLesson(index);
    if (lesson.to) {
      assert.ok(hiveTargets(game, pieceId).some((to) => to.q === lesson.to.q && to.r === lesson.to.r), `Schritt ${index + 1} hat ein legales Ziel`);
      const piece = game.pieces.find((p) => p.id === pieceId);
      const next = applyHiveAction(game, "learn-white", { type: piece.position ? "move" : "place", gameId: game.id, ply: game.ply, pieceId, to: lesson.to });
      if (index === 5) { assert.equal(next.phase, "finished"); assert.equal(next.result.winnerId, "learn-white"); assert.equal(queenSurroundCount(next, "learn-black"), 6); }
    } else if (lesson.kind === "blocked") assert.equal(hivePieceHint(game, pieceId).code, "split");
    else { assert.equal(game.pieces.find((p) => p.id === pieceId).level, 2); assert.equal(hivePieceHint(game, "learn-white:queen:0").code, "covered"); }
  }
});
