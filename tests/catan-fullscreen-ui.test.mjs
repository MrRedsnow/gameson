import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Only the browser fullscreen boundary is replaced. Render the real mounted
// panels, navigation and resource hand against engine-generated game states.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-fullscreen-ui-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export { CatanGameUI } from "./components/catan/game-ui";\nexport * from "./lib/catan";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
  plugins: [{
    name: "expanded-island",
    setup(builder) {
      builder.onLoad({ filter: /[/\\]use-island-fullscreen\.ts$/ }, () => ({
        contents: "export function useIslandFullscreen() { return { expanded: true, toggle() {}, close() {} }; }",
        loader: "ts",
      }));
    },
  }],
});
after(() => rm(output, { force: true }));
const { CatanGameUI, createCatanGame, applyCatanAction, catanView, legalSettlements, legalRoads } = createRequire(import.meta.url)(output);
const seats = [{ id: "a", name: "Robin" }, { id: "b", name: "Mara" }, { id: "c", name: "Lea" }];
const sequence = (values) => { let index = 0; return (length) => values[index++ % values.length] % length; };

function foundedGame() {
  let game = createCatanGame(seats, 10, sequence([0]));
  for (let step = 0; step < 6; step++) {
    const actor = game.players[game.currentPlayer].id;
    game = applyCatanAction(game, actor, { type: "build", building: "settlement", position: legalSettlements(game, actor, true)[0] }, sequence([0]));
    game = applyCatanAction(game, actor, { type: "build", building: "road", position: legalRoads(game, actor, game.setupVertex)[0] }, sequence([0]));
  }
  return game;
}
const ui = (game, viewerId, extra = {}) => renderToStaticMarkup(createElement(CatanGameUI, { game: catanView(game, viewerId), send: async () => true, busy: false, local: false, ...extra }));
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const panelTags = (html) => (html.match(/<div\b[^>]*>/g) ?? []).filter((tag) => attribute(tag, "data-catan-fullscreen-panel"));

function panel(html, name) {
  const tag = panelTags(html).find((element) => attribute(element, "data-catan-fullscreen-panel") === name);
  assert.ok(tag, `Das montierte Vollbildmenü ${name} fehlt.`);
  const start = html.indexOf(tag);
  const next = panelTags(html).map((element) => html.indexOf(element)).filter((index) => index > start).sort((a, b) => a - b)[0];
  return html.slice(start, next ?? html.indexOf('<nav class="catan-nav"', start));
}

