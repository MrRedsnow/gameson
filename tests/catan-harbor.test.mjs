import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-harbor-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({ stdin: { contents: 'export { createBoard } from "./lib/catan"; export * from "./lib/catan-harbor";', resolveDir: root, loader: "ts" }, absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", outfile: output, logLevel: "silent" });
after(() => rm(output, { force: true }));
const { createBoard, harborLayout, harborLayouts, harborBoatClearsLand, harborMooringPath, HARBOR_BOAT_SIZE } = createRequire(import.meta.url)(output);

/** Independent separating-axis check for the full rotated image and convex hex. */
function polygonsIntersect(first, second) {
  for (const polygon of [first, second]) for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]; const b = polygon[(index + 1) % polygon.length]; const axis = { x: -(b.y - a.y), y: b.x - a.x };
    const projections = [first, second].map((shape) => shape.map((point) => point.x * axis.x + point.y * axis.y));
    if (Math.max(...projections[0]) < Math.min(...projections[1]) || Math.max(...projections[1]) < Math.min(...projections[0])) return false;
  }
  return true;
}
function corners(layout, progress) {
  const radians = (-5 + 10 * progress) * Math.PI / 180; const half = HARBOR_BOAT_SIZE / 2;
  return [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, y]) => ({
    x: layout.boat.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: layout.boat.y + x * Math.sin(radians) + y * Math.cos(radians) - 1.5 + progress * 4,
  }));
}

test("all six directions keep the full animated boat outside land and harbor plaques", () => {
  const board = createBoard(() => 0); const headings = new Set();
  const land = board.hexes.map((hex) => hex.vertices.map((id) => board.vertices[id]));
  const labels = board.harbors.map((harbor) => {
    const edge = board.edges[harbor.edge]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
    const x = (a.x + b.x) / 2 * 1.29; const y = (a.y + b.y) / 2 * 1.29;
    return [{ x: x - 19, y: y - 17 }, { x: x + 19, y: y - 17 }, { x: x + 19, y: y + 17 }, { x: x - 19, y: y + 17 }];
  });
  for (const edge of board.edges.filter((edge) => edge.hexes.length === 1)) {
    const layout = harborLayout(board, edge.id); headings.add(layout.heading);
    const hex = board.hexes[edge.hexes[0]];
    assert.ok((layout.boat.x - layout.coast.x) * (layout.coast.x - hex.x) + (layout.boat.y - layout.coast.y) * (layout.coast.y - hex.y) > 0);
    assert.equal(harborBoatClearsLand(board, layout.boat), true);
    for (let step = 0; step <= 120; step++) {
      const boat = corners(layout, step / 120);
      for (const polygon of land) assert.equal(polygonsIntersect(boat, polygon), false, `Coast edge ${edge.id}, sway step ${step} intersects land.`);
      for (const polygon of labels) assert.equal(polygonsIntersect(boat, polygon), false, `Coast edge ${edge.id}, sway step ${step} intersects a harbor label.`);
    }
  }
  assert.deepEqual([...headings].sort(), [0, 1, 2, 3, 4, 5]);
});

test("mooring holds its pier point for every view and follows a point inside the boat body", () => {
  const board = createBoard(() => 0);
  for (const harbor of board.harbors) {
    const layout = harborLayout(board, harbor.edge);
    let fixedAnchor;
    for (let step = 0; step <= 100; step++) {
      const path = harborMooringPath(layout, step / 100);
      const values = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const anchor = values.slice(0, 2); fixedAnchor ??= anchor;
      assert.deepEqual(anchor, fixedAnchor);
      const attachment = { x: values[4], y: values[5] };
      const bodyCenter = { x: layout.boat.x, y: layout.boat.y - 1.5 + step / 100 * 4 };
      assert.ok(Math.hypot(attachment.x - bodyCenter.x, attachment.y - bodyCenter.y) < 11, "A rope must terminate on the vessel, not in the surrounding sea.");
    }
  }
});

test("neighboring harbor boats never intersect at independent animation phases", () => {
  const board = createBoard(() => 0);
  const layouts = board.harbors.map((harbor) => harborLayout(board, harbor.edge));
  for (let first = 0; first < layouts.length; first++) for (let second = first + 1; second < layouts.length; second++) {
    for (let firstPhase = 0; firstPhase <= 12; firstPhase++) for (let secondPhase = 0; secondPhase <= 12; secondPhase++) {
      assert.equal(polygonsIntersect(corners(layouts[first], firstPhase / 12), corners(layouts[second], secondPhase / 12)), false,
        `Boats ${board.harbors[first].edge} and ${board.harbors[second].edge} intersect at phases ${firstPhase}/12 and ${secondPhase}/12.`);
    }
  }
});

test("the shared layout remains collision-free with alternate normal nine-harbor placements", () => {
  for (const offset of [1, 2, 5, 7]) {
    const board = createBoard(() => 0);
    const angle = (edge) => Math.atan2(board.vertices[edge.a].y + board.vertices[edge.b].y, board.vertices[edge.a].x + board.vertices[edge.b].x);
    const perimeter = board.edges.filter((edge) => edge.hexes.length === 1).sort((a, b) => angle(a) - angle(b));
    board.harbors.forEach((harbor) => { const index = perimeter.findIndex((edge) => edge.id === harbor.edge); harbor.edge = perimeter[(index + offset) % perimeter.length].id; });
    const layouts = harborLayouts(board);
    for (let first = 0; first < layouts.length; first++) for (let second = first + 1; second < layouts.length; second++) {
      for (let firstPhase = 0; firstPhase <= 12; firstPhase++) for (let secondPhase = 0; secondPhase <= 12; secondPhase++) {
        assert.equal(polygonsIntersect(corners(layouts[first], firstPhase / 12), corners(layouts[second], secondPhase / 12)), false,
          `Perimeter offset ${offset}, boats ${first}/${second}, independent phases ${firstPhase}/${secondPhase}.`);
      }
    }
    for (const layout of layouts) assert.equal(harborBoatClearsLand(board, layout.boat), true);
  }
});

test("board bounds and single-edge consumers share stable layouts through polls, array order and ownership", () => {
  const board = createBoard(() => 0);
  const expected = new Map(board.harbors.map((harbor) => [harbor.edge, harborLayout(board, harbor.edge)]));
  for (const [index, layout] of harborLayouts(board).entries()) assert.deepEqual(layout, expected.get(board.harbors[index].edge));
  board.harbors.reverse();
  for (const vertex of board.vertices.slice(0, 3)) Object.assign(vertex, { owner: "a", building: "settlement" });
  for (const harbor of board.harbors) assert.deepEqual(harborLayout(board, harbor.edge), expected.get(harbor.edge));
  const polled = structuredClone(board);
  for (const harbor of polled.harbors) assert.deepEqual(harborLayout(polled, harbor.edge), expected.get(harbor.edge));
  const externallyChanged = harborLayout(board, board.harbors[0].edge); externallyChanged.boat.x = 1000;
  assert.deepEqual(harborLayout(board, board.harbors[0].edge), expected.get(board.harbors[0].edge), "A consumer cannot poison the shared cached position.");
});
