import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test, { after } from "node:test";
import { build } from "esbuild";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { acceptMap } from "./catan-helpers.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-sounds-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export * from "./lib/catan"; export * from "./lib/catan-sounds"; export * from "./lib/catan-sound-events"; export * from "./components/catan/sound";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { createCatanGame, applyCatanAction, catanView, legalRoads, legalSettlements, RESOURCES, CATAN_SOUND_FILES, CatanSoundPlayer, catanSoundEvents, useCatanSounds } = createRequire(import.meta.url)(output);
const seats = [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }, { id: "c", name: "Clara" }];
const view = (game, actor = "a") => catanView(game, actor);
const apply = (game, action, actor = "a", random = () => 2) => applyCatanAction(game, actor, action, random);
const sounds = (before, after, actor = "a") => catanSoundEvents(view(before, actor), view(after, actor));
function game(target = 15) {
  const result = acceptMap(createCatanGame(seats, target, () => 0), applyCatanAction);
  result.phase = "main"; result.turn = 2; return result;
}
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
  for (const resource of RESOURCES) {
    const hex = result.board.hexes.find((hex) => hex.resource === resource);
    hex.number = 6;
    Object.assign(result.board.vertices[hex.vertices[0]], { owner: "a", building: "settlement" });
  }
  return result;
}

test("confirmed harvest plays every received resource once and respects private receipts", () => {
  const before = harvestGame(); const after = apply(before, { type: "roll" });
  const effects = sounds(before, after);
  assert.equal(effects[0], "dice_roll");
  for (const resource of RESOURCES) assert.equal(effects.filter((effect) => effect === `resource_${resource}_gain`).length, 1);
  assert.deepEqual(sounds(before, after, "b"), ["dice_roll"]);
  const unfiltered = { ...view(after, "b"), notifications: after.notifications };
  assert.deepEqual(catanSoundEvents(view(before, "b"), unfiltered), ["dice_roll"]);
});

test("reloads, handoffs, repeated polls and older sequences replay nothing", () => {
  const before = harvestGame(); const current = view(apply(before, { type: "roll" }));
  assert.deepEqual(catanSoundEvents(null, current), []);
  assert.deepEqual(catanSoundEvents(current, structuredClone(current)), []);
  assert.deepEqual(catanSoundEvents(view(before, "b"), current), []);
  assert.deepEqual(catanSoundEvents({ ...view(before), id: "other" }, current), []);
  assert.deepEqual(catanSoundEvents({ ...current, sequence: current.sequence + 1 }, current), []);
  const unchangedDice = { ...current, sequence: current.sequence + 1, notifications: [] };
  assert.deepEqual(catanSoundEvents(current, unchangedDice), []);
  assert.deepEqual(catanSoundEvents(current, { ...unchangedDice, turn: current.turn + 1 }), ["dice_roll", "turn_start"]);
});

test("all building kinds use confirmed public board changes, including remote construction", () => {
  const settlement = game(); settlement.phase = "setup_settlement";
  const builtSettlement = apply(settlement, { type: "build", building: "settlement", position: legalSettlements(settlement, "a", true)[0] });
  assert.ok(sounds(settlement, builtSettlement).includes("build_settlement"));
  assert.ok(sounds(settlement, builtSettlement, "b").includes("build_settlement"));
  const builtRoad = apply(builtSettlement, { type: "build", building: "road", position: legalRoads(builtSettlement, "a", builtSettlement.setupVertex)[0] });
  assert.ok(sounds(builtSettlement, builtRoad).includes("build_road"));
  const city = game(); fund(city, "a", { ore: 3, grain: 2 });
  Object.assign(city.board.vertices[0], { owner: "a", building: "settlement" });
  assert.deepEqual(sounds(city, apply(city, { type: "build", building: "city", position: 0 })), ["build_city"]);
});

