import { acceptMap } from "./catan-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-construction-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export * from "./lib/catan"; export * from "./lib/catan-construction"; export { ConstructionPlayback } from "./components/catan/construction-playback";', resolveDir: root, loader: "ts" },
  absWorkingDir: root, bundle: true, platform: "node", format: "cjs", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { createCatanGame, applyCatanAction, catanView, legalRoads, legalSettlements, RESOURCES, constructionBatch, ConstructionPlayback, CONSTRUCTION_ROAD_MS, CONSTRUCTION_BUILDING_MS, CONSTRUCTION_HANDOFF_MS } = createRequire(import.meta.url)(output);
const seats = [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }, { id: "c", name: "Clara" }];
const initial = () => acceptedCatanGame(seats, 12, () => 0);
const view = (game, viewer = "a") => catanView(game, viewer);
const actor = (game) => game.players[game.currentPlayer].id;
function settlement(game) { return applyCatanAction(game, actor(game), { type: "build", building: "settlement", position: legalSettlements(game, actor(game), true)[0] }); }
function road(game) { return applyCatanAction(game, actor(game), { type: "build", building: "road", position: legalRoads(game, actor(game), game.phase === "setup_road" ? game.setupVertex : null)[0] }); }
function founded() { let game = initial(); while (game.phase.startsWith("setup")) game = game.phase === "setup_settlement" ? settlement(game) : road(game); return game; }
function fund(game, playerId = "a") {
  const player = game.players.find((item) => item.id === playerId);
  for (const resource of RESOURCES) { game.bank[resource] += player.resources[resource]; player.resources[resource] = 5; game.bank[resource] -= 5; }
}

test("confirmed setup settlements and roads detect every owner using only public views", () => {
  const before = initial(); const built = settlement(before); const connected = road(built); const remote = settlement(connected);
  assert.deepEqual(constructionBatch(view(before, "spectator"), view(built, "spectator")).events.map(({ kind, ownerId, position }) => ({ kind, ownerId, position })), [{ kind: "settlement", ownerId: "a", position: built.setupVertex }]);
  const roadEvent = constructionBatch(view(built, "b"), view(connected, "b")).events;
  assert.equal(roadEvent.length, 1); assert.equal(roadEvent[0].kind, "road"); assert.equal(roadEvent[0].ownerId, "a");
  const remoteEvent = constructionBatch(view(connected), view(remote)).events;
  assert.equal(remoteEvent.length, 1); assert.equal(remoteEvent[0].ownerId, "b"); assert.equal(remoteEvent[0].kind, "settlement");
  assert.deepEqual(constructionBatch(view(connected), view(remote)), constructionBatch(view(connected), view(remote)), "Event IDs stay stable for the same confirmed interval.");
});

test("paid roads and city upgrades animate after successful rules-engine actions", () => {
  const before = founded(); before.phase = "main"; fund(before);
  const paidRoad = road(before);
  assert.equal(paidRoad.players[0].resources.wood, before.players[0].resources.wood - 1);
  assert.deepEqual(constructionBatch(view(before), view(paidRoad)).events.map((event) => event.kind), ["road"]);
  const vertex = paidRoad.board.vertices.find((item) => item.owner === "a" && item.building === "settlement");
  const city = applyCatanAction(paidRoad, "a", { type: "build", building: "city", position: vertex.id });
  assert.deepEqual(constructionBatch(view(paidRoad), view(city)).events.map(({ kind, position, ownerId }) => ({ kind, position, ownerId })), [{ kind: "city", position: vertex.id, ownerId: "a" }]);
});

test("free roads produce construction events without resource payments", () => {
  const before = founded(); before.phase = "main"; before.turn = 3;
  before.players[0].development.push({ id: "free", type: "road_building", boughtOnTurn: 1 });
  const card = applyCatanAction(before, "a", { type: "play_development", cardId: "free" });
  const next = road(card);
  assert.deepEqual(next.players[0].resources, card.players[0].resources);
  assert.deepEqual(constructionBatch(view(card), view(next)).events.map((event) => event.kind), ["road"]);
});

