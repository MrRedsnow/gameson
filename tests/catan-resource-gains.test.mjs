import { acceptMap } from "./catan-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-resource-gains-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export * from "./lib/catan"; export * from "./lib/catan-resource-gains";', resolveDir: root, loader: "ts" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { RESOURCES, createCatanGame, applyCatanAction, catanView, emptyResources, resourceGainBatch, resourceLossBatch } = createRequire(import.meta.url)(output);
const seats = [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }, { id: "c", name: "Clara" }];
const act = (game, action, actor = "a", random = () => 2) => applyCatanAction(game, actor, action, random);
const view = (game, actor = "a") => catanView(game, actor);
const gainNotice = (game, actor = "a") => game.notifications.findLast((notice) => notice.playerId === actor && notice.kind === "resources" && notice.tone === "gain");

test("loss receipts survive a later gain in the same update and stay private", () => {
  const before = game(); fund(before, "a", { wood: 4 });
  const previous = view(before);
  const next = structuredClone(previous); next.sequence += 3;
  next.notifications = [
    { id: previous.sequence + 1, playerId: "a", kind: "resources", tone: "loss", resources: { ...emptyResources(), wood: 4 } },
    { id: previous.sequence + 2, playerId: "a", kind: "resources", tone: "gain", resources: { ...emptyResources(), wood: 4 } },
    { id: previous.sequence + 3, playerId: "b", kind: "resources", tone: "loss", resources: { ...emptyResources(), ore: 3 } },
  ];
  assert.deepEqual(resourceLossBatch(previous, next).losses, { ...emptyResources(), wood: 4 });
  assert.equal(resourceGainBatch(previous, next).gains.wood, 4);
  assert.equal(resourceLossBatch(next, next), null);
  assert.equal(resourceLossBatch(next, previous), null);
  assert.equal(resourceLossBatch(previous, { ...next, me: { ...next.me, id: "b" } }), null);
});

test("legacy loss snapshots report only the confirmed decrease", () => {
  const before = game(); fund(before, "a", { wood: 4, grain: 2 });
  const previous = view(before);
  const next = structuredClone(previous); next.sequence++; next.notifications = [];
  next.me.resources.wood = 1; next.me.resources.grain = 3;
  assert.deepEqual(resourceLossBatch(previous, next).losses, { ...emptyResources(), wood: 3 });
});
function game() { const result = acceptedCatanGame(seats, 12, () => 0); result.phase = "main"; result.turn = 2; return result; }
function fund(game, actor, resources) {
  const player = game.players.find((player) => player.id === actor);
  for (const resource of RESOURCES) {
    game.bank[resource] += player.resources[resource];
    player.resources[resource] = resources[resource] ?? 0;
    game.bank[resource] -= player.resources[resource];
  }
}
function harvestGame() {
  const result = game(); result.phase = "roll";
  result.board.hexes.forEach((hex) => { hex.number = null; });
  const [first, second] = result.board.hexes.filter((hex) => hex.resource === "wood");
  first.number = 6; second.number = 6;
  const city = first.vertices.find((id) => !second.vertices.includes(id));
  const settlement = second.vertices.find((id) => !first.vertices.includes(id));
  Object.assign(result.board.vertices[city], { owner: "a", building: "city" });
  Object.assign(result.board.vertices[settlement], { owner: "a", building: "settlement" });
  return { game: result, first, second, city, settlement };
}

test("Würfelertrag bewahrt jedes Feld und zwei einzelne Karten einer Stadt", () => {
  const { game: before, first, second } = harvestGame();
  const next = act(before, { type: "roll" });
  assert.deepEqual(gainNotice(next).resourceOrigins, [
    { hexId: first.id, resource: "wood", amount: 2 },
    { hexId: second.id, resource: "wood", amount: 1 },
  ]);
  const batch = resourceGainBatch(view(before), view(next));
  assert.deepEqual(batch.gains, { ...emptyResources(), wood: 3 });
  assert.deepEqual(batch.steps.map(({ resource, hexId }) => ({ resource, hexId })), [
    { resource: "wood", hexId: first.id }, { resource: "wood", hexId: first.id }, { resource: "wood", hexId: second.id },
  ]);
  assert.equal(new Set(batch.steps.map((step) => step.id)).size, 3);
  assert.deepEqual(resourceGainBatch(view(before), view(next)), batch, "Eine identische Übergabe ergibt stabile Animations-IDs.");
});

