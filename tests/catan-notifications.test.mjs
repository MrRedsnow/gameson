import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-notifications-${process.pid}.cjs`);
await mkdir(resolve(root, ".wrangler/test-artifacts"), { recursive: true });
await build({
  stdin: { contents: 'export * from "./lib/catan"; export * from "./lib/catan-notifications"; export { CatanNotificationContent } from "./components/catan/resource-rewards";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { RESOURCES, COSTS, emptyResources, createCatanGame, applyCatanAction, catanView, legalSettlements, legalRoads,
  createNotificationQueue, updateNotificationQueue, collectNotification, presentedResources, localNotificationRecipients, CatanNotificationContent } = createRequire(import.meta.url)(output);
const seats = [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }, { id: "c", name: "Clara" }];
function game() { const g = createCatanGame(seats, 12, () => 0); g.phase = "main"; g.turn = 2; return g; }
function fund(g, id, values) {
  const player = g.players.find((p) => p.id === id);
  for (const r of RESOURCES) { g.bank[r] += player.resources[r]; player.resources[r] = values[r] ?? 0; g.bank[r] -= player.resources[r]; }
}
function card(g, type) { g.deck.splice(g.deck.indexOf(type), 1); g.players[0].development.push({ id: type, type, boughtOnTurn: 1 }); }
const act = (g, move, actor = "a", random = () => 0) => applyCatanAction(g, actor, move, random);
const notices = (g, id, after = 0) => catanView(g, id).notifications.filter((n) => n.id > after);
const resources = (g, id, after = 0) => notices(g, id, after).filter((n) => n.kind === "resources");
function checkChanges(before, next) {
  for (const player of next.players) for (const r of RESOURCES) {
    const changes = resources(next, player.id, before.sequence).reduce((sum, n) => sum + (n.tone === "gain" ? 1 : -1) * n.resources[r], 0);
    assert.equal(changes, player.resources[r] - before.players.find((p) => p.id === player.id).resources[r]);
  }
}

test("Räuber meldet dem Opfer den genauen Verlust und dem Dieb den Gewinn privat", () => {
  const before = game(); before.phase = "steal"; before.victims = ["b"]; fund(before, "b", { ore: 2 });
  const next = act(before, { type: "steal", victimId: "b" });
  assert.equal(resources(next, "a")[0].tone, "gain");
  assert.equal(resources(next, "b")[0].tone, "loss");
  assert.equal(resources(next, "b")[0].resources.ore, 1);
  assert.match(resources(next, "b")[0].title, /Räuber/);
  assert.deepEqual(notices(next, "c"), []);
  assert.deepEqual(localNotificationRecipients(next, "a", before.sequence), ["a", "b"]);
  checkChanges(before, next);
});

test("Monopol informiert alle über die Karte und jede betroffene Hand über ihren Anteil", () => {
  const before = game(); card(before, "monopoly"); fund(before, "b", { wood: 3 }); fund(before, "c", { wood: 2 });
  const next = act(before, { type: "play_development", cardId: "monopoly", resource: "wood" });
  for (const id of ["a", "b", "c"]) {
    assert.equal(notices(next, id)[0].kind, "card");
    assert.match(notices(next, id)[0].message, /Anna.*Monopol.*Holz/);
    assert.equal(resources(next, id).length, 1);
    assert.ok(notices(next, id).every((n) => n.playerId === null || n.playerId === id));
  }
  assert.equal(resources(next, "a")[0].resources.wood, 5);
  assert.equal(resources(next, "b")[0].resources.wood, 3);
  assert.equal(resources(next, "c")[0].resources.wood, 2);
  assert.deepEqual(localNotificationRecipients(next, "a", before.sequence), ["a", "b", "c"]);
  checkChanges(before, next);
});

test("jede spielbare Entwicklungskarte meldet sich auch ohne Ressourcenänderung", () => {
  for (const type of ["knight", "road_building", "plenty", "monopoly"]) {
    const before = game(); card(before, type);
    before.board.vertices[0].owner = "a"; before.board.vertices[0].building = "settlement";
    const next = act(before, { type: "play_development", cardId: type, resource: "ore", resources: { grain: 2 } });
    assert.equal(notices(next, "b")[0].kind, "card", type);
    assert.equal(notices(next, "b")[0].playerId, null);
    if (type === "plenty") assert.equal(resources(next, "a")[0].resources.grain, 2);
    else assert.equal(resources(next, "a").length, 0);
    checkChanges(before, next);
  }
});

test("Kauf meldet Kosten und neue Karte ausschließlich der kaufenden Person", () => {
  const before = game(); fund(before, "a", COSTS.development); before.deck = ["victory"];
  const next = act(before, { type: "buy_development" });
  assert.match(notices(next, "a")[0].title, /Siegpunkt/);
  assert.equal(resources(next, "a")[0].tone, "loss");
  assert.deepEqual(notices(next, "b"), []);
  assert.ok(!JSON.stringify(catanView(next, "b")).includes("Neue Karte: Siegpunkt"));
  checkChanges(before, next);
});

test("Bankhandel und Spielerhandel zeigen Minus und Plus getrennt auf beiden Seiten", () => {
  const before = game(); fund(before, "a", { wood: 4 }); fund(before, "b", { ore: 2 });
  const bank = act(before, { type: "bank_trade", give: "wood", receive: "ore" });
  assert.deepEqual(resources(bank, "a").map((n) => n.tone), ["loss", "gain"]);
  assert.equal(resources(bank, "a")[0].resources.wood, 4); checkChanges(before, bank);
  const offer = act(before, { type: "offer_trade", toId: "b", give: { wood: 2 }, receive: { ore: 1 } });
  assert.deepEqual(notices(offer, "a"), []);
  const traded = act(offer, { type: "accept_trade", offerId: offer.trade.id }, "b");
  for (const id of ["a", "b"]) assert.deepEqual(resources(traded, id).map((n) => n.tone), ["loss", "gain"]);
  assert.deepEqual(localNotificationRecipients(traded, "b", offer.sequence), ["b", "a"]);
  assert.deepEqual(notices(traded, "c"), []); checkChanges(offer, traded);
});

test("Gründung, Würfelertrag, Baukosten und Abgabe werden vollständig erfasst", () => {
  let g = createCatanGame(seats, 12, () => 0);
  while (g.phase.startsWith("setup")) {
    const actor = g.players[g.currentPlayer].id;
    const road = g.phase === "setup_road";
    const position = road ? legalRoads(g, actor, g.setupVertex)[0] : legalSettlements(g, actor, true)[0];
    const next = act(g, { type: "build", building: road ? "road" : "settlement", position }, actor);
    checkChanges(g, next); g = next;
  }
  assert.ok(g.notifications.some((n) => n.title === "Startrohstoffe"));
  const rolled = act(g, { type: "roll" }); checkChanges(g, rolled);
  g = game(); g.phase = "roll";
  const hex = g.board.hexes.find((h) => h.resource !== "desert"); hex.number = 6;
  Object.assign(g.board.vertices[hex.vertices[0]], { owner: "b", building: "city" });
  const harvest = act(g, { type: "roll" }, "a", () => 2);
  assert.equal(resources(harvest, "b")[0].title, "Würfelertrag");
  assert.ok(resources(harvest, "b")[0].resources[hex.resource] >= 2); checkChanges(g, harvest);
  g = game(); fund(g, "a", { wood: 9 }); g.phase = "discard"; g.discards = { a: 4 };
  const discarded = act(g, { type: "discard", resources: { wood: 4 } });
  assert.equal(resources(discarded, "a")[0].resources.wood, 4); checkChanges(g, discarded);
  g = game(); fund(g, "a", COSTS.city); Object.assign(g.board.vertices[0], { owner: "a", building: "settlement" });
  const built = act(g, { type: "build", building: "city", position: 0 });
  assert.equal(resources(built, "a")[0].title, "Baukosten"); checkChanges(g, built);
});

test("Räuberbewegung und Wechsel einer Sonderkarte informieren alle, bisherigen Besitzer auch über Verlust", () => {
  let g = game(); g.phase = "robber";
  const moved = act(g, { type: "move_robber", hex: g.board.hexes.find((h) => h.id !== g.robberHex).id });
  for (const id of ["a", "b", "c"]) assert.equal(notices(moved, id)[0].kind, "robber");
  g = game(); card(g, "knight"); g.largestArmy = "b"; g.players[0].knights = 3; g.players[1].knights = 3;
  const awarded = act(g, { type: "play_development", cardId: "knight" });
  assert.equal(awarded.largestArmy, "a");
  assert.ok(notices(awarded, "b").some((n) => n.kind === "award" && n.tone === "loss" && /2 Siegpunkte/.test(n.message)));
  assert.ok(notices(awarded, "c").some((n) => n.kind === "award" && /Anna/.test(n.message)));
});

test("Polling verliert gegenläufige Änderungen nicht und unterbricht keine laufende Meldung", () => {
  const before = game(); fund(before, "a", { wood: 4 }); fund(before, "b", { wood: 4 }); card(before, "monopoly");
  let queue = createNotificationQueue(catanView(before, "a"));
  const traded = act(before, { type: "bank_trade", give: "wood", receive: "ore" });
  const after = act(traded, { type: "play_development", cardId: "monopoly", resource: "wood" });
  assert.equal(after.players[0].resources.wood, before.players[0].resources.wood);
  queue = updateNotificationQueue(queue, catanView(after, "a"));
  assert.deepEqual(queue.notices.filter((n) => n.resources?.wood).map((n) => n.tone), ["loss", "gain"]);
  const first = queue.notices[0];
  assert.equal(updateNotificationQueue(queue, catanView(after, "a")), queue);
  const ended = act(after, { type: "end_turn" });
  queue = updateNotificationQueue(queue, catanView(ended, "a"));
  assert.equal(queue.notices[0], first);
  assert.equal(collectNotification(queue, -1), queue);
  queue = collectNotification(queue, first.id);
  assert.equal(queue.notices[0].tone, "gain");
  assert.equal(presentedResources(catanView(ended, "a"), queue).ore, 0);
  queue = collectNotification(queue, queue.notices[0].id, "ore");
  assert.equal(presentedResources(catanView(ended, "a"), queue).ore, 1);
  assert.equal(queue.arrivals, 1);
  assert.equal(collectNotification(queue, queue.notices[0].id, "ore"), queue);
  assert.deepEqual(updateNotificationQueue(queue, catanView(ended, "b")).notices, []);
  const restored = createNotificationQueue(catanView(after, "a"), first.id);
  assert.ok(restored.notices.every((n) => n.id > first.id));
});

test("ältere Spielstände erhalten Meldungen ohne Migration, abgelehnte Aktionen erzeugen keine", () => {
  const before = game(); delete before.notifications; fund(before, "a", { wood: 4 });
  assert.deepEqual(catanView(before, "a").notifications, []);
  const next = act(before, { type: "bank_trade", give: "wood", receive: "ore" });
  assert.equal(resources(next, "a").length, 2);
  const original = structuredClone(next);
  assert.throws(() => act(next, { type: "bank_trade", give: "wood", receive: "ore" }));
  assert.deepEqual(next, original);
});

test("Fenster benennen Gewinne und Verluste mit Vorzeichen, Menge und Rohstoff", () => {
  for (const [tone, sign, label] of [["loss", "−", "verloren"], ["gain", "+", "erhalten"]]) {
    const notice = { id: 1, playerId: "a", kind: "resources", tone, title: "Räuber · Diebstahl", message: "Anna stiehlt Ben eine Rohstoffkarte.", resources: { ...emptyResources(), ore: 1 } };
    const html = renderToStaticMarkup(createElement(CatanNotificationContent, { notice }));
    assert.ok(html.includes(`Rohstoffe ${label}`));
    assert.ok(html.includes(`${sign}1`));
    assert.ok(html.includes("Erz"));
    assert.ok(html.includes(`lucide-${tone === "loss" ? "minus" : "plus"}`));
  }
});
