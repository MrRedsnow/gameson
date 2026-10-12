import { acceptMap } from "./catan-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the real play screen and its panels with engine-generated states.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-ui-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export * from "./components/catan/game-ui";\nexport { CatanBoard, WoodIcon, ResourceIcon } from "./components/catan/board";\nexport { CardsPanel } from "./components/catan/cards-panel";\nexport { OverviewPanel } from "./components/catan/overview-panel";\nexport { ResourceAmounts } from "./components/catan/play-primitives";\nexport { TradeInventoryPreview } from "./components/catan/trade-panel";\nexport * from "./lib/catan";\nexport * from "./lib/catan-ux";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { CatanGameUI, CatanRules, CatanBoard, CardsPanel, OverviewPanel, ResourceAmounts, TradeInventoryPreview, CATAN_TABS, suggestedTab, navigationTask, resolveNavigation, WoodIcon, ResourceIcon, createCatanGame, applyCatanAction, catanView, legalSettlements, legalRoads, tradeRatio, COSTS, RESOURCES, RESOURCE_INFO, emptyResources, buildUnavailable, hasBuildOption, buildingPreview, developmentGroups } = createRequire(import.meta.url)(output);
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const send = async () => true;
const seats = [{ id: "a", name: "Robin" }, { id: "b", name: "Mara" }, { id: "c", name: "Lea" }];
const sequence = (values) => { let i = 0; return (length) => values[i++ % values.length] % length; };

test("map voting shows the island, progress, immutable own vote and host-only tie actions", () => {
  let game = createCatanGame([...seats, { id: "d", name: "Dana" }], 12, sequence([0]));
  let html = ui(game, "b");
  assert.match(html, /Kartenabstimmung/); assert.match(html, /Karte akzeptieren/); assert.match(html, /Karte ablehnen/);
  assert.match(html, /0 Ja · 0 Nein · 4 offen/); assert.match(html, /Feld ansehen:/);
  assert.doesNotMatch(html, /Siedlung auf Kreuzung|Starthilfe zur Gründung|catan-hand-bar/);
  assert.equal((html.match(/<button\b[^>]*>/g) ?? []).filter((tag) => /data-catan-menu-trigger="(?:karten|bauen|handel)"/.test(tag) && /disabled=""/.test(tag)).length, 3);
  const mapId = game.mapVote.id;
  game = applyCatanAction(game, "b", { type: "map_vote", mapId, accept: false });
  html = ui(game, "b");
  assert.match(html, /Du hast die Karte abgelehnt/); assert.match(html, /0 Ja · 1 Nein · 3 offen/);
  assert.doesNotMatch(html, /Karte akzeptieren|Karte ablehnen/);
  for (const [id, accept] of [["a", true], ["c", true], ["d", false]]) game = applyCatanAction(game, id, { type: "map_vote", mapId, accept });
  const host = ui(game, "a"); const guest = ui(game, "b");
  assert.match(host, /2 Ja · 2 Nein · 0 offen/); assert.match(host, /Karte annehmen/); assert.match(host, /Neue Karte/);
  assert.match(guest, /Gleichstand: Robin entscheidet/); assert.doesNotMatch(guest, /Karte annehmen|Neue Karte/);
  assert.match(ui(game, "a", { busy: true }), /<button[^>]*disabled=""[^>]*>Karte annehmen/);
  game = applyCatanAction(game, "a", { type: "resolve_map_tie", mapId, accept: true });
  assert.match(ui(game, "a"), /Erste Siedlung setzen|mit der Gründung dran/); assert.doesNotMatch(ui(game, "a"), /catan-map-vote/);
});

