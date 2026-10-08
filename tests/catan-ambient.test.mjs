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
  stdin: { contents: 'export * from "./lib/catan-ambient"; export * from "./lib/catan-camera"; export * from "./lib/catan-harbor"; export { createBoard } from "./lib/catan"; export { CatanAmbientIsland } from "./components/catan/ambient-island";', resolveDir: root, loader: "ts" },
  absWorkingDir: root, bundle: true, platform: "node", format: "cjs", outfile: output, logLevel: "silent", external: ["react", "react/jsx-runtime"],
});
after(() => rm(output, { force: true }));
const require = createRequire(import.meta.url);
const {
  ambientBounds, ambientRandom, ambientSeaPoint, ambientPathPoint, ambientPath, ambientPolylineLength, ambientSceneDuration, ambientRoadRoute, ambientSheep, ambientSceneValid, harborAmbientPoint, ambientHarborExclusions, harborLayout, HARBOR_BOAT_CLEARANCE, fitCamera, cameraMetrics, pointInPolygon,
  validDolphinPath, ambientDolphinPosition, createAmbientScene, AmbientSchedule, AMBIENT_INTERVALS, AMBIENT_FIRST_INTERVALS, AMBIENT_DURATIONS, AMBIENT_DOLPHIN_SIZE, AMBIENT_DOLPHIN_JUMP, AMBIENT_WILDLIFE_SPRITES, AMBIENT_WILDLIFE_BOB, preloadAmbientArtwork, CatanAmbientIsland, createBoard,
} = require(output);
const React = require("react"); const { createElement } = React; const { renderToStaticMarkup } = require("react-dom/server");
const bounds = { x: -420, y: -370, width: 840, height: 740 };
const state = { available: true, blocked: false, mobile: false };
const makeGame = (seed = "island") => {
  const board = createBoard(() => 0);
  return { id: seed, board, robberHex: board.hexes.find((hex) => hex.resource === "desert").id };
};
const wildlifeTerrains = [
  ["ore_wildlife", "ore", ["deer", "stag", "fox", "boar"]],
  ["clay_wildlife", "brick", ["salamander", "toad", "newt"]],
  ["grain_wildlife", "grain", ["hare", "field_mouse", "pheasant"]],
  ["forest_wildlife", "wood", ["squirrel", "badger", "hedgehog"]],
];

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
      assert.equal(ambientDolphinPosition(game.board, bounds, point), true);
      assert.equal(ambientDolphinPosition(game.board, bounds, { ...point, y: point.y - Math.sin(progress * Math.PI) * AMBIENT_DOLPHIN_JUMP }), true);
    }
  }
  assert.ok(found >= 20, "A wide visible sea ring has reliable routes.");
  const center = game.board.hexes[0];
  assert.equal(ambientSeaPoint(game.board, bounds, center), false);
  assert.equal(validDolphinPath(game.board, bounds, [{ x: -100, y: -100 }, { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 100, y: 100 }]), false);
  assert.equal(createAmbientScene("dolphin", game, { x: -30, y: -30, width: 60, height: 60 }, ambientRandom("no-sea")), null, "A close inland view waits rather than cutting the coast.");
});

test("dolphin clearance checks coast edges and harbor circles through the full sprite, not just corners", () => {
  assert.equal(AMBIENT_DOLPHIN_SIZE, 40);
  const board = { vertices: [{ x: -100, y: 0 }, { x: 100, y: 0 }], edges: [{ a: 0, b: 1, hexes: [0] }], hexes: [], harbors: [] };
  assert.equal(ambientDolphinPosition(board, bounds, { x: 0, y: 14 }), false, "The coastline cuts the middle of the rectangle without touching a sprite corner.");
  assert.ok(Math.hypot(20, 60 - 40 * .72) > 37, "Every sprite corner misses the harbor exclusion.");
  const harborBoard = makeGame().board; const harbor = harborAmbientPoint(harborBoard, harborBoard.harbors[0].edge);
  assert.equal(ambientDolphinPosition(harborBoard, bounds, { x: harbor.x, y: harbor.y + 60 }), false, "The harbor circle still meets the middle of the sprite's upper edge.");
  assert.equal(ambientDolphinPosition(board, bounds, { x: 0, y: 74 }), true);
  assert.equal(ambientDolphinPosition(board, bounds, { x: bounds.x + 19, y: 100 }), false, "The full sprite must fit in the visible sea ring.");
});

