import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test, { after } from "node:test";
import { build } from "esbuild";
import { acceptMap } from "./catan-helpers.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, `.wrangler/test-artifacts/catan-presentation-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({ stdin: { contents: 'export * from "./lib/catan"; export * from "./lib/catan-presentation"; export * from "./lib/catan-notifications"; export * from "./components/catan/event-notice";', resolveDir: root, loader: "tsx" }, absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent" });
after(() => rm(output, { force: true }));
const { createCatanGame, applyCatanAction, catanView, longestRoadPath, longestRoadLength, CatanPresentationCursor, catanPresentationBatch, groupedActivity, CatanEventNoticePlayback, CATAN_EVENT_NOTICE_MS } = createRequire(import.meta.url)(output);
const seats = [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }, { id: "c", name: "Clara" }];
const view = (game, viewer = "a") => catanView(game, viewer);
function game() { const state = acceptMap(createCatanGame(seats, 12, () => 0), applyCatanAction); state.phase = "main"; state.turn = 2; return state; }
function purchase(before, type = "knight") {
  const state = structuredClone(before); state.deck = [type];
  for (const resource of ["wool", "grain", "ore"]) { state.bank[resource]--; state.players[0].resources[resource]++; }
  return applyCatanAction(state, "a", { type: "buy_development" });
}
function award(before, type, toId) {
  const state = structuredClone(before); const fromId = state[type]; state[type] = toId;
  state.notifications.push({ id: ++state.sequence, playerId: null, kind: "award", tone: "info", title: "Sonderkarte", message: "Auszeichnung", award: { type, fromId, toId } });
  return state;
}

test("zero-yield rolls produce public structured receipts without an activity notice", () => {
  const before = game(); before.phase = "roll";
  const next = applyCatanAction(before, "a", { type: "roll" }, () => 2);
  for (const viewer of ["a", "b", "spectator"]) {
    const current = view(next, viewer); const batch = catanPresentationBatch(view(before, viewer), current);
    assert.deepEqual(batch.roll.dice, [3, 3]); assert.equal(batch.roll.robberHex, before.robberHex);
    assert.deepEqual(groupedActivity(current, before.sequence), []);
  }
});

test("roll receipts preserve the original blocked field across later robber movement", () => {
  const before = game(); before.phase = "roll";
  const rolled = applyCatanAction(before, "a", { type: "roll" }, () => 2); rolled.phase = "robber";
  const target = rolled.board.hexes.find((hex) => hex.id !== rolled.robberHex).id;
  const moved = applyCatanAction(rolled, "a", { type: "move_robber", hex: target });
  const batch = catanPresentationBatch(view(before), view(moved));
  assert.equal(batch.roll.robberHex, before.robberHex);
  assert.deepEqual({ fromHex: batch.robber.fromHex, toHex: batch.robber.toHex }, { fromHex: before.robberHex, toHex: target });
  const advanced = applyCatanAction(moved, "a", { type: "end_turn" });
  assert.equal(catanPresentationBatch(view(before), view(advanced)).roll, null);
});

test("identical dice in a later turn form a fresh event while repeated snapshots do not", () => {
  const before = game(); before.phase = "roll";
  const first = applyCatanAction(before, "a", { type: "roll" }, () => 2);
  const ended = applyCatanAction(first, "a", { type: "end_turn" });
  const second = applyCatanAction(ended, "b", { type: "roll" }, () => 2);
  const initialBatch = catanPresentationBatch(view(before), view(first));
  const nextBatch = catanPresentationBatch(view(first), view(second));
  assert.deepEqual(initialBatch.roll.dice, nextBatch.roll.dice);
  assert.notEqual(initialBatch.roll.id, nextBatch.roll.id);
  assert.equal(nextBatch.roll.turn, second.turn);
  assert.equal(catanPresentationBatch(view(second), view(second)), null);
});

test("coalesced purchases reveal only the newest own card and no opponent's metadata", () => {
  const before = game(); const first = purchase(before, "victory"); const next = purchase(first, "plenty");
  const batch = catanPresentationBatch(view(before), view(next));
  assert.equal(batch.cards.length, 1); assert.equal(batch.cards[0].type, "plenty");
  assert.equal(catanPresentationBatch(view(before, "b"), view(next, "b")), null);
  const hostile = { ...view(next, "b"), notifications: next.notifications };
  assert.equal(catanPresentationBatch(view(before, "b"), hostile), null);
  assert.ok(!JSON.stringify(view(next, "b")).includes('"card":'));
  assert.equal(catanPresentationBatch(view(before), view(next, "b")), null);
});