function foundedGame() {
  let game = acceptedCatanGame(seats, 10, sequence([0]));
  for (let step = 0; step < 6; step++) {
    const actor = game.players[game.currentPlayer].id;
    game = applyCatanAction(game, actor, { type: "build", building: "settlement", position: legalSettlements(game, actor, true)[0] }, sequence([0]));
    game = applyCatanAction(game, actor, { type: "build", building: "road", position: legalRoads(game, actor, game.setupVertex)[0] }, sequence([0]));
  }
  return game;
}
const ui = (game, viewerId, extra = {}) => render(CatanGameUI, { game: catanView(game, viewerId), send, busy: false, local: false, ...extra });
const overview = (game, viewerId, extra = {}) => render(OverviewPanel, { game: catanView(game, viewerId), page: "menu", setPage() {}, activity: [], unreadActivity: [], unread: 0, onRead() {}, local: false, busy: false, ...extra });
function labelledButton(html, label) {
  const button = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((element) => element.includes(`aria-label="${label}"`));
  assert.ok(button, `Die Aktion ${label} fehlt.`);
  return button;
}
function isDisabled(html, label) { return /\bdisabled=""/.test(labelledButton(html, label)); }
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
function menu(html, name) {
  const tags = (html.match(/<div\b[^>]*>/g) ?? []).filter((tag) => attribute(tag, "data-catan-menu-panel"));
  const tag = tags.find((element) => attribute(element, "data-catan-menu-panel") === name);
  assert.ok(tag, `Das montierte Menü ${name} fehlt.`);
  const start = html.indexOf(tag);
  const next = tags.map((element) => html.indexOf(element)).filter((index) => index > start).sort((a, b) => a - b)[0];
  return html.slice(start, next ?? html.indexOf('<nav ', start));
}
function buildRow(html, kind) {
  const label = { road: "Straße", settlement: "Siedlung", city: "Stadt", development: "Entwicklungskarte kaufen" }[kind];
  const row = (menu(html, "bauen").match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((button) => button.includes(`<strong>${label}</strong>`));
  assert.ok(row, `Die Bauoption ${label} fehlt.`);
  return row;
}
function costNumber(row, resource) {
  const entry = row.match(new RegExp(`<span\\b[^>]*data-catan-cost="${resource}"[^>]*>[\\s\\S]*?<b\\b([^>]*)>(\\d+)<\\/b>`));
  assert.ok(entry, `Die benötigte Menge für ${resource} fehlt.`);
  return { count: Number(entry[2]), missing: /\bclass="is-missing"/.test(entry[1]) };
}
function buildNavigation(html) {
  const button = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((element) => attribute(element, "data-catan-menu-trigger") === "bauen");
  assert.ok(button, "Der Bauen-Tab fehlt.");
  return button;
}

test("zeigt fünf angeheftete Menübereiche mit sprechenden Gruppen", () => {
  assert.deepEqual(CATAN_TABS.map((tab) => tab.label), ["Insel", "Karten", "Bauen", "Handel", "Übersicht"]);
  const game = acceptedCatanGame(seats, 12, sequence([0]));
  const html = ui(game, game.players[0].id);
  assert.match(html, /<nav[^>]*class="catan-nav"[^>]*aria-label="Spielmenü"/);
  const triggers = (html.match(/<button\b[^>]*>/g) ?? []).filter((tag) => attribute(tag, "data-catan-menu-trigger"));
  assert.equal(triggers.length, 5);
  for (const trigger of triggers) assert.match(attribute(trigger, "class"), /\bcatan-nav-tab\b/);
  assert.deepEqual(triggers.map((tag) => attribute(tag, "data-catan-menu-trigger")), CATAN_TABS.map((tab) => tab.id));
  assert.equal(attribute(triggers[0], "data-state"), "active");
  assert.match(html, /class="catan-menu-stage"/);
  const island = (html.match(/<div\b[^>]*>/g) ?? []).find((tag) => attribute(tag, "class") === "catan-tab-panel catan-tab-insel");
  assert.equal(attribute(island, "data-state"), "active");
  for (const tab of CATAN_TABS.filter((tab) => tab.id !== "insel")) assert.match(menu(html, tab.id), /role="dialog"/);
  assert.match(html, /Deine Rohstoffe: 0 Holz, 0 Lehm, 0 Wolle, 0 Getreide, 0 Erz/);
  assert.doesNotMatch(html, /catan-hand-meta|>Deine Rohstoffe<|aria-label="Spielübersicht öffnen"/);
  assert.match(labelledButton(html, "Karten öffnen, 0 Rohstoffkarten"), /catan-hand-total[^>]*>[\s\S]*?<b class="catan-hand-count">0<\/b>/);
  assert.doesNotMatch(html, /Deine Karten öffnen/);
  assert.match(html, /Punktestand öffnen: Du hast 0 von 12 Siegpunkten/);
  // Das Brett trägt keine eigene Kopfzeile und keine Legende mehr; beides kostete dauerhaft Platz.
  assert.doesNotMatch(html, /catan-board-toolbar|catan-board-legend/);
  assert.match(html, /class="catan-board-controls"/);
  assert.doesNotMatch(html, /catan-board-selection|Vorheriger Bauplatz|Nächster Bauplatz/);
});

test("zeigt oben nur die Person am Zug ohne ausklappbare Erklärung und behält Würfel und Punkte", () => {
  let game = foundedGame();
  const active = game.players[game.currentPlayer].id; const other = game.players.find((p) => p.id !== active).id;
  const waiting = ui(game, other);
  // Die Statuszeile steht vor allen Menübereichen und nennt, wer dran ist.
  const statusRow = (html) => html.slice(html.indexOf('class="catan-status '), html.indexOf('class="catan-hand-bar'));
  const status = statusRow(waiting);
  assert.ok(status, "Die Statuszeile fehlt.");
  assert.match(status, new RegExp(`${game.players[game.currentPlayer].name} ist am Zug`));
  assert.match(status, /Punktestand öffnen: Du hast 2 von 10 Siegpunkten/);
  assert.match(status, /<div class="catan-status-main" aria-live="polite" aria-atomic="true">/);
  assert.doesNotMatch(status, /<button[^>]*class="catan-status-main"|Zug erklären|aria-expanded|lucide-chevron-down|catan-phase-help|Warten auf den Würfelwurf/);
  const ownStatus = statusRow(ui(game, active));
  assert.match(ownStatus, /<strong>Du bist am Zug<\/strong>/);
  assert.doesNotMatch(ownStatus, /Würfeln, bauen oder handeln/);
  assert.match(ui(acceptedCatanGame(seats, 12, sequence([0])), seats[0].id), /Erste Siedlung setzen/);
  game = applyCatanAction(game, active, { type: "roll" }, sequence([1, 3]));
  // Nach dem Wurf steht das Ergebnis in derselben Zeile – auch für alle, die nicht am Zug sind.
  assert.match(ui(game, other), /class="catan-status[^"]*"[\s\S]*?class="catan-dice"[^>]*aria-label="Würfel: 2 und 4, Summe 6"/);
});

test("Ganze Insel bleibt als Reset auch beim Erkunden und während einer Spielaktion erreichbar", () => {
  const game = acceptedCatanGame(seats, 12, sequence([0]));
  const view = catanView(game, game.players[0].id);
  for (const disabled of [false, true]) {
    const html = render(CatanBoard, { game: view, mode: null, choices: [], selected: null, onSelect() {}, disabled });
    const reset = html.match(/<button\b[^>]*aria-label="Ganze Insel anzeigen und zentrieren"[^>]*>[\s\S]*?<\/button>/);
    assert.ok(reset, "Der Reset zur zentrierten Inselübersicht fehlt.");
    assert.match(reset[0], /<svg/);
    assert.doesNotMatch(reset[0], /\bdisabled(?:=|[ >])/);
    assert.match(html, /<button\b[^>]*aria-label="Insel vergrößern"/);
    assert.match(html, /<button\b[^>]*aria-label="Insel verkleinern"/);
    assert.doesNotMatch(html, /Feld antippen zum Vergrößern|Felder ansehen|Vorheriges Landschaftsfeld|Nächstes Landschaftsfeld/);
  }
});

test("Bauplätze bleiben konkrete Tastaturziele und eine Auswahl verändert den Kartenausschnitt nicht", () => {
  const game = acceptedCatanGame(seats, 12, sequence([0]));
  const view = catanView(game, game.players[0].id);
  const choices = legalSettlements(game, game.players[0].id, true);
  const props = { game: view, mode: "settlement", choices, selected: null, onSelect() {}, disabled: false };
  const overview = render(CatanBoard, props);
  const selected = render(CatanBoard, { ...props, selected: choices[0] });
  const viewBox = (html) => html.match(/<svg\b[^>]*class="catan-board"[^>]*viewBox="([^"]+)"/)?.[1];
  assert.ok(viewBox(overview), "Der Kartenausschnitt fehlt.");
  assert.equal(viewBox(selected), viewBox(overview), "Eine Bauplatzauswahl darf die Kamera nicht automatisch verschieben oder vergrößern.");
  assert.doesNotMatch(overview, /aria-label="Bauplätze ansehen:/, "Ein Landschaftstap darf keinen beliebigen angrenzenden Bauplatz wählen.");
  for (const id of choices) assert.match(overview, new RegExp(`role="button"[^>]*tabindex="0"[^>]*aria-label="Siedlung auf Kreuzung ${id + 1} bauen"`));
  assert.match(selected, new RegExp(`aria-label="Siedlung auf Kreuzung ${choices[0] + 1} bauen"[^>]*aria-pressed="true"`));
  const busy = render(CatanBoard, { ...props, disabled: true });
  assert.match(busy, /role="button"[^>]*tabindex="-1"[^>]*aria-label="Siedlung auf Kreuzung \d+ bauen"[^>]*aria-disabled="true"/);
});

test("normale und maximierte Karte behalten Bauziele und Kamerasteuerung ohne die zusätzliche Platzliste", () => {
  const game = acceptedCatanGame(seats, 12, sequence([0])); const viewer = game.players[0].id;
  const choices = legalSettlements(game, viewer, true);
  const props = { game: catanView(game, viewer), mode: "settlement", choices, selected: choices[0], onSelect() {}, disabled: false };
  const normal = render(CatanBoard, props); const expanded = render(CatanBoard, { ...props, expanded: true });
  for (const html of [normal, expanded]) assert.doesNotMatch(html, /catan-board-selection|Vorheriger Bauplatz|Nächster Bauplatz/);
  for (const label of ["Insel verkleinern", "Ganze Insel anzeigen und zentrieren", "Insel vergrößern"]) labelledButton(expanded, label);
  assert.match(expanded, new RegExp(`aria-label="Siedlung auf Kreuzung ${choices[0] + 1} bauen"[^>]*aria-pressed="true"`));
  assert.equal((expanded.match(/aria-label="Siedlung auf Kreuzung/g) ?? []).length, choices.length);
});

test("der gemalte Räuber bleibt auf allen 19 Feldern über Gebäuden und Baueffekten sichtbar", () => {
  const initial = acceptedCatanGame(seats, 12, sequence([0]));
  for (const hex of initial.board.hexes) {
    const game = structuredClone(initial); game.robberHex = hex.id;
    for (const [index, vertexId] of hex.vertices.filter((_, corner) => corner % 2 === 0).entries()) {
      Object.assign(game.board.vertices[vertexId], { owner: game.players[index].id, building: index === 0 ? "city" : "settlement" });
    }
    for (const expanded of [false, true]) {
      const html = render(CatanBoard, { game: catanView(game, game.players[0].id), mode: null, choices: [], selected: null, onSelect() {}, disabled: false, expanded });
      const layer = html.match(/<g class="catan-robber-layer"[^>]*>[\s\S]*?<\/g>/)?.[0];
      assert.ok(layer, `Räuberebene fehlt auf Feld ${hex.id}.`);
      assert.equal((html.match(/class="catan-robber-piece"/g) ?? []).length, 1);
      assert.equal((html.match(/class="catan-number-label[^"]*"/g) ?? []).length, 18);
      assert.match(html, /href="\/catan\/robber-v2\.png" width="40" height="40"/);
      const landscapes = html.match(/<use class="catan-landscape[^"]*"[^>]*>/g);
      assert.equal(landscapes.length, 19);
      assert.equal(landscapes.filter((landscape) => landscape.includes("is-blocked")).length, 1, "Nur das aktuelle Räuberfeld darf ausgegraut werden.");
      assert.ok(landscapes[hex.id].includes('class="catan-landscape is-blocked"'));
      assert.match(layer, /role="img"[^>]*aria-label="Räuber auf Feld \d+ – blockiert den Ertrag"[^>]*pointer-events="none"/);
      assert.ok(layer.includes(`data-catan-robber="${hex.id}"`));
      assert.ok(layer.includes(`transform="translate(${hex.x - 20} ${hex.y - 29})"`));
      assert.ok(html.indexOf(layer) > html.lastIndexOf("data-catan-building="));
      assert.ok(html.indexOf(layer) > html.indexOf('class="catan-construction-effects"'));
      assert.match(html, /Räuber blockiert den Ertrag/);
      assert.doesNotMatch(html, />R<\/text>/);
      if (hex.number) {
        assert.ok(layer.includes(`x="${hex.x}" y="${hex.y + 36}" text-anchor="middle" aria-hidden="true">${hex.number}</text>`));
        assert.match(layer, /class="catan-number-label[^"]* is-blocked"/);
        assert.doesNotMatch(layer, /on-grain/, "Auch auf ausgegrautem Acker muss die Zahl hell sein.");
      } else {
        assert.doesNotMatch(layer, /catan-number-label/);
        assert.match(layer, /class="catan-blocked-desert-label"[^>]*>Wüste<\/text>/);
        assert.equal((html.match(/>Wüste<\/text>/g) ?? []).length, 1);
      }
    }
  }
});

test("die Räuberebene erhält Feld- und Bauziele einschließlich Tastaturauswahl", () => {
  const game = acceptedCatanGame(seats, 12, sequence([0])); const viewer = game.players[0].id;
  const choices = game.board.hexes.filter((hex) => hex.id !== game.robberHex).map((hex) => hex.id);
  for (const disabled of [false, true]) {
    const html = render(CatanBoard, { game: catanView(game, viewer), mode: "robber", choices, selected: choices[0], onSelect() {}, disabled });
    assert.equal((html.match(/role="button"[^>]*aria-label="Räuber auf Feld/g) ?? []).length, 18);
    assert.match(html, new RegExp(`role="button"[^>]*tabindex="${disabled ? -1 : 0}"[^>]*aria-label="Räuber auf Feld ${choices[0] + 1}:[^"]*"[^>]*aria-pressed="true"[^>]*aria-disabled="${disabled}"`));
    assert.match(html, /class="catan-robber-layer"[^>]*pointer-events="none"/);
  }
  const settlements = legalSettlements(game, viewer, true);
  const html = render(CatanBoard, { game: catanView(game, viewer), mode: "settlement", choices: settlements, selected: settlements[0], onSelect() {}, disabled: false });
  assert.equal((html.match(/aria-label="Siedlung auf Kreuzung/g) ?? []).length, settlements.length);
});

test("öffnet den Bereich, dessen Aufgabe gerade ansteht", () => {
  const setup = acceptedCatanGame(seats, 12, sequence([0]));
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
  for (const footer of main.match(/<footer class="catan-screen-actions">[\s\S]*?<\/footer>/g) ?? []) {
    assert.doesNotMatch(footer, />Bauen<\/button>|>Handeln<\/button>|Fehlende Rohstoffe ertauschen/);
  }
  const offered = { ...game, players: game.players.map((p) => p.id === active ? { ...p, resources: { ...p.resources, wood: 2 } } : p) };
  const withOffer = applyCatanAction(offered, active, { type: "offer_trade", toId: other, give: { wood: 1 }, receive: { ore: 1 } });
  assert.equal(suggestedTab(catanView(withOffer, other)), "handel");
  assert.match(ui(withOffer, other), /class="catan-nav-badge is-alert" aria-hidden="true">1<\/span><\/span><span class="catan-nav-label">Handel<\/span><span class="sr-only">, Ein Handelsangebot wartet auf deine Antwort/);
  assert.match(ui(withOffer, active), /class="catan-nav-badge is-dot"[^>]*><\/span><\/span><span class="catan-nav-label">Handel<\/span><span class="sr-only">, Dein Angebot ist noch offen/);
});

test("zählt Rohstoffkarten im unteren Menü und markiert Warnung und Abgabe am Badge", () => {
  const game = foundedGame(); const me = game.players[0].id;
  const rich = { ...game, players: game.players.map((p) => p.id === me ? { ...p, resources: { wood: 3, brick: 2, wool: 2, grain: 1, ore: 1 } } : p) };
  const html = ui(rich, me);
  assert.match(html, /catan-nav-badge is-warn catan-hand-total[^>]*><b class="catan-hand-count">9<\/b>/);
  assert.match(html, /Mehr als sieben Karten: Bei einer 7 musst du 4 abgeben\./);
  const discard = { ...rich, phase: "discard", discards: { [me]: 4 } };
  assert.equal(suggestedTab(catanView(discard, me)), "karten");
  const discardHtml = ui(discard, me);
  assert.match(discardHtml, /catan-nav-badge is-alert catan-hand-total[^>]*><b class="catan-hand-count">9<\/b>/);
  assert.match(discardHtml, /aria-label="Karten öffnen, 9 Rohstoffkarten, 4 Rohstoffkarten abgeben"/);
  assert.match(discardHtml, /class="catan-screen catan-discard"/);
  assert.equal(suggestedTab(catanView(discard, game.players[1].id)), "insel");
});

test("heftet die eigenen Rohstoffe über alle Menübereiche an", () => {
  const game = foundedGame(); const me = game.players[0].id;
  const rich = { ...game, players: game.players.map((p) => p.id === me ? { ...p, resources: { wood: 3, brick: 2, wool: 2, grain: 1, ore: 1 } } : p) };
  const html = ui(rich, me);
  const barStart = html.indexOf('class="catan-hand-bar');
  const firstPanel = html.indexOf('class="catan-tab-panel');
  const bar = html.slice(barStart, firstPanel);
  assert.ok(barStart > 0 && firstPanel > barStart, "Die angeheftete Rohstoffleiste fehlt.");
  // Sie steht vor den Menübereichen und damit in jedem Bereich, nicht nur auf der Insel.
  assert.ok(barStart < firstPanel);
  assert.equal((html.match(/catan-hand-strip/g) ?? []).length, 1);
  assert.doesNotMatch(bar, /catan-hand-total|catan-hand-meta|>Deine Rohstoffe</);
  const nav = html.slice(html.indexOf('<nav class="catan-nav"'));
  assert.match(nav, /catan-hand-total[^>]*><b class="catan-hand-count">9<\/b>/);
  assert.match(bar, /<div\b[^>]*class="catan-hand-strip"[^>]*role="group"[^>]*aria-label="Deine Rohstoffe: 3 Holz, 2 Lehm, 2 Wolle, 1 Getreide, 1 Erz"/);
  assert.doesNotMatch(bar, /<button[^>]*class="catan-hand-strip"/);
  assert.match(html, /<div class="catan-hand-bar is-warn">/);
  assert.match(ui({ ...rich, phase: "discard", discards: { [me]: 4 } }, me), /<div class="catan-hand-bar is-alert">/);
});

test("normale Pflichtmenüs überlagern dieselbe aktive Insel und behalten eine Rohstoffleiste", () => {
  const game = foundedGame(); const active = game.players[game.currentPlayer].id; const other = game.players.find((player) => player.id !== active).id;
  game.phase = "main"; game.players[game.currentPlayer].resources.wood = 2;
  const offered = applyCatanAction(game, active, { type: "offer_trade", toId: other, give: { wood: 1 }, receive: { ore: 1 } });
  const cases = [
    { game: { ...game, phase: "discard", discards: { [active]: 4 } }, viewer: active, activeMenu: "karten" },
    { game: offered, viewer: other, activeMenu: "handel" },
    { game: { ...game, phase: "finished", winner: active }, viewer: other, activeMenu: "uebersicht" },
  ];
  for (const state of cases) {
    const html = ui(state.game, state.viewer);
    assert.match(html, /class="catan-play is-menu-open"/);
    assert.equal((html.match(/class="catan-board"/g) ?? []).length, 1);
    assert.equal((html.match(/class="catan-hand-bar\b/g) ?? []).length, 1);
    assert.equal((html.match(/class="catan-hand-strip"/g) ?? []).length, 1);
    const island = (html.match(/<div\b[^>]*>/g) ?? []).find((tag) => attribute(tag, "class") === "catan-tab-panel catan-tab-insel");
    assert.equal(attribute(island, "data-state"), "active");
    const panels = (html.match(/<div\b[^>]*>/g) ?? []).filter((tag) => attribute(tag, "data-catan-menu-panel"));
    assert.equal(panels.length, 4);
    assert.deepEqual(panels.filter((tag) => attribute(tag, "data-state") === "active").map((tag) => attribute(tag, "data-catan-menu-panel")), [state.activeMenu]);
    const trigger = (html.match(/<button\b[^>]*>/g) ?? []).find((tag) => attribute(tag, "data-catan-menu-trigger") === state.activeMenu);
    const panel = panels.find((tag) => attribute(tag, "data-catan-menu-panel") === state.activeMenu);
    assert.equal(attribute(trigger, "aria-expanded"), "true");
    assert.equal(attribute(trigger, "aria-controls"), attribute(panel, "id"));
    assert.equal(attribute(panel, "role"), "dialog");
    assert.equal(attribute(panel, "tabindex"), "-1");
    assert.match(menu(html, state.activeMenu), /aria-label="Menü schließen"/);
  }
});

test("Handel startet mit vier Filtern und drei Einstiegskarten", () => {
  let game = foundedGame();
  const active = game.players[game.currentPlayer].id; const other = game.players.find((p) => p.id !== active).id;
  game = applyCatanAction(game, active, { type: "roll" }, sequence([1, 3]));
  const html = ui(game, active);
  const trade = menu(html, "handel");
  assert.match(trade, /<h2>Handeln<\/h2>/);
  assert.match(trade, /class="catan-trade-options">[\s\S]*?Hafen &amp; Bank[\s\S]*?Fester Kurs ab [234]:1[\s\S]*?Mitspielende[\s\S]*?Handle direkt mit einer anderen Person am Tisch[\s\S]*?Eigene Angebote/);
  assert.equal((trade.match(/class="catan-trade-option\b/g) ?? []).length, 3);
  assert.match(trade, /class="catan-trade-filters" role="group" aria-label="Handelsbereiche filtern"/);
  for (const label of ["Alle", "Bank &amp; Hafen", "Mitspielende", "Meine Angebote"]) assert.match(trade, new RegExp(`<button[^>]*aria-pressed="${label === "Alle"}"[^>]*>${label}<\\/button>`));
  // Erst nach der Wahl folgen die Fragen nach Person, Gabe und Wunsch.
  assert.doesNotMatch(html, /Schritt \d von 3|catan-trade-partner|catan-resource-picker|catan-two-fields/);
  assert.match(ui(game, other), new RegExp(`Angebot an ${game.players[game.currentPlayer].name} senden`));
});

test("stellt Holz als Holzstapel statt als Baum dar", () => {
  const wood = render(WoodIcon, {});
  assert.match(wood, /class="[^"]*catan-wood-icon/);
  assert.match(wood, /data-resource="wood"/);
  assert.match(render(ResourceIcon, { resource: "wood" }), /catan-wood-icon/);
  assert.doesNotMatch(render(ResourceIcon, { resource: "wood" }), /lucide-trees|lucide-tree/);
  const game = acceptedCatanGame(seats, 12, sequence([0]));
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

test("Bauen-Badge zählt Bau- und Kaufoptionen und folgt Handel, Kauf und Bau", () => {
  let game = foundedGame(); const active = game.players[game.currentPlayer].id;
  game.phase = "main";
  const badge = (count) => {
    const button = buildNavigation(ui(game, active));
    assert.match(button, new RegExp(`class="catan-nav-badge ${count ? "is-ready" : ""}"[^>]*>${count}<\\/span>`));
    assert.equal(attribute(button, "aria-label"), `Bauen öffnen, ${count} ${count === 1 ? "Bau- oder Kaufoption" : "Bau- oder Kaufoptionen"} mit deinen Rohstoffen verfügbar`);
  };
  game.players[game.currentPlayer].resources = emptyResources(); badge(0);
  game.players[game.currentPlayer].resources = { wood: 1, brick: 0, wool: 1, grain: 1, ore: tradeRatio(game, active, "ore") }; badge(1);
  game = applyCatanAction(game, active, { type: "bank_trade", give: "ore", receive: "brick" });
  badge(1);
  game.players[game.currentPlayer].resources.ore = 1; badge(2);
  game = applyCatanAction(game, active, { type: "buy_development" }, sequence([0])); badge(1);
  game = applyCatanAction(game, active, { type: "build", building: "road", position: legalRoads(game, active)[0] }); badge(0);
});

test("Bauen-Badge berücksichtigt Vorräte und gültige Bauplätze", () => {
  const game = foundedGame(); const active = game.players[game.currentPlayer].id;
  game.phase = "main"; game.players[game.currentPlayer].resources = emptyResources(5);
  assert.equal(legalSettlements(game, active).length, 0);
  const view = catanView(game, active);
  const badge = (count) => assert.match(buildNavigation(render(CatanGameUI, { game: view, send, busy: false, local: false })), new RegExp(`catan-nav-badge[^>]*>${count}<\\/span>`));
  badge(3);
  view.players[view.currentPlayer].pieces.road = 15; badge(2);
  view.deckCount = 0; badge(1);
  for (const vertex of view.board.vertices) if (vertex.owner === active) vertex.building = "city";
  badge(0);
});

test("Bauen-Badge zeigt null außerhalb der Bauphase und bleibt bei laufenden Anfragen stabil", () => {
  const game = foundedGame(); const active = game.players[game.currentPlayer].id;
  game.players[game.currentPlayer].resources = emptyResources(5);
  for (const phase of ["roll", "discard", "robber", "free_roads", "finished"]) {
    game.phase = phase; game.winner = phase === "finished" ? active : null;
    assert.match(buildNavigation(ui(game, active)), /catan-nav-badge[^>]*>0<\/span>/);
  }
  game.phase = "main"; game.winner = null;
  assert.match(buildNavigation(ui(game, game.players[1].id)), /catan-nav-badge[^>]*>0<\/span>/);
  assert.match(buildNavigation(ui(game, active, { busy: true })), /catan-nav-badge is-ready[^>]*>3<\/span>/);
  assert.doesNotMatch(buildNavigation(ui(createCatanGame(seats, 10, sequence([0])), "a")), /catan-nav-badge/);
});

test("das Baumenü erklärt allgemeine Einschränkungen einmal und behält jede Kostenzeile", () => {
  const game = foundedGame(); const active = game.players[game.currentPlayer].id;
  const html = ui(game, active);
  const build = menu(html, "bauen");
  assert.equal((build.match(/Würfle zuerst\./g) ?? []).length, 1);
  assert.equal((build.match(/class="catan-build-choice\b/g) ?? []).length, 4);
  assert.equal((build.match(/aria-disabled="true"/g) ?? []).length, 4);
  assert.equal((build.match(/aria-pressed="false"/g) ?? []).length, 4);
  assert.match(build, /<h2>Bauen<\/h2>/);
  assert.match(build, /disabled=""[^>]*>[\s\S]*?Auswählen<\/button>/);
  assert.doesNotMatch(build, /Fehlende Rohstoffe ertauschen/);
  const island = html.slice(html.indexOf('class="catan-tab-panel catan-tab-insel"'), html.indexOf('data-catan-menu-panel="karten"'));
  assert.match(island, /class="catan-screen-actions"[\s\S]*?Würfeln/);
  const local = ui(game, active, { local: true, onHide() {} });
  assert.equal((local.match(/aria-label="Handkarten verdecken"/g) ?? []).length, 1);
  assert.doesNotMatch(local, />Hand verdecken<\/button>/);
});

test("Baukosten markieren nur unzureichende Rohstoffe und zeigen benötigte Gesamtmengen", () => {
  const game = foundedGame(); const active = game.players[game.currentPlayer].id;
  game.phase = "main";
  game.players[game.currentPlayer].resources = { wood: 1, brick: 0, wool: 1, grain: 1, ore: 2 };
  const html = ui(game, active);
  const road = buildRow(html, "road"); const city = buildRow(html, "city"); const development = buildRow(html, "development");
  assert.deepEqual(costNumber(road, "wood"), { count: 1, missing: false });
  assert.deepEqual(costNumber(road, "brick"), { count: 1, missing: true });
  assert.deepEqual(costNumber(city, "grain"), { count: 2, missing: true });
  assert.deepEqual(costNumber(city, "ore"), { count: 3, missing: true });
  assert.doesNotMatch(menu(html, "bauen"), /Dir fehlen|class="is-unavailable"/);
  assert.match(road, /aria-disabled="true"/);
  assert.match(city, /aria-disabled="true"/);
  assert.match(development, /aria-disabled="false"/);
  for (const resource of ["wool", "grain", "ore"]) assert.deepEqual(costNumber(development, resource), { count: 1, missing: false });
  assert.match(road, /<span class="sr-only"> Lehm benötigt, 0 vorhanden<\/span>/);
  assert.match(menu(html, "bauen"), /disabled=""[^>]*>[\s\S]*?Auswählen<\/button>/, "Verfügbare Bauoptionen allein dürfen keine Aktion bestätigen.");
});

test("exakt erfüllte Kosten bleiben neutral; Phase und Beschäftigung sperren unabhängig vom Bestand", () => {
  const game = foundedGame(); const active = game.players[game.currentPlayer].id;
  game.phase = "main";
  game.players[game.currentPlayer].resources = { wood: 1, brick: 1, wool: 1, grain: 2, ore: 3 };
  for (const kind of Object.keys(COSTS)) {
    const row = buildRow(ui(game, active), kind);
    assert.equal(attribute(row, "aria-disabled"), buildUnavailable(catanView(game, active), kind) ? "true" : "false");
    assert.match(row, /aria-pressed="false"/);
    for (const resource of RESOURCES.filter((resource) => COSTS[kind][resource])) assert.deepEqual(costNumber(row, resource), { count: COSTS[kind][resource], missing: false });
    assert.match(buildRow(ui(game, active, { busy: true }), kind), /aria-disabled="true"/);
  }
  game.phase = "roll";
  const build = menu(ui(game, active), "bauen");
  assert.equal((build.match(/aria-disabled="true"/g) ?? []).length, 4);
  assert.equal((build.match(/Würfle zuerst\./g) ?? []).length, 1);
  assert.doesNotMatch(build, /class="is-missing"/);
});

test("Vorrat, Kartenstapel und fehlende Bauplätze sperren Optionen bei neutralen erfüllten Kosten", () => {
  const game = foundedGame(); const active = game.players[game.currentPlayer].id;
  game.phase = "main"; game.players[game.currentPlayer].resources = emptyResources(5);
  const view = catanView(game, active);
  view.players[view.currentPlayer].pieces.road = 15;
  view.players[view.currentPlayer].pieces.settlement = 5;
  view.deckCount = 0;
  for (const vertex of view.board.vertices) if (vertex.owner === active) vertex.building = "city";
  const build = menu(render(CatanGameUI, { game: view, send, busy: false, local: false }), "bauen");
  assert.equal((build.match(/aria-disabled="true"/g) ?? []).length, 4);
  assert.match(build, /Keine Straßen mehr im Vorrat/);
  assert.match(build, /Keine Siedlungen mehr im Vorrat/);
  assert.match(build, /eigene Siedlung zum Ausbauen/);
  assert.match(build, /Kartenstapel ist leer/);
  assert.doesNotMatch(build, /class="is-missing"/);
});

test("Bauplatzvorschau erklärt angrenzende Zahlen, Häfen und Startrohstoffe", () => {
  const g = acceptedCatanGame(seats, 12, sequence([0])); const view = catanView(g, g.players[0].id);
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

test("gruppierte Entwicklungskarten spielen eine ältere Kopie trotz neu gekaufter Karte zuerst", () => {
  const game = foundedGame(); const id = game.players[game.currentPlayer].id;
  game.turn = 4; game.phase = "main";
  game.players[game.currentPlayer].development = [
    { id: "new-knight", type: "knight", boughtOnTurn: 4 },
    { id: "old-knight", type: "knight", boughtOnTurn: 2 },
    { id: "point", type: "victory", boughtOnTurn: 4 },
  ];
  const groups = developmentGroups(catanView(game, id));
  assert.deepEqual(groups.map((group) => group.type), ["knight", "victory"]);
  const knight = groups[0];
  assert.equal(knight.count, 2); assert.equal(knight.fresh, 1);
  assert.equal(knight.card.id, "old-knight"); assert.equal(knight.reason, undefined);
  const next = applyCatanAction(game, id, { type: "play_development", cardId: knight.card.id });
  const remaining = developmentGroups(catanView(next, id))[0];
  assert.equal(remaining.card.id, "new-knight"); assert.equal(remaining.count, 1);
  assert.ok(remaining.reason, "Nach dem Ausspielen darf die neue Kopie nicht spielbar erscheinen.");
  next.phase = "main";
  assert.match(developmentGroups(catanView(next, id))[0].reason, /schon eine Entwicklungskarte gespielt/);
  next.playedDevelopment = false;
  assert.match(developmentGroups(catanView(next, id))[0].reason, /Neu gekauft/);
  assert.throws(() => applyCatanAction(next, id, { type: "play_development", cardId: remaining.card.id }));
  next.turn++;
  assert.equal(developmentGroups(catanView(next, id))[0].reason, undefined);
});

test("Kartengruppen erklären fremde Züge, fehlende Straßenplätze und bereits gezählte Siegpunkte", () => {
  const game = foundedGame(); const id = game.players[game.currentPlayer].id;
  game.turn = 4;
  game.players[game.currentPlayer].development = [
    { id: "road", type: "road_building", boughtOnTurn: 2 },
    { id: "point", type: "victory", boughtOnTurn: 4 },
  ];
  const view = catanView(game, id);
  assert.equal(developmentGroups(view)[0].reason, undefined, "Auch vor dem Würfeln spielbar.");
  assert.match(developmentGroups(view)[1].reason, /Zählt bereits/);
  view.board.edges.forEach((edge) => { edge.owner = id; });
  assert.match(developmentGroups(view)[0].reason, /keinen freien Platz/);
  view.currentPlayer = (view.currentPlayer + 1) % view.players.length;
  assert.match(developmentGroups(view)[0].reason, /eigenen Zug/);
});

test("gewöhnliche Zug- und Phasenwechsel erhalten den gewählten Bereich", () => {
  let game = foundedGame(); const active = game.players[game.currentPlayer].id;
  const choice = { task: null, tab: "karten" };
  assert.equal(navigationTask(catanView(game, active)), null);
  assert.equal(resolveNavigation(catanView(game, active), choice), choice);
  game = applyCatanAction(game, active, { type: "roll" }, sequence([1, 3]));
  assert.equal(resolveNavigation(catanView(game, active), choice), choice, "Würfeln darf die gewählte Kartenansicht nicht ersetzen.");
  game = applyCatanAction(game, active, { type: "end_turn" });
  assert.equal(resolveNavigation(catanView(game, active), choice), choice, "Das Zugende darf die gewählte Ansicht nicht ersetzen.");
  assert.equal(navigationTask(catanView(game, game.players[game.currentPlayer].id)), null);
});

test("nur eine neue eigene Pflichtaufgabe wechselt die Ansicht automatisch", () => {
  const game = foundedGame(); const active = game.players[game.currentPlayer].id; const other = game.players.find((p) => p.id !== active).id;
  const choice = { task: null, tab: "uebersicht" };
  const discard = { ...game, phase: "discard", discards: { [active]: 4 } };
  const task = navigationTask(catanView(discard, active));
  assert.equal(task.tab, "karten");
  const redirected = resolveNavigation(catanView(discard, active), choice);
  assert.equal(redirected.tab, "karten");
  assert.equal(redirected.task, task.key);
  const manual = { ...redirected, tab: "insel" };
  assert.equal(resolveNavigation(catanView(discard, active), manual), manual, "Die gleiche Aufgabe darf manuell gewählte Ansichten nicht erneut überschreiben.");
  assert.equal(resolveNavigation(catanView(discard, other), choice), choice, "Fremde Abgaben sind keine eigene Pflichtaufgabe.");
  const complete = resolveNavigation(catanView(game, active), manual);
  assert.equal(complete.task, null);
  assert.equal(complete.tab, "insel");
  for (const phase of ["setup_settlement", "setup_road", "robber", "steal", "free_roads"]) {
    assert.equal(navigationTask(catanView({ ...game, phase }, active)).tab, "insel");
    assert.equal(navigationTask(catanView({ ...game, phase }, other)), null);
  }
});

test("ein neues eingehendes Angebot lenkt zum Handel, dieselbe offene Aufgabe nur einmal", () => {
  const game = foundedGame(); game.phase = "main";
  const active = game.players[game.currentPlayer].id; const other = game.players.find((p) => p.id !== active).id;
  game.players[game.currentPlayer].resources.wood = 3;
  const offered = applyCatanAction(game, active, { type: "offer_trade", toId: other, give: { wood: 1 }, receive: { ore: 1 } });
  const choice = { task: null, tab: "karten" };
  assert.equal(resolveNavigation(catanView(offered, active), choice), choice, "Ein eigenes Angebot darf die gewählte Ansicht nicht ersetzen.");
  const redirected = resolveNavigation(catanView(offered, other), choice);
  assert.equal(redirected.tab, "handel");
  const manual = { ...redirected, tab: "karten" };
  assert.equal(resolveNavigation(catanView(offered, other), manual), manual);
  const renewed = applyCatanAction(offered, active, { type: "offer_trade", toId: other, give: { wood: 2 }, receive: { ore: 1 } });
  assert.equal(resolveNavigation(catanView(renewed, other), manual).tab, "handel");
  const finished = { ...game, phase: "finished", winner: active };
  assert.equal(resolveNavigation(catanView(finished, other), manual).tab, "uebersicht");
});

test("Angebote an alle zeigen jedem Empfänger Antwortaktionen und lassen abgelehnte Personen aus", () => {
  const game = foundedGame(); game.phase = "main"; game.players[0].resources.wood = 3;
  const offered = applyCatanAction(game, "a", { type: "offer_trade", toId: null, give: { wood: 1 }, receive: { ore: 1 } });
  assert.equal(navigationTask(catanView(offered, "a")), null);
  for (const id of ["b", "c"]) {
    assert.equal(suggestedTab(catanView(offered, id)), "handel");
    assert.deepEqual(navigationTask(catanView(offered, id)), { key: `offer:${offered.trade.id}`, tab: "handel" });
    const html = ui(offered, id); const trade = menu(html, "handel");
    assert.match(trade, /<h2>Angebot von Robin<\/h2>/);
    assert.match(trade, /Ablehnen/); assert.match(trade, /Gegenangebot/); assert.match(trade, /Annehmen/);
    assert.match(trade, /Du gibst[\s\S]*1 Erz[\s\S]*Du erhältst[\s\S]*1 Holz/);
    assert.match(trade, /bleibt das Angebot für die anderen offen/);
    assert.match(html, /Ein Handelsangebot wartet auf deine Antwort/);
  }
  const declined = applyCatanAction(offered, "b", { type: "cancel_trade", offerId: offered.trade.id });
  assert.equal(navigationTask(catanView(declined, "b")), null);
  assert.equal(suggestedTab(catanView(declined, "b")), "insel");
  const rejectedHTML = ui(declined, "b"); const trade = menu(rejectedHTML, "handel");
  assert.match(trade, /Du hast dieses Angebot abgelehnt/);
  assert.doesNotMatch(trade, />Annehmen<|>Ablehnen<|>Gegenangebot</);
  assert.doesNotMatch(rejectedHTML, /Ein Handelsangebot wartet auf deine Antwort/);
  assert.match(ui(declined, "c"), /Ein Handelsangebot wartet auf deine Antwort/);
});

test("Karten öffnen die gruppierten Entwicklungskarten und das Badge zählt weiterhin Rohstoffkarten", () => {
  const game = foundedGame(); const me = game.players[game.currentPlayer].id;
  game.turn = 4; game.phase = "main";
  game.players[game.currentPlayer].resources = { wood: 3, brick: 2, wool: 2, grain: 1, ore: 1 };
  game.players[game.currentPlayer].development = [
    { id: "old", type: "knight", boughtOnTurn: 2 },
    { id: "new", type: "knight", boughtOnTurn: 4 },
    { id: "point", type: "victory", boughtOnTurn: 4 },
  ];
  const cards = render(CardsPanel, { game: catanView(game, me), busy: false, send });
  assert.match(cards, /<h2>Karten<\/h2>/);
  assert.match(cards, /class="catan-screen-subtitle">Deine Entwicklungskarten/);
  assert.equal((cards.match(/class="catan-development-choice\b/g) ?? []).length, 2);
  assert.match(cards, /Spielbar · 1 neu gekauft/);
  assert.match(cards, /aria-label="2 Karten">2×/);
  assert.doesNotMatch(cards, /Deine Rohstoffe|catan-resource-hand|catan-card-links|Bankbestand|Rohstoffkarten|Einen Schritt zurück/);
  assert.match(ui(game, me), /catan-nav-badge is-warn catan-hand-total[^>]*><b class="catan-hand-count">9<\/b>/);
  assert.match(ui(game, me), /aria-label="Karten öffnen, 9 Rohstoffkarten, 3 Entwicklungskarten,/);
  const empty = render(CardsPanel, { game: catanView(foundedGame(), me), busy: false, send });
  assert.match(empty, /Noch keine Entwicklungskarten/);
  assert.match(empty, /class="catan-card-illustration" aria-hidden="true"/);
  assert.match(empty, /disabled=""[^>]*>[\s\S]*?Karte spielen<\/button>/);
  assert.doesNotMatch(empty, /catan-resource-hand|Bankbestand|Einen Schritt zurück/);
});

test("die Abgabe ersetzt Entwicklungskarten nur für betroffene Personen", () => {
  const game = foundedGame(); const me = game.players[0].id; const other = game.players[1].id;
  game.phase = "discard"; game.discards = { [me]: 4 };
  game.players[0].resources = { wood: 3, brick: 2, wool: 2, grain: 1, ore: 1 };
  const html = render(CardsPanel, { game: catanView(game, me), busy: false, send });
  assert.match(html, /<h2>Rohstoffe abgeben<\/h2>/);
  assert.doesNotMatch(html, /catan-development-list|catan-resource-hand/);
  for (const resource of RESOURCES) assert.equal(isDisabled(html, `Abgeben: weniger ${RESOURCE_INFO[resource].label}`), true);
  assert.match(html, /disabled=""[^>]*>Abgabe bestätigen<\/button>/);
  const waiting = render(CardsPanel, { game: catanView(game, other), busy: false, send });
  assert.match(waiting, /<h2>Karten<\/h2>/);
  assert.doesNotMatch(waiting, /<h2>Rohstoffe abgeben<\/h2>/);
});

test("jede Rohstoffzeile hat eigene Mengenaktionen mit Bestands- und Abgabegrenzen", () => {
  const props = { label: "Abgeben", maximum: { wood: 3, brick: 0, wool: 2, grain: 1, ore: 1 }, value: { wood: 3, brick: 0, wool: 0, grain: 0, ore: 0 }, limit: 4, disabled: false, onChange() {} };
  const html = render(ResourceAmounts, props);
  assert.equal((html.match(/class="catan-amount-controls"/g) ?? []).length, 5);
  assert.doesNotMatch(html, /aria-pressed=|catan-resource-choices/);
  for (const resource of RESOURCES) {
    assert.match(html, new RegExp(`aria-label="Abgeben: ${RESOURCE_INFO[resource].label}">${props.value[resource]}</output>`));
    assert.equal(isDisabled(html, `Abgeben: weniger ${RESOURCE_INFO[resource].label}`), props.value[resource] === 0);
    assert.equal(isDisabled(html, `Abgeben: mehr ${RESOURCE_INFO[resource].label}`), props.value[resource] >= props.maximum[resource]);
  }
  const capped = render(ResourceAmounts, { ...props, value: { ...props.value, wool: 1 } });
  for (const resource of RESOURCES) assert.equal(isDisabled(capped, `Abgeben: mehr ${RESOURCE_INFO[resource].label}`), true, "Nach Erreichen der Abgabemenge darf kein weiterer Rohstoff hinzugefügt werden.");
  const busy = render(ResourceAmounts, { ...props, disabled: true });
  for (const resource of RESOURCES) for (const action of ["weniger", "mehr"]) assert.equal(isDisabled(busy, `Abgeben: ${action} ${RESOURCE_INFO[resource].label}`), true);
});

test("Handelsvorschauen zeigen nur betroffene Rohstoffe, Änderung und neuen Bestand", () => {
  const props = { resources: { wood: 4, brick: 8, wool: 5, grain: 6, ore: 2 }, give: { wood: 2 }, receive: { ore: 1 } };
  const html = render(TradeInventoryPreview, props);
  assert.match(html, /Holz[\s\S]*?-2[\s\S]*?Danach 2/);
  assert.match(html, /Erz[\s\S]*?\+1[\s\S]*?Danach 3/);
  assert.doesNotMatch(html, /Lehm|Wolle|Getreide|catan-resource-hand/);
  const unavailable = render(TradeInventoryPreview, { ...props, give: { wood: 5 } });
  assert.match(unavailable, /Dir fehlen 1 Holz/);
  assert.equal((unavailable.match(/Danach —/g) ?? []).length, 2);
  assert.doesNotMatch(unavailable, /Danach -1|Danach 3/);
});

test("Übersicht zeigt sofort alle Punktestände, Listenlinks und nur zusätzliche Spielerdetails", () => {
  const game = foundedGame(); const me = game.players[0].id;
  const html = overview(game, me, { local: true, onHide() {}, unread: 2 });
  assert.equal((html.match(/class="catan-player-card"/g) ?? []).length, game.players.length);
  assert.ok(html.indexOf('class="catan-score-list"') < html.indexOf('class="catan-overview-links"'));
  assert.equal((html.match(/class="catan-overview-link"/g) ?? []).length, 3);
  assert.match(html, /Spielverlauf/); assert.match(html, /Deine Meldungen/); assert.match(html, /Spielregeln &amp; Baukosten/);
  assert.match(html, /2 neu/);
  assert.doesNotMatch(html, /catan-overview-menu|Hand verdecken|Einen Schritt zurück/);
  for (const card of html.match(/<details class="catan-player-card"[\s\S]*?<\/details>/g) ?? []) {
    assert.equal((card.match(/Rohstoffkarten/g) ?? []).length, 1, "Aufgeklappte Spielerdetails dürfen die Rohstoffzahl nicht erneut zeigen.");
    assert.match(card, /Entwicklungskarten/); assert.match(card, /Vorrat:/);
  }
});

test("gegnerische Siegpunktkarten bleiben bis zum Spielende verdeckt, Endpunkte stehen direkt in der Übersicht", () => {
  const game = foundedGame(); const active = game.players[game.currentPlayer]; const viewer = game.players.find((p) => p.id !== active.id);
  active.development = Array.from({ length: 8 }, (_, i) => ({ id: `point-${i}`, type: "victory", boughtOnTurn: 0 }));
  const before = overview(game, viewer.id);
  const card = before.match(new RegExp(`<details class="catan-player-card"[^>]*>[\\s\\S]*?<strong>${active.name}[\\s\\S]*?<b>(\\d+) / 10<\\/b>`));
  assert.equal(card?.[1], "2", "Verdeckte gegnerische Siegpunkte dürfen vor dem Ende nicht aufgedeckt werden.");
  const finished = applyCatanAction(game, active.id, { type: "roll" }, sequence([1, 3]));
  assert.equal(finished.phase, "finished");
  const after = overview(finished, viewer.id, { onRematch() {} });
  assert.match(after, new RegExp(`<h2>${active.name} gewinnt!<\\/h2>`));
  assert.match(after, new RegExp(`<strong>${active.name}[\\s\\S]*?<b>10 / 10<\\/b>`));
  assert.equal((after.match(/class="catan-player-card"/g) ?? []).length, game.players.length);
  assert.match(after, /Neue Partie vorbereiten/);
});

test("Regeln öffnen alle Themen als Akkordeon mit aktuellen Baukosten am Anfang", () => {
  const game = foundedGame(); const me = game.players[0].id;
  const html = overview(game, me, { page: "rules" });
  assert.match(html, /<details class="catan-rule-section" open=""><summary>Baukosten<\/summary>/);
  assert.equal((html.match(/class="catan-rule-section"/g) ?? []).length, 11);
  assert.doesNotMatch(html, /catan-pager|Seite wechseln/);
  const costs = html.slice(html.indexOf('class="catan-rule-costs"'), html.indexOf('</details>'));
  assert.doesNotMatch(costs, /class="is-missing"/, "Allgemeine Regelkosten haben keinen persönlichen Bestandsvergleich.");
  for (const label of ["Straße", "Siedlung", "Stadt", "Entwicklungskarte"]) assert.match(costs, new RegExp(`<strong>${label}<\\/strong>`));
  for (const [kind, cost] of Object.entries(COSTS)) {
    const index = Object.keys(COSTS).indexOf(kind);
    const row = costs.split(/<div><strong>/)[index + 1]?.split('</div>')[0];
    assert.ok(row, `Die Baukosten für ${kind} fehlen.`);
    for (const resource of RESOURCES.filter((resource) => cost[resource])) assert.match(row, new RegExp(`title="${RESOURCE_INFO[resource].label}"[\\s\\S]*?>${cost[resource]}<span class="sr-only"> ${RESOURCE_INFO[resource].label}`));
  }
  const generalRules = render(CatanRules, {});
  assert.doesNotMatch(generalRules, /class="is-missing"/);
  const generalCosts = generalRules.slice(generalRules.indexOf('class="catan-rule-costs"'), generalRules.indexOf('class="catan-rule-legend"'));
  for (const [index, kind] of Object.keys(COSTS).entries()) {
    const row = generalCosts.split(/<div><strong>/)[index + 1]?.split('</div>')[0];
    for (const resource of RESOURCES.filter((resource) => COSTS[kind][resource])) assert.deepEqual(costNumber(row, resource), { count: COSTS[kind][resource], missing: false });
  }
});

test("Meldungen sind neueste zuerst aufklappbar und markieren tatsächlich ungelesene Einträge", () => {
  const game = foundedGame(); const me = game.players[0].id;
  const activity = [
    { id: 1, title: "Erster Ertrag", message: "Deine Siedlung erhält Holz.", gains: { ...emptyResources(), wood: 1 }, losses: emptyResources() },
    { id: 2, title: "Straße gebaut", message: "Du hast eine Straße gebaut.", gains: emptyResources(), losses: { ...emptyResources(), wood: 1, brick: 1 } },
    { id: 3, title: "Letzter Ertrag", message: "Deine Stadt erhält Erz.", gains: { ...emptyResources(), ore: 2 }, losses: emptyResources() },
  ];
  const html = overview(game, me, { page: "activity", activity, unread: 1, unreadActivity: [activity[0]] });
  const entries = html.match(/<details class="catan-activity-item[^"]*">[\s\S]*?<\/details>/g) ?? [];
  assert.equal(entries.length, 3);
  assert.match(entries[0], /Letzter Ertrag/); assert.match(entries[1], /Straße gebaut/); assert.match(entries[2], /Erster Ertrag/);
  assert.doesNotMatch(entries[0], /is-unread/); assert.match(entries[2], /is-unread/);
  assert.equal((html.match(/class="catan-activity-unread"/g) ?? []).length, 1);
  assert.match(entries[0], /Erhalten:/); assert.match(entries[1], /Abgegeben:/);
  assert.match(html, /Alle Meldungen als gelesen markieren/);
  assert.doesNotMatch(html, /catan-pager|Meldung wechseln/);
});

function acceptedCatanGame(...args) { return acceptMap(createCatanGame(...args), applyCatanAction); }

test("Räuber werden ausschließlich über Kartenfelder ausgewählt und unter der Karte bestätigt", () => {
  const game = foundedGame(); game.phase = "robber";
  const viewer = game.players[game.currentPlayer].id;
  const view = catanView(game, viewer);
  const choices = game.board.hexes.filter((hex) => hex.id !== game.robberHex).map((hex) => hex.id);
  for (const expanded of [false, true]) {
    const board = render(CatanBoard, { game: view, mode: "robber", choices, selected: null, onSelect() {}, disabled: false, expanded });
    assert.doesNotMatch(board, /catan-board-selection|Bauplatz|mögliche Plätze/);
    assert.equal((board.match(/<g\b[^>]*role="button"[^>]*aria-label="Räuber auf Feld /g) ?? []).length, 18);
    assert.doesNotMatch(board, new RegExp(`aria-label="Räuber auf Feld ${game.robberHex + 1}:`));
  }
  const html = ui(game, viewer);
  assert.match(html, /class="catan-island-dock"/);
  assert.match(html, /Tippe ein anderes Feld auf der Karte an/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Räuber versetzen<\/button>/);
  assert.doesNotMatch(html, /Vorheriger Bauplatz|Nächster Bauplatz|catan-board-selection/);
  assert.ok(html.indexOf('class="catan-island-canvas"') < html.indexOf('class="catan-island-dock"'));
});

test("die Opferauswahl zeigt öffentliche Spielerkarten und verlangt auch bei einer Person eine Bestätigung", () => {
  const game = foundedGame(); game.phase = "steal";
  const viewer = game.players[game.currentPlayer].id;
  const victims = game.players.filter((player) => player.id !== viewer);
  game.victims = victims.map((player) => player.id);
  for (const ids of [game.victims, game.victims.slice(0, 1)]) for (const busy of [false, true]) {
    const html = ui({ ...game, victims: ids }, viewer, { busy });
    const choices = (html.match(/<button\b[^>]*>/g) ?? []).filter((tag) => /class="catan-victim-choice"/.test(tag));
    assert.equal(choices.length, ids.length);
    for (const tag of choices) {
      assert.match(tag, /aria-pressed="false"/);
      assert.match(tag, /--player-color:/);
      assert.equal(/disabled=""/.test(tag), busy);
    }
    assert.equal((html.match(/class="catan-victim-avatar"/g) ?? []).length, ids.length);
    assert.match(html, /zufällige Rohstoffkarte/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>Karte stehlen<\/button>/);
    assert.doesNotMatch(html, /<button[^>]*>[^<]*bestehlen<\/button>/);
  }
  const observer = ui(game, victims[0].id);
  assert.doesNotMatch(observer, /catan-victim-choice|>Karte stehlen<\/button>/);
});

test("Menüschließen gehört auf allen Hauptseiten zum jeweiligen Header", () => {
  const html = ui(foundedGame(), "a");
  for (const id of ["karten", "bauen", "handel", "uebersicht"]) {
    const panel = menu(html, id);
    const header = panel.match(/<header class="catan-screen-heading">[\s\S]*?<\/header>/)?.[0];
    assert.ok(header, `Header fehlt: ${id}`);
    assert.match(header, /aria-label="Menü schließen"/);
    assert.equal((panel.match(/aria-label="Menü schließen"/g) ?? []).length, 1);
  }
});
