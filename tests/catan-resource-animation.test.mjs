import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-resource-animation-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export { playResourceGain } from "./components/catan/resource-hand"; export { RESOURCES, emptyResources, resourceCount } from "./lib/catan";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { playResourceGain, RESOURCES, emptyResources, resourceCount } = createRequire(import.meta.url)(output);

class Classes {
  values = new Set();
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
}
class Listeners {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type) { this.listeners.get(type)?.forEach((callback) => callback()); }
  get size() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
}
class Node {
  classList = new Classes();
  children = [];
  parent = null;
  queries = new Map();
  ancestors = new Map();
  attributes = new Map();
  style = {};
  hidden = false;
  textContent = "";
  className = "";
  rect = { left: 0, top: 0, width: 17, height: 17 };
  animations = [];
  querySelector(selector) { return this.queries.get(selector) ?? null; }
  closest(selector) { return this.ancestors.get(selector) ?? null; }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  cloneNode() { const clone = new Node(); clone.attributes = new Map(this.attributes); clone.rect = { ...this.rect }; return clone; }
  animate() { const animation = { cancelled: false, cancel() { this.cancelled = true; } }; this.animations.push(animation); return animation; }
}

/** Small DOM boundary fake; the bundled production controller owns all scheduling. */
function environment(t, { reducedMotion = false, clipped = false } = {}) {
  let now = 0; let nextId = 0;
  const frames = new Map(); const timers = new Map();
  const motion = Object.assign(new Listeners(), { matches: reducedMotion });
  const document = Object.assign(new Listeners(), { hidden: false, documentElement: new Node(), body: new Node(), createElement: () => new Node() });
  const raf = (callback) => { const id = ++nextId; frames.set(id, callback); return id; };
  const setTimer = (callback, delay = 0) => { const id = ++nextId; timers.set(id, { callback, due: now + delay }); return id; };
  const clearTimer = (id) => timers.delete(id);
  const globals = { document, window: { innerWidth: 600, innerHeight: 800, matchMedia: () => motion, setTimeout: setTimer, clearTimeout: clearTimer }, requestAnimationFrame: raf, cancelAnimationFrame: (id) => frames.delete(id), setTimeout: setTimer, clearTimeout: clearTimer };
  const original = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });

  const hand = new Node(); const total = new Node(); const announcement = new Node();
  const cells = Object.fromEntries(RESOURCES.map((resource, index) => {
    const cell = new Node(); const icon = new Node();
    icon.rect = { left: 45 + index * 55, top: 20, width: 17, height: 17 };
    icon.attributes.set("data-resource", resource);
    cell.queries.set("svg", icon); return [resource, cell];
  }));
  for (const [resource, cell] of [...Object.entries(cells), ["total", total]]) {
    cell.queries.set("b", new Node());
    const badge = new Node(); badge.hidden = true; cell.queries.set(".catan-hand-gain", badge);
    if (resource !== "total") hand.queries.set(`[data-catan-resource="${resource}"]`, cell);
  }
  hand.queries.set(".catan-hand-total", total); hand.queries.set("[data-catan-gain-announcement]", announcement);
  const play = new Node(); const board = new Node(); const viewport = new Node();
  viewport.rect = { left: 0, top: 80, width: 600, height: 500 };
  board.ancestors.set(".catan-board-viewport", viewport);
  board.getScreenCTM = () => ({ x: clipped ? -1000 : 300, y: 300 });
  board.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform(matrix) { return { x: this.x + matrix.x, y: this.y + matrix.y }; } });
  play.queries.set(".catan-tab-insel[data-state=active] .catan-board", board); hand.ancestors.set(".catan-play", play);

  function advanceTo(time) {
    assert.ok(time >= now, "Fake clock must move forwards.");
    let due;
    while ((due = [...timers.entries()].filter(([, timer]) => timer.due <= time).sort((a, b) => a[1].due - b[1].due)[0])) {
      now = due[1].due; timers.delete(due[0]); due[1].callback();
    }
    now = time;
  }
  return {
    hand, cells, total, announcement, document, motion, frames, timers,
    advanceTo,
    frameAt(time) { advanceTo(time); const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(time)); },
    count(resource) { return Number((resource === "total" ? total : cells[resource]).querySelector("b").textContent); },
    gain(resource) { const badge = (resource === "total" ? total : cells[resource]).querySelector(".catan-hand-gain"); return badge.hidden ? null : badge.textContent; },
    flights() { return document.body.children.flatMap((overlay) => overlay.children).map((node) => node.children[0].attributes.get("data-resource")); },
  };
}