test("award batches retain the latest holder for each award including an unoccupied road", () => {
  const before = game();
  const intermediate = award(before, "longestRoad", "b");
  const next = award(award(intermediate, "longestRoad", null), "largestArmy", "a");
  const batch = catanPresentationBatch(view(before), view(next));
  assert.deepEqual(batch.awards.map(({ type, fromId, toId }) => ({ type, fromId, toId })), [
    { type: "longestRoad", fromId: "b", toId: null }, { type: "largestArmy", fromId: null, toId: "a" },
  ]);
  assert.equal(catanPresentationBatch(view(next), { ...view(next), sequence: next.sequence + 1 }), null);
});

test("a confirmed knight action records a public structured award transfer", () => {
  const before = game(); before.players[0].knights = 3; before.players[1].knights = 3; before.largestArmy = "b";
  before.players[0].development.push({ id: "older-knight", type: "knight", boughtOnTurn: 1 });
  const next = applyCatanAction(before, "a", { type: "play_development", cardId: "older-knight" });
  const batch = catanPresentationBatch(view(before, "c"), view(next, "c"));
  assert.deepEqual(batch.awards.map(({ type, fromId, toId }) => ({ type, fromId, toId })), [{ type: "largestArmy", fromId: "b", toId: "a" }]);
});

test("old saves fall back to confirmed snapshots and the cursor never lowers its baseline", () => {
  const before = view(game()); const after = view(purchase({ ...game(), id: before.id }, "knight")); delete after.notifications;
  assert.equal(catanPresentationBatch(before, after).cards[0].type, "knight");
  const cursor = new CatanPresentationCursor(before);
  assert.ok(cursor.update(after)); assert.equal(cursor.update(before), null); assert.equal(cursor.update(after), null);
  assert.equal(cursor.update({ ...after, sequence: after.sequence + 1 }), null);
  const reconnect = { ...after, sequence: after.sequence + 2, largestArmy: "a" };
  assert.equal(cursor.update(reconnect, 1), null); assert.equal(cursor.update(reconnect, 1), null);
  assert.equal(cursor.update({ ...reconnect, id: "new" }, 1), null);
  assert.equal(catanPresentationBatch(null, after), null);
});

function graph(pairs) {
  const vertices = Array.from({ length: Math.max(...pairs.flat()) + 1 }, (_, id) => ({ id, x: 0, y: 0, hexes: [], edges: [], owner: null, building: null }));
  const edges = pairs.map(([a, b], id) => { vertices[a].edges.push(id); vertices[b].edges.push(id); return { id, a, b, owner: "a", hexes: [] }; });
  return { vertices, edges, hexes: [], harbors: [] };
}
function connected(board, path) {
  assert.equal(new Set(path).size, path.length);
  const endpoints = [board.edges[path[0]].a, board.edges[path[0]].b];
  assert.ok(endpoints.some((initial) => {
    let vertex = initial;
    for (const id of path) { const edge = board.edges[id]; if (edge.a !== vertex && edge.b !== vertex) return false; vertex = edge.a === vertex ? edge.b : edge.a; }
    return true;
  }));
}
test("longest road returns one contiguous trail with deterministic ties and enemy interruptions", () => {
  const branch = graph([[0, 1], [1, 2], [1, 3]]);
  assert.deepEqual(longestRoadPath(branch, "a"), [0, 1]); assert.equal(longestRoadLength(branch, "a"), 2);
  branch.vertices.forEach((vertex) => vertex.edges.reverse());
  assert.deepEqual(longestRoadPath(branch, "a"), [0, 1]);
  const ring = graph([[0, 1], [1, 2], [2, 3], [3, 0], [0, 4]]);
  const path = longestRoadPath(ring, "a"); assert.equal(path.length, 5); connected(ring, path);
  ring.vertices[0].owner = "b"; ring.vertices[0].building = "settlement";
  assert.equal(longestRoadPath(ring, "a").length, 4);
  assert.deepEqual(longestRoadPath(ring, "b"), []);
});

