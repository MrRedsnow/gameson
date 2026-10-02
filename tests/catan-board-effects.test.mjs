import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { acceptMap } from "./catan-helpers.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-board-effects-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({ stdin: { contents: 'export * from "./lib/catan"; export * from "./components/catan/board-effects"; export { CatanBoard } from "./components/catan/board";', resolveDir: root, loader: "tsx" }, absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent" });
after(() => rm(output, { force: true }));
const { createCatanGame, applyCatanAction, catanView, BoardEffectsPlayback, harborOwners, CatanBoard, longestRoadPath } = createRequire(import.meta.url)(output);
const initial = () => catanView(acceptMap(createCatanGame([{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }, { id: "c", name: "Clara" }], 12, () => 0), applyCatanAction), "a");
const harborMarkup = (html, edge) => html.split(`data-catan-harbor="${edge}"`)[1].split('data-catan-harbor="')[0];

class Listeners {
  handlers = new Map();
  addEventListener(type, callback) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(callback); }
  removeEventListener(type, callback) { this.handlers.get(type)?.delete(callback); }
  emit(type) { this.handlers.get(type)?.forEach((callback) => callback()); }
  get size() { return [...this.handlers.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}
class Node {
  attributes = new Map(); children = []; queries = new Map(); parent = null; textContent = "";
  classes = new Set();
  classList = { add: (...classes) => classes.forEach((name) => this.classes.add(name)), remove: (...classes) => classes.forEach((name) => this.classes.delete(name)), contains: (name) => this.classes.has(name) };
  constructor(tagName = "g") { this.tagName = tagName; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) { return this.queries.get(selector) ?? null; }
  append(...children) { children.forEach((child) => { this.children.push(child); child.parent = this; }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); this.parent = null; }
}
function environment(t, game, { reducedMotion = false } = {}) {
  const frames = new Map(); let id = 0;
  const document = Object.assign(new Listeners(), { hidden: false, documentElement: new Node("html"), createElementNS: (_namespace, tagName) => new Node(tagName) });
  const motion = Object.assign(new Listeners(), { matches: reducedMotion });
  const globals = { document, window: { matchMedia: () => motion }, requestAnimationFrame: (callback) => { const next = ++id; frames.set(next, callback); return next; }, cancelAnimationFrame: (frame) => frames.delete(frame) };
  const original = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.entries(globals).forEach(([key, value]) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }));
  const svg = new Node("svg"); const layer = new Node(); const traveller = new Node("use");
  const setRobberPosition = (hexId) => { const hex = game.board.hexes[hexId]; traveller.setAttribute("transform", `translate(${hex.x - 20} ${hex.y - 29})`); };
  setRobberPosition(game.robberHex); svg.queries.set("[data-catan-robber-traveller]", traveller);
  const numbers = game.board.hexes.map((hex) => { const node = new Node("text"); svg.queries.set(`[data-catan-number="${hex.id}"]`, node); return node; });
  const harbors = game.board.harbors.map((harbor) => { const node = new Node(); svg.queries.set(`[data-catan-harbor="${harbor.edge}"]`, node); return node; });
  const busy = [];
  const playback = new BoardEffectsPlayback(svg, layer, game, true, 0, (value) => busy.push(value));
  t.after(() => { playback.dispose(); Object.entries(original).forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }); });
  return { svg, layer, traveller, numbers, harbors, document, motion, frames, busy, playback, setRobberPosition, frameAt(time) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(time)); } };
}
function rolled(game, sumHex) {
  const next = structuredClone(game); next.sequence++; next.phase = "main";
  const sum = next.board.hexes[sumHex].number;
  next.dice = sum <= 7 ? [1, sum - 1] : [6, sum - 6];
  return next;
}

test("harbor access derives only owners with a building at either coast endpoint", () => {
  const game = initial(); const harbor = game.board.harbors[0]; const edge = game.board.edges[harbor.edge];
  assert.deepEqual(harborOwners(game.board, harbor.edge), []);
  game.board.vertices[edge.a].owner = "a";
  assert.deepEqual(harborOwners(game.board, harbor.edge), [], "A bare road endpoint does not own a harbor.");
  game.board.vertices[edge.a].building = "settlement";
  assert.deepEqual(harborOwners(game.board, harbor.edge), ["a"]);
  Object.assign(game.board.vertices[edge.b], { owner: "a", building: "city" });
  assert.deepEqual(harborOwners(game.board, harbor.edge), ["a"]);
});