test("coalesced confirmed snapshots animate a null-to-city result once", () => {
  const before = initial(); const setup = founded(); setup.phase = "main"; fund(setup);
  const vertex = setup.board.vertices.find((item) => item.owner === "a" && item.building === "settlement");
  const next = applyCatanAction(setup, "a", { type: "build", building: "city", position: vertex.id });
  // Keep the game identity when a transport batches all intermediate accepted snapshots.
  before.id = next.id;
  const batch = constructionBatch(view(before), view(next));
  const buildings = batch.events.filter((event) => event.kind !== "road");
  assert.equal(buildings.length, 6); assert.equal(batch.events.filter((event) => event.kind === "road").length, 6);
  assert.deepEqual(buildings.filter((event) => event.position === vertex.id).map((event) => event.kind), ["city"]);
});

test("initial, restored, repeated and rejected snapshots never infer construction", () => {
  const before = initial(); const next = settlement(before); const current = view(next);
  assert.equal(constructionBatch(null, current), null);
  assert.equal(constructionBatch(view(before), { ...current, id: "other" }), null);
  assert.equal(constructionBatch(current, structuredClone(current)), null);
  assert.equal(constructionBatch(current, view(before)), null);
  assert.throws(() => applyCatanAction(before, "a", { type: "build", building: "city", position: 0 }));
  assert.equal(constructionBatch(view(before), view(before)), null);
  const removed = structuredClone(current); removed.sequence++;
  removed.board.vertices[next.setupVertex].owner = null; removed.board.vertices[next.setupVertex].building = null;
  assert.equal(constructionBatch(current, removed), null);
  assert.ok(CONSTRUCTION_HANDOFF_MS > Math.max(CONSTRUCTION_ROAD_MS, CONSTRUCTION_BUILDING_MS));
});

class Listeners {
  handlers = new Map();
  addEventListener(type, callback) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(callback); }
  removeEventListener(type, callback) { this.handlers.get(type)?.delete(callback); }
  emit(type) { this.handlers.get(type)?.forEach((callback) => callback()); }
  get size() { return [...this.handlers.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}
class Node {
  attributes = new Map(); children = []; queries = new Map(); parent = null;
  constructor(tagName = "g") { this.tagName = tagName; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) { return this.queries.get(selector) ?? null; }
  querySelectorAll(selector) { return this.queries.get(selector) ?? []; }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
}
function environment(t, game, { reducedMotion = false, hidden = false } = {}) {
  const frames = new Map(); let nextFrame = 0;
  const playbacks = [];
  const document = Object.assign(new Listeners(), { hidden, createElementNS: (_namespace, tagName) => new Node(tagName) });
  const motion = Object.assign(new Listeners(), { matches: reducedMotion });
  const globals = { document, window: { matchMedia: () => motion }, requestAnimationFrame: (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; }, cancelAnimationFrame: (id) => frames.delete(id) };
  const original = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { playbacks.forEach((playback) => playback.dispose()); for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const svg = new Node("svg"); const layer = new Node();
  const roads = new Map(game.board.edges.map((edge) => { const lines = [new Node("line"), new Node("line")]; svg.queries.set(`[data-catan-road="${edge.id}"] > line`, lines); return [edge.id, lines]; }));
  const buildings = new Map(game.board.vertices.map((vertex) => { const structure = new Node(); svg.queries.set(`[data-catan-building="${vertex.id}"] .catan-building-structure`, structure); return [vertex.id, structure]; }));
  return {
    svg, layer, roads, buildings, frames, document, motion,
    frameAt(time) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(time)); },
    playback(initialGame = game, visible = true, baseline = 0) { const playback = new ConstructionPlayback(svg, layer, initialGame, visible, baseline); playbacks.push(playback); return playback; },
  };
}