function start(env, { before = emptyResources(5), gains = { wood: 3 }, losses = {}, origins = {}, island = false } = {}) {
  const received = { ...emptyResources(), ...gains };
  const resources = Object.fromEntries(RESOURCES.map((resource) => [resource, before[resource] + received[resource] - (losses[resource] ?? 0)]));
  const steps = RESOURCES.flatMap((resource) => Array.from({ length: received[resource] }, (_, index) => ({ id: `${resource}:${index}`, resource, hexId: origins[resource]?.[index] ?? null })));
  const previous = { me: { id: "a", resources: before } };
  const current = { me: { id: "a", resources }, board: { hexes: [{ id: 0, x: -80, y: -30 }, { id: 1, x: 80, y: 30 }] } };
  const playback = playResourceGain(env.hand, previous, current, { id: "qa", gains: received, steps }, island);
  return { playback, resources };
}

test("header-only gains increment separately every 120ms with cumulative +1, +2, +3", (t) => {
  const env = environment(t); start(env);
  env.frameAt(0); env.frameAt(119);
  assert.equal(env.count("wood"), 5); assert.equal(env.gain("wood"), null);
  for (let unit = 1; unit <= 3; unit++) {
    env.frameAt(unit * 120);
    assert.equal(env.count("wood"), 5 + unit); assert.equal(env.gain("wood"), `+${unit}`);
    assert.equal(env.count("total"), 25 + unit); assert.equal(env.gain("total"), `+${unit}`);
    if (unit < 3) { env.frameAt((unit + 1) * 120 - 1); assert.equal(env.count("wood"), 5 + unit); }
  }
  assert.deepEqual(env.flights(), []); assert.equal(env.frames.size, 0);
  assert.match(env.announcement.textContent, /Erhalten: 3 Holz/);
});

test("receipts wait for the actual dice lifecycle before launching or counting", (t) => {
  const env = environment(t);
  env.document.documentElement.classList.add("catan-dice-rolling");
  start(env, { gains: { wood: 1 }, origins: { wood: [0] }, island: true });
  env.frameAt(0); env.frameAt(2200);
  assert.equal(env.count("wood"), 5); assert.deepEqual(env.flights(), []);
  env.document.documentElement.classList.remove("catan-dice-rolling");
  env.frameAt(2210); assert.deepEqual(env.flights(), ["wood"]);
  env.frameAt(2909); assert.equal(env.count("wood"), 5);
  env.frameAt(2910); assert.equal(env.count("wood"), 6); assert.equal(env.gain("wood"), "+1");
});

test("reduced motion immediately displays final counts and +N without flight or pop", (t) => {
  const env = environment(t, { reducedMotion: true });
  const { resources } = start(env, { origins: { wood: [0, 0, 0] }, island: true });
  for (const resource of RESOURCES) assert.equal(env.count(resource), resources[resource]);
  assert.equal(env.count("total"), resourceCount(resources));
  assert.equal(env.gain("wood"), "+3"); assert.equal(env.gain("total"), "+3");
  assert.deepEqual(env.flights(), []); assert.equal(env.frames.size, 0);
  assert.equal(env.cells.wood.querySelector("b").animations.length, 0);
});

test("gain badges hold four seconds after the last arrival, then fade and clean up", (t) => {
  const env = environment(t); start(env);
  env.frameAt(0); env.frameAt(120); env.frameAt(240); env.frameAt(360);
  env.advanceTo(4359); assert.equal(env.gain("wood"), "+3"); assert.equal(env.hand.classList.contains("is-fading"), false);
  env.advanceTo(4360); assert.equal(env.hand.classList.contains("is-fading"), true); assert.equal(env.gain("wood"), "+3");
  env.advanceTo(4559); assert.equal(env.gain("wood"), "+3");
  env.advanceTo(4560);
  assert.equal(env.gain("wood"), null); assert.equal(env.gain("total"), null);
  assert.equal(env.count("wood"), 8); assert.equal(env.count("total"), 28);
  assert.equal(env.hand.classList.contains("is-fading"), false);
  assert.equal(env.document.size, 0); assert.equal(env.motion.size, 0); assert.equal(env.timers.size, 0);
});

