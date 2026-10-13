import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, `.wrangler/test-artifacts/catan-board-art-${process.pid}.cjs`);
await mkdir(resolve(root, ".wrangler/test-artifacts"), { recursive: true });
await build({
  stdin: { contents: 'export { CatanBoard } from "./components/catan/board"; export { coastlinePath } from "./lib/catan-coastline"; export { createBoard, createCatanGame, catanView } from "./lib/catan";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { CatanBoard, coastlinePath, createBoard, createCatanGame, catanView } = createRequire(import.meta.url)(output);
const seats = ["Robin", "Mara", "Lea", "Dana"].map((name, index) => ({ id: String(index), name }));
const game = createCatanGame(seats, 12, () => 0);
const render = (state = game) => renderToStaticMarkup(createElement(CatanBoard, { game: catanView(state, "0"), mode: null, choices: [], selected: null, onSelect() {}, disabled: false }));
const edgeKey = (a, b) => [a, b].sort().join("|");

test("the closed coastline follows every exposed edge exactly once without artificial diagonals", () => {
  const board = createBoard(() => 0);
  const path = coastlinePath(board);
  assert.equal((path.match(/M/g) ?? []).length, 1);
  assert.equal((path.match(/Z/g) ?? []).length, 1);
  const points = path.slice(1, -1).split("L");
  const actual = points.map((point, index) => edgeKey(point, points[(index + 1) % points.length]));
  const expected = board.edges.filter((edge) => edge.hexes.length === 1).map((edge) => edgeKey(
    `${board.vertices[edge.a].x},${board.vertices[edge.a].y}`,
    `${board.vertices[edge.b].x},${board.vertices[edge.b].y}`,
  ));
  assert.equal(new Set(actual).size, actual.length, "No coastal segment may acquire doubled opacity.");
  assert.deepEqual(actual.sort(), expected.sort());
  assert.equal(coastlinePath({ vertices: board.vertices, edges: [...board.edges].reverse() }).split("L").length, points.length);
  assert.equal(coastlinePath({ vertices: board.vertices, edges: board.edges.filter((edge) => edge.id !== board.edges.find((candidate) => candidate.hexes.length === 1).id) }), "", "An incomplete contour does not invent a closing coast.");
});

test("two static coastal strokes share the closed contour below terrain and do not intercept input", () => {
  const html = render();
  const shore = html.match(/<g aria-hidden="true" class="catan-shoreline"[^>]*>[\s\S]*?<\/g>/)?.[0];
  assert.ok(shore);
  assert.match(shore, /pointer-events="none"/);
  assert.equal((shore.match(/<path /g) ?? []).length, 2);
  assert.doesNotMatch(shore, /<line|filter=|animate|vector-effect=/);
  const contours = [...shore.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(contours[0], contours[1]);
  assert.match(contours[0], /Z$/);
  assert.ok(html.indexOf(shore) < html.indexOf('class="catan-landscape'));
});

test("roads retain two construction strokes with shared nondegenerate paints and production numbers identify 6 and 8", () => {
  const owned = structuredClone(game);
  owned.board.edges.forEach((edge, index) => { edge.owner = String(index % seats.length); });
  const html = render(owned);
  const paints = [...html.matchAll(/<linearGradient id="([^"]+-road-\d)"([^>]*)>/g)];
  assert.equal(paints.length, 4, "Roads share a single paint per player color.");
  for (const [, , attributes] of paints) {
    assert.match(attributes, /gradientUnits="userSpaceOnUse"/);
    const first = Number(attributes.match(/ y1="([^"]+)"/)[1]);
    const second = Number(attributes.match(/ y2="([^"]+)"/)[1]);
    assert.ok(second > first, "The paint works for vertical and horizontal road bounds.");
  }
  const roads = [...html.matchAll(/<g data-catan-road="\d+">[\s\S]*?<\/g>/g)].map((match) => match[0]);
  assert.equal(roads.length, owned.board.edges.length);
  for (const road of roads) {
    assert.equal((road.match(/<line /g) ?? []).length, 2, "Construction playback still controls exactly two strokes.");
    assert.match(road, /stroke="url\(#[^)]+-road-\d\)"/);
  }
  for (const label of html.matchAll(/<text[^>]*class="catan-number-label[^"]*"[^>]*data-catan-number-hot="(true|false)"[^>]*>(\d+)<\/text>/g)) {
    assert.equal(label[1], [6, 8].includes(Number(label[2])) ? "true" : "false");
  }
  assert.equal((html.match(/data-catan-number-hot="/g) ?? []).length, 18);
});