test("roads unroll both confirmed strokes in SVG world coordinates for 700ms", (t) => {
  const before = settlement(initial()); const next = road(before); const event = constructionBatch(before, next).events[0];
  const env = environment(t, next); const playback = env.playback(before); playback.update(next);
  const lines = env.roads.get(event.position);
  const edge = next.board.edges[event.position]; const a = next.board.vertices[edge.a]; const b = next.board.vertices[edge.b];
  const length = Math.hypot(a.x - b.x, a.y - b.y);
  for (const line of lines) assert.equal(Number(line.getAttribute("stroke-dashoffset")), length);
  env.frameAt(0); env.frameAt(350);
  for (const line of lines) assert.ok(Number(line.getAttribute("stroke-dashoffset")) > 0 && Number(line.getAttribute("stroke-dashoffset")) < length);
  env.frameAt(699); assert.equal(env.frames.size, 1);
  env.frameAt(700);
  for (const line of lines) { assert.equal(line.getAttribute("stroke-dashoffset"), null); assert.equal(line.getAttribute("stroke-dasharray"), null); }
  assert.equal(env.frames.size, 0);
});

test("building rise stays anchored and survives camera, menu and unrelated snapshot updates", (t) => {
  const before = initial(); const next = settlement(before); const position = next.setupVertex;
  const env = environment(t, next); const playback = env.playback(before); playback.update(next, true);
  const structure = env.buildings.get(position);
  assert.equal(structure.getAttribute("transform"), "scale(0.92 0.12)"); assert.equal(structure.getAttribute("opacity"), "0");
  const [effect] = env.layer.children;
  const vertex = next.board.vertices[position];
  assert.equal(effect.getAttribute("transform"), `translate(${vertex.x} ${vertex.y})`);
  assert.equal(effect.getAttribute("pointer-events"), "none"); assert.equal(effect.getAttribute("aria-hidden"), "true");
  assert.equal(effect.children[0].tagName, "ellipse"); assert.equal(effect.children.filter((node) => node.tagName === "circle").length, 7);
  env.frameAt(0); env.frameAt(375);
  const midway = structure.getAttribute("transform"); assert.notEqual(midway, "scale(0.92 0.12)");
  env.svg.setAttribute("viewBox", "-100 -100 200 200");
  playback.update({ ...next, sequence: next.sequence + 1 }, true);
  assert.equal(env.layer.children[0], effect); assert.equal(structure.getAttribute("transform"), midway); assert.equal(env.frames.size, 1);
  playback.update({ ...next, sequence: next.sequence + 1 }, true);
  env.frameAt(749); assert.equal(env.layer.children.length, 1);
  env.frameAt(750);
  assert.equal(structure.getAttribute("transform"), null); assert.equal(structure.getAttribute("opacity"), null);
  assert.equal(env.layer.children.length, 0); assert.equal(env.frames.size, 0);
});

test("city upgrade replaces an ongoing settlement effect without leaving old dust", (t) => {
  const before = initial(); const setup = founded(); setup.phase = "main"; fund(setup);
  before.id = setup.id;
  const vertex = setup.board.vertices.find((item) => item.owner === "a" && item.building === "settlement");
  const city = applyCatanAction(setup, "a", { type: "build", building: "city", position: vertex.id });
  const env = environment(t, city); const playback = env.playback(before); playback.update(setup);
  env.frameAt(0); env.frameAt(200);
  const old = env.layer.children.find((node) => node.getAttribute("data-construction-event").endsWith(`settlement:${vertex.id}`));
  playback.update(city);
  assert.equal(old.parent, null);
  const replacement = env.layer.children.filter((node) => node.getAttribute("data-construction-event").endsWith(`city:${vertex.id}`));
  assert.equal(replacement.length, 1); assert.equal(replacement[0].children[0].getAttribute("rx"), "25");
  env.frameAt(216); env.frameAt(966);
  assert.equal(env.layer.children.length, 0); assert.equal(env.frames.size, 0);
});