test("späterer Stadtbau oder Räuberstand verändert historische Ertragsfelder nicht", () => {
  const { game: before, first, second, settlement } = harvestGame();
  fund(before, "a", { ore: 3, grain: 2 });
  const harvested = act(before, { type: "roll" });
  const next = act(harvested, { type: "build", building: "city", position: settlement });
  next.robberHex = first.id;
  const batch = resourceGainBatch(view(before), view(next));
  assert.equal(next.board.vertices[settlement].building, "city");
  assert.deepEqual(batch.steps.map((step) => step.hexId), [first.id, first.id, second.id]);
  assert.equal(batch.gains.wood, 3, "Das neue Stadtgebäude darf den alten Ertrag nicht verdoppeln.");
});

test("Räuberfeld produziert weder Karten noch Ursprünge", () => {
  const { game: before, first, second } = harvestGame();
  before.robberHex = first.id;
  const next = act(before, { type: "roll" });
  assert.deepEqual(gainNotice(next).resourceOrigins, [{ hexId: second.id, resource: "wood", amount: 1 }]);
  assert.deepEqual(resourceGainBatch(view(before), view(next)).steps.map((step) => step.hexId), [second.id]);
});

test("Bankmangel begrenzt die Ursprünge auf tatsächlich erhaltene Karten", () => {
  const { game: before, first } = harvestGame(); before.bank.wood = 1;
  const next = act(before, { type: "roll" });
  assert.equal(next.players[0].resources.wood, 1);
  assert.deepEqual(gainNotice(next).resourceOrigins, [{ hexId: first.id, resource: "wood", amount: 1 }]);
  assert.equal(resourceGainBatch(view(before), view(next)).steps.length, 1);
});

test("Bankmangel für mehrere Empfänger erzeugt keine scheinbaren Erträge", () => {
  const { game: before, first } = harvestGame(); before.bank.wood = 3;
  const other = first.vertices.find((id) => before.board.vertices[id].owner === null);
  Object.assign(before.board.vertices[other], { owner: "b", building: "settlement" });
  const next = act(before, { type: "roll" });
  assert.equal(next.players[0].resources.wood, 0); assert.equal(next.players[1].resources.wood, 0);
  assert.equal(gainNotice(next), undefined); assert.equal(gainNotice(next, "b"), undefined);
  assert.equal(resourceGainBatch(view(before), view(next)), null);
});

test("nur die zweite Startsiedlung liefert Karten aus ihren angrenzenden Feldern", () => {
  for (const secondSettlement of [false, true]) {
    const before = acceptedCatanGame(seats, 12, () => 0);
    before.setupIndex = secondSettlement ? before.players.length : 0;
    const vertex = before.board.vertices.find((vertex) => vertex.hexes.length === 3 && vertex.hexes.every((id) => before.board.hexes[id].resource !== "desert"));
    const next = act(before, { type: "build", building: "settlement", position: vertex.id });
    if (!secondSettlement) {
      assert.equal(gainNotice(next), undefined); assert.equal(resourceGainBatch(view(before), view(next)), null); continue;
    }
    const expected = vertex.hexes.map((hexId) => ({ hexId, resource: before.board.hexes[hexId].resource, amount: 1 }));
    assert.deepEqual(gainNotice(next).resourceOrigins, expected);
    const batch = resourceGainBatch(view(before), view(next));
    assert.equal(batch.steps.length, 3);
    assert.deepEqual(batch.steps.map(({ resource, hexId }) => `${resource}:${hexId}`).sort(), expected.map(({ resource, hexId }) => `${resource}:${hexId}`).sort());
  }
});

test("Ursprünge bleiben privat und die Übergabe filtert fremde Ressourcenmeldungen", () => {
  const { game: before, first, second } = harvestGame();
  const other = first.vertices.find((id) => before.board.vertices[id].owner === null && !second.vertices.includes(id));
  Object.assign(before.board.vertices[other], { owner: "b", building: "settlement" });
  const next = act(before, { type: "roll" });
  for (const actor of ["a", "b", "c", "spectator"]) {
    const current = view(next, actor);
    assert.ok(current.notifications.every((notice) => !notice.resourceOrigins || notice.playerId === actor));
    const batch = resourceGainBatch(view(before, actor), current);
    if (actor === "a") assert.equal(batch.gains.wood, 3);
    else if (actor === "b") assert.equal(batch.gains.wood, 1);
    else assert.equal(batch, null);
  }
  const unfiltered = { ...view(next), notifications: next.notifications };
  assert.equal(resourceGainBatch(view(before), unfiltered).gains.wood, 3);
});