function assertMountedIsland(html, activeMenu) {
  assert.match(html, /class="catan-play is-board-expanded"/);
  const island = (html.match(/<div\b[^>]*>/g) ?? []).find((tag) => attribute(tag, "class") === "catan-tab-panel catan-tab-insel");
  assert.ok(island, "Die Insel fehlt im Vollbild.");
  assert.equal(attribute(island, "data-state"), "active", "Ein offenes Menü darf die Insel nicht deaktivieren.");
  assert.equal((html.match(/class="catan-board"/g) ?? []).length, 1);
  assert.equal((html.match(/class="catan-hand-bar\b/g) ?? []).length, 1);
  assert.equal((html.match(/class="catan-hand-strip"/g) ?? []).length, 1);
  assert.equal(panelTags(html).length, 4);
  assert.deepEqual(panelTags(html).filter((tag) => attribute(tag, "data-state") === "active").map((tag) => attribute(tag, "data-catan-fullscreen-panel")), activeMenu ? [activeMenu] : []);
}

test("Vollbild hält Insel und Hand einmal montiert und verknüpft alle vier Menüpunkte mit Dialogen", () => {
  const game = foundedGame();
  for (const local of [false, true]) {
    const html = ui(game, game.players[game.currentPlayer].id, { local, onHide() {} });
    assertMountedIsland(html, null);
    assert.match(html, /<nav[^>]*class="catan-fullscreen-nav"[^>]*aria-label="Vollbild-Spielmenü"/);
    const triggers = (html.match(/<button\b[^>]*>/g) ?? []).filter((tag) => attribute(tag, "data-catan-fullscreen-trigger"));
    assert.deepEqual(triggers.map((tag) => attribute(tag, "data-catan-fullscreen-trigger")), ["karten", "bauen", "handel", "uebersicht"]);
    for (const trigger of triggers) {
      const name = attribute(trigger, "data-catan-fullscreen-trigger");
      const dialog = panelTags(html).find((tag) => attribute(tag, "data-catan-fullscreen-panel") === name);
      assert.equal(attribute(trigger, "aria-haspopup"), "dialog");
      assert.equal(attribute(trigger, "aria-expanded"), "false");
      assert.equal(attribute(trigger, "aria-controls"), attribute(dialog, "id"));
      assert.equal(attribute(dialog, "role"), "dialog");
      assert.equal(attribute(dialog, "tabindex"), "-1");
      assert.match(panel(html, name), /aria-label="Vollbildmenü schließen"/);
    }
    assert.match(panel(html, "bauen"), /<h2>Was möchtest du bauen\?<\/h2>/);
  }
});

test("eine eigene Abgabe öffnet ausschließlich Karten mit Mengenwahl und Bestätigung über der Insel", () => {
  let game = foundedGame(); const actor = game.players[game.currentPlayer].id;
  game.players[game.currentPlayer].resources = { wood: 9, brick: 0, wool: 0, grain: 0, ore: 0 };
  game = applyCatanAction(game, actor, { type: "roll" }, sequence([0, 5]));
  assert.equal(game.phase, "discard"); assert.equal(game.discards[actor], 4);
  for (const busy of [false, true]) {
    const html = ui(game, actor, { busy });
    assertMountedIsland(html, "karten");
    const cards = panel(html, "karten");
    assert.match(cards, /<h2>Rohstoffe abgeben<\/h2>/);
    assert.equal((cards.match(/class="catan-amount-controls"/g) ?? []).length, 5);
    assert.match(cards, /<button[^>]*disabled=""[^>]*>Abgabe bestätigen<\/button>/);
    const trigger = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((button) => attribute(button, "data-catan-fullscreen-trigger") === "karten");
    assert.match(trigger, /aria-expanded="true"/);
    assert.match(trigger, /aria-label="Karten öffnen, 4 Rohstoffkarten abgeben"/);
    assert.match(trigger, /catan-nav-badge is-alert[^>]*>4<\/span>/);
  }
});

test("ein eingehendes Angebot öffnet Handel mit Antwortaktionen und eigenem Hinweis-Badge", () => {
  let game = foundedGame(); const actor = game.players[game.currentPlayer].id;
  const recipient = game.players.find((player) => player.id !== actor).id;
  game.players[game.currentPlayer].resources.wood = 2;
  game = applyCatanAction(game, actor, { type: "roll" }, sequence([1, 3]));
  game = applyCatanAction(game, actor, { type: "offer_trade", toId: recipient, give: { wood: 1 }, receive: { ore: 1 } });
  const html = ui(game, recipient, { busy: true });
  assertMountedIsland(html, "handel");
  const trade = panel(html, "handel");
  assert.match(trade, /<h2>Angebot von Robin<\/h2>/);
  for (const label of ["Ablehnen", "Gegenangebot", "Annehmen"]) assert.match(trade, new RegExp(`<button[^>]*disabled=""[^>]*>${label}<\\/button>`));
  const trigger = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((button) => attribute(button, "data-catan-fullscreen-trigger") === "handel");
  assert.match(trigger, /aria-expanded="true"/);
  assert.match(trigger, /aria-label="Handel öffnen, Ein Handelsangebot wartet auf deine Antwort"/);
  assert.match(trigger, /catan-nav-badge is-alert[^>]*>1<\/span>/);
});

test("das Spielende öffnet die Übersicht mit Gewinner und erreichbarer Folgeaktion über derselben Insel", () => {
  let game = foundedGame(); const actor = game.players[game.currentPlayer];
  actor.development = Array.from({ length: 8 }, (_, index) => ({ id: `point-${index}`, type: "victory", boughtOnTurn: 0 }));
  game = applyCatanAction(game, actor.id, { type: "roll" }, sequence([1, 3]));
  assert.equal(game.phase, "finished");
  const html = ui(game, game.players.find((player) => player.id !== actor.id).id, { onRematch() {} });
  assertMountedIsland(html, "uebersicht");
  const overview = panel(html, "uebersicht");
  assert.match(overview, /<h2>Robin gewinnt!<\/h2>/);
  assert.equal((overview.match(/class="catan-player-card"/g) ?? []).length, 3);
  assert.match(overview, /<footer class="catan-screen-actions">[\s\S]*>Neue Partie vorbereiten<\/button>/);
});

test("nach der eigenen Abgabe bleibt die Räuberaufgabe auf der aktiven Insel ohne offenes Menü", () => {
  let game = foundedGame(); const actor = game.players[game.currentPlayer].id;
  game.players[game.currentPlayer].resources = { wood: 9, brick: 0, wool: 0, grain: 0, ore: 0 };
  game = applyCatanAction(game, actor, { type: "roll" }, sequence([0, 5]));
  game = applyCatanAction(game, actor, { type: "discard", resources: { wood: 4 } });
  assert.equal(game.phase, "robber");
  const html = ui(game, actor);
  assertMountedIsland(html, null);
  assert.match(html, /aria-label="Räuber auf Feld \d+[^>]*role="button"|role="button"[^>]*aria-label="Räuber auf Feld \d+/);
  assert.match(html, />Räuber versetzen<\/button>/);
});
