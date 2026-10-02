import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-pedestrian-render-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export { CatanBoard } from "./components/catan/board"; export { CatanAmbientIsland } from "./components/catan/ambient-island"; export { createCatanGame, catanView } from "./lib/catan"; export { AMBIENT_WALK_REST } from "./lib/catan-ambient";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const require = createRequire(import.meta.url);
const React = require("react"); const { renderToStaticMarkup } = require("react-dom/server");
const { CatanBoard, CatanAmbientIsland, createCatanGame, catanView, AMBIENT_WALK_REST } = require(output);
const seats = [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }, { id: "c", name: "Clara" }];
const gameWithRoad = () => {
  const game = createCatanGame(seats, 10, () => 0); const edge = game.board.edges[0];
  edge.owner = "a"; Object.assign(game.board.vertices[edge.a], { owner: "a", building: "settlement" });
  return catanView(game, "a");
};

test("villagers have one animated source and are painted above confirmed roads but below buildings", () => {
  const html = renderToStaticMarkup(React.createElement(CatanBoard, { game: gameWithRoad(), mode: null, choices: [], selected: null, onSelect() {}, disabled: false }));
  const source = html.match(/<g id="([^"]+-ambient-pedestrians)">/);
  assert.ok(source); assert.equal(html.split(`id="${source[1]}"`).length - 1, 1);
  const instances = [...html.matchAll(/<use class="catan-ambient-pedestrians"[^>]*>/g)];
  assert.equal(instances.length, 1, "External placement must not duplicate villagers inside the scenery layer.");
  assert.ok(instances[0][0].includes(`href="#${source[1]}"`));
  assert.match(instances[0][0], /pointer-events="none" aria-hidden="true"/);
  assert.ok(html.lastIndexOf('data-catan-road="') < instances[0].index, "Road strokes cannot cover a walking figure.");
  assert.ok(instances[0].index < html.indexOf('data-catan-building="'), "Buildings still cover figures at their junctions.");
});

test("isolated island fixtures keep a single default use instance for the same animated source", () => {
  const props = { game: gameWithRoad(), artId: "inline", viewBox: "-420 -370 840 740", active: true, interacting: false, enabled: true };
  const render = (externalPedestrians) => renderToStaticMarkup(React.createElement("svg", null, React.createElement(CatanAmbientIsland, { ...props, externalPedestrians })));
  const inline = render(false); const external = render(true);
  assert.equal((inline.match(/class="catan-ambient-pedestrians"/g) ?? []).length, 1);
  assert.match(inline, /href="#inline-ambient-pedestrians"/);
  assert.doesNotMatch(external, /class="catan-ambient-pedestrians"/);
  assert.match(external, /id="inline-ambient-pedestrians"/);
});

test("the scenery animation finds its villager source inside defs, follows four-point road polylines and turns on vertical returns", (t) => {
  const scene = { id: "villager", kind: "pedestrian", startedAt: 0, duration: 9300, pathKind: "polyline", path: [{ x: 0, y: 0 }, { x: 0, y: 54 }, { x: 54, y: 54 }, { x: 54, y: 0 }] };
  const attributes = new Map([["data-ambient-scene", scene.id]]); const bodyAttributes = new Map();
  const classes = new Map();
  const body = { setAttribute: (name, value) => bodyAttributes.set(name, value) };
  const source = { getAttribute: (name) => attributes.get(name), setAttribute: (name, value) => attributes.set(name, value), querySelector: () => body, classList: { toggle: (name, enabled) => classes.set(name, enabled) }, style: {} };
  const layer = { querySelectorAll: () => [source] }; const layouts = []; let refs = 0; let frame;
  t.mock.method(React, "useState", () => [[scene], () => {}]);
  t.mock.method(React, "useRef", (value) => ({ current: refs++ === 0 ? layer : value }));
  t.mock.method(React, "useEffect", () => {});
  t.mock.method(React, "useLayoutEffect", (effect) => { layouts.push(effect); });
  const previousFrame = globalThis.requestAnimationFrame; const previousCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { frame = callback; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    if (previousFrame) globalThis.requestAnimationFrame = previousFrame; else delete globalThis.requestAnimationFrame;
    if (previousCancel) globalThis.cancelAnimationFrame = previousCancel; else delete globalThis.cancelAnimationFrame;
  });
  const tree = CatanAmbientIsland({ game: gameWithRoad(), artId: "animated", viewBox: "-420 -370 840 740", active: true, interacting: false, enabled: true, externalPedestrians: true });
  const html = renderToStaticMarkup(React.createElement("svg", null, tree));
  const start = html.indexOf('id="animated-ambient-pedestrians"'); const sceneIndex = html.indexOf('data-ambient-scene="villager"');
  assert.ok(start < sceneIndex && sceneIndex < html.indexOf("</defs>"), "The selected animation source really lives inside definitions.");
  assert.equal((html.match(/data-ambient-scene="villager"/g) ?? []).length, 1);
  layouts.at(-1)();
  const position = () => attributes.get("transform").match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number);
  const travelDuration = scene.duration - AMBIENT_WALK_REST;
  frame(travelDuration * .1); let [x, y] = position();
  assert.equal(x, 0); assert.ok(y > 15 && y < 17, "The first vertical road stays vertical, rather than using a cubic shortcut.");
  assert.match(bodyAttributes.get("transform"), /scale\(1 1\)/);
  assert.equal(source.style.opacity, "1");
  frame(travelDuration * .5); [x, y] = position();
  assert.equal(x, 27); assert.ok(Math.abs(y - 54) < 1, "The middle of the walk covers the whole middle road.");
  frame(travelDuration * .9); [x, y] = position();
  assert.equal(x, 54); assert.ok(y > 15 && y < 17);
  assert.match(bodyAttributes.get("transform"), /scale\(-1 1\)/, "An upward return turns the upright figure.");
  assert.equal(classes.get("is-resting"), false);
  frame(travelDuration); const arrived = attributes.get("transform");
  assert.deepEqual(position(), [54, 0], "The entire final road reaches its endpoint while the figure is still fully visible.");
  assert.equal(classes.get("is-resting"), true); assert.equal(source.style.opacity, "1");
  frame(travelDuration + AMBIENT_WALK_REST / 2);
  assert.equal(attributes.get("transform"), arrived, "The villager really stands still for the final rest, with no walking bob.");
  assert.equal(source.style.opacity, "1");
  frame(scene.duration - 200); assert.equal(source.style.opacity, "0.5");
  frame(9300); assert.equal(source.style.opacity, "0");
  assert.equal(attributes.get("transform"), arrived, "The figure fades at the reached endpoint rather than sliding past the house.");
});