test("development purchase and public play keep distinct sounds and seven belongs to a roll", () => {
  const before = game(); fund(before, "a", { ore: 1, grain: 1, wool: 1 });
  assert.deepEqual(sounds(before, apply(before, { type: "buy_development" })), ["development_draw"]);
  const knight = game(); knight.players[0].knights = 2;
  knight.players[0].development.push({ id: "knight", type: "knight", boughtOnTurn: 1 });
  const played = apply(knight, { type: "play_development", cardId: "knight" });
  assert.deepEqual(sounds(knight, played), ["development_play", "special_award"]);
  assert.deepEqual(sounds(knight, played, "b"), ["development_play", "special_award"]);
  const roll = game(); roll.phase = "roll"; let index = 0;
  const seven = apply(roll, { type: "roll" }, "a", () => [2, 3][index++]);
  assert.deepEqual(sounds(roll, seven), ["dice_roll", "robber_seven"]);
});

test("incoming offers notify the recipient; completed trades use private confirmed receipts", () => {
  const before = game(); fund(before, "a", { grain: 1 }); fund(before, "b", { wood: 1 });
  const offered = apply(before, { type: "offer_trade", toId: "a", give: { wood: 1 }, receive: { grain: 1 } }, "b");
  assert.deepEqual(sounds(before, offered), ["trade_offer_received"]);
  assert.deepEqual(sounds(before, offered, "b"), []);
  const traded = apply(offered, { type: "accept_trade", offerId: offered.trade.id });
  assert.deepEqual(sounds(offered, traded), ["trade_complete", "resource_wood_gain"]);
  assert.deepEqual(sounds(offered, traded, "b"), ["trade_complete", "resource_grain_gain"]);
  assert.deepEqual(sounds(offered, traded, "c"), []);
  const bank = game(); fund(bank, "a", { wood: 4, grain: 1, wool: 1 });
  const exchanged = apply(bank, { type: "bank_trade", give: "wood", receive: "ore" });
  const bought = apply(exchanged, { type: "buy_development" });
  assert.equal(bought.players[0].resources.ore, bank.players[0].resources.ore);
  assert.ok(sounds(bank, bought).includes("resource_ore_gain"), "A later payment must not hide the earlier confirmed gain.");
  assert.ok(sounds(bank, bought).includes("trade_complete"));
});

test("robber movement and theft notify the participants without leaking stolen resource sounds", () => {
  const before = game(); before.phase = "robber";
  const hex = before.board.hexes.find((hex) => hex.id !== before.robberHex && hex.resource !== "desert");
  Object.assign(before.board.vertices[hex.vertices[0]], { owner: "b", building: "settlement" });
  fund(before, "b", { wool: 1 });
  const moved = apply(before, { type: "move_robber", hex: hex.id });
  assert.deepEqual(sounds(before, moved), ["robber_move"]);
  const stolen = apply(moved, { type: "steal", victimId: "b" }, "a", () => 0);
  assert.deepEqual(sounds(moved, stolen), ["resource_steal", "resource_wool_gain"]);
  assert.deepEqual(sounds(moved, stolen, "b"), ["resource_steal"]);
  assert.deepEqual(sounds(moved, stolen, "c"), []);
});

test("turn start targets the active player and victory plays once for every viewer", () => {
  const before = game(); const next = apply(before, { type: "end_turn" });
  assert.deepEqual(sounds(before, next), []);
  assert.deepEqual(sounds(before, next, "b"), ["turn_start"]);
  const winning = game(8); fund(winning, "a", { ore: 3, grain: 2 });
  for (let i = 0; i < 4; i++) Object.assign(winning.board.vertices[i], { owner: "a", building: i ? "city" : "settlement" });
  const won = apply(winning, { type: "build", building: "city", position: 0 });
  assert.equal(won.winner, "a");
  for (const actor of ["a", "b", "c"]) assert.deepEqual(sounds(winning, won, actor), ["build_city", "game_won"]);
});

