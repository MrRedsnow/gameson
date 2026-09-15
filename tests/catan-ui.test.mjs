import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the real play screen with engine-generated states: the pinned menu, its badges and the resource icons.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-ui-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export * from "./components/catan/game-ui";\nexport { WoodIcon, ResourceIcon } from "./components/catan/board";\nexport * from "./lib/catan";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { CatanGameUI, CATAN_TABS, suggestedTab, WoodIcon, ResourceIcon, createCatanGame, applyCatanAction, catanView, legalSettlements, legalRoads } = createRequire(import.meta.url)(output);
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const send = async () => true;
const seats = [{ id: "a", name: "Robin" }, { id: "b", name: "Mara" }, { id: "c", name: "Lea" }];
const sequence = (values) => { let i = 0; return (length) => values[i++ % values.length] % length; };

function foundedGame() {
  let game = createCatanGame(seats, 10, sequence([0]));
  for (let step = 0; step < 6; step++) {
    const actor = game.players[game.currentPlayer].id;
    game = applyCatanAction(game, actor, { type: "build", building: "settlement", position: legalSettlements(game, actor, true)[0] }, sequence([0]));
    game = applyCatanAction(game, actor, { type: "build", building: "road", position: legalRoads(game, actor, game.setupVertex)[0] }, sequence([0]));
  }
  return game;
}
const ui = (game, viewerId, extra = {}) => render(CatanGameUI, { game: catanView(game, viewerId), send, busy: false, local: false, ...extra });

test("zeigt fünf angeheftete Menübereiche mit sprechenden Gruppen", () => {
  assert.deepEqual(CATAN_TABS.map((tab) => tab.label), ["Insel", "Karten", "Bauen", "Handel", "Übersicht"]);
  const game = createCatanGame(seats, 12, sequence([0]));
  const html = ui(game, game.players[0].id);
  assert.match(html, /<nav class="catan-nav" aria-label="Spielmenü">/);
  assert.equal((html.match(/class="catan-nav-tab"/g) ?? []).length, 5);
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*data-state="active"[^>]*id="[^"]*-trigger-insel"/);
  for (const tab of CATAN_TABS) assert.match(html, new RegExp(`role="tabpanel"[^>]*id="[^"]*-content-${tab.id}"[^>]*class="catan-tab-panel"`));
  assert.match(html, /Deine Karten öffnen: 0 Holz, 0 Lehm, 0 Wolle, 0 Getreide, 0 Erz/);
  assert.match(html, /class="catan-score-strip" aria-label="Punktestand"/);
});

test("öffnet den Bereich, dessen Aufgabe gerade ansteht", () => {
  const setup = createCatanGame(seats, 12, sequence([0]));
  assert.equal(suggestedTab(catanView(setup, setup.players[0].id)), "insel");
  assert.equal(suggestedTab(catanView(setup, setup.players[1].id)), "insel");
  let game = foundedGame();
  const active = game.players[game.currentPlayer].id; const other = game.players.find((p) => p.id !== active).id;
  assert.equal(game.phase, "roll");
  assert.match(ui(game, active), /class="catan-turn-actions"><button[^>]*>[^<]*<svg[^>]*lucide-dices[\s\S]*?Würfeln<\/button>/);
  game = applyCatanAction(game, active, { type: "roll" }, sequence([1, 3]));
  assert.equal(game.phase, "main");
  assert.equal(suggestedTab(catanView(game, active)), "bauen");
  assert.equal(suggestedTab(catanView(game, other)), "insel");
  assert.match(ui(game, active), /Zug beenden →/);
  const main = ui(game, active);
  assert.match(main, /class="catan-supply" aria-label="Dein Vorrat"[\s\S]*13 Straßen[\s\S]*3 Siedlungen[\s\S]*4 Städte/);
  const offered = { ...game, players: game.players.map((p) => p.id === active ? { ...p, resources: { ...p.resources, wood: 2 } } : p) };
  const withOffer = applyCatanAction(offered, active, { type: "offer_trade", toId: other, give: { wood: 1 }, receive: { ore: 1 } });
  assert.equal(suggestedTab(catanView(withOffer, other)), "handel");
  assert.match(ui(withOffer, other), /class="catan-nav-badge is-alert" aria-hidden="true">1<\/span><\/span><span class="catan-nav-label">Handel<\/span><span class="sr-only">, Ein Handelsangebot wartet auf deine Antwort/);
  assert.match(ui(withOffer, active), /class="catan-nav-badge is-dot"[^>]*><\/span><\/span><span class="catan-nav-label">Handel<\/span><span class="sr-only">, Dein Angebot ist noch offen/);
});

test("warnt in den Karten vor mehr als sieben Rohstoffen und beim Abgeben", () => {
  const game = foundedGame(); const me = game.players[0].id;
  const rich = { ...game, players: game.players.map((p) => p.id === me ? { ...p, resources: { wood: 3, brick: 2, wool: 2, grain: 1, ore: 1 } } : p) };
  const html = ui(rich, me);
  assert.match(html, /class="catan-nav-badge is-warn" aria-hidden="true">9<\/span><\/span><span class="catan-nav-label">Karten<\/span><span class="sr-only">, 9 Rohstoffkarten, bei einer 7 musst du abgeben/);
  assert.match(html, /Mehr als sieben Karten: Bei einer 7 musst du 4 abgeben\./);
  const discard = { ...rich, phase: "discard", discards: { [me]: 4 } };
  assert.equal(suggestedTab(catanView(discard, me)), "karten");
  const discardHtml = ui(discard, me);
  assert.match(discardHtml, /class="catan-nav-badge is-alert" aria-hidden="true">4<\/span><\/span><span class="catan-nav-label">Karten<\/span><span class="sr-only">, 4 Karten abgeben/);
  assert.match(discardHtml, /class="catan-panel catan-discard"/);
  assert.equal(suggestedTab(catanView(discard, game.players[1].id)), "insel");
});

test("stellt Holz als Holzstapel statt als Baum dar", () => {
  const wood = render(WoodIcon, {});
  assert.match(wood, /class="catan-wood-icon"/);
  assert.equal((wood.match(/<circle /g) ?? []).length, 6);
  assert.match(render(ResourceIcon, { resource: "wood" }), /catan-wood-icon/);
  assert.doesNotMatch(render(ResourceIcon, { resource: "wood" }), /lucide-trees|lucide-tree/);
  const game = createCatanGame(seats, 12, sequence([0]));
  assert.doesNotMatch(ui(game, game.players[0].id), /lucide-trees/);
});
