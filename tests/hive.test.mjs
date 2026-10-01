import assert from "node:assert/strict";
import test from "node:test";
import { activeHivePlayer, applyHiveAction, canHivePass, canUndoHiveTurn, createHiveGame, hexKey, hiveMovePath, hiveOutcome, hivePieceHint, hivePlacements, hiveTargets, isHiveConnected, queenRequired, queenSurroundCount, restoreHiveGame, undoHiveTurn } from "../lib/hive.ts";

const players = [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }];
const start = () => createHiveGame(players);
const act = (game, action, actor = activeHivePlayer(game).id) => applyHiveAction(game, actor, { gameId: game.id, ply: game.ply, ...action });
const keys = (positions) => positions.map(hexKey).sort();
const has = (positions, q, r) => positions.some((p) => p.q === q && p.r === r);
function arrange(entries, currentPlayer = 0) {
  const game = start(); game.currentPlayer = currentPlayer;
  for (const [owner, kind, q, r, level = 1] of entries) {
    const piece = game.pieces.find((p) => p.ownerId === owner && p.kind === kind && !p.position);
    assert.ok(piece, `${owner} ${kind} available`); piece.position = { q, r }; piece.level = level;
  }
  assert.ok(isHiveConnected(game), "Testposition muss zusammenhängen"); return game;
}
const id = (game, owner, kind, index = 0) => game.pieces.filter((p) => p.ownerId === owner && p.kind === kind)[index].id;

test("Grundspiel mit 22 Steinen, zwei Farben und validierten Namen", () => {
  const game = start(); assert.equal(game.pieces.length, 22); assert.deepEqual(game.players.map((p) => p.color), ["white", "black"]);
  assert.equal(new Set(game.pieces.map((p) => p.id)).size, 22);
  assert.throws(() => createHiveGame(players.slice(0, 1))); assert.throws(() => createHiveGame([...players, { id: "c", name: "Clara" }]));
  assert.throws(() => createHiveGame([{ id: "a", name: "Anna" }, { id: "b", name: " ANNA " }]));
  assert.deepEqual(restoreHiveGame(JSON.stringify(game)), game);
});

test("erster Stein jeder Farbe darf an den Gegner grenzen; danach nur an eigene Oberseiten", () => {
  let game = start(); assert.deepEqual(hiveTargets(game, id(game, "a", "ant")), [{ q: 0, r: 0 }]);
  game = act(game, { type: "place", pieceId: id(game, "a", "ant"), to: { q: 0, r: 0 } });
  assert.equal(hivePlacements(game).length, 6);
  game = act(game, { type: "place", pieceId: id(game, "b", "spider"), to: { q: 1, r: 0 } });
  assert.ok(has(hivePlacements(game), -1, 0)); assert.ok(!has(hivePlacements(game), 0, 1));
  assert.deepEqual(hiveTargets(game, id(game, "a", "ant")), [], "Ohne eigene Königin kein Bewegen");
  assert.throws(() => act(game, { type: "place", pieceId: id(game, "a", "beetle"), to: { q: 0, r: 0 } }), /nicht erlaubt/);
  const covered = arrange([["a", "queen", 0, 0], ["b", "beetle", 0, 0, 2], ["b", "queen", 1, 0]]);
  assert.ok(has(hivePlacements(covered, "b"), 0, -1)); assert.ok(!has(hivePlacements(covered, "a"), 0, -1));
});

