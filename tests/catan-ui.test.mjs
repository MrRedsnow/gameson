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
  stdin: { contents: 'export * from "./components/catan/game-ui";\nexport { WoodIcon, ResourceIcon } from "./components/catan/board";\nexport * from "./lib/catan";\nexport * from "./lib/catan-ux";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { CatanGameUI, CATAN_TABS, suggestedTab, WoodIcon, ResourceIcon, createCatanGame, applyCatanAction, catanView, legalSettlements, legalRoads, COSTS, buildUnavailable, hasBuildOption, buildingPreview } = createRequire(import.meta.url)(output);
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
  for (const tab of CATAN_TABS) assert.match(html, new RegExp(`role="tabpanel"[^>]*id="[^"]*-content-${tab.id}"[^>]*class="catan-tab-panel`));
  assert.match(html, /Deine Karten öffnen: 0 Holz, 0 Lehm, 0 Wolle, 0 Getreide, 0 Erz/);
  assert.match(html, /Punktestand öffnen: Du hast 0 von 12 Siegpunkten/);
  // Das Brett trägt keine eigene Kopfzeile und keine Legende mehr; beides kostete dauerhaft Platz.
  assert.doesNotMatch(html, /catan-board-toolbar|catan-board-legend/);
  assert.match(html, /class="catan-board-controls"/);
  assert.match(html, /Nächster Bauplatz oder Räuberplatz/);
});

test("hält Zugstatus, Würfelwurf und nächsten Schritt dauerhaft im Bild", () => {
  let game = foundedGame();
  const active = game.players[game.currentPlayer].id; const other = game.players.find((p) => p.id !== active).id;
  const waiting = ui(game, other);
  // Die Statuszeile steht vor allen Menübereichen und nennt, wer dran ist.
  const status = waiting.slice(waiting.indexOf('class="catan-status '), waiting.indexOf('class="catan-hand-bar'));
  assert.ok(status, "Die Statuszeile fehlt.");
  assert.match(status, new RegExp(`${game.players[game.currentPlayer].name} ist am Zug`));
  assert.match(status, /Punktestand öffnen: Du hast 2 von 10 Siegpunkten/);
  assert.match(status, /Zug erklären/);
  assert.match(status, /aria-expanded="false"/);
  assert.match(ui(createCatanGame(seats, 12, sequence([0])), seats[0].id), /Erste Siedlung setzen/);
  game = applyCatanAction(game, active, { type: "roll" }, sequence([1, 3]));
  // Nach dem Wurf steht das Ergebnis in derselben Zeile – auch für alle, die nicht am Zug sind.
  assert.match(ui(game, other), /class="catan-status[^"]*"[\s\S]*?class="catan-dice"[^>]*aria-label="Würfel: 2 und 4, Summe 6"/);
});

test("öffnet den Bereich, dessen Aufgabe gerade ansteht", () => {
  const setup = createCatanGame(seats, 12, sequence([0]));
  assert.equal(suggestedTab(catanView(setup, setup.players[0].id)), "insel");
  assert.equal(suggestedTab(catanView(setup, setup.players[1].id)), "insel");
  let game = foundedGame();
  const active = game.players[game.currentPlayer].id; const other = game.players.find((p) => p.id !== active).id;
  assert.equal(game.phase, "roll");
  assert.match(ui(game, active), /class="catan-screen-actions"[\s\S]*?<svg[^>]*lucide-dices[\s\S]*?Würfeln<\/button>/);
  game = applyCatanAction(game, active, { type: "roll" }, sequence([1, 3]));
  assert.equal(game.phase, "main");
  assert.equal(suggestedTab(catanView(game, active)), "insel");
  assert.equal(suggestedTab(catanView(game, other)), "insel");
  assert.match(ui(game, active), /Zug beenden/);
  const main = ui(game, active);
  assert.match(main, /class="catan-screen-actions"[\s\S]*?Handeln<\/button>[\s\S]*?Zug beenden<\/button>/);
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
  assert.match(discardHtml, /class="catan-screen catan-discard"/);
  assert.equal(suggestedTab(catanView(discard, game.players[1].id)), "insel");
});

test("heftet die eigenen Rohstoffe über alle Menübereiche an", () => {
  const game = foundedGame(); const me = game.players[0].id;
  const rich = { ...game, players: game.players.map((p) => p.id === me ? { ...p, resources: { wood: 3, brick: 2, wool: 2, grain: 1, ore: 1 } } : p) };
  const html = ui(rich, me);
  const bar = html.match(/<div class="catan-hand-bar[^"]*">[\s\S]*?<\/button><\/div>/);
  assert.ok(bar, "Die angeheftete Rohstoffleiste fehlt.");
  // Sie steht vor den Menübereichen und damit in jedem Bereich, nicht nur auf der Insel.
  assert.ok(html.indexOf(bar[0]) < html.indexOf('class="catan-tab-panel"'));
  assert.equal((html.match(/catan-hand-strip/g) ?? []).length, 1);
  assert.match(bar[0], /class="catan-hand-total"[^>]*>[\s\S]*?9<\/span>/);
  assert.match(bar[0], /Deine Karten öffnen: 3 Holz, 2 Lehm, 2 Wolle, 1 Getreide, 1 Erz/);
  assert.match(html, /<div class="catan-hand-bar is-warn">/);
  assert.match(ui({ ...rich, phase: "discard", discards: { [me]: 4 } }, me), /<div class="catan-hand-bar is-alert">/);
});