test("dolphin masks protect both harbor labels and the relocated boat with its full sway radius", () => {
  const game = makeGame(); const exclusions = ambientHarborExclusions(game.board);
  assert.equal(exclusions.length, game.board.harbors.length * 2);
  for (const harbor of game.board.harbors) {
    const guards = exclusions.filter((guard) => guard.edgeId === harbor.edge);
    const label = guards.find((guard) => guard.kind === "label"); const boat = guards.find((guard) => guard.kind === "boat");
    assert.deepEqual(label.point, harborAmbientPoint(game.board, harbor.edge)); assert.equal(label.radius, 36);
    assert.deepEqual(boat.point, harborLayout(game.board, harbor.edge).boat); assert.ok(boat.radius >= HARBOR_BOAT_CLEARANCE);
    assert.notDeepEqual(boat.point, label.point, "The physical boat no longer shares the label centre.");
    for (const guard of guards) assert.equal(ambientDolphinPosition(game.board, bounds, { x: guard.point.x, y: guard.point.y + AMBIENT_DOLPHIN_SIZE * .72 }), false, "A dolphin rectangle cannot overlap either harbor layer.");
  }
});

test("dolphins find safe water in the real fitted board bounds on mobile, desktop and fullscreen", (t) => {
  const game = makeGame();
  const extents = [...game.board.vertices, ...game.board.harbors.flatMap((harbor) => {
    const point = harborAmbientPoint(game.board, harbor.edge);
    return [{ x: point.x - 23, y: point.y - 20 }, { x: point.x + 23, y: point.y + 20 }];
  }), ...game.board.harbors.flatMap((harbor) => {
    const point = harborLayout(game.board, harbor.edge).boat;
    return [{ x: point.x - HARBOR_BOAT_CLEARANCE, y: point.y - HARBOR_BOAT_CLEARANCE }, { x: point.x + HARBOR_BOAT_CLEARANCE, y: point.y + HARBOR_BOAT_CLEARANCE }];
  })];
  const padding = 32;
  const left = Math.min(...extents.map((point) => point.x)) - padding; const top = Math.min(...extents.map((point) => point.y)) - padding;
  const boardBounds = { x: left, y: top, width: Math.max(...extents.map((point) => point.x)) - left + padding, height: Math.max(...extents.map((point) => point.y)) - top + padding };
  for (const size of [{ width: 360, height: 300 }, { width: 1100, height: 650 }, { width: 360, height: 680 }, { width: 1440, height: 900 }, { width: 600, height: 600 }]) {
    const visible = ambientBounds(cameraMetrics(boardBounds, size, fitCamera(boardBounds)).viewBox);
    let found = 0; const sides = new Set();
    for (let seed = 0; seed < 100; seed++) {
      const scene = createAmbientScene("dolphin", game, visible, ambientRandom(`fit-${size.width}-${size.height}-${seed}`));
      if (scene) { found++; assert.equal(validDolphinPath(game.board, visible, scene.path), true); const point = ambientPathPoint(scene.path, .5); sides.add(Math.abs(point.x) > Math.abs(point.y) ? point.x > 0 ? "east" : "west" : point.y > 0 ? "south" : "north"); }
    }
    t.diagnostic(`${size.width}×${size.height}: ${found}/100 safe dolphin paths, sides ${[...sides].join(",")}`);
    assert.ok(found >= 95, `${size.width}×${size.height} fitted view leaves space for dolphins (${found}/100).`);
    assert.equal(sides.size, 4, `Dolphins reach every island side in ${size.width}×${size.height}.`);
  }
});

test("dolphin route caching survives transport snapshots and cannot be mutated by a caller", () => {
  const game = makeGame(); const random = () => ambientRandom("same-geometry");
  const first = createAmbientScene("dolphin", game, bounds, random());
  const snapshot = structuredClone(game); snapshot.board.edges[0].owner = "changed"; snapshot.board.hexes[0].resource = "grain";
  assert.deepEqual(createAmbientScene("dolphin", snapshot, bounds, random()), first, "Public ownership and resource updates do not change coastal geometry.");
  first.path[0].x = 1e6;
  const next = createAmbientScene("dolphin", snapshot, bounds, random());
  assert.notEqual(next.path[0].x, 1e6);
  assert.equal(validDolphinPath(snapshot.board, bounds, next.path), true);
});

const roadBoard = (points, connections) => ({
  vertices: points.map(([x, y], id) => ({ id, x, y, owner: null, building: null })),
  edges: connections.map(([a, b], id) => ({ id, a, b, owner: "a", hexes: [] })), hexes: [], harbors: [],
});
const assertRoadRouteSegments = (board, route) => {
  assert.equal(route.pathKind, "polyline");
  assert.equal(route.path.length, route.roadEdges.length + 1);
  route.roadEdges.forEach((id, index) => {
    const edge = board.edges[id]; const a = board.vertices[edge.a]; const b = board.vertices[edge.b];
    const same = (point, vertex) => point.x === vertex.x && point.y === vertex.y;
    assert.ok(same(route.path[index], a) && same(route.path[index + 1], b) || same(route.path[index], b) && same(route.path[index + 1], a), "Every movement spans one entire built road between its two vertices.");
  });
};
const assertCompleteRoadRoute = (board, route, expected = board.edges.map((edge) => edge.id)) => {
  assertRoadRouteSegments(board, route);
  assert.deepEqual([...new Set(route.roadEdges)].sort((a, b) => a - b), [...expected].sort((a, b) => a - b));
};
const claimedRoadChain = (count) => {
  const board = createBoard(() => 0); let chain;
  const visit = (vertex, edges, vertices) => {
    if (edges.length === count) { chain = { edges: [...edges], vertices: [...vertices] }; return true; }
    for (const edge of board.edges.filter((edge) => edge.a === vertex || edge.b === vertex)) {
      const next = edge.a === vertex ? edge.b : edge.a; if (vertices.includes(next)) continue;
      if (visit(next, [...edges, edge.id], [...vertices, next])) return true;
    }
    return false;
  };
  assert.equal(visit(0, [], [0]), true);
  for (const id of chain.edges) board.edges[id].owner = "a";
  return { board, ...chain };
};