test("Königin spätestens im vierten eigenen Zug; alle anderen Reservesteine sind dann gesperrt", () => {
  let game = start();
  for (let i = 0; i < 6; i++) {
    const owner = activeHivePlayer(game).id; const pieceId = id(game, owner, "ant", Math.floor(i / 2));
    assert.equal(queenRequired(game), false); game = act(game, { type: "place", pieceId, to: hiveTargets(game, pieceId)[0] });
  }
  assert.equal(game.players[0].turns, 3); assert.equal(queenRequired(game), true);
  assert.deepEqual(hiveTargets(game, id(game, "a", "beetle")), []);
  assert.throws(() => act(game, { type: "place", pieceId: id(game, "a", "beetle"), to: hivePlacements(game)[0] }));
  const queenId = id(game, "a", "queen"); game = act(game, { type: "place", pieceId: queenId, to: hiveTargets(game, queenId)[0] });
  assert.equal(queenRequired(game), true, "Auch Schwarz muss im vierten Zug die Königin setzen");
});

test("kein Zug darf den Schwarm während der Bewegung teilen", () => {
  const game = arrange([["a", "queen", -1, 0], ["a", "ant", 0, 0], ["b", "queen", 1, 0]]);
  assert.deepEqual(hiveTargets(game, id(game, "a", "ant")), []);
  assert.throws(() => act(game, { type: "move", pieceId: id(game, "a", "ant"), to: { q: 0, r: 1 } }));
  assert.ok(hiveTargets(game, id(game, "a", "queen")).length);
});

test("Königin gleitet ein Feld; Spinne genau drei ohne Rückweg; Ameise erreicht die freie Außenkante", () => {
  const queen = arrange([["a", "queen", -1, 0], ["b", "queen", 0, 0], ["b", "ant", 1, 0]]);
  assert.deepEqual(keys(hiveTargets(queen, id(queen, "a", "queen"))), ["-1,1", "0,-1"]);
  const spider = arrange([["a", "queen", 0, 0], ["b", "queen", 1, 0], ["a", "spider", -1, 0]]);
  assert.deepEqual(keys(hiveTargets(spider, id(spider, "a", "spider"))), ["1,1", "2,-1"]);
  const ant = arrange([["a", "queen", 0, 0], ["b", "queen", 1, 0], ["a", "ant", -1, 0]]);
  assert.equal(hiveTargets(ant, id(ant, "a", "ant")).length, 7);
});

test("Grashüpfer springt gerade über eine lückenlose Reihe bis zum ersten freien Feld", () => {
  const game = arrange([["a", "queen", 0, 0], ["b", "queen", 1, 0], ["a", "grasshopper", -1, 0], ["b", "ant", 1, 1], ["b", "ant", 2, 1], ["b", "ant", 3, 0]]);
  const targets = hiveTargets(game, id(game, "a", "grasshopper"));
  assert.deepEqual(targets, [{ q: 2, r: 0 }]); assert.ok(!has(targets, 4, 0));
});

test("gleitende Steine passen nicht durch ein geschlossenes Tor; Käfer beachten die Stapelhöhe", () => {
  const queen = arrange([["a", "queen", 0, 0], ["b", "queen", 1, -1], ["b", "ant", 2, -1], ["b", "ant", 2, 0], ["b", "spider", 1, 1], ["b", "spider", 0, 1]]);
  assert.ok(!has(hiveTargets(queen, id(queen, "a", "queen")), 1, 0));
  const elevated = arrange([["a", "queen", -1, 0], ["a", "ant", 0, 0], ["a", "beetle", 0, 0, 2], ["b", "queen", 0, 1], ["b", "beetle", 0, 1, 2], ["b", "ant", 1, -1], ["b", "beetle", 1, -1, 2]]);
  assert.ok(!has(hiveTargets(elevated, id(elevated, "a", "beetle")), 1, 0));
  assert.ok(has(hiveTargets(elevated, id(elevated, "a", "beetle")), 0, 1), "Käfer darf auf einen höheren Stapel klettern");
  elevated.pieces.find((p) => p.ownerId === "b" && p.kind === "beetle" && p.position.r === 1).position = null;
  assert.ok(has(hiveTargets(elevated, id(elevated, "a", "beetle")), 1, 0), "Nur ein gleichhoher Torstein blockiert nicht");
});

