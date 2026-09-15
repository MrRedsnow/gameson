import assert from "node:assert/strict";
import test from "node:test";
import { applySlfAction, calculateSlfPoints, changeSlfTimer, challengeKey, createSlfGame, expireSlfRound, formatTime, LETTERS, normalizedAnswer, remainingSeconds, slfView, validateSettings, voteSummary } from "../lib/stadt-land-fluss.ts";

const players = [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }, { id: "c", name: "Clara" }];
const settings = { columns: ["Stadt", "Land", "Fluss"], timerSeconds: 120, rounds: 2 };
const start = (config = settings) => createSlfGame(players, config, 1000, () => 0);
const act = (game, actorId, action, now = 2000, config = settings) => applySlfAction(game, actorId, "a", { ...action, roundId: game.round.id }, config, now, () => 0);
const answers = (game, id, values, extra = {}) => act(game, id, { type: "answers", values, sequence: 1, ...extra });
function reviewGame() {
  let game = start();
  game = answers(game, "a", ["Aachen", "Argentinien", "Aare"], { submit: true });
  game = answers(game, "b", [" aACHEN ", "Australien", ""], { submit: true });
  return answers(game, "c", ["Augsburg", "", "Bode"], { submit: true });
}

test("validiert freie Spalten, Timer und Rundenzahl einschließlich deaktiviertem Timer", () => {
  assert.deepEqual(validateSettings({ columns: ["  Mein  Essen ", "Beruf"], timerSeconds: null, rounds: 20 }), { columns: ["Mein Essen", "Beruf"], timerSeconds: null, rounds: 20 });
  for (const columns of [["Stadt"], ["Stadt", "stadt"], ["Ärger", "Arger"], ["", "Land"], Array(13).fill("x"), [5, "Land"], ["a".repeat(31), "Land"]]) assert.throws(() => validateSettings({ ...settings, columns }));
  for (const timerSeconds of [0, 14, 1801, "120", NaN, 15.5]) assert.throws(() => validateSettings({ ...settings, timerSeconds }));
  for (const rounds of [0, 21, 1.5, "5"]) assert.throws(() => validateSettings({ ...settings, rounds }));
  assert.throws(() => createSlfGame(players.slice(0, 1), settings));
});

test("verbirgt fremde Antworten bis zur Auswertung; Eingaben und Abgaben sind unabhängig", () => {
  let game = start(); const original = structuredClone(game);
  game = answers(game, "a", ["Aachen", "Argentinien", "Aare"]);
  game = answers(game, "b", ["Augsburg", "Australien", "Alster"]);
  const view = slfView(game, "a");
  assert.deepEqual(Object.keys(view.round.answers), ["a"]);
  assert.ok(!JSON.stringify(view).includes("Augsburg")); assert.equal(view.progress.length, 3);
  view.round.answers.a.values[0] = "mutated"; assert.equal(game.round.answers.a.values[0], "Aachen");
  assert.deepEqual(original.round.answers.a.values, ["", "", ""]);
  game = answers(game, "a", ["Aalen", "", ""], { sequence: 3 });
  game = answers(game, "a", ["OLD", "", ""], { sequence: 2 });
  assert.equal(game.round.answers.a.values[0], "Aalen");
  game = answers(game, "a", ["Aalen", "", ""], { sequence: 4, submit: true });
  game = answers(game, "a", ["TOO LATE", "", ""], { sequence: 5 });
  assert.equal(game.round.answers.a.values[0], "Aalen"); assert.equal(game.phase, "writing");
  assert.throws(() => act(game, "nobody", { type: "stop" }));
});

test("Serverdeadline sperrt neue Antworten exakt; Timer kann live geändert und deaktiviert werden", () => {
  let game = start(); assert.equal(game.round.endsAt, 121000);
  assert.equal(expireSlfRound(game, 120999), false);
  assert.throws(() => act(game, "a", { type: "answers", values: ["Aalen", "", ""], sequence: 1 }, 121000), /Schreibzeit ist vorbei/);
  assert.equal(expireSlfRound(game, 121000), true); assert.equal(game.phase, "review"); assert.equal(game.round.stoppedAt, 121000);
  game = start(); changeSlfTimer(game, 30, 3000); assert.equal(game.round.endsAt, 33000);
  changeSlfTimer(game, null, 4000); assert.equal(expireSlfRound(game, 9e9), false); assert.equal(game.round.endsAt, null);
  changeSlfTimer(game, 60, 5000); assert.equal(game.round.endsAt, 65000);
  assert.equal(remainingSeconds(65000, 5001), 60); assert.equal(remainingSeconds(65000, 65000), 0); assert.equal(remainingSeconds(null, 5), null); assert.equal(formatTime(125), "2:05");
  assert.throws(() => act(game, "b", { type: "stop" }));
  game = act(game, "a", { type: "stop" }); assert.equal(game.phase, "review"); assert.equal(game.round.stopReason, "host");
});