test("an unbroken seven-road strand always spans all confirmed segments, including houses only at its ends", () => {
  const { board, edges, vertices } = claimedRoadChain(7);
  for (const housesAtEnds of [false, true]) {
    if (housesAtEnds) {
      Object.assign(board.vertices[vertices[0]], { owner: "a", building: "settlement" });
      Object.assign(board.vertices[vertices.at(-1)], { owner: "a", building: "city" });
    }
    const before = structuredClone(board);
    for (let seed = 0; seed < 64; seed++) {
      const route = ambientRoadRoute(board, bounds, ambientRandom(`seven-${housesAtEnds}-${seed}`));
      assertCompleteRoadRoute(board, route, edges); assert.equal(route.roadEdges.length, 7); assert.equal(route.path.length, 8);
      assert.equal(ambientSceneDuration("pedestrian", route), 20_100);
      const ends = [board.vertices[vertices[0]], board.vertices[vertices.at(-1)]];
      assert.ok(ends.some((end) => route.path[0].x === end.x && route.path[0].y === end.y));
      assert.ok(ends.some((end) => route.path.at(-1).x === end.x && route.path.at(-1).y === end.y));
    }
    assert.deepEqual(board, before, "Routing leaves confirmed ownership and buildings intact.");
  }
});

test("an own middle house is an occasional destination while most seven-road walks remain complete", () => {
  const { board, edges, vertices } = claimedRoadChain(7);
  const middle = vertices[3];
  for (const [id, building] of [[vertices[0], "settlement"], [middle, "city"], [vertices.at(-1), "settlement"]]) Object.assign(board.vertices[id], { owner: "a", building });
  let full = 0; let stopped = 0; const starts = new Set();
  for (let seed = 0; seed < 128; seed++) {
    const route = ambientRoadRoute(board, bounds, ambientRandom(`middle-home-${seed}`)); assertRoadRouteSegments(board, route);
    const start = vertices.find((id) => board.vertices[id].x === route.path[0].x && board.vertices[id].y === route.path[0].y);
    starts.add(start); assert.ok([vertices[0], vertices.at(-1)].includes(start), "An interior home must not split every walk into the nearest short segment.");
    if (route.roadEdges.length === 7) { full++; assertCompleteRoadRoute(board, route, edges); }
    else {
      stopped++; assert.ok([3, 4].includes(route.roadEdges.length));
      assert.deepEqual(route.path.at(-1), { x: board.vertices[middle].x, y: board.vertices[middle].y });
    }
  }
  assert.ok(full > 80 && stopped > 10, `${full} complete walks and ${stopped} house destinations preserve long routes and occasional stops.`);
  assert.equal(starts.size, 2, "Both outer houses can begin a walk.");
  board.vertices[middle].owner = "b";
  for (let seed = 0; seed < 32; seed++) {
    const route = ambientRoadRoute(board, bounds, ambientRandom(`enemy-middle-${seed}`)); assertRoadRouteSegments(board, route);
    assert.ok(route.roadEdges.every((id) => ![board.edges[id].a, board.edges[id].b].includes(middle)));
    assert.equal(route.path.some((point) => point.x === board.vertices[middle].x && point.y === board.vertices[middle].y), false, "A walker never reaches or passes an opponent's house.");
  }
});

test("a longest visible network is preferred to an isolated short road, and loops can start at an own home", () => {
  const { board, edges, vertices } = claimedRoadChain(7);
  const isolated = board.edges.find((edge) => !edges.includes(edge.id) && !vertices.includes(edge.a) && !vertices.includes(edge.b)); isolated.owner = "a";
  Object.assign(board.vertices[vertices[0]], { owner: "a", building: "settlement" });
  for (let seed = 0; seed < 32; seed++) {
    const route = ambientRoadRoute(board, bounds, ambientRandom(`longest-network-${seed}`));
    assertCompleteRoadRoute(board, route, edges); assert.deepEqual(route.path[0], { x: board.vertices[vertices[0]].x, y: board.vertices[vertices[0]].y });
  }
  const loop = roadBoard([[0, 0], [60, 0], [60, 60], [0, 60]], [[0, 1], [1, 2], [2, 3], [3, 0]]);
  Object.assign(loop.vertices[2], { owner: "a", building: "city" });
  for (let seed = 0; seed < 12; seed++) {
    const route = ambientRoadRoute(loop, bounds, ambientRandom(`home-loop-${seed}`)); assertCompleteRoadRoute(loop, route);
    assert.deepEqual(route.path[0], { x: 60, y: 60 }); assert.deepEqual(route.path.at(-1), route.path[0]);
  }
});