test("Käfer klettert, blockiert den unteren Stein und gibt ihn nach dem Herunterklettern frei", () => {
  let game = arrange([["a", "queen", 0, 0], ["a", "beetle", -1, 0], ["b", "queen", 1, 0]]);
  const beetleId = id(game, "a", "beetle");
  game = act(game, { type: "move", pieceId: beetleId, to: { q: 0, r: 0 } });
  assert.equal(game.pieces.find((p) => p.id === beetleId).level, 2);
  game.currentPlayer = 0; assert.deepEqual(hiveTargets(game, id(game, "a", "queen")), []);
  game = act(game, { type: "move", pieceId: beetleId, to: { q: 0, r: 1 } });
  assert.equal(game.pieces.find((p) => p.id === beetleId).level, 1); game.currentPlayer = 0;
  assert.ok(hiveTargets(game, id(game, "a", "queen")).length);
});

test("ein neuer Reservestein darf in eine vollständig umschlossene eigene Lücke gesetzt werden", () => {
  const game = arrange([["a", "queen", 1, 0], ["a", "spider", 0, 1], ["a", "ant", -1, 1], ["a", "ant", -1, 0], ["a", "ant", 0, -1], ["a", "beetle", 1, -1], ["b", "queen", 2, 0]]);
  assert.ok(has(hiveTargets(game, id(game, "a", "grasshopper")), 0, 0));
  const next = act(game, { type: "place", pieceId: id(game, "a", "grasshopper"), to: { q: 0, r: 0 } }); assert.ok(isHiveConnected(next));
});

test("Passen nur ohne jeden legalen Zug; ein verdeckter eigener Stein ermöglicht keine Platzierung", () => {
  assert.throws(() => act(start(), { type: "pass" }), /nur passen/);
  const game = arrange([["a", "queen", 0, 0], ["b", "beetle", 0, 0, 2], ["b", "queen", 1, 0]]);
  assert.equal(canHivePass(game), true); const next = act(game, { type: "pass" });
  assert.equal(next.currentPlayer, 1); assert.equal(next.players[0].turns, 1); assert.equal(next.history[0].type, "pass");
});

test("sechs besetzte Seiten entscheiden auch bei überdeckter Königin; beide gleichzeitig ergeben Remis", () => {
  const winning = arrange([["b", "queen", 0, 0], ["a", "queen", 0, 1], ["a", "ant", -1, 1], ["a", "ant", -1, 0], ["a", "spider", 0, -1], ["a", "grasshopper", 1, -1], ["a", "beetle", 2, -1]]);
  assert.equal(queenSurroundCount(winning, "b"), 5);
  const won = act(winning, { type: "move", pieceId: id(winning, "a", "beetle"), to: { q: 1, r: 0 } });
  assert.equal(won.phase, "finished"); assert.deepEqual(won.result, { winnerId: "a", reason: "surrounded" });
  won.pieces.find((p) => p.ownerId === "a" && p.kind === "beetle").position = { q: 0, r: 0 };
  won.pieces.find((p) => p.ownerId === "a" && p.kind === "beetle").level = 2;
  const spare = won.pieces.find((p) => p.ownerId === "a" && p.kind === "spider" && !p.position); spare.position = { q: 1, r: 0 }; spare.level = 1;
  assert.equal(hiveOutcome(won).winnerId, "a");
  const draw = arrange([["a", "queen", 0, 0], ["b", "queen", 1, 0], ["a", "ant", -1, 1], ["a", "ant", -1, 0], ["a", "ant", 0, -1], ["a", "spider", 1, -1], ["b", "ant", 2, -1], ["b", "ant", 2, 0], ["b", "ant", 1, 1], ["a", "beetle", -1, 2]]);
  const tied = act(draw, { type: "move", pieceId: id(draw, "a", "beetle"), to: { q: 0, r: 1 } });
  assert.equal(tied.phase, "finished"); assert.deepEqual(tied.result, { winnerId: null, reason: "both-surrounded" });
});

