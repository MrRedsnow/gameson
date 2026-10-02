import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-ambient-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export * from "./lib/catan-ambient"; export * from "./lib/catan-camera"; export { createBoard } from "./lib/catan"; export { CatanAmbientIsland } from "./components/catan/ambient-island";', resolveDir: root, loader: "ts" },
  absWorkingDir: root, bundle: true, platform: "node", format: "cjs", outfile: output, logLevel: "silent", external: ["react", "react/jsx-runtime"],
});
after(() => rm(output, { force: true }));
const require = createRequire(import.meta.url);
const {
  ambientBounds, ambientRandom, ambientSeaPoint, ambientPathPoint, ambientRoadRoute, ambientSheep, ambientSceneValid, harborAmbientPoint, fitCamera, cameraMetrics,
  validDolphinPath, createAmbientScene, AmbientSchedule, AMBIENT_INTERVALS, AMBIENT_DOLPHIN_CLEARANCE, preloadAmbientArtwork, CatanAmbientIsland, createBoard,
} = require(output);
const { createElement } = require("react"); const { renderToStaticMarkup } = require("react-dom/server");
const bounds = { x: -420, y: -370, width: 840, height: 740 };
const state = { available: true, blocked: false, mobile: false };
const makeGame = (seed = "island") => {
  const board = createBoard(() => 0);
  return { id: seed, board, robberHex: board.hexes.find((hex) => hex.resource === "desert").id };
};

test("ambient camera input is finite and deterministic decoration has its own random source", () => {
  assert.deepEqual(ambientBounds("-420,-370 840 740"), bounds);
  for (const invalid of ["", "1 2 0 4", "1 2 -3 4", "NaN 2 3 4", "1 2 3", "1 2 3 Infinity", "1 2 3 4 5"]) assert.equal(ambientBounds(invalid), null);
  const first = ambientRandom("a"); const second = ambientRandom("a"); const different = ambientRandom("b");
  const values = Array.from({ length: 12 }, first);
  assert.deepEqual(values, Array.from({ length: 12 }, second));
  assert.notDeepEqual(values, Array.from({ length: 12 }, different));
  assert.ok(values.every((value) => value >= 0 && value < 1));
});

test("dolphin routes keep the full swim and airborne arc in water outside harbors", () => {
  const game = makeGame(); let found = 0;
  for (let seed = 0; seed < 30; seed++) {
    const scene = createAmbientScene("dolphin", game, bounds, ambientRandom(`dolphin-${seed}`));
    if (!scene) continue;
    found++;
    assert.equal(validDolphinPath(game.board, bounds, scene.path), true);
    // Independently inspect a denser render timeline, including the visible jump.
    for (let i = 0; i <= 1000; i++) {
      const progress = i / 1000; const point = ambientPathPoint(scene.path, progress);
      assert.equal(ambientSeaPoint(game.board, bounds, point, AMBIENT_DOLPHIN_CLEARANCE), true);
      assert.equal(ambientSeaPoint(game.board, bounds, { ...point, y: point.y - Math.sin(progress * Math.PI) * 10 }, AMBIENT_DOLPHIN_CLEARANCE), true);
    }
  }
  assert.ok(found >= 20, "A wide visible sea ring has reliable routes.");
  const center = game.board.hexes[0];
  assert.equal(ambientSeaPoint(game.board, bounds, center), false);
  assert.equal(validDolphinPath(game.board, bounds, [{ x: -100, y: -100 }, { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 100, y: 100 }]), false);
  assert.equal(createAmbientScene("dolphin", game, { x: -30, y: -30, width: 60, height: 60 }, ambientRandom("no-sea")), null, "A close inland view waits rather than cutting the coast.");
});

test("dolphins find safe water in the real fitted board bounds on mobile, desktop and fullscreen", (t) => {
  const game = makeGame();
  const extents = [...game.board.vertices, ...game.board.harbors.flatMap((harbor) => {
    const point = harborAmbientPoint(game.board, harbor.edge);
    return [{ x: point.x - 23, y: point.y - 20 }, { x: point.x + 23, y: point.y + 20 }];
  })];
  const left = Math.min(...extents.map((point) => point.x)) - 12; const top = Math.min(...extents.map((point) => point.y)) - 12;
  const boardBounds = { x: left, y: top, width: Math.max(...extents.map((point) => point.x)) - left + 12, height: Math.max(...extents.map((point) => point.y)) - top + 12 };
  for (const size of [{ width: 360, height: 300 }, { width: 1100, height: 650 }, { width: 360, height: 680 }, { width: 1440, height: 900 }, { width: 600, height: 600 }]) {
    const visible = ambientBounds(cameraMetrics(boardBounds, size, fitCamera(boardBounds)).viewBox);
    let found = 0;
    for (let seed = 0; seed < 30; seed++) {
      const scene = createAmbientScene("dolphin", game, visible, ambientRandom(`fit-${size.width}-${size.height}-${seed}`));
      if (scene) { found++; assert.equal(validDolphinPath(game.board, visible, scene.path), true); }
    }
    t.diagnostic(`${size.width}×${size.height}: ${found}/30 safe dolphin paths, viewBox ${JSON.stringify(visible)}`);
    assert.ok(found >= 20, `${size.width}×${size.height} fitted view leaves space for occasional dolphins (${found}/30).`);
  }
});