test("Handel startet mit Hafen und Bank oder Mitspielenden und fragt dann Schritt für Schritt", () => {
  let game = foundedGame();
  const active = game.players[game.currentPlayer].id; const other = game.players.find((p) => p.id !== active).id;
  game = applyCatanAction(game, active, { type: "roll" }, sequence([1, 3]));
  const html = ui(game, active);
  assert.match(html, /class="catan-trade-options">[\s\S]*?Hafen &amp; Bank[\s\S]*?Fester Kurs ab [234]:1[\s\S]*?Mitspielende[\s\S]*?Angebot an eine Person am Tisch/);
  // Erst nach der Wahl folgen die Fragen nach Person, Gabe und Wunsch.
  assert.doesNotMatch(html, /Schritt \d von 3|catan-trade-partner|catan-resource-picker|catan-two-fields/);
  assert.match(ui(game, other), new RegExp(`Angebot an ${game.players[game.currentPlayer].name} senden`));
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


test("Bauentscheidungen erklären Kosten, Zugphase, leeren Vorrat und fehlende Plätze", () => {
  const g = foundedGame(); const id = g.players[g.currentPlayer].id;
  assert.match(buildUnavailable(catanView(g, id), "road"), /Würfle zuerst/);
  g.phase = "main";
  g.players.find((p) => p.id === id).resources = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  assert.match(buildUnavailable(catanView(g, id), "road"), /Dir fehlen 1 Holz, 1 Lehm/);
  assert.equal(hasBuildOption(catanView(g, id)), false);
  g.players.find((p) => p.id === id).resources = { ...COSTS.city, wood: 5, brick: 5, wool: 5 };
  assert.equal(buildUnavailable(catanView(g, id), "city"), undefined);
  assert.equal(hasBuildOption(catanView(g, id)), true);
  const view = catanView(g, id);
  view.players.find((p) => p.id === id).pieces.road = 15;
  assert.match(buildUnavailable(view, "road"), /Keine Straßen mehr/);
  view.deckCount = 0;
  assert.match(buildUnavailable(view, "development"), /Kartenstapel ist leer/);
  view.board.vertices.forEach((vertex) => { if (vertex.owner === id) vertex.building = "city"; });
  assert.match(buildUnavailable(view, "city"), /eigene Siedlung/);
  assert.match(buildUnavailable(catanView(g, g.players.find((p) => p.id !== id).id), "road"), /eigenen Zug/);
});

test("Bauplatzvorschau erklärt angrenzende Zahlen, Häfen und Startrohstoffe", () => {
  const g = createCatanGame(seats, 12, sequence([0])); const view = catanView(g, g.players[0].id);
  const harbor = g.board.harbors.find((h) => h.resource !== "any");
  const vertex = g.board.edges[harbor.edge].a;
  const preview = buildingPreview(view, "settlement", vertex);
  assert.match(preview.port, /Hafen: 2:1/);
  assert.equal(preview.fields.length, g.board.vertices[vertex].hexes.filter((id) => g.board.hexes[id].resource !== "desert").length);
  for (const field of preview.fields) {
    const combinations = Array.from({ length: 36 }, (_, i) => Math.floor(i / 6) + i % 6 + 2).filter((sum) => sum === field.number).length;
    assert.equal(field.combinations, combinations);
  }
  view.setupIndex = view.players.length;
  assert.match(buildingPreview(view, "settlement", vertex).hint, /Startrohstoffe sofort/);
  assert.match(buildingPreview(view, "city", vertex).hint, /2 Rohstoffe/);
  assert.match(buildingPreview(view, "road", harbor.edge).hint, /selbst keine Rohstoffe/);
});

test("eingehende Angebote zeigen die eigene Perspektive und haben Entscheidungsaktionen", () => {
  const g = foundedGame(); g.phase = "main";
  const a = g.players[0].id; const b = g.players[1].id;
  g.players[0].resources.wood = 3; g.players[1].resources.ore = 2;
  const offered = applyCatanAction(g, a, { type: "offer_trade", toId: b, give: { wood: 2 }, receive: { ore: 1 } });
  const html = ui(offered, b);
  assert.match(html, /Du gibst<\/span><strong><span>1 Erz/);
  assert.match(html, /Du erhältst<\/span><strong><span>2 Holz/);
  assert.match(html, /Annehmen<\/button>/);
  assert.match(html, /Gegenangebot<\/button>/);
  assert.match(html, /Ablehnen<\/button>/);
  assert.doesNotMatch(html, /catan-event-overlay|Rohstoffe einsammeln/);
});