test("production outlines wait for dice docking, pulse 900ms and mark the historical robber field", (t) => {
  const before = initial(); const hex = before.board.hexes.find((hex) => hex.number && hex.number !== 7);
  before.robberHex = hex.id; const next = rolled(before, hex.id);
  const env = environment(t, before);
  env.document.documentElement.classList.add("catan-dice-rolling"); env.playback.update(next);
  env.frameAt(0); env.frameAt(2400); assert.equal(env.layer.children.length, 0);
  env.document.documentElement.classList.remove("catan-dice-rolling"); env.frameAt(2410);
  assert.ok(env.layer.children.some((node) => node.textContent === "Blockiert"));
  assert.ok(env.layer.children.filter((node) => node.tagName === "polygon").every((node) => node.getAttribute("pointer-events") === "none"));
  assert.equal(env.numbers[hex.id].classes.has("is-roll-hit"), true);
  env.frameAt(3309); assert.ok(env.layer.children.length);
  env.frameAt(3310); assert.equal(env.layer.children.length, 0); assert.equal(env.numbers[hex.id].classes.size, 0); assert.deepEqual(env.busy, [true, false]);
});

test("seven never highlights production and a subsequent same-result turn is fresh", (t) => {
  const before = initial(); const env = environment(t, before);
  const seven = { ...before, sequence: before.sequence + 1, phase: "robber", dice: [3, 4] };
  env.playback.update(seven); env.frameAt(0); env.frameAt(1); assert.equal(env.layer.children.length, 0);
  const hex = before.board.hexes.find((hex) => hex.number && hex.number !== 7);
  const next = rolled(seven, hex.id); env.playback.update(next); env.frameAt(2); env.frameAt(902);
  const again = { ...next, sequence: next.sequence + 1, turn: next.turn + 1 };
  env.playback.update(again); env.frameAt(903); assert.ok(env.layer.children.length);
});

test("robber travels from its previous world coordinates for 650ms before landing dust", (t) => {
  const before = initial(); const next = { ...before, sequence: before.sequence + 1, robberHex: before.robberHex === 0 ? 1 : 0 };
  const env = environment(t, before); env.setRobberPosition(next.robberHex); const finalTransform = env.traveller.getAttribute("transform");
  env.playback.update(next); env.frameAt(0);
  const from = before.board.hexes[before.robberHex]; const to = before.board.hexes[next.robberHex];
  assert.equal(env.traveller.getAttribute("transform"), `translate(${from.x - to.x} ${from.y - to.y}) ${finalTransform}`);
  env.frameAt(325); assert.notEqual(env.traveller.getAttribute("transform"), finalTransform);
  env.frameAt(650); assert.equal(env.traveller.getAttribute("transform"), finalTransform);
  env.frameAt(750); assert.ok(env.layer.children[0].children.some((node) => Number(node.getAttribute("opacity")) > 0));
  env.frameAt(900); assert.equal(env.layer.children.length, 0); assert.equal(env.traveller.getAttribute("transform"), finalTransform);
});

test("harbor opening responds to construction even without a presentation receipt", (t) => {
  const before = initial(); const next = structuredClone(before); next.sequence++;
  const edge = next.board.edges[next.board.harbors[0].edge]; Object.assign(next.board.vertices[edge.a], { owner: "a", building: "settlement" });
  const env = environment(t, before); env.playback.update(next); env.frameAt(0);
  assert.equal(env.harbors[0].classes.has("is-newly-opened"), true);
  env.frameAt(1199); assert.equal(env.harbors[0].classes.has("is-newly-opened"), true);
  env.frameAt(1200); assert.equal(env.harbors[0].classes.has("is-newly-opened"), false);
  env.playback.update(next); assert.equal(env.frames.size, 0);
});

test("longest road award marks only its rule-valid path and clears on holder loss", (t) => {
  const before = initial(); before.board.edges.slice(0, 9).forEach((edge) => { edge.owner = "a"; });
  const next = { ...before, sequence: before.sequence + 1, longestRoad: "a" };
  const env = environment(t, before); env.playback.update(next); env.frameAt(0);
  const expected = longestRoadPath(next.board, "a");
  assert.equal(env.layer.children.length, expected.length);
  for (const [index, node] of env.layer.children.entries()) {
    const edge = next.board.edges[expected[index]];
    assert.equal(Number(node.getAttribute("x1")), next.board.vertices[edge.a].x);
    assert.equal(Number(node.getAttribute("y2")), next.board.vertices[edge.b].y);
  }
  env.playback.update({ ...next, sequence: next.sequence + 1, longestRoad: null });
  assert.equal(env.layer.children.length, 0, "The previous path cannot continue glowing after the award becomes vacant.");
});