test("passengers only follow confirmed connected roads of one owner without crossing opponents", () => {
  const game = makeGame(); const first = game.board.edges.find((edge) => edge.hexes.length === 2);
  const junction = first.b;
  const second = game.board.edges.find((edge) => edge.id !== first.id && (edge.a === junction || edge.b === junction));
  first.owner = "a"; second.owner = "a";
  const snapshot = structuredClone(game);
  for (let seed = 0; seed < 20; seed++) {
    const route = ambientRoadRoute(game.board, bounds, ambientRandom(`walker-${seed}`));
    assert.ok(route);
    assert.ok(route.roadEdges.length <= 2);
    assert.ok(route.roadEdges.every((id) => game.board.edges[id].owner === "a"));
    if (route.roadEdges.length === 2) assert.ok(route.path.some((point) => point.x === game.board.vertices[junction].x && point.y === game.board.vertices[junction].y));
  }
  assert.deepEqual(game, snapshot, "No resource, ownership or board mutation.");
  game.board.vertices[junction].owner = "b"; game.board.vertices[junction].building = "settlement";
  for (let seed = 0; seed < 10; seed++) assert.equal(ambientRoadRoute(game.board, bounds, ambientRandom(`blocked-${seed}`)), null);
  first.owner = null; second.owner = null;
  assert.equal(ambientRoadRoute(game.board, bounds, ambientRandom("no-roads")), null);
});

test("grazing sheep and wind never begin on the robber's blocked field", () => {
  const game = makeGame(); const wool = game.board.hexes.find((hex) => hex.resource === "wool"); game.robberHex = wool.id;
  assert.equal(ambientSheep(game.board).filter((sheep) => sheep.hexId === wool.id).length, 4);
  for (let seed = 0; seed < 30; seed++) {
    const sheep = createAmbientScene("sheep", game, bounds, ambientRandom(`sheep-${seed}`));
    assert.notEqual(sheep?.hexId, wool.id);
    assert.deepEqual(sheep.path[0], sheep.path[sheep.path.length - 1], "Grazing settles at its resting sprite rather than jumping back.");
    const breeze = createAmbientScene("wind", game, bounds, ambientRandom(`wind-${seed}`));
    assert.ok(breeze.windFields.length >= 1 && breeze.windFields.length <= 2);
    assert.ok(breeze.windFields.every((id) => ["wood", "grain"].includes(game.board.hexes[id].resource)));
  }
});

test("running grazing and road scenes stop when a public board update invalidates their place", () => {
  const game = makeGame(); const sheep = { ...createAmbientScene("sheep", game, bounds, ambientRandom("moving")), kind: "sheep" };
  assert.equal(ambientSceneValid(sheep, game), true);
  game.robberHex = sheep.hexId; assert.equal(ambientSceneValid(sheep, game), false);
  game.robberHex = game.board.hexes.find((hex) => hex.resource === "desert").id;
  assert.equal(ambientSceneValid(sheep, game, false), false, "An unavailable clean pasture restores the painted sheep.");
  const edge = game.board.edges.find((item) => item.hexes.length === 2); edge.owner = "a";
  const passenger = { ...ambientRoadRoute(game.board, bounds, ambientRandom("passenger")), kind: "pedestrian" };
  assert.equal(ambientSceneValid(passenger, game), true);
  game.board.vertices[edge.a].owner = "b";
  assert.equal(ambientSceneValid(passenger, game), false);
  const queue = new AmbientSchedule(() => 0);
  queue.tick(0, state, () => null); queue.preview("sheep", 1, state, () => sheep);
  queue.prune((scene) => ambientSceneValid(scene, game, false));
  assert.deepEqual(queue.tick(2, state, () => null), []);
});