class Listeners {
  handlers = new Map();
  addEventListener(type, callback) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(callback); }
  removeEventListener(type, callback) { this.handlers.get(type)?.delete(callback); }
  emit(type) { this.handlers.get(type)?.forEach((callback) => callback()); }
  get size() { return [...this.handlers.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}
class Classes {
  items = new Set();
  add(...values) { values.forEach((value) => this.items.add(value)); }
  remove(...values) { values.forEach((value) => this.items.delete(value)); }
  contains(value) { return this.items.has(value); }
}
function environment(t, initial, { reduced = false, hidden = false } = {}) {
  const frames = new Map(); const timers = new Map(); let number = 0;
  const document = Object.assign(new Listeners(), { hidden, documentElement: { classList: new Classes() } });
  const motion = Object.assign(new Listeners(), { matches: reduced });
  const copy = new Map(["eyebrow", "title", "description", "footnote"].map((key) => [`[data-event-${key}]`, { textContent: "" }]));
  const attributes = new Map();
  const node = { hidden: true, className: "", offsetWidth: 100, classList: new Classes(), style: { setProperty() {} }, querySelector: (selector) => copy.get(selector), querySelectorAll: () => [...copy.values()], setAttribute: (key, value) => attributes.set(key, value), removeAttribute: (key) => attributes.delete(key) };
  const schedule = (callback, duration) => { const id = ++number; timers.set(id, { callback, duration }); return id; };
  const globals = { document, window: { matchMedia: () => motion, setTimeout: schedule }, clearTimeout: (id) => timers.delete(id), requestAnimationFrame: (callback) => { const id = ++number; frames.set(id, callback); return id; }, cancelAnimationFrame: (id) => frames.delete(id) };
  const originals = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const playback = new CatanEventNoticePlayback(node, initial);
  t.after(() => { playback.dispose(); for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return { document, motion, playback, node, timers, frames, attributes, text: (key) => copy.get(`[data-event-${key}]`).textContent,
    finish() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(({ callback, duration }) => { assert.equal(duration, CATAN_EVENT_NOTICE_MS); callback(); }); },
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()); },
  };
}

test("private card notice waits for dice, stays nonmodal and clears text on expiry", (t) => {
  const before = game(); const next = purchase(before, "victory"); const env = environment(t, view(before));
  env.document.documentElement.classList.add("catan-dice-rolling"); env.playback.update(view(next));
  assert.equal(env.node.hidden, true); assert.equal(env.frames.size, 1);
  env.document.documentElement.classList.remove("catan-dice-rolling"); env.frame();
  assert.equal(env.node.hidden, false); assert.equal(env.text("title"), "Siegpunkt"); assert.match(env.text("footnote"), /sofort verdeckt/);
  env.playback.update(view(next)); assert.equal(env.timers.size, 1);
  env.finish(); assert.equal(env.node.hidden, true); assert.equal(env.text("title"), "");
  env.playback.update(view(next)); assert.equal(env.node.hidden, true);
});

test("hidden views and baseline/player changes erase queued private content and never replay", (t) => {
  const before = game(); const next = purchase(before); const env = environment(t, view(before));
  env.playback.update(view(next)); assert.equal(env.node.hidden, false);
  env.document.hidden = true; env.document.emit("visibilitychange");
  assert.equal(env.node.hidden, true); assert.equal(env.timers.size, 0); assert.equal(env.text("title"), "");
  env.document.hidden = false; env.playback.update(view(next)); assert.equal(env.node.hidden, true);
  const latest = purchase(next, "plenty"); env.playback.update(view(latest), 1); assert.equal(env.node.hidden, true);
  env.playback.update(view(latest, "b"), 1); assert.equal(env.node.hidden, true);
  env.playback.update(view(latest), 1); assert.equal(env.node.hidden, true);
  env.playback.dispose(); env.playback.dispose(); assert.equal(env.document.size, 0); assert.equal(env.motion.size, 0);
});

test("reduced motion keeps static award feedback and a newer batch replaces older notices", (t) => {
  const before = game(); const first = award(before, "longestRoad", "b"); const env = environment(t, view(before), { reduced: true });
  env.playback.update(view(first)); assert.equal(env.attributes.get("data-motion"), "still"); assert.match(env.text("description"), /Ben erhält \+2/);
  const newer = award(first, "longestRoad", null); env.playback.update(view(newer));
  assert.match(env.text("description"), /unbesetzt/); assert.equal(env.timers.size, 1);
  env.playback.update(view(before)); assert.match(env.text("description"), /unbesetzt/);
  env.motion.matches = false; env.motion.emit("change"); assert.equal(env.attributes.get("data-motion"), "full");
  env.finish(); assert.equal(env.node.hidden, true);
});