test("walkers cover full chains as real polylines, including the four-point cubic special case", () => {
  const board = roadBoard([[0, 0], [60, 0], [60, 60], [120, 60]], [[0, 1], [1, 2], [2, 3]]);
  for (let seed = 0; seed < 12; seed++) {
    const route = ambientRoadRoute(board, bounds, ambientRandom(`chain-${seed}`));
    assertCompleteRoadRoute(board, route);
    assert.equal(route.path.length, 4);
    assert.deepEqual(ambientPathPoint(route.path, 1 / 3, route.pathKind), route.path[1]);
    assert.deepEqual(ambientPathPoint(route.path, 2 / 3, route.pathKind), route.path[2]);
    assert.match(ambientPath(route.path, route.pathKind), /L/); assert.doesNotMatch(ambientPath(route.path, route.pathKind), /C/);
    assert.equal(ambientPolylineLength(route.path), 180);
    assert.equal(ambientSceneDuration("pedestrian", route), 10_200);
    assert.ok(ambientSceneDuration("pedestrian", route) > ambientSceneDuration("pedestrian", { path: route.path.slice(0, 2) }));
    const queue = new AmbientSchedule(() => 0);
    assert.equal(queue.preview("pedestrian", 0, state, () => route)[0].duration, 10_200);
  }
  const narrowView = { x: -20, y: -20, width: 50, height: 50 };
  assertCompleteRoadRoute(board, ambientRoadRoute(board, narrowView, ambientRandom("offscreen-network")));
});

test("walkers visit connected branches and loops without jumping or leaving their owner's network", () => {
  const board = roadBoard([[0, 0], [60, 0], [120, 0], [120, 60], [120, -60], [180, 0]], [[0, 1], [1, 2], [2, 3], [2, 4], [2, 5], [3, 5]]);
  const original = structuredClone(board);
  for (let seed = 0; seed < 30; seed++) assertCompleteRoadRoute(board, ambientRoadRoute(board, bounds, ambientRandom(`branches-${seed}`)));
  assert.deepEqual(board, original);
  board.vertices[2].owner = "b"; board.vertices[2].building = "settlement";
  for (let seed = 0; seed < 20; seed++) {
    const route = ambientRoadRoute(board, bounds, ambientRandom(`opponent-${seed}`));
    assert.ok(route.roadEdges.every((id) => ![board.edges[id].a, board.edges[id].b].includes(2)), "An enemy building splits the decorative walk before the junction.");
  }
});

test("forest birds can cross between nearby woods along a longer curved flight", () => {
  const game = { id: "woods", robberHex: 2, board: { hexes: [{ id: 0, x: 0, y: 0, resource: "wood" }, { id: 1, x: 95, y: 0, resource: "wood" }, { id: 2, x: 0, y: 95, resource: "desert" }] } };
  const scene = createAmbientScene("forest_bird", game, bounds, () => 0);
  assert.equal(scene.hexId, 0); assert.equal(scene.pathKind, "bezier");
  assert.ok(Math.abs(scene.path[scene.path.length - 1].x - 95) <= 23, "The flight reaches a second nearby forest field.");
  assert.ok(ambientPolylineLength(scene.path) > 60, "The bird follows a longer route than the old single-field arc.");
  game.robberHex = 1;
  const isolated = createAmbientScene("forest_bird", game, bounds, () => 0);
  assert.ok(Math.abs(isolated.path[isolated.path.length - 1].x) <= 29, "A robber-blocked destination is skipped.");
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
    assert.equal(sheep.pathKind, "polyline");
    assert.ok(ambientPolylineLength(sheep.path) >= 24 && ambientPolylineLength(sheep.path) <= 28, "The sheep travels 12–14 units and returns the same distance.");
    const hex = game.board.hexes[sheep.hexId]; const polygon = hex.vertices.map((id) => game.board.vertices[id]);
    for (let step = 0; step <= 100; step++) {
      const point = ambientPathPoint(sheep.path, step / 100, sheep.pathKind);
      const size = 18; const top = point.y - size * .72 - .85;
      for (const x of [point.x - size / 2, point.x + size / 2]) for (const y of [top, point.y + size * .28]) assert.equal(pointInPolygon({ x, y }, polygon), true, "The whole sheep sprite and walking bob stay inside the wool hex.");
      assert.ok(Math.abs(point.x - hex.x) - size / 2 >= 14, "The sheep stays beside the central number.");
    }
    const breeze = createAmbientScene("wind", game, bounds, ambientRandom(`wind-${seed}`));
    assert.ok(breeze.windFields.length >= 1 && breeze.windFields.length <= 2);
    assert.ok(breeze.windFields.every((id) => ["wood", "grain"].includes(game.board.hexes[id].resource)));
  }
});