test("Aufgeben und beidseitiges Remis; falsche Akteure, alte Züge und veränderte Eingaben werden abgewiesen", () => {
  const game = start(); const original = structuredClone(game); const move = { type: "place", pieceId: id(game, "a", "queen"), to: { q: 0, r: 0 } };
  assert.throws(() => act(game, move, "b"), /andere Person/); assert.throws(() => act(game, move, "intruder"));
  const next = act(game, move); assert.deepEqual(game, original);
  assert.throws(() => applyHiveAction(next, "a", { ...move, gameId: game.id, ply: 0 }), /nicht mehr aktuell/);
  assert.throws(() => act(game, { ...move, to: { q: NaN, r: 0 } }));
  assert.throws(() => act(game, { type: "answer-draw", accept: true }, "b"));
  const offered = act(game, { type: "offer-draw" }); assert.equal(offered.ply, 0); assert.equal(offered.currentPlayer, 0);
  assert.throws(() => act(offered, { type: "answer-draw", accept: true }, "a"));
  const declined = act(offered, { type: "answer-draw", accept: false }, "b"); assert.equal(declined.phase, "playing");
  const draw = act(offered, { type: "answer-draw", accept: true }, "b"); assert.equal(draw.result.reason, "agreement");
  const resigned = act(game, { type: "resign" }, "b"); assert.equal(resigned.result.winnerId, "a");
  assert.throws(() => act(resigned, move), /beendet/);
});

test("lokale Speicherung verwirft beschädigte Figuren, Stapel und Spielzustände", () => {
  for (const mutate of [(g) => g.pieces.pop(), (g) => g.players.pop(), (g) => { g.pieces[0].position = { q: .5, r: 0 }; }, (g) => { g.pieces[0].kind = "mosquito"; }, (g) => { g.pieces[0].ownerId = "intruder"; }]) {
    const game = start(); mutate(game); assert.throws(() => restoreHiveGame(JSON.stringify(game)), /nicht gelesen/);
  }
});

test("Blockierhinweise unterscheiden Königin, Käfer und getrennte Gruppen, ohne den Spielstand zu verändern", () => {
  const opening = act(start(), { type: "place", pieceId: "a:ant:0", to: { q: 0, r: 0 } }); opening.currentPlayer = 0;
  assert.equal(hivePieceHint(opening, "a:ant:0").code, "queen-missing");
  const split = arrange([["a", "queen", -1, 0], ["a", "ant", 0, 0], ["b", "queen", 1, 0]]); const before = structuredClone(split);
  const hint = hivePieceHint(split, "a:ant:0"); assert.equal(hint.code, "split");
  assert.deepEqual(hint.groups.map(keys), [["-1,0"], ["1,0"]]); assert.deepEqual(split, before);
  assert.equal(hivePieceHint(split, "a:queen:0"), null, "Ein legal beweglicher Stein bekommt keine Blockade erklärt");
  const covered = arrange([["a", "queen", 0, 0], ["b", "beetle", 0, 0, 2], ["b", "queen", 1, 0]]);
  assert.equal(hivePieceHint(covered, "a:queen:0").code, "covered");
  assert.equal(hivePieceHint(covered, "a:ant:0").code, "placement");
});

