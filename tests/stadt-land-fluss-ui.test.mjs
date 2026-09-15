import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/slf-ui-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({ stdin: { contents: 'export * from "./components/stadt-land-fluss/game-ui"; export * from "./lib/stadt-land-fluss";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent" });
after(() => rm(output, { force: true }));
const { SlfTimerBar, SlfAnswerSheet, SlfReview, SlfSettingsForm, SlfScoreboard, createSlfGame, applySlfAction, slfView } = createRequire(import.meta.url)(output);
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const players = [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }];
const settings = { columns: ["Stadt", "Mein Wunschberuf"], timerSeconds: 120, rounds: 1 };
const start = () => createSlfGame(players, settings, 1000, () => 0);
const act = (game, id, action) => applySlfAction(game, id, "a", { ...action, roundId: game.round.id }, settings, 2000, () => 0);
const state = (game = start(), me = "a") => ({ lobby: { id: "DEMO", name: "Wörter", hostPlayerId: "a", settings, revision: 1 }, me: players.find((p) => p.id === me), members: players, game: slfView(game, me), serverNow: 2000 });
const send = async () => true;

test("Timer bleibt in Lobby, Schreibphase und Auswertung vorhanden; nur Host kann ihn bearbeiten", () => {
  const current = state();
  let html = render(SlfTimerBar, { state: current, now: 11001, connected: true, onEdit() {} });
  assert.match(html, /role="timer" aria-live="off" aria-label="110 Sekunden verbleibend">1:50/);
  assert.match(html, /aria-label="Timer bearbeiten"/); assert.match(html, /Buchstabe A/);
  html = render(SlfTimerBar, { state: state(start(), "b"), now: 111001, connected: true, onEdit() {} });
  assert.match(html, /slf-timer-bar is-urgent/); assert.doesNotMatch(html, /aria-label="Timer bearbeiten"/);
  html = render(SlfTimerBar, { state: { ...current, game: null, lobby: { ...current.lobby, settings: { ...settings, timerSeconds: null } } }, now: 2000, connected: false, onEdit() {} });
  assert.match(html, /Ohne Limit/); assert.match(html, /Verbindung unterbrochen/);
  html = render(SlfTimerBar, { state: state(act(start(), "a", { type: "stop" })), now: 2000, connected: true, onEdit() {} });
  assert.match(html, /Abstimmung/); assert.match(html, /role="timer"/);
});

test("freie Spalten sind beschriftete private Eingabefelder; Ablauf sperrt die ganze Abgabe", () => {
  let game = act(start(), "b", { type: "answers", values: ["Augsburg", "Architekt"], sequence: 1 });
  game = act(game, "a", { type: "answers", values: ["Aachen", "Arzt"], sequence: 1 });
  const props = { game: slfView(game, "a"), meId: "a", now: 2000, connected: true, isHost: false, send };
  const html = render(SlfAnswerSheet, props);
  assert.match(html, /aria-label="Stadt"/); assert.match(html, /aria-label="Mein Wunschberuf"/);
  assert.match(html, /value="Aachen"/); assert.doesNotMatch(html, /Augsburg|Architekt/);
  assert.doesNotMatch(html, /Schreibphase für alle beenden/);
  const expired = render(SlfAnswerSheet, { ...props, now: 121000 });
  assert.equal((expired.match(/<input[^>]*disabled=""/g) ?? []).length, 2);
  assert.match(expired, /Zeit vorbei/); assert.match(expired, /<button[^>]*disabled=""[^>]*>[\s\S]*Fertig – Antworten abgeben/);
});

test("Abstimmung bietet große Tap-Buttons, markiert fehlende Stimmen und sperrt die Bestätigung", () => {
  let game = start();
  for (const player of players) game = act(game, player.id, { type: "answers", values: ["Aachen", "Arzt"], sequence: 1, submit: true });
  game = act(game, "a", { type: "challenge", playerId: "b", column: 0 });
  let html = render(SlfReview, { game: slfView(game, "a"), meId: "a", isHost: true, busy: false, send });
  assert.match(html, /aria-label="Aachen von Ben: Gilt"/); assert.match(html, /aria-label="Aachen von Ben: Gilt nicht"/);
  assert.match(html, /1 offene Abstimmungen/); assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*Wertung bestätigen/);
  game = act(game, "a", { type: "vote", playerId: "b", column: 0, valid: false });
  html = render(SlfReview, { game: slfView(game, "a"), meId: "a", isHost: true, busy: false, send });
  assert.match(html, /aria-pressed="true" aria-label="Aachen von Ben: Gilt nicht"/);
  const guest = render(SlfReview, { game: slfView(game, "b"), meId: "b", isHost: false, busy: false, send });
  assert.doesNotMatch(guest, /Punkte auswerten|Mit bisherigen Stimmen abschließen/);
});

test("Spalteneditor und Ergebnis zeigen die tatsächlich konfigurierten Kategorien und berechneten Punkte", () => {
  const form = render(SlfSettingsForm, { value: settings, busy: false, roundsLocked: true, onSave: send });
  assert.match(form, /aria-label="Spalte 2"[^>]*value="Mein Wunschberuf"/);
  assert.match(form, /id="slf-settings-rounds"[^>]*disabled=""/);
  let game = start();
  game = act(game, "a", { type: "answers", values: ["Aachen", "Arzt"], sequence: 1, submit: true });
  game = act(game, "b", { type: "answers", values: ["Aachen", ""], sequence: 1, submit: true });
  game = act(game, "a", { type: "score", force: true });
  const html = render(SlfScoreboard, { game: slfView(game, "a") });
  assert.match(html, /Das Endergebnis/); assert.match(html, /Anna/); assert.match(html, /<b>25 /); assert.match(html, /<b>5 /);
});