test("every terrain animal keeps both complete poses, its bob and return walk inside its terrain away from the number", () => {
  const game = makeGame(); const before = structuredClone(game); const seen = new Set();
  for (const [kind, resource, species] of wildlifeTerrains) {
    const fields = new Set();
    for (let seed = 0; seed < 120; seed++) {
      const scene = createAmbientScene(kind, game, bounds, ambientRandom(`${kind}-${seed}`));
      assert.ok(scene, "Each animal has safe routes on the ordinary full island.");
      assert.ok(species.includes(scene.wildlifeSpecies)); seen.add(scene.wildlifeSpecies); fields.add(scene.hexId);
      const hex = game.board.hexes[scene.hexId]; const polygon = hex.vertices.map((id) => game.board.vertices[id]);
      assert.equal(hex.resource, resource); assert.notEqual(hex.id, game.robberHex);
      assert.equal(scene.pathKind, "polyline"); assert.deepEqual(scene.path[0], scene.path.at(-1));
      assert.ok(ambientPolylineLength(scene.path) >= 24, "The animal visibly walks out and back.");
      const size = AMBIENT_WILDLIFE_SPRITES[scene.wildlifeSpecies].size;
      for (let step = 0; step <= 100; step++) {
        const point = ambientPathPoint(scene.path, step / 100, scene.pathKind);
        const left = point.x - size / 2; const right = point.x + size / 2;
        const top = point.y - size * .72 - AMBIENT_WILDLIFE_BOB; const bottom = point.y + size * .28;
        // The whole rectangle contains both full atlas poses and every bob height;
        // reflection is identical and the renderer never rotates ground animals.
        for (const x of [left, right]) for (const y of [top, bottom]) {
          assert.equal(pointInPolygon({ x, y }, polygon), true, `${scene.wildlifeSpecies} fits its own hex throughout the walk.`);
          assert.ok(x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height);
        }
        const nearestX = Math.max(left, Math.min(right, hex.x)); const nearestY = Math.max(top, Math.min(bottom, hex.y));
        assert.ok(Math.hypot(nearestX - hex.x, nearestY - hex.y) >= 18, "The entire label disc stays clear, including sprite edges between corners.");
      }
    }
    assert.equal(fields.size, game.board.hexes.filter((hex) => hex.resource === resource).length, "Decoration can reach every field of its terrain.");
  }
  assert.deepEqual([...seen].sort(), wildlifeTerrains.flatMap(([, , species]) => species).sort());
  assert.deepEqual(game, before, "Ambient animals do not change public game state.");
});

test("wildlife respects missing terrain, robber changes, transport snapshots and camera clipping", () => {
  for (const [kind, resource, species] of wildlifeTerrains) {
    const game = makeGame(); const chosen = game.board.hexes.find((hex) => hex.resource === resource);
    game.board.hexes.forEach((hex) => { if (hex.resource === resource && hex.id !== chosen.id) hex.resource = "desert"; });
    const scene = { ...createAmbientScene(kind, game, bounds, ambientRandom(kind)), kind };
    assert.equal(scene.hexId, chosen.id); assert.equal(ambientSceneValid(scene, structuredClone(game), false), true, "Wildlife does not depend on clean pasture artwork.");
    const foreignSpecies = wildlifeTerrains.flatMap(([, , animals]) => animals).find((animal) => !species.includes(animal));
    assert.equal(ambientSceneValid({ ...scene, wildlifeSpecies: foreignSpecies }, game), false, "An animal from another habitat cannot remain on this field.");
    assert.equal(createAmbientScene(kind, game, { x: chosen.x - 10, y: chosen.y - 10, width: 20, height: 20 }, () => .5), null, "A clipped or zoomed number area cannot spawn half an animal.");
    game.robberHex = chosen.id;
    assert.equal(createAmbientScene(kind, game, bounds, () => .5), null); assert.equal(ambientSceneValid(scene, game), false);
    game.robberHex = game.board.hexes.find((hex) => hex.resource === "desert").id;
    chosen.resource = "desert";
    assert.equal(ambientSceneValid(scene, game), false); assert.equal(createAmbientScene(kind, game, bounds, () => .5), null);
    const queue = new AmbientSchedule(() => 0);
    queue.preview(kind, 0, state, () => scene); queue.prune((running) => ambientSceneValid(running, game));
    assert.deepEqual(queue.tick(1, state, () => null), []);
  }
});