/** Audio/network boundary fake: production decoding, ordering and cancellation stay real. */
function audioEnvironment(t, { hold = [], holdResume = false } = {}) {
  const sources = []; const contexts = []; const requests = []; const waiting = new Map(); const resumes = [];
  const failed = new Set();
  const response = (url) => ({ ok: !failed.has(url), arrayBuffer: async () => new TextEncoder().encode(url).buffer });
  class Context {
    state = "suspended"; currentTime = 10; destination = {}; closeCalls = 0; decodes = [];
    constructor() { contexts.push(this); }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createBufferSource() {
      const source = { starts: [], stops: [], disconnected: false, onended: null, buffer: null,
        connect() {}, disconnect() { this.disconnected = true; }, start(at) { this.starts.push(at); }, stop() { this.stops.push(true); } };
      sources.push(source); return source;
    }
    async decodeAudioData(data) { const id = new TextDecoder().decode(data); this.decodes.push(id); return { id, duration: 1 }; }
    async resume() { if (holdResume) await new Promise((resolve) => resumes.push(resolve)); this.state = "running"; }
    async close() { this.closeCalls++; this.state = "closed"; }
  }
  const globals = {
    AudioContext: Context,
    fetch(url, options) {
      requests.push({ url, signal: options.signal });
      if (hold.some((filename) => url.endsWith(filename))) return new Promise((resolve) => waiting.set(url, () => resolve(response(url))));
      return Promise.resolve(response(url));
    },
  };
  const original = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return { sources, contexts, requests, failed, waiting,
    release(filename) { for (const [url, finish] of waiting) if (url.endsWith(filename)) { waiting.delete(url); finish(); } },
    resume() { resumes.splice(0).forEach((finish) => finish()); },
  };
}

const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

test("the player caches local samples and queues gains while UI cues remain immediate", async (t) => {
  const env = audioEnvironment(t); const player = new CatanSoundPlayer(); t.after(() => player.close());
  await player.resume();
  await player.play(["resource_wood_gain", "resource_wool_gain"]);
  await player.play(["resource_ore_gain"]);
  assert.equal(env.sources.length, 3);
  assert.ok(env.sources[1].starts[0] >= env.sources[0].starts[0] + 1);
  assert.ok(env.sources[2].starts[0] >= env.sources[1].starts[0] + 1);
  await player.play(["ui_select"], "ui");
  assert.ok(env.sources.at(-1).starts[0] < env.sources[2].starts[0]);
  await player.play(["resource_wood_gain"], "preview");
  const preview = env.sources.at(-1);
  await player.play(["resource_grain_gain"], "preview");
  assert.equal(preview.stops.length, 1); assert.equal(preview.disconnected, true);
  assert.equal(env.sources[0].stops.length, 0, "A field preview must not cut off earned resources.");
  assert.equal(env.requests.length, Object.keys(CATAN_SOUND_FILES).length);
  assert.equal(new Set(env.contexts[0].decodes).size, env.contexts[0].decodes.length);
  player.stop();
  assert.ok(env.sources.every((source) => source.disconnected && source.stops.length === 1));
});

test("muting cancels late decoding and scheduled sources, but later playback still works", async (t) => {
  const env = audioEnvironment(t, { hold: ["resource-wood-gain.mp3"] });
  const player = new CatanSoundPlayer(); t.after(() => player.close()); await player.resume();
  const old = player.play(["resource_wood_gain"]); player.stop();
  await player.play(["ui_select"], "ui");
  env.release("resource-wood-gain.mp3"); await old;
  assert.equal(env.sources.length, 1);
  assert.match(env.sources[0].buffer.id, /ui-select/);
  await player.play(["resource_wood_gain"]);
  assert.equal(env.sources.length, 2);
  player.close(); player.close();
  assert.equal(env.contexts[0].closeCalls, 1);
  assert.ok(env.requests.every((request) => request.signal.aborted));
});

