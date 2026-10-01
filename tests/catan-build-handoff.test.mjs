import { acceptMap } from "./catan-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-build-handoff-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export * from "./lib/catan-build-handoff"; export * from "./lib/catan";', resolveDir: root, loader: "ts" },
  absWorkingDir: root, bundle: true, platform: "node", format: "cjs", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { CatanBuildHandoff, buildHandoffViewer, createCatanGame, applyCatanAction, catanView, localActorId, legalSettlements, legalRoads } = createRequire(import.meta.url)(output);

function boundary({ visible = true, reduced = false } = {}) {
  let now = 0; let id = 0;
  const frames = new Map(); const timers = new Map(); const interruptions = new Set();
  const environment = {
    canAnimate: () => visible && !reduced,
    afterPaint: (callback) => { const key = ++id; frames.set(key, callback); return () => frames.delete(key); },
    delay: (callback, duration) => { const key = ++id; timers.set(key, { callback, at: now + duration }); return () => timers.delete(key); },
    onInterruption: (callback) => { interruptions.add(callback); return () => interruptions.delete(callback); },
  };
  return {
    environment,
    paint() { const ready = [...frames.values()]; frames.clear(); ready.forEach((callback) => callback()); },
    advance(duration) { now += duration; for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.callback(); } },
    interrupt() { [...interruptions].forEach((callback) => callback()); },
    pending: () => frames.size + timers.size + interruptions.size,
    callbacks: () => [...frames.values(), ...[...timers.values()].map((timer) => timer.callback)],
  };
}
const transition = { gameId: "game", sequence: 14, viewerId: "outgoing" };

test("Weitergabe wartet 800 ms ab Darstellung und löst die Sperre genau einmal", () => {
  const env = boundary(); let finishes = 0; let notifications = 0;
  const controller = new CatanBuildHandoff(() => finishes++);
  const unsubscribe = controller.subscribe(() => notifications++);
  assert.equal(controller.start(transition, env.environment), true);
  env.advance(1000);
  assert.equal(controller.getSnapshot(), transition, "Zeit vor dem ersten Bild verkürzt die Bauanimation nicht.");
  assert.equal(controller.start({ ...transition, sequence: 15 }, env.environment), false, "Keine zweite Aktion während der Weitergabe.");
  env.paint(); env.advance(799);
  assert.equal(controller.getSnapshot(), transition);
  env.advance(1);
  assert.equal(controller.getSnapshot(), null);
  assert.equal(finishes, 1); assert.equal(notifications, 2); assert.equal(env.pending(), 0);
  controller.finish(); assert.equal(finishes, 1);
  unsubscribe();
});

test("Verbergen, reduzierte Bewegung und Abbruch bereinigen den Übergang sofort", () => {
  for (const afterPaint of [false, true]) {
    const env = boundary(); let finishes = 0;
    const controller = new CatanBuildHandoff(() => finishes++);
    controller.start(transition, env.environment);
    if (afterPaint) env.paint();
    env.interrupt();
    assert.equal(controller.getSnapshot(), null); assert.equal(finishes, 1); assert.equal(env.pending(), 0);
    env.paint(); env.advance(10000); assert.equal(finishes, 1);
  }
  for (const options of [{ visible: false }, { reduced: true }]) {
    const env = boundary(options); const controller = new CatanBuildHandoff(() => assert.fail("Kein Übergang gestartet"));
    assert.equal(controller.start(transition, env.environment), false);
    assert.equal(controller.getSnapshot(), null); assert.equal(env.pending(), 0);
  }
});

test("Verspätete Callback-Aufrufe verändern keinen neuen Übergang", () => {
  const env = boundary(); let finishes = 0;
  const controller = new CatanBuildHandoff(() => finishes++);
  controller.start(transition, env.environment); env.paint();
  const stale = env.callbacks(); controller.finish();
  const next = { ...transition, gameId: "rematch", sequence: 3 };
  controller.start(next, env.environment);
  stale.forEach((callback) => callback());
  assert.equal(controller.getSnapshot(), next); assert.equal(finishes, 1);
  controller.finish(); assert.equal(env.pending(), 0);
});

test("Bestätigte Aufbaustraße bleibt im bisherigen privaten Blick, bis weitergegeben wird", () => {
  let game = acceptedCatanGame(["Anna", "Ben", "Clara"].map((name, i) => ({ id: `p${i}`, name })), 12, () => 0);
  const outgoing = localActorId(game);
  game = applyCatanAction(game, outgoing, { type: "build", building: "settlement", position: legalSettlements(game, outgoing, true)[0] }, () => 0);
  const position = legalRoads(game, outgoing, game.setupVertex)[0];
  const next = applyCatanAction(game, outgoing, { type: "build", building: "road", position }, () => 0);
  const incoming = localActorId(next);
  assert.notEqual(outgoing, incoming);
  next.players.find((player) => player.id === incoming).resources.ore = 5;
  const hold = { gameId: next.id, sequence: next.sequence, viewerId: outgoing };
  const env = boundary(); const controller = new CatanBuildHandoff(() => {});
  controller.start(hold, env.environment);
  const view = catanView(next, buildHandoffViewer(next, controller.getSnapshot()));
  assert.equal(view.board.edges[position].owner, outgoing, "Bestätigter Bau ist sofort im dargestellten Spielstand.");
  assert.equal(view.me.id, outgoing); assert.equal(view.me.resources.ore, 0);
  assert.equal(view.players.find((player) => player.id === incoming).resources, undefined, "Nächste Hand bleibt privat.");
  assert.equal(JSON.parse(JSON.stringify(next)).board.edges[position].owner, outgoing, "Gespeicherter Zustand ist bereits fortgeschritten.");
  controller.finish();
  assert.equal(buildHandoffViewer(next, controller.getSnapshot()), incoming);
  assert.equal(buildHandoffViewer(next, { ...hold, gameId: "different" }), incoming);
  assert.equal(buildHandoffViewer(next, { ...hold, sequence: hold.sequence - 1 }), incoming);
});

function acceptedCatanGame(...args) { return acceptMap(createCatanGame(...args), applyCatanAction); }