test("Punkte: einzigartige 10, gleiche 5, allein gültige 20, leere/falsche 0", () => {
  const game = reviewGame(); assert.equal(game.phase, "review"); assert.equal(game.round.stopReason, "submitted");
  assert.deepEqual(calculateSlfPoints(game), { a: [5, 10, 20], b: [5, 10, 0], c: [10, 0, 0] });
  assert.equal(Object.keys(slfView(game, "b").round.answers).length, 3);
  assert.equal(normalizedAnswer(" Ägypten  "), "agypten"); assert.equal(normalizedAnswer("Straße"), "strasse");
});

test("Tap-Abstimmungen erlauben genau eine änderbare Stimme pro Person und setzen Bestätigungen zurück", () => {
  let game = reviewGame();
  game = act(game, "a", { type: "ready" });
  game = act(game, "b", { type: "challenge", playerId: "a", column: 1 }); assert.deepEqual(game.round.ready, []);
  const key = challengeKey("a", 1);
  assert.throws(() => act(game, "a", { type: "ready" }), /Stimme zuerst/);
  assert.throws(() => act(game, "a", { type: "challenge", playerId: "c", column: 2 }), /Anfangsbuchstaben/);
  assert.throws(() => act(game, "a", { type: "vote", playerId: "a", column: 0, valid: true }));
  game = act(game, "a", { type: "vote", playerId: "a", column: 1, valid: true });
  game = act(game, "a", { type: "ready" }); assert.deepEqual(game.round.ready, ["a"]);
  game = act(game, "a", { type: "vote", playerId: "a", column: 1, valid: false }); assert.deepEqual(game.round.ready, []);
  assert.equal(voteSummary(game.round.challenges[key]).total, 1);
  game = act(game, "b", { type: "vote", playerId: "a", column: 1, valid: true });
  assert.equal(voteSummary(game.round.challenges[key]).valid, true, "Unentschieden akzeptiert die Antwort");
  game = act(game, "c", { type: "vote", playerId: "a", column: 1, valid: false });
  assert.equal(voteSummary(game.round.challenges[key]).valid, false);
  assert.deepEqual(calculateSlfPoints(game), { a: [5, 0, 20], b: [5, 20, 0], c: [10, 0, 0] });
  assert.throws(() => act(game, "a", { type: "score" }), /nicht alle/);
  assert.throws(() => act(game, "b", { type: "score", force: true }), /Lobby-Master/);
  for (const p of players) game = act(game, p.id, { type: "ready" });
  game = act(game, "a", { type: "score" }); assert.equal(game.phase, "results"); assert.deepEqual(game.scores, { a: 25, b: 25, c: 10 });
  assert.throws(() => act(game, "a", { type: "score" }), /Abstimmung/);
  assert.throws(() => act(game, "a", { type: "vote", playerId: "a", column: 1, valid: true }));
});

test("alle Runden laufen mit neuen Buchstaben und neuen Spalten bis zum Endergebnis", () => {
  const config = { ...settings, rounds: 20 }; let game = start(config); const firstId = game.round.id;
  for (let number = 1; number <= 20; number++) {
    assert.equal(game.round.number, number);
    game = act(game, "a", { type: "stop" }, 2000, config);
    game = act(game, "a", { type: "score", force: true }, 2000, config);
    if (number < 20) game = act(game, "a", { type: "next" }, 3000, { ...config, columns: ["Essen", "Vorname"], timerSeconds: null });
  }
  assert.equal(game.phase, "finished"); assert.equal(game.history.length, 20); assert.equal(new Set(game.usedLetters).size, 20); assert.ok(game.usedLetters.every((l) => LETTERS.includes(l)));
  assert.deepEqual(game.round.columns, ["Essen", "Vorname"]); assert.equal(game.round.endsAt, null);
  assert.throws(() => applySlfAction(game, "a", "a", { type: "next", roundId: firstId }, config), /nicht mehr aktuell/);
  assert.throws(() => act(game, "a", { type: "next" }));
});