test("flights use 700ms arrivals, 140ms spacing within a field and overlapping fields", (t) => {
  const env = environment(t); start(env, { gains: { wood: 2, grain: 1 }, origins: { wood: [0, 0], grain: [1] }, island: true });
  env.frameAt(0); assert.deepEqual(env.flights(), ["wood"]);
  env.frameAt(59); assert.deepEqual(env.flights(), ["wood"]);
  env.frameAt(60); assert.deepEqual(env.flights(), ["wood", "grain"]);
  env.frameAt(139); assert.equal(env.flights().length, 2);
  env.frameAt(140); assert.deepEqual(env.flights(), ["wood", "grain", "wood"]);
  env.frameAt(699); assert.equal(env.count("wood"), 5); assert.equal(env.count("grain"), 5);
  env.frameAt(700); assert.equal(env.count("wood"), 6); assert.equal(env.gain("wood"), "+1");
  env.frameAt(760); assert.equal(env.count("grain"), 6); assert.equal(env.gain("total"), "+2");
  env.frameAt(840); assert.equal(env.count("wood"), 7); assert.equal(env.gain("wood"), "+2");
  assert.equal(env.gain("total"), "+3"); assert.deepEqual(env.flights(), []);
});

test("hiding flights on a menu change removes every object while counters finish", (t) => {
  const env = environment(t); const { playback } = start(env, { gains: { wood: 2 }, origins: { wood: [0, 0] }, island: true });
  env.frameAt(0); env.frameAt(140); assert.equal(env.flights().length, 2);
  playback.hideFlights(); assert.deepEqual(env.flights(), []); assert.equal(env.count("wood"), 5);
  env.frameAt(700); assert.equal(env.count("wood"), 6); assert.deepEqual(env.flights(), []);
  env.frameAt(840); assert.equal(env.count("wood"), 7); assert.equal(env.gain("wood"), "+2"); assert.equal(env.gain("total"), "+2");
});

test("dispose cancels pending frames, settles counts and removes flights and listeners", (t) => {
  const env = environment(t); const { playback } = start(env, { gains: { wood: 2 }, origins: { wood: [0, 0] }, island: true });
  env.frameAt(0); assert.equal(env.flights().length, 1); assert.equal(env.frames.size, 1);
  playback.dispose(); playback.dispose();
  assert.equal(env.count("wood"), 7); assert.equal(env.count("total"), 27);
  assert.equal(env.frames.size, 0); assert.equal(env.timers.size, 0); assert.deepEqual(env.flights(), []);
  assert.equal(env.gain("wood"), null); assert.equal(env.document.size, 0); assert.equal(env.motion.size, 0);
  env.frameAt(10000); assert.equal(env.count("wood"), 7); assert.equal(env.gain("wood"), null);
});

test("dispose also cancels a pending fade timer and every outstanding counter pop", (t) => {
  const env = environment(t); const { playback } = start(env, { gains: { wood: 1 } });
  env.frameAt(0); env.frameAt(120); env.advanceTo(4120);
  assert.equal(env.hand.classList.contains("is-fading"), true); assert.equal(env.timers.size, 1);
  playback.dispose();
  assert.equal(env.timers.size, 0); assert.equal(env.hand.classList.contains("is-fading"), false);
  for (const cell of [env.cells.wood, env.total]) assert.ok(cell.querySelector("b").animations.every((animation) => animation.cancelled));
  assert.equal(env.gain("wood"), null); assert.equal(env.announcement.textContent, "");
});

test("bank trade shows its receipt while total reflects payment and never shows a false gain", (t) => {
  const env = environment(t); start(env, { gains: { ore: 1 }, losses: { wood: 4 } });
  assert.equal(env.count("wood"), 1); assert.equal(env.count("total"), 21);
  env.frameAt(0); env.frameAt(120);
  assert.equal(env.count("ore"), 6); assert.equal(env.gain("ore"), "+1");
  assert.equal(env.count("total"), 22); assert.equal(env.gain("total"), null);
  assert.equal(env.total.classList.contains("is-gaining"), false);
  assert.doesNotMatch(env.announcement.textContent, /Insgesamt \+/);
});

test("clipped landscape fields use separate header increments without flights", (t) => {
  const env = environment(t, { clipped: true }); start(env, { gains: { wood: 2 }, origins: { wood: [0, 0] }, island: true });
  env.frameAt(0); env.frameAt(120);
  assert.equal(env.count("wood"), 6); assert.equal(env.gain("wood"), "+1"); assert.deepEqual(env.flights(), []);
  env.frameAt(240); assert.equal(env.count("wood"), 7); assert.equal(env.gain("wood"), "+2");
});