test("unavailable clips are skipped and can be retried without breaking other sounds", async (t) => {
  const env = audioEnvironment(t); const missing = "/audio/catan/v1/resource-ore-gain.mp3";
  env.failed.add(missing);
  const player = new CatanSoundPlayer(); t.after(() => player.close()); await player.resume(); await flush();
  await player.play(["resource_ore_gain", "resource_wood_gain"]);
  assert.equal(env.sources.length, 1); assert.match(env.sources[0].buffer.id, /resource-wood/);
  env.failed.delete(missing); await player.play(["resource_ore_gain"]);
  assert.equal(env.sources.length, 2); assert.match(env.sources[1].buffer.id, /resource-ore/);
});

/** Minimal DOM host for the real React hook; the harness itself renders no UI. */
class HostNode {
  constructor(document, type = 1, name = "DIV") {
    Object.assign(this, { ownerDocument: document, nodeType: type, nodeName: name, tagName: name, namespaceURI: "http://www.w3.org/1999/xhtml", childNodes: [], parentNode: null, style: {}, listeners: new Map() });
    const values = new Set(); this.classList = { add: (name) => values.add(name), remove: (name) => values.delete(name), contains: (name) => values.has(name) };
  }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  appendChild(child) { this.childNodes.push(child); child.parentNode = this; return child; }
  removeChild(child) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; }
  set textContent(value) { if (value === "") this.childNodes = []; }
}