test("a newer robber movement cancels its old journey and settles at the latest sprite position", (t) => {
  const before = initial(); const targets = before.board.hexes.filter((hex) => hex.id !== before.robberHex).slice(0, 2);
  const env = environment(t, before);
  const first = { ...before, sequence: before.sequence + 1, robberHex: targets[0].id };
  env.setRobberPosition(first.robberHex); env.playback.update(first); env.frameAt(0); env.frameAt(200);
  const oldDust = env.layer.children[0];
  const second = { ...first, sequence: first.sequence + 1, robberHex: targets[1].id };
  env.setRobberPosition(second.robberHex); const destination = env.traveller.getAttribute("transform");
  env.playback.update(second); assert.equal(oldDust.parent, null); assert.equal(env.layer.children.length, 1);
  env.frameAt(216); env.frameAt(1116);
  assert.equal(env.traveller.getAttribute("transform"), destination); assert.equal(env.layer.children.length, 0);
});

test("a hidden or reset snapshot during robber travel settles at its newest authoritative destination", (t) => {
  const before = initial(); const targets = before.board.hexes.filter((hex) => hex.id !== before.robberHex).slice(0, 2);
  const env = environment(t, before);
  const first = { ...before, sequence: before.sequence + 1, robberHex: targets[0].id };
  env.setRobberPosition(first.robberHex); env.playback.update(first); env.frameAt(0); env.frameAt(200);
  const second = { ...first, sequence: first.sequence + 1, robberHex: targets[1].id };
  env.setRobberPosition(second.robberHex); const secondDestination = env.traveller.getAttribute("transform");
  env.playback.update(second, false);
  assert.equal(env.traveller.getAttribute("transform"), secondDestination);
  env.playback.update(second, true); assert.equal(env.frames.size, 0);
  const third = { ...second, sequence: second.sequence + 1, robberHex: targets[0].id };
  env.setRobberPosition(third.robberHex); env.playback.update(third); env.frameAt(220); env.frameAt(420);
  const reset = { ...third, sequence: third.sequence + 1, robberHex: targets[1].id };
  env.setRobberPosition(reset.robberHex); const resetDestination = env.traveller.getAttribute("transform");
  env.playback.update(reset, true, 1);
  assert.equal(env.traveller.getAttribute("transform"), resetDestination); assert.equal(env.frames.size, 0);
});

test("hidden, viewer and baseline changes consume effects without replay; disposal frees listeners", (t) => {
  const before = initial(); const next = rolled(before, before.board.hexes.find((hex) => hex.number).id);
  const env = environment(t, before); env.playback.update(next, false); env.playback.update(next, true); assert.equal(env.frames.size, 0);
  const newer = { ...next, sequence: next.sequence + 1, turn: next.turn + 1 };
  env.playback.update(newer); env.frameAt(0); assert.ok(env.layer.children.length);
  env.document.hidden = true; env.document.emit("visibilitychange"); assert.equal(env.layer.children.length, 0); assert.equal(env.frames.size, 0);
  env.document.hidden = false; env.playback.update(newer); assert.equal(env.frames.size, 0);
  const restored = { ...newer, sequence: newer.sequence + 1, turn: newer.turn + 1 };
  env.playback.update(restored, true, 1); assert.equal(env.frames.size, 0);
  env.playback.update({ ...restored, sequence: restored.sequence + 1, me: { ...restored.me, id: "b" } }, true, 1); assert.equal(env.frames.size, 0);
  env.playback.dispose(); assert.equal(env.document.size, 0); assert.equal(env.motion.size, 0);
});

test("reduced motion leaves robber at final coordinates and uses short static feedback", (t) => {
  const before = initial(); const env = environment(t, before, { reducedMotion: true });
  const next = { ...before, sequence: before.sequence + 1, robberHex: before.robberHex === 0 ? 1 : 0 };
  env.setRobberPosition(next.robberHex); const finalTransform = env.traveller.getAttribute("transform");
  env.playback.update(next); env.frameAt(0); assert.equal(env.layer.children.length, 0); assert.equal(env.traveller.getAttribute("transform"), finalTransform);
  env.frameAt(400); assert.equal(env.traveller.getAttribute("opacity"), null); assert.equal(env.frames.size, 0);
});