test("geschlossene Tore markieren genau ihre flankierenden Steine; vollständige Umringung wird getrennt erklärt", () => {
  const game = arrange([["a", "queen", 0, 0], ["b", "queen", 1, -1], ["b", "ant", 2, -1], ["b", "ant", 2, 0], ["b", "ant", 1, 1], ["b", "spider", 0, 1], ["b", "spider", -1, 1], ["b", "grasshopper", 0, -1]]);
  assert.deepEqual(hiveTargets(game, "a:queen:0"), []);
  const hint = hivePieceHint(game, "a:queen:0"); assert.equal(hint.code, "gate");
  assert.deepEqual(keys(hint.highlights), ["-1,1", "0,-1", "0,1", "1,-1"]);
  const surrounded = arrange([["a", "queen", 0, 0], ["b", "queen", 1, 0], ["b", "ant", 0, 1], ["b", "ant", -1, 1], ["b", "ant", -1, 0], ["b", "spider", 0, -1], ["b", "spider", 1, -1]]);
  assert.equal(hivePieceHint(surrounded, "a:queen:0").code, "surrounded");
  assert.equal(hivePieceHint(surrounded, "a:queen:0").highlights.length, 6);
});

test("Vorschauwege respektieren Spinnenschritte, Rückwegverbot, Ameisenpfade und illegale Ziele", () => {
  for (const kind of ["spider", "ant"]) {
    const game = arrange([["a", "queen", 0, 0], ["b", "queen", 1, 0], ["a", kind, -1, 0]]);
    for (const to of hiveTargets(game, id(game, "a", kind))) {
      const path = hiveMovePath(game, id(game, "a", kind), to);
      assert.deepEqual(path[0], { q: -1, r: 0 }); assert.deepEqual(path.at(-1), to);
      assert.equal(new Set(keys(path)).size, path.length); if (kind === "spider") assert.equal(path.length, 4);
    }
    assert.deepEqual(hiveMovePath(game, id(game, "a", kind), { q: 40, r: 40 }), []);
  }
});

test("lokale Rücknahme stellt Setzen, Klettern, Herunterklettern und Passen samt Zugreihenfolge wieder her", () => {
  const original = start(); const first = act(original, { type: "place", pieceId: "a:queen:0", to: { q: 0, r: 0 } });
  const second = act(first, { type: "place", pieceId: "b:queen:0", to: { q: 1, r: 0 } });
  assert.deepEqual(undoHiveTurn(second), first); assert.deepEqual(undoHiveTurn(undoHiveTurn(second)), original);
  for (const [before, action] of [
    [arrange([["a", "queen", 0, 0], ["a", "beetle", -1, 0], ["b", "queen", 1, 0]]), { type: "move", pieceId: "a:beetle:0", to: { q: 0, r: 0 } }],
    [arrange([["a", "queen", 0, 0], ["a", "beetle", 0, 0, 2], ["b", "queen", 1, 0]]), { type: "move", pieceId: "a:beetle:0", to: { q: -1, r: 0 } }],
    [arrange([["a", "queen", 0, 0], ["b", "beetle", 0, 0, 2], ["b", "queen", 1, 0]]), { type: "pass" }],
  ]) {
    const played = act(before, action); const snapshot = structuredClone(played); const restored = undoHiveTurn(played);
    assert.deepEqual(restored, before); assert.deepEqual(played, snapshot); assert.deepEqual(restoreHiveGame(JSON.stringify(restored)), before);
  }
  assert.equal(canUndoHiveTurn(original), false); assert.throws(() => undoHiveTurn(original));
  assert.equal(canUndoHiveTurn(act(second, { type: "resign" })), false, "Aufgeben ist kein Spielzug im Zugverlauf");
});

test("ein zurückgenommener Gewinnzug öffnet die Partie und die sechste Seite der Königin wieder", () => {
  const before = arrange([["b", "queen", 0, 0], ["a", "queen", 0, 1], ["a", "ant", -1, 1], ["a", "ant", -1, 0], ["a", "spider", 0, -1], ["a", "grasshopper", 1, -1], ["a", "beetle", 2, -1]]);
  const won = act(before, { type: "move", pieceId: "a:beetle:0", to: { q: 1, r: 0 } });
  assert.equal(won.phase, "finished"); assert.equal(canUndoHiveTurn(won), true);
  const back = undoHiveTurn(won); assert.deepEqual(back, before); assert.equal(queenSurroundCount(back, "b"), 5);
});