test("all four wildlife habitats share the scene budget, repeat gently and never catch up after suspension", () => {
  const game = makeGame(); const kinds = wildlifeTerrains.map(([kind]) => kind);
  const create = (kind) => kinds.includes(kind) ? createAmbientScene(kind, game, bounds, () => 0) : null;
  for (const mobile of [false, true]) {
    const queue = new AmbientSchedule(() => 0); const scheduleState = { ...state, mobile }; const cap = mobile ? 2 : 3;
    queue.tick(0, scheduleState, create); assert.deepEqual(queue.tick(5999, scheduleState, create), []);
    const first = queue.tick(6000, scheduleState, create);
    assert.equal(first.length, cap, "Simultaneously due wildlife fills only the existing shared scene budget.");
    assert.ok(first.every((scene) => kinds.includes(scene.kind) && scene.duration >= 6000 && scene.duration <= 9000));
    const instances = new Set(); const starts = new Map(kinds.map((kind) => [kind, []]));
    for (let now = 6000; now <= 48_000; now += 500) {
      const scenes = queue.tick(now, scheduleState, create);
      assert.ok(scenes.length <= cap);
      for (const scene of scenes) if (!instances.has(scene.id)) {
        instances.add(scene.id); starts.get(scene.kind).push(scene.startedAt);
      }
    }
    for (const kind of kinds) {
      const appearances = starts.get(kind);
      assert.ok(appearances.length >= 2, `${kind}: each waiting habitat receives a first appearance and a repeat.`);
      for (let index = 1; index < appearances.length; index++) assert.ok(appearances[index] - appearances[index - 1] >= AMBIENT_INTERVALS[kind][0], "Wildlife repeats respect their quiet interval even when the budget is full.");
    }
    assert.deepEqual(queue.tick(49_000, { ...scheduleState, available: false }, create), []);
    assert.deepEqual(queue.tick(100_000, scheduleState, create), []);
    assert.deepEqual(queue.tick(105_999, scheduleState, create), []);
    assert.equal(queue.tick(106_000, scheduleState, create).length, cap);
    const resumed = new Set();
    for (let now = 106_000; now <= 116_000; now += 500) {
      const scenes = queue.tick(now, scheduleState, create);
      assert.ok(scenes.length <= cap);
      for (const scene of scenes) { resumed.add(scene.kind); assert.ok(scene.startedAt >= 106_000); }
    }
    assert.deepEqual([...resumed].sort(), [...kinds].sort(), "Suspension restarts quiet scheduling without starving the habitats waiting for space.");
    queue.dispose();
  }
});