test("shared deadlines obey both scene budgets and a separate two-field breeze", () => {
  for (const mobile of [false, true]) {
    const queue = new AmbientSchedule(() => 0); let calls = 0;
    const create = () => { calls++; return { point: { x: 0, y: 0 } }; };
    queue.tick(0, { ...state, mobile }, create);
    for (let time = 1000; time <= 300_000; time += 1000) {
      const scenes = queue.tick(time, { ...state, mobile }, create);
      assert.ok(scenes.filter((scene) => scene.kind !== "wind").length <= (mobile ? 2 : 3));
      assert.ok(scenes.filter((scene) => scene.kind === "wind").length <= 1);
      assert.equal(new Set(scenes.map((scene) => scene.kind)).size, scenes.length);
    }
    assert.ok(calls > 20); queue.dispose();
  }
});

test("priority pauses preserve time, hidden/disabled/reduced suspension resets it without catch-up", () => {
  const queue = new AmbientSchedule(() => 0); let calls = 0;
  const create = () => { calls++; return { point: { x: 0, y: 0 } }; };
  queue.tick(0, state, create);
  queue.tick(45_000, { ...state, blocked: true }, create);
  assert.equal(calls, 0, "Dice, construction, robber, awards and camera priority cannot spawn scenery.");
  queue.tick(47_000, state, create); assert.ok(calls > 0);
  assert.deepEqual(queue.tick(48_000, { ...state, available: false }, create), []); assert.equal(queue.running, false);
  calls = 0;
  assert.deepEqual(queue.tick(1_000_000, state, create), []); assert.equal(calls, 0);
  assert.deepEqual(queue.tick(1_019_999, state, create), []);
  assert.equal(queue.tick(1_020_000, state, create)[0].kind, "smoke");
  queue.dispose(); calls = 0;
  assert.deepEqual(queue.tick(3_000_000, state, create), []); assert.equal(calls, 0); assert.equal(queue.running, false);
});

test("fixture previews honor lifecycle and action priority", () => {
  const queue = new AmbientSchedule(() => 0); const create = () => ({ point: { x: 10, y: 20 } });
  assert.deepEqual(queue.preview("gull", 0, { ...state, available: false }, create), []);
  assert.deepEqual(queue.preview("gull", 0, { ...state, blocked: true }, create), []);
  assert.equal(queue.preview("gull", 0, state, create)[0].kind, "gull");
  queue.dispose(); assert.deepEqual(queue.preview("gull", 0, state, create), []);
});

test("clean meadow requires both images, keeps the painted fallback on either failure and removes load handlers", () => {
  const setup = () => {
    const images = []; const ready = [];
    const dispose = preloadAmbientArtwork((value) => ready.push(value), () => { const image = { src: "", onload: null, onerror: null }; images.push(image); return image; });
    assert.deepEqual(images.map((image) => image.src), ["/catan/pasture-v1.png", "/catan/ambient-atlas-v1.png"]);
    return { images, ready, dispose };
  };
  const complete = setup(); complete.images[0].onload(); assert.deepEqual(complete.ready, []);
  complete.images[1].onload(); assert.deepEqual(complete.ready, [true]); complete.dispose();
  for (const failedIndex of [0, 1]) {
    const failed = setup(); failed.images[failedIndex].onerror(); failed.images[1 - failedIndex].onload();
    assert.deepEqual(failed.ready, [false]); failed.dispose();
  }
  const unmounted = setup(); const lateLoad = unmounted.images[0].onload; unmounted.dispose(); lateLoad();
  assert.deepEqual(unmounted.ready, []);
  assert.ok([...complete.images, ...unmounted.images].every((image) => image.onload === null && image.onerror === null));
});

test("server rendering has silent sprites, exact 4×3 crops and optional pasture fallback", () => {
  const game = makeGame();
  const props = { game, artId: "fixture", viewBox: "-420 -370 840 740", active: true, interacting: false, enabled: true };
  const markup = renderToStaticMarkup(createElement("svg", null, createElement(CatanAmbientIsland, props)));
  assert.match(markup, /aria-hidden="true" pointer-events="none"/);
  assert.match(markup, /width="400" height="300"/);
  assert.match(markup, /viewBox="0 200 100 100"/);
  assert.equal((markup.match(/catan-ambient-standing-sheep/g) ?? []).length, 16);
  const fallback = renderToStaticMarkup(createElement("svg", null, createElement(CatanAmbientIsland, { ...props, cleanPasture: false })));
  assert.doesNotMatch(fallback, /catan-ambient-standing-sheep/);
  assert.ok(Object.values(AMBIENT_INTERVALS).every(([minimum, maximum]) => minimum >= 20_000 && maximum >= minimum));
});