test("hidden views consume snapshots, clear running effects and never replay on return", (t) => {
  const before = initial(); const built = settlement(before); const connected = road(built);
  const env = environment(t, connected); const playback = env.playback(before);
  playback.update(built, false); assert.equal(env.frames.size, 0); assert.equal(env.layer.children.length, 0);
  playback.update(built, true); assert.equal(env.frames.size, 0);
  playback.update(connected, true); assert.equal(env.frames.size, 1);
  playback.update(connected, false); assert.equal(env.frames.size, 0);
  for (const line of env.roads.get(constructionBatch(built, connected).events[0].position)) assert.equal(line.getAttribute("stroke-dashoffset"), null);
  playback.update(connected, true); assert.equal(env.frames.size, 0);
});

test("background and reduced-motion changes settle effects and consume later snapshots", (t) => {
  const before = initial(); const built = settlement(before); const connected = road(built);
  const env = environment(t, connected); const playback = env.playback(before); playback.update(built);
  env.document.hidden = true; env.document.emit("visibilitychange");
  assert.equal(env.frames.size, 0); assert.equal(env.layer.children.length, 0); assert.equal(env.buildings.get(built.setupVertex).getAttribute("transform"), null);
  playback.update(connected); env.document.hidden = false; env.document.emit("visibilitychange"); playback.update(connected);
  assert.equal(env.frames.size, 0);
  const remote = settlement(connected); playback.update(remote); assert.equal(env.layer.children.length, 1);
  env.motion.matches = true; env.motion.emit("change"); assert.equal(env.layer.children.length, 0); assert.equal(env.frames.size, 0);
  const remoteRoad = road(remote); playback.update(remoteRoad); env.motion.matches = false; env.motion.emit("change"); playback.update(remoteRoad);
  assert.equal(env.frames.size, 0);
});

test("first load, reconnection baselines, old repeats and new games reset construction safely", (t) => {
  const before = initial(); const built = settlement(before); const connected = road(built);
  const env = environment(t, connected); const playback = env.playback(built);
  assert.equal(env.frames.size, 0); assert.equal(env.layer.children.length, 0);
  playback.update(connected, true, 1); assert.equal(env.frames.size, 0);
  playback.update(before, true, 1); playback.update(connected, true, 1); assert.equal(env.frames.size, 0, "A restored earlier snapshot cannot replay its already-seen successor.");
  const remote = settlement(connected); playback.update(remote, true, 1); assert.equal(env.layer.children.length, 1);
  playback.update({ ...remote, id: "new-game" }, true, 1); assert.equal(env.layer.children.length, 0); assert.equal(env.frames.size, 0);
  playback.dispose(); playback.dispose(); assert.equal(env.document.size, 0); assert.equal(env.motion.size, 0);
  playback.update(remote); assert.equal(env.frames.size, 0);
});

test("an older snapshot cannot become the baseline of a later unrelated update", (t) => {
  const before = initial(); const built = settlement(before); const connected = road(built);
  const env = environment(t, connected); const playback = env.playback(connected);
  playback.update(built);
  playback.update({ ...connected, sequence: connected.sequence + 1 });
  assert.equal(env.frames.size, 0); assert.equal(env.layer.children.length, 0);
  for (const line of env.roads.get(constructionBatch(built, connected).events[0].position)) assert.equal(line.getAttribute("stroke-dashoffset"), null);
});

test("initial reduced motion displays final pieces without scheduling construction", (t) => {
  const before = initial(); const next = settlement(before);
  const env = environment(t, next, { reducedMotion: true }); const playback = env.playback(before); playback.update(next);
  assert.equal(env.buildings.get(next.setupVertex).getAttribute("transform"), null); assert.equal(env.layer.children.length, 0); assert.equal(env.frames.size, 0);
});

function acceptedCatanGame(...args) { return acceptMap(createCatanGame(...args), applyCatanAction); }