test("first birds arrive sooner than repeats and long visible scenes retain their shared budget", () => {
  const queue = new AmbientSchedule(() => 0);
  const create = (kind) => ["gull", "forest_bird", "dolphin"].includes(kind) ? { point: { x: 0, y: 0 } } : null;
  assert.deepEqual(queue.tick(0, state, create), []);
  assert.deepEqual(queue.tick(1999, state, create), []);
  assert.deepEqual(queue.tick(2000, state, create).map((scene) => [scene.kind, scene.startedAt, scene.duration]), [["gull", 2000, 10_000]]);
  assert.deepEqual(queue.tick(5000, state, create).map((scene) => scene.kind), ["gull", "forest_bird"]);
  const full = queue.tick(7000, state, create);
  assert.equal(full.length, 3); assert.equal(full.find((scene) => scene.kind === "dolphin").duration, 8000);
  assert.equal(AMBIENT_DURATIONS.forest_bird, 7000);
  const repeat = queue.tick(12_000, state, create).find((scene) => scene.kind === "gull");
  assert.equal(repeat.startedAt, 12_000, "The next gull follows the repeat interval after its first appearance.");
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

test("busy mobile islands show walkers early and give every waiting animal its turn", () => {
  const game = makeGame();
  const road = game.board.edges.find((edge) => edge.hexes.length === 2);
  road.owner = "a";
  Object.assign(game.board.vertices[road.a], { owner: "a", building: "settlement" });
  for (const seed of ["constant", ...Array.from({ length: 24 }, (_, index) => `busy-island-${index}`)]) {
    const queue = new AmbientSchedule(seed === "constant" ? () => 0 : ambientRandom(seed));
    const random = ambientRandom(`${seed}-routes`); const seen = new Set();
    let firstWalker; let firstWalkDuration;
    for (let now = 0; now <= 180_000; now += 800) {
      const scenes = queue.tick(now, { ...state, mobile: true }, (kind) => createAmbientScene(kind, game, bounds, random));
      assert.ok(scenes.filter((scene) => scene.kind !== "wind").length <= 2);
      for (const scene of scenes) {
        seen.add(scene.kind);
        if (scene.kind === "pedestrian" && firstWalker === undefined) { firstWalker = scene.startedAt; firstWalkDuration = scene.duration; }
      }
    }
    assert.ok(firstWalker <= 10_000, `${seed}: a confirmed road must have a visible early walker.`);
    assert.ok(firstWalkDuration >= 7000, "Even one road leaves time to notice the figure.");
    assert.deepEqual([...seen].sort(), Object.keys(AMBIENT_INTERVALS).sort(), `${seed}: birds cannot starve another kind indefinitely.`);
  }
});

test("game actions preserve waiting order, and a long walk gets a quiet interval before returning", () => {
  const queue = new AmbientSchedule(() => 0);
  const details = { path: [{ x: 0, y: 0 }, { x: 800, y: 0 }], pathKind: "polyline" };
  const create = (kind) => kind === "pedestrian" ? details : { point: { x: 0, y: 0 } };
  queue.tick(0, { ...state, mobile: true }, create);
  assert.deepEqual(queue.tick(10_000, { ...state, mobile: true, blocked: true }, create), []);
  const resumed = queue.tick(10_800, { ...state, mobile: true }, create);
  const walker = resumed.find((scene) => scene.kind === "pedestrian");
  assert.ok(walker, "Temporary action priority must not move a waiting walker behind birds.");
  const end = walker.startedAt + walker.duration;
  for (let now = 11_600; now < end; now += 800) queue.tick(now, { ...state, mobile: true }, create);
  const after = queue.tick(end, { ...state, mobile: true }, create);
  assert.equal(after.some((scene) => scene.kind === "pedestrian"), false, "A long route cannot replay immediately at its final junction.");
  for (let now = end + 800; now < end + AMBIENT_INTERVALS.pedestrian[0]; now += 800) {
    assert.equal(queue.tick(now, { ...state, mobile: true }, create).some((scene) => scene.kind === "pedestrian"), false);
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
  assert.deepEqual(queue.tick(1_000_999, state, create), []);
  assert.equal(queue.tick(1_001_000, state, create)[0].kind, "sheep");
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

test("camera navigation leaves no scenery timer or SVG paint, resumes once and respects suspension and unmount", (t) => {
  const slots = []; const timers = new Map(); const frames = new Map(); const listeners = new Map(); const attributes = new Map();
  let cursor = 0; let dirty = false; let layouts = []; let effects = []; let sequence = 0; let now = 0; let writes = 0; let scenes = [];
  const svg = { setAttribute: (name, value) => attributes.set(name, value), getAttribute: (name) => attributes.get(name), querySelector: () => null, closest: () => null };
  const body = { setAttribute: () => { writes++; } };
  const layer = { ownerSVGElement: svg, querySelectorAll: () => scenes.map((scene) => ({
    getAttribute: () => scene.id, setAttribute: () => { writes++; }, querySelector: () => body,
    classList: { toggle: () => { writes++; } }, style: {},
  })) };
  const media = new Map();
  const matchMedia = (query) => {
    if (!media.has(query)) media.set(query, {
      matches: query.includes("max-width"), listeners: new Set(),
      addEventListener(_name, callback) { this.listeners.add(callback); }, removeEventListener(_name, callback) { this.listeners.delete(callback); },
    });
    return media.get(query);
  };
  const document = {
    hidden: false, documentElement: { classList: { contains: () => false } },
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name) => listeners.delete(name),
  };
  const previous = Object.fromEntries(["window", "document", "requestAnimationFrame", "cancelAnimationFrame"].map((name) => [name, globalThis[name]]));
  globalThis.window = { matchMedia }; globalThis.document = document;
  globalThis.requestAnimationFrame = (callback) => { const id = ++sequence; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  t.mock.method(globalThis, "setTimeout", (callback) => { const id = ++sequence; timers.set(id, callback); return id; });
  t.mock.method(globalThis, "clearTimeout", (id) => timers.delete(id));
  t.mock.method(performance, "now", () => now);
  t.after(() => { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });
  t.mock.method(React, "useRef", (value) => { const id = cursor++; return slots[id] ??= { current: id === 0 ? layer : value }; });
  t.mock.method(React, "useState", (value) => {
    const id = cursor++; const slot = slots[id] ??= { value };
    return [slot.value, (next) => { slot.value = next; scenes = next; dirty = true; }];
  });
  const queueEffect = (effect, deps, queue) => {
    const id = cursor++; const slot = slots[id] ??= {};
    if (!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps[index]))) {
      slot.deps = deps; queue.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
    }
  };
  t.mock.method(React, "useLayoutEffect", (effect, deps) => queueEffect(effect, deps, layouts));
  t.mock.method(React, "useEffect", (effect, deps) => queueEffect(effect, deps, effects));
  let props = { game: makeGame("navigation"), artId: "navigation", viewBox: "-420 -370 840 740", active: true, interacting: false, enabled: true, previewKind: "gull" };
  const render = (next = {}) => {
    props = { ...props, ...next };
    do {
      dirty = false; cursor = 0; layouts = []; effects = [];
      CatanAmbientIsland(props);
      for (const effect of [...layouts, ...effects]) effect();
    } while (dirty);
  };
  const flush = () => { if (dirty) render(); };
  const paint = (time) => {
    now = time; const [id, callback] = frames.entries().next().value;
    frames.delete(id); callback(now);
  };
  render();
  assert.equal(scenes.length, 1); const firstScene = scenes[0].id;
  assert.equal(timers.size, 1); assert.equal(frames.size, 1);
  paint(1000); assert.ok(writes > 0, "An available island really paints the active scene.");
  const originalTimer = [...timers.keys()];
  for (let offset = 1; offset <= 30; offset++) render({ viewBox: `${-420 + offset} -370 840 740` });
  assert.deepEqual([...timers.keys()], originalTimer, "Camera bounds alone cannot continually clear and recreate the shared scheduler timer.");
  const queuedPaint = frames.values().next().value;
  render({ interacting: true });
  assert.equal(timers.size, 0); assert.equal(frames.size, 0); assert.equal(attributes.get("data-catan-ambient-active"), "false");
  const frozenWrites = writes;
  now = 1500; queuedPaint(now);
  for (let offset = 31; offset <= 90; offset++) render({ viewBox: `${-420 + offset} -370 840 740` });
  assert.equal(writes, frozenWrites, "Even an already queued frame must not mutate SVG presentation during a gesture.");
  assert.equal(timers.size, 0); assert.equal(frames.size, 0); assert.equal(scenes[0].id, firstScene);
  render({ interacting: false });
  assert.equal(timers.size, 1); assert.equal(frames.size, 1); assert.equal(scenes[0].id, firstScene, "Short navigation preserves the current scenery.");
  paint(2000); assert.ok(writes > frozenWrites);

  render({ interacting: true }); now = 30_000;
  render({ interacting: false, viewBox: "-30 -30 60 60", previewKind: "dolphin" });
  assert.equal(scenes.some((scene) => scene.id === firstScene), false, "Scenery that elapsed during a long gesture does not flash back on screen.");
  assert.equal(scenes.some((scene) => scene.kind === "dolphin"), false, "A preview after navigation uses the final inland bounds.");
  assert.equal(timers.size, 1);
  document.hidden = true; listeners.get("visibilitychange")(); flush();
  assert.deepEqual(scenes, []); assert.equal(timers.size, 0); assert.equal(frames.size, 0);
  now = 1_000_000; document.hidden = false; listeners.get("visibilitychange")(); flush();
  assert.deepEqual(scenes, [], "Returning from a hidden tab starts fresh without replaying the elapsed schedule.");
  assert.equal(timers.size, 1);
  const reduced = media.get("(prefers-reduced-motion: reduce)");
  reduced.matches = true; for (const callback of reduced.listeners) callback(); flush();
  assert.equal(timers.size, 0); assert.equal(frames.size, 0);
  reduced.matches = false; for (const callback of reduced.listeners) callback(); flush();
  render({ enabled: false, previewKind: undefined }); assert.equal(timers.size, 0); assert.equal(frames.size, 0);
  render({ enabled: true, previewKind: "gull", viewBox: "-420 -370 840 740" });
  assert.equal(timers.size, 1); assert.equal(frames.size, 1);
  const lateTimer = timers.values().next().value; const latePaint = frames.values().next().value;
  for (const slot of slots) slot.cleanup?.();
  assert.equal(timers.size, 0); assert.equal(frames.size, 0); assert.equal(listeners.size, 0);
  assert.ok([...media.values()].every((query) => query.listeners.size === 0));
  const unmountedWrites = writes; lateTimer(); latePaint(1_000_100);
  assert.equal(timers.size, 0); assert.equal(frames.size, 0); assert.equal(writes, unmountedWrites, "Callbacks retained by the browser cannot restart a disposed island.");
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
  assert.match(markup, /href="\/catan\/wildlife-atlas-v1\.png" width="400" height="400"/);
  assert.match(markup, /href="\/catan\/field-forest-wildlife-v1\.png" width="400" height="400"/);
  assert.match(markup, /viewBox="0 200 100 100"/);
  assert.equal((markup.match(/catan-ambient-standing-sheep/g) ?? []).length, 16);
  const fallback = renderToStaticMarkup(createElement("svg", null, createElement(CatanAmbientIsland, { ...props, cleanPasture: false })));
  assert.doesNotMatch(fallback, /catan-ambient-standing-sheep/);
  assert.ok(Object.entries(AMBIENT_INTERVALS).every(([kind, [minimum, maximum]]) => minimum >= 6000 && maximum >= minimum && AMBIENT_FIRST_INTERVALS[kind][1] <= minimum));
});
