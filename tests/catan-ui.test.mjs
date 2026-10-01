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
const { CatanGameUI, CatanBoard, CardsPanel, OverviewPanel, ResourceAmounts, TradeInventoryPreview, CATAN_TABS, suggestedTab, navigationTask, resolveNavigation, WoodIcon, ResourceIcon, createCatanGame, applyCatanAction, catanView, legalSettlements, legalRoads, COSTS, RESOURCES, RESOURCE_INFO, emptyResources, buildUnavailable, hasBuildOption, buildingPreview, developmentGroups } = createRequire(import.meta.url)(output);
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
const overview = (game, viewerId, extra = {}) => render(OverviewPanel, { game: catanView(game, viewerId), page: "menu", setPage() {}, activity: [], unreadActivity: [], unread: 0, onRead() {}, local: false, busy: false, ...extra });
function labelledButton(html, label) {
  const button = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find((element) => element.includes(`aria-label="${label}"`));
  assert.ok(button, `Die Aktion ${label} fehlt.`);
  return button;
}
function isDisabled(html, label) { return /\bdisabled=""/.test(labelledButton(html, label)); }

test("zeigt fünf angeheftete Menübereiche mit sprechenden Gruppen", () => {
  assert.deepEqual(CATAN_TABS.map((tab) => tab.label), ["Insel", "Karten", "Bauen", "Handel", "Übersicht"]);
  const game = createCatanGame(seats, 12, sequence([0]));
  const html = ui(game, game.players[0].id);
  assert.match(html, /<nav class="catan-nav" aria-label="Spielmenü">/);
  assert.equal((html.match(/class="catan-nav-tab"/g) ?? []).length, 5);
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*data-state="active"[^>]*id="[^"]*-trigger-insel"/);
  for (const tab of CATAN_TABS) assert.match(html, new RegExp(`role="tabpanel"[^>]*id="[^"]*-content-${tab.id}"[^>]*class="catan-tab-panel`));
  assert.match(html, /Deine Rohstoffe: 0 Holz, 0 Lehm, 0 Wolle, 0 Getreide, 0 Erz/);
  assert.doesNotMatch(html, /Deine Karten öffnen/);
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

test("Ganze Insel bleibt als Reset auch beim Erkunden und während einer Spielaktion erreichbar", () => {
  const game = createCatanGame(seats, 12, sequence([0]));
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
  const game = createCatanGame(seats, 12, sequence([0]));
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
  for (const footer of main.match(/<footer class="catan-screen-actions">[\s\S]*?<\/footer>/g) ?? []) {
    assert.doesNotMatch(footer, />Bauen<\/button>|>Handeln<\/button>|Fehlende Rohstoffe ertauschen/);
  }
  const offered = { ...game, players: game.players.map((p) => p.id === active ? { ...p, resources: { ...p.resources, wood: 2 } } : p) };
  const withOffer = applyCatanAction(offered, active, { type: "offer_trade", toId: other, give: { wood: 1 }, receive: { ore: 1 } });
  assert.equal(suggestedTab(catanView(withOffer, other)), "handel");
  assert.match(ui(withOffer, other), /class="catan-nav-badge is-alert" aria-hidden="true">1<\/span><\/span><span class="catan-nav-label">Handel<\/span><span class="sr-only">, Ein Handelsangebot wartet auf deine Antwort/);
  assert.match(ui(withOffer, active), /class="catan-nav-badge is-dot"[^>]*><\/span><\/span><span class="catan-nav-label">Handel<\/span><span class="sr-only">, Dein Angebot ist noch offen/);
});

test("warnt oben vor mehr als sieben Rohstoffen und markiert die Abgabe als Kartenaufgabe", () => {
  const game = foundedGame(); const me = game.players[0].id;
  const rich = { ...game, players: game.players.map((p) => p.id === me ? { ...p, resources: { wood: 3, brick: 2, wool: 2, grain: 1, ore: 1 } } : p) };
  const html = ui(rich, me);
  assert.doesNotMatch(html, /catan-nav-badge is-warn[^>]*>9<\/span>/);
  assert.match(html, /Mehr als sieben Karten: Bei einer 7 musst du 4 abgeben\./);
  const discard = { ...rich, phase: "discard", discards: { [me]: 4 } };
  assert.equal(suggestedTab(catanView(discard, me)), "karten");
  const discardHtml = ui(discard, me);
  assert.match(discardHtml, /class="catan-nav-badge is-alert" aria-hidden="true">4<\/span><\/span><span class="catan-nav-label">Karten<\/span><span class="sr-only">,[^<]*4[^<]*abgeben/);
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
  assert.match(bar, /class="catan-hand-total"[^>]*>[\s\S]*?>9</);
  assert.match(bar, /<div\b[^>]*class="catan-hand-strip"[^>]*role="group"[^>]*aria-label="Deine Rohstoffe: 3 Holz, 2 Lehm, 2 Wolle, 1 Getreide, 1 Erz"/);
  assert.doesNotMatch(bar, /<button[^>]*class="catan-hand-strip"/);
  assert.match(html, /<div class="catan-hand-bar is-warn">/);
  assert.match(ui({ ...rich, phase: "discard", discards: { [me]: 4 } }, me), /<div class="catan-hand-bar is-alert">/);
});

test("Handel startet mit der Wahl zwischen Hafen und Bank oder Mitspielenden", () => {
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
  assert.match(wood, /class="[^"]*catan-wood-icon/);
  assert.match(wood, /data-resource="wood"/);
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

test("das Baumenü erklärt allgemeine Einschränkungen einmal und behält jede Kostenzeile", () => {
  const game = foundedGame(); const active = game.players[game.currentPlayer].id;
  const html = ui(game, active);
  const build = html.slice(html.indexOf('-content-bauen"'), html.indexOf('-content-handel"'));
  assert.equal((build.match(/Würfle zuerst\./g) ?? []).length, 1);
  assert.equal((build.match(/class="catan-build-choice"/g) ?? []).length, 4);
  assert.equal((build.match(/aria-disabled="true"/g) ?? []).length, 4);
  assert.doesNotMatch(build, /Fehlende Rohstoffe ertauschen/);
  for (const footer of html.match(/<footer class="catan-screen-actions">[\s\S]*?<\/footer>/g) ?? []) assert.match(footer, /Würfeln/);
  const local = ui(game, active, { local: true, onHide() {} });
  assert.equal((local.match(/aria-label="Handkarten verdecken"/g) ?? []).length, 1);
  assert.doesNotMatch(local, />Hand verdecken<\/button>/);
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

test("Karten öffnen unmittelbar die gruppierten Entwicklungskarten und zählen nur diese im Tab", () => {
  const game = foundedGame(); const me = game.players[game.currentPlayer].id;
  game.turn = 4; game.phase = "main";
  game.players[game.currentPlayer].resources = { wood: 3, brick: 2, wool: 2, grain: 1, ore: 1 };
  game.players[game.currentPlayer].development = [
    { id: "old", type: "knight", boughtOnTurn: 2 },
    { id: "new", type: "knight", boughtOnTurn: 4 },
    { id: "point", type: "victory", boughtOnTurn: 4 },
  ];
  const cards = render(CardsPanel, { game: catanView(game, me), busy: false, send });
  assert.match(cards, /<h2>Entwicklungskarten<\/h2>/);
  assert.equal((cards.match(/class="catan-development-choice"/g) ?? []).length, 2);
  assert.match(cards, /Spielbar · 1 neu gekauft/);
  assert.match(cards, /aria-label="2 Karten">2×/);
  assert.doesNotMatch(cards, /Deine Rohstoffe|catan-resource-hand|catan-card-links|Bankbestand|Rohstoffkarten|Einen Schritt zurück/);
  assert.match(ui(game, me), /class="catan-nav-badge " aria-hidden="true">3<\/span><\/span><span class="catan-nav-label">Karten<\/span><span class="sr-only">, 3 Entwicklungskarten/);
  const empty = render(CardsPanel, { game: catanView(foundedGame(), me), busy: false, send });
  assert.match(empty, /Noch keine Entwicklungskarten/);
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
  assert.match(waiting, /<h2>Entwicklungskarten<\/h2>/);
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
  assert.equal((html.match(/class="catan-rule-section"/g) ?? []).length, 10);
  assert.doesNotMatch(html, /catan-pager|Seite wechseln/);
  const costs = html.slice(html.indexOf('class="catan-rule-costs"'), html.indexOf('</details>'));
  for (const label of ["Straße", "Siedlung", "Stadt", "Entwicklungskarte"]) assert.match(costs, new RegExp(`<strong>${label}<\\/strong>`));
  for (const [kind, cost] of Object.entries(COSTS)) {
    const index = Object.keys(COSTS).indexOf(kind);
    const row = costs.split(/<div><strong>/)[index + 1]?.split('</div>')[0];
    assert.ok(row, `Die Baukosten für ${kind} fehlen.`);
    for (const resource of RESOURCES.filter((resource) => cost[resource])) assert.match(row, new RegExp(`title="${RESOURCE_INFO[resource].label}"[\\s\\S]*?>${cost[resource]}<span class="sr-only"> ${RESOURCE_INFO[resource].label}`));
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