test("selected settlement preview uses own color and city preview replaces the old settlement", () => {
  const game = initial(); const position = game.board.vertices[0].id;
  const props = { game, mode: "settlement", choices: [position], selected: position, onSelect() {}, disabled: false };
  let html = renderToStaticMarkup(createElement(CatanBoard, props));
  assert.match(html, /class="catan-building-preview"[^>]*pointer-events="none"[^>]*aria-hidden="true"/);
  assert.match(html, /data-catan-building-preview="0"/);
  assert.match(html, /data-building="settlement"/);
  Object.assign(game.board.vertices[position], { owner: "a", building: "settlement" });
  html = renderToStaticMarkup(createElement(CatanBoard, { ...props, mode: "city" }));
  assert.match(html, /data-building="city"/); assert.doesNotMatch(html, /data-catan-building="0"|data-building="settlement"/);
  const illegal = renderToStaticMarkup(createElement(CatanBoard, { ...props, choices: [] }));
  assert.doesNotMatch(illegal, /data-catan-building-preview/);
});

test("harbor access colors both its anchor and rate while preserving the resource and title", () => {
  const game = initial(); const harbor = game.board.harbors[0];
  Object.assign(game.board.vertices[game.board.edges[harbor.edge].a], { owner: "b", building: "settlement" });
  const html = renderToStaticMarkup(createElement(CatanBoard, { game, mode: null, choices: [], selected: null, onSelect() {}, disabled: false }));
  const owned = harborMarkup(html, harbor.edge);
  assert.match(owned, /erschlossen von Ben/);
  assert.match(owned, /stroke="#63a9e9"[^>]*class="lucide lucide-anchor"/);
  assert.match(owned, /<text[^>]*fill="#63a9e9"[^>]*>[23]:1<\/text>/);
  if (harbor.resource !== "any") assert.match(owned, new RegExp(`data-resource="${harbor.resource}"`));
  assert.doesNotMatch(html, /catan-harbor-flag|data-catan-harbor-owner=/);
  assert.ok(html.indexOf('class="catan-number-label') > html.indexOf('class="catan-ambient-island"'), "Numbers paint over ambient sprites.");
});

test("unopened harbors keep their neutral anchor and rate, including specific resource ports", () => {
  const game = initial(); const html = renderToStaticMarkup(createElement(CatanBoard, { game, mode: null, choices: [], selected: null, onSelect() {}, disabled: false }));
  for (const harbor of game.board.harbors) {
    const rendered = harborMarkup(html, harbor.edge);
    assert.match(rendered, /stroke="#dfdac7"[^>]*class="lucide lucide-anchor"/);
    assert.match(rendered, /<text[^>]*fill="#f2ecda"[^>]*>[23]:1<\/text>/);
    assert.doesNotMatch(rendered, /erschlossen von/);
    if (harbor.resource !== "any") assert.match(rendered, new RegExp(`data-resource="${harbor.resource}"`));
  }
});

test("shared harbor access divides anchor and rate between both owners without flags", () => {
  const game = initial(); const harbor = game.board.harbors.find((harbor) => harbor.resource === "any");
  const edge = game.board.edges[harbor.edge];
  Object.assign(game.board.vertices[edge.a], { owner: "a", building: "settlement" });
  Object.assign(game.board.vertices[edge.b], { owner: "b", building: "city" });
  const html = renderToStaticMarkup(createElement(CatanBoard, { game, mode: null, choices: [], selected: null, onSelect() {}, disabled: false }));
  const shared = harborMarkup(html, harbor.edge);
  assert.match(shared, /erschlossen von Anna, Ben/);
  assert.match(shared, /<stop offset="50%" stop-color="#eb7959"><\/stop><stop offset="50%" stop-color="#63a9e9">/);
  assert.match(shared, /stroke="url\(#[^)]+-anchor\)"/);
  assert.match(shared, /<text[^>]*fill="url\(#[^)]+-course\)"[^>]*>3:1<\/text>/);
  assert.doesNotMatch(html, /catan-harbor-flag/);
});