async function hookHarness(t, initial, options = {}) {
  const audio = audioEnvironment(t, options); const frames = new Map(); let nextFrame = 0; let current; let mounted = true;
  const document = new HostNode(null, 9, "#document"); document.ownerDocument = document; document.hidden = false;
  document.createElement = (name) => new HostNode(document, 1, name.toUpperCase());
  document.documentElement = document.createElement("html"); document.body = document.createElement("body"); document.activeElement = document.body;
  const window = { document, HTMLElement: HostNode, HTMLIFrameElement: class {} }; document.defaultView = window;
  const globals = { document, window, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const original = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const reactRoot = createRoot(document.createElement("div"));
  // eslint-disable-next-line react/prop-types -- Both props are supplied by this test harness.
  const Component = ({ game, baseline }) => { current = useCatanSounds(game, baseline); return null; };
  const render = async (game, baseline = 0) => { await act(async () => { reactRoot.render(createElement(Component, { game, baseline })); await flush(); }); };
  const unmount = async () => { if (mounted) { mounted = false; await act(() => reactRoot.unmount()); } };
  t.after(async () => {
    await unmount();
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  await render(initial);
  return { ...audio, document, frames, render, unmount,
    get current() { return current; },
    async toggle() { await act(async () => { await current.toggle(); await flush(); }); },
    async frame() { await act(async () => { const queued = [...frames.values()]; frames.clear(); queued.forEach((callback) => callback()); await flush(); }); },
    async hide() { await act(() => { document.hidden = true; document.listeners.get("visibilitychange").forEach((callback) => callback()); }); },
  };
}

test("the hook skips muted history and waits for the actual dice overlay before resource cues", async (t) => {
  const before = harvestGame(); const earned = apply(before, { type: "roll" });
  const env = await hookHarness(t, view(before));
  await env.render(view(earned)); await env.toggle();
  assert.equal(env.current.enabled, true);
  assert.equal(env.sources.length, 1); assert.match(env.sources[0].buffer.id, /ui-select/);
  const next = { ...view(earned), sequence: earned.sequence + 1, turn: earned.turn + 1 };
  next.me = { ...next.me, resources: { ...next.me.resources, wood: next.me.resources.wood + 1 } };
  env.document.documentElement.classList.add("catan-dice-rolling");
  await env.render(next);
  assert.match(env.sources.at(-1).buffer.id, /dice-roll/);
  assert.equal(env.frames.size, 1);
  const count = env.sources.length; await env.frame(); assert.equal(env.sources.length, count);
  env.document.documentElement.classList.remove("catan-dice-rolling"); await env.frame();
  assert.ok(env.sources.slice(count).some((source) => source.buffer.id.includes("resource-wood")));
  assert.equal(env.frames.size, 0);
});

test("hidden documents and local handoffs stop both pending and active audio", async (t) => {
  const before = harvestGame(); const earned = apply(before, { type: "roll" });
  const env = await hookHarness(t, view(before)); await env.toggle();
  env.document.documentElement.classList.add("catan-dice-rolling"); await env.render(view(earned));
  assert.equal(env.frames.size, 1); await env.hide();
  assert.equal(env.frames.size, 0); assert.ok(env.sources.every((source) => source.disconnected));
  env.document.hidden = false; env.document.documentElement.classList.remove("catan-dice-rolling");
  await act(async () => { env.current.preview("wood"); await flush(); });
  assert.equal(env.sources.at(-1).disconnected, false);
  const count = env.sources.length; await env.render(view(earned, "b")); await env.frame();
  assert.equal(env.sources.length, count);
  assert.ok(env.sources.every((source) => source.disconnected), "Passing the device cancels the previous player's field preview.");
  await env.unmount(); assert.equal(env.contexts[0].closeCalls, 1);
  assert.equal(env.document.listeners.get("visibilitychange").size, 0);
});

test("switching off during audio unlock cannot enable sound again when resume finishes", async (t) => {
  const env = await hookHarness(t, view(game()), { holdResume: true });
  let unlocking;
  await act(() => { unlocking = env.current.toggle(); });
  await env.toggle(); assert.equal(env.current.enabled, false);
  await act(async () => { env.resume(); await unlocking; await flush(); });
  assert.equal(env.current.enabled, false); assert.equal(env.sources.length, 0);
});

test("reconnection baselines and delayed older snapshots never replay already consumed gains", async (t) => {
  const before = harvestGame(); const earned = apply(before, { type: "roll" });
  const env = await hookHarness(t, view(before)); await env.toggle();
  const count = env.sources.length;
  await env.render(view(earned), 1); await env.render(view(before), 1); await env.render(view(earned), 1);
  assert.equal(env.sources.length, count);
  const next = view(earned); next.sequence++;
  next.me.resources.grain++;
  await env.render(next, 1);
  assert.equal(env.sources.length, count + 1);
  assert.match(env.sources.at(-1).buffer.id, /resource-grain/);
});

test("the real service worker precaches and returns every mapped sound without a network", async () => {
  const origin = "https://gameson.test"; const handlers = new Map(); const entries = new Map(); let online = true; let fetches = 0;
  const urls = Object.values(CATAN_SOUND_FILES).map((file) => `/audio/catan/v1/${file}`);
  const assets = new Map(await Promise.all(urls.map(async (url) => [url, await readFile(resolve(root, "public" + url))])));
  const key = (request) => new URL(typeof request === "string" ? request : request.url, origin).pathname;
  const fetch = async (request) => {
    assert.equal(online, true, "Offline audio must use the installation cache."); fetches++;
    return new Response(assets.get(key(request)) ?? "shell", { headers: { "content-type": "audio/mpeg" } });
  };
  const cache = { async addAll(urls) { for (const url of urls) entries.set(key(url), await fetch(url)); }, async put(request, response) { entries.set(key(request), response.clone()); } };
  const caches = { async open() { return cache; }, async match(request) { return entries.get(key(request))?.clone(); } };
  const worker = await readFile(resolve(root, "public/sw.js"), "utf8");
  runInNewContext(worker, { URL, caches, fetch, self: { location: { origin }, addEventListener: (name, callback) => handlers.set(name, callback), skipWaiting() {} } });
  let install; handlers.get("install")({ waitUntil(promise) { install = promise; } }); await install;
  online = false; const before = fetches;
  for (const url of urls) {
    let result; handlers.get("fetch")({ request: new Request(origin + url), respondWith(promise) { result = promise; } });
    const response = await result;
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), assets.get(url));
  }
  assert.equal(fetches, before); assert.equal(urls.length, 22);
});