test("gebündelte Gewinne bleiben sichtbar auch wenn spätere Kosten den Nettogewinn aufheben", () => {
  const before = game(); fund(before, "a", { wood: 4 }); fund(before, "b", { wood: 4 });
  before.deck.splice(before.deck.indexOf("monopoly"), 1);
  before.players[0].development.push({ id: "monopoly", type: "monopoly", boughtOnTurn: 1 });
  const traded = act(before, { type: "bank_trade", give: "wood", receive: "ore" });
  const next = act(traded, { type: "play_development", cardId: "monopoly", resource: "wood" });
  assert.equal(next.players[0].resources.wood, before.players[0].resources.wood);
  const batch = resourceGainBatch(view(before), view(next));
  assert.deepEqual(batch.gains, { ...emptyResources(), wood: 4, ore: 1 });
  assert.equal(batch.steps.length, 5); assert.ok(batch.steps.every((step) => step.hexId === null));
  assert.ok(next.notifications.every((notice) => !notice.resourceOrigins));
  assert.equal(resourceGainBatch(view(before, "b"), view(next, "b")), null, "Ein reiner Verlust zählt nicht grün hoch.");
});

test("mehrere Bestätigungen summieren Erträge ohne alte Belege erneut einzubeziehen", () => {
  const before = game(); fund(before, "a", { wood: 8 });
  const first = act(before, { type: "bank_trade", give: "wood", receive: "ore" });
  const second = act(first, { type: "bank_trade", give: "wood", receive: "ore" });
  assert.equal(resourceGainBatch(view(before), view(second)).gains.ore, 2);
  assert.equal(resourceGainBatch(view(first), view(second)).gains.ore, 1);
  assert.equal(resourceGainBatch(view(second), view(second)), null);
});

test("Initialisierung, Spielerwechsel, neue Partie und wiederholte Sequenz spielen nichts ab", () => {
  const { game: before } = harvestGame(); const next = act(before, { type: "roll" }); const current = view(next);
  assert.equal(resourceGainBatch(null, current), null);
  assert.equal(resourceGainBatch(view(before, "b"), current), null);
  assert.equal(resourceGainBatch({ ...view(before), id: "another-game" }, current), null);
  assert.equal(resourceGainBatch({ ...view(before), sequence: current.sequence }, current), null);
  assert.equal(resourceGainBatch({ ...view(before), sequence: current.sequence + 1 }, current), null);
  assert.equal(resourceGainBatch(current, structuredClone(current)), null);
});

test("alte Belege und alte Spielstände ohne Belege zählen ohne erfundene Feldursprünge hoch", () => {
  const { game: before } = harvestGame(); const next = act(before, { type: "roll" });
  const current = view(next); current.notifications.forEach((notice) => { delete notice.resourceOrigins; });
  let batch = resourceGainBatch(view(before), current);
  assert.equal(batch.gains.wood, 3); assert.ok(batch.steps.every((step) => step.hexId === null));
  delete current.notifications;
  batch = resourceGainBatch(view(before), current);
  assert.equal(batch.gains.wood, 3); assert.ok(batch.steps.every((step) => step.hexId === null));
  assert.equal(resourceGainBatch(view(next), { ...current, sequence: current.sequence + 1 }), null);
});

test("fehlende Gewinne anderer Rohstoffe fallen auf die bestätigte Bestandsdifferenz zurück", () => {
  const { game: before } = harvestGame(); const next = act(before, { type: "roll" });
  const current = view(next); current.me.resources.ore = 2;
  const batch = resourceGainBatch(view(before), current);
  assert.equal(batch.gains.wood, 3); assert.equal(batch.gains.ore, 2);
  assert.equal(batch.steps.filter((step) => step.resource === "wood" && step.hexId !== null).length, 3);
  assert.equal(batch.steps.filter((step) => step.resource === "ore" && step.hexId === null).length, 2);
});

test("unvollständige oder überzählige Ursprünge verändern die bestätigte Kartenmenge nicht", () => {
  const { game: before, first } = harvestGame(); const next = act(before, { type: "roll" }); const current = view(next);
  const notice = current.notifications.find((notice) => notice.resourceOrigins);
  notice.resourceOrigins = [{ hexId: first.id, resource: "wood", amount: 100 }];
  let batch = resourceGainBatch(view(before), current);
  assert.equal(batch.steps.length, 3); assert.ok(batch.steps.every((step) => step.hexId === first.id));
  notice.resourceOrigins = [
    { hexId: first.id, resource: "wood", amount: 1 },
    { hexId: 999, resource: "wood", amount: 2 },
    { hexId: first.id, resource: "wood", amount: -1 },
  ];
  batch = resourceGainBatch(view(before), current);
  assert.deepEqual(batch.steps.map((step) => step.hexId), [first.id, null, null]);
});

function acceptedCatanGame(...args) { return acceptMap(createCatanGame(...args), applyCatanAction); }
