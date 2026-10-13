import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-atmosphere-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({ stdin: { contents: 'export * from "./lib/catan-atmosphere"; export * from "./lib/catan-ambient"; export * from "./lib/catan-camera"; export * from "./lib/catan-harbor"; export { createBoard } from "./lib/catan";', resolveDir: root, loader: "ts" }, absWorkingDir: root, bundle: true, platform: "node", format: "cjs", outfile: output, logLevel: "silent" });
after(() => rm(output, { force: true }));
const require = createRequire(import.meta.url);
const {
  AtmosphereClock, createAtmosphere, atmosphereCloudFrame, atmosphereSurfOpacity, atmosphereFogFrame, preloadAtmosphereArtwork, ATMOSPHERE_CLOUD_OPACITY,
  createBoard, ambientRandom, ambientPathPoint, ambientBounds, ambientSeaRectangle, ambientHarborExclusions, segmentDistance, pointInPolygon,
  ambientSailboatPosition, ambientSailboatRectangle, validSailboatPath, ambientSailboatHeading, ambientShipWakeAnchor, createAmbientScene, ambientSceneValid,
  ambientPirateShipPosition, validPirateShipPath, AMBIENT_PIRATE_SHIP_SIZE, AMBIENT_PIRATE_SHIP_WAKE,
  AmbientSchedule, AMBIENT_INTERVALS, AMBIENT_FIRST_INTERVALS, AMBIENT_DURATIONS, AMBIENT_SAILBOAT_SIZE, AMBIENT_SAILBOAT_WAKE,
  fitCamera, cameraMetrics, harborAmbientPoint, harborLayout, HARBOR_BOAT_CLEARANCE,
} = require(output);
const bounds = { x: -420, y: -370, width: 840, height: 740 };
const makeGame = () => { const board = createBoard(() => 0); return { id: "atmosphere", board, robberHex: board.hexes.find((hex) => hex.resource === "desert").id }; };
const fittedBoardBounds = (board) => {
  const extents = [...board.vertices, ...board.harbors.flatMap((harbor) => {
    const label = harborAmbientPoint(board, harbor.edge); const boat = harborLayout(board, harbor.edge).boat;
    return [{ x: label.x - 23, y: label.y - 20 }, { x: label.x + 23, y: label.y + 20 }, { x: boat.x - HARBOR_BOAT_CLEARANCE, y: boat.y - HARBOR_BOAT_CLEARANCE }, { x: boat.x + HARBOR_BOAT_CLEARANCE, y: boat.y + HARBOR_BOAT_CLEARANCE }];
  })];
  const x = Math.min(...extents.map((point) => point.x)) - 32; const y = Math.min(...extents.map((point) => point.y)) - 32;
  return { x, y, width: Math.max(...extents.map((point) => point.x)) - x + 32, height: Math.max(...extents.map((point) => point.y)) - y + 32 };
};

test("the atmosphere clock accumulates only active time and resumes without a hidden-tab or gesture jump", () => {
  const clock = new AtmosphereClock();
  assert.equal(clock.sample(10, true), 0);
  assert.equal(clock.sample(110, true), 100);
  assert.equal(clock.sample(160, false), 150);
  assert.equal(clock.sample(1_000_000, false), 150);
  assert.equal(clock.sample(1_000_010, true), 150);
  assert.equal(clock.sample(1_000_110, true), 250);
  clock.pause();
  assert.equal(clock.elapsed, 250);
  assert.equal(clock.sample(5_000_000, true), 250);
  assert.equal(clock.sample(5_000_100, true), 350);
  assert.equal(clock.sample(5_000_050, true), 350, "A backward timestamp cannot rewind the clock or count time twice.");
  assert.equal(clock.sample(5_000_200, true), 450);
  assert.equal(clock.sample(Number.NaN, true), 450);
  assert.equal(clock.sample(8_000_000, true), 450);
});

test("cloud routes and local phases remain stable across public transport snapshots", () => {
  const game = makeGame(); const original = createAtmosphere(game.board, bounds, game.id);
  assert.equal(original.clouds.length, 2); assert.ok(original.surf.length <= 2);
  for (const cloud of original.clouds) {
    assert.ok(cloud.duration >= 70_000 && cloud.duration <= 110_000);
    assert.ok(cloud.width >= 150 && cloud.width <= 210);
    assert.ok(cloud.phase >= (cloud.variant ? .70 : .42) && cloud.phase <= (cloud.variant ? .78 : .50));
    assert.ok(cloud.path[0].x < bounds.x && cloud.path[1].x > bounds.x + bounds.width);
    assert.ok(cloud.path[0].y > cloud.path[1].y, "Clouds drift from lower left to upper right.");
  }
  const snapshot = structuredClone(game.board); snapshot.vertices[0].owner = "player"; snapshot.hexes[0].resource = "grain";
  assert.deepEqual(createAtmosphere(snapshot, bounds, game.id), original);
  assert.notDeepEqual(createAtmosphere(snapshot, bounds, "another-island").clouds, original.clouds);
});

test("clouds keep their world phase when resizing or zooming and fade fully before wrapping", () => {
  const cloud = { ...createAtmosphere(makeGame().board, bounds, "sizes").clouds[0], phase: 0 };
  const position = atmosphereCloudFrame(cloud, cloud.duration * .4, .5, true).point;
  for (const mobile of [false, true]) for (const scale of [.1, .3, .7, 1, 2, 6]) {
    const frame = atmosphereCloudFrame(cloud, cloud.duration * .4, scale, mobile);
    assert.deepEqual(frame.point, position);
    assert.ok(frame.width * scale >= (mobile ? 60 : 90) - 1e-7);
    assert.ok(frame.width * scale <= (mobile ? 140 : 220) + 1e-7);
    assert.equal(frame.opacity, ATMOSPHERE_CLOUD_OPACITY);
  }
  assert.equal(atmosphereCloudFrame(cloud, 0, 1, false).opacity, 0);
  assert.equal(atmosphereCloudFrame(cloud, cloud.duration, 1, false).opacity, 0);
  assert.ok(atmosphereCloudFrame(cloud, cloud.duration - 1, 1, false).opacity < 1e-6);
  assert.ok(Number.isFinite(atmosphereCloudFrame(cloud, 0, Number.NaN, false).width));
});

test("the mobile cloud passes through the fitted centre viewport and is visible at initial strong zoom", () => {
  const game = makeGame(); const boardBounds = fittedBoardBounds(game.board);
  for (const size of [{ width: 320, height: 568 }, { width: 360, height: 300 }, { width: 360, height: 680 }, { width: 390, height: 844 }]) {
    const metrics = cameraMetrics(boardBounds, size, { ...fitCamera(boardBounds), zoom: 6 });
    const visible = ambientBounds(metrics.viewBox);
    for (let seed = 0; seed < 20; seed++) {
      const cloud = createAtmosphere(game.board, boardBounds, `centre-${seed}`).clouds[0];
      assert.ok(cloud.path[0].y >= boardBounds.y + boardBounds.height / 2 && cloud.path[1].y < boardBounds.y + boardBounds.height / 2, "The only mobile cloud has a route through the centre viewport rather than permanently offshore.");
      const frame = atmosphereCloudFrame(cloud, 0, metrics.scale, true);
      const halfWidth = frame.width / 2; const halfHeight = frame.width * .2;
      assert.ok(frame.opacity > 0);
      assert.ok(frame.point.x + halfWidth >= visible.x && frame.point.x - halfWidth <= visible.x + visible.width && frame.point.y + halfHeight >= visible.y && frame.point.y - halfHeight <= visible.y + visible.height, `${size.width}×${size.height}: the initial complete cloud viewport intersects the actual zoomed map.`);
    }
  }
});

test("surf strokes are bounded coastal segments beyond harbor exclusion envelopes", () => {
  const game = makeGame(); const scene = createAtmosphere(game.board, bounds, "surf");
  assert.equal(scene.surf.length, 2);
  for (const surf of scene.surf) {
    assert.equal(game.board.edges[surf.edgeId].hexes.length, 1);
    assert.equal(game.board.harbors.some((harbor) => harbor.edge === surf.edgeId), false);
    assert.ok(surf.duration >= 8000 && surf.duration <= 12_000);
    assert.ok(Math.abs(Math.hypot(surf.outward.x, surf.outward.y) - 1) < 1e-8);
    assert.ok(ambientHarborExclusions(game.board).every((harbor) => segmentDistance(harbor.point, surf.from, surf.to) >= harbor.radius + 5));
    for (let step = 0; step <= 20; step++) {
      const point = ambientPathPoint([surf.from, surf.to], step / 20, "polyline");
      assert.ok(game.board.hexes.every((hex) => !pointInPolygon(point, hex.vertices.map((id) => game.board.vertices[id]))));
      const opacity = atmosphereSurfOpacity(surf, step * 1000);
      assert.ok(opacity >= .08 && opacity <= .4);
    }
  }
});

test("fog stays wholly in safe sea through its full motion and has a quiet interval", () => {
  const game = makeGame(); const fog = createAtmosphere(game.board, bounds, "fog").fog;
  assert.ok(fog);
  assert.ok(fog.visibleDuration >= 25_000 && fog.visibleDuration <= 40_000);
  assert.ok(fog.duration - fog.visibleDuration >= 120_000 && fog.duration - fog.visibleDuration <= 180_000);
  assert.equal(atmosphereFogFrame(fog, 0).opacity, 0, "The production fog begins in its quiet interval.");
  let visible = false; let quiet = false;
  for (let step = 0; step <= 200; step++) {
    const frame = atmosphereFogFrame(fog, step / 200 * fog.duration);
    assert.equal(ambientSeaRectangle(game.board, bounds, { x: frame.point.x - frame.width / 2, y: frame.point.y - frame.height / 2, width: frame.width, height: frame.height }, 18), true);
    visible ||= frame.opacity > .1; quiet ||= frame.opacity === 0;
  }
  assert.equal(visible, true); assert.equal(quiet, true);
  assert.equal(atmosphereFogFrame(fog, 0, true).opacity, .11);
  assert.notDeepEqual(atmosphereFogFrame(fog, 0, true).point, atmosphereFogFrame(fog, fog.duration * .12, true).point, "Preview visibility keeps the same slow moving route.");
  for (let elapsed = fog.visibleDuration; elapsed < fog.duration; elapsed += 1000) assert.equal(atmosphereFogFrame({ ...fog, phase: 0 }, elapsed).opacity, 0);
  const fitted = createAtmosphere(game.board, fittedBoardBounds(game.board), "fitted-fog");
  assert.ok(fitted.fog, "The actual fitted island has space for one coastal fog patch.");
  assert.equal(createAtmosphere(game.board, { x: -30, y: -30, width: 60, height: 60 }, "inland").fog, null);
});

test("new artwork preloads independently and late callbacks cannot revive disposed artwork", () => {
  const images = []; const events = [];
  const dispose = preloadAtmosphereArtwork((asset, ready) => events.push([asset, ready]), () => { const image = { src: "", onload: null, onerror: null }; images.push(image); return image; });
  assert.deepEqual(images.map((image) => image.src), ["/catan/clouds-atlas-v1.png", "/catan/sailboats-directions-v1.png", "/catan/pirate-ships-directions-v1.png"]);
  images[0].onerror(); images[1].onload(); images[2].onerror();
  assert.deepEqual(events, [["clouds", false], ["sailboat", true], ["pirate_ship", false]]);
  const lateLoad = images[0].onload; const lateError = images[1].onerror;
  dispose(); lateLoad(); lateError();
  assert.deepEqual(events, [["clouds", false], ["sailboat", true], ["pirate_ship", false]]);
  assert.ok(images.every((image) => image.onload === null && image.onerror === null));
});

test("the pirate ship is twice the sailboat size and protects its full hull, bob and doubled wake in every direction", () => {
  assert.equal(AMBIENT_PIRATE_SHIP_SIZE, AMBIENT_SAILBOAT_SIZE * 2);
  assert.equal(AMBIENT_PIRATE_SHIP_WAKE, AMBIENT_SAILBOAT_WAKE * 2);
  const board = { vertices: [{ x: -100, y: 0 }, { x: 100, y: 0 }], edges: [{ a: 0, b: 1, hexes: [0] }], hexes: [], harbors: [] };
  assert.equal(ambientPirateShipPosition(board, bounds, { x: 0, y: 56 }, 0), false);
  assert.equal(ambientPirateShipPosition(board, bounds, { x: 0, y: 60 }, 0), true);
  assert.equal(ambientPirateShipPosition(board, bounds, { x: bounds.x + 60, y: 120 }, 0), false, "The large hull can fit while its longer wake still leaves the viewport.");
  for (let heading = 0; heading < 6; heading++) {
    const point = { x: 0, y: 140 }; const rectangle = ambientSailboatRectangle(point, heading, 88, 32);
    assert.ok(rectangle.x <= point.x - 44 + 1e-7 && rectangle.x + rectangle.width >= point.x + 44 - 1e-7);
    assert.ok(rectangle.y <= point.y - 46 + 1e-7 && rectangle.y + rectangle.height >= point.y + 46 - 1e-7);
    const anchor = ambientShipWakeAnchor(heading, 88);
    for (let index = 0; index < 3; index++) {
      const side = index - 1; const to = 32 - index * 6;
      const x = point.x + anchor.x - Math.cos(heading * Math.PI / 3) * to - Math.sin(heading * Math.PI / 3) * side * 12;
      const y = point.y + anchor.y - Math.sin(heading * Math.PI / 3) * to + Math.cos(heading * Math.PI / 3) * side * 12;
      assert.ok(x - 2 >= rectangle.x - 1e-7 && x + 2 <= rectangle.x + rectangle.width + 1e-7);
      assert.ok(y - 4 >= rectangle.y - 1e-7 && y + 4 <= rectangle.y + rectangle.height + 1e-7);
    }
  }
});

test("ship wakes attach to the painted stern and protect all fanned curve controls and ends", () => {
  const ships = [
    { size: 44, wake: 16, anchors: [[23, 69], [31, 49], [73, 49], [81, 67], [69, 72], [30, 74]] },
    { size: 88, wake: 32, anchors: [[22, 75], [24, 62], [80, 62], [82, 74], [70, 77], [27, 77]] },
  ];
  for (const ship of ships) for (let heading = 0; heading < 6; heading++) {
    const anchor = ambientShipWakeAnchor(heading, ship.size); const expected = ship.anchors[heading];
    assert.deepEqual(anchor, { x: (expected[0] / 100 - .5) * ship.size, y: (expected[1] / 100 - .5) * ship.size });
    assert.ok(anchor.y > -2, "The attachment follows the painted lower hull, not the empty image centre above it.");
    const rectangle = ambientSailboatRectangle({ x: 0, y: 0 }, heading, ship.size, ship.wake);
    const dx = Math.cos(heading * Math.PI / 3); const dy = Math.sin(heading * Math.PI / 3); const ratio = ship.size / 44;
    for (let index = 0; index < 3; index++) {
      const side = index - 1; const from = index * 3 * ratio; const to = ship.wake - index * 3 * ratio;
      for (const [travel, fan] of [[from, 2 * ratio], [(from + to) / 2, 4 * ratio], [to, 6 * ratio]]) {
        const point = { x: anchor.x - dx * travel - dy * side * fan, y: anchor.y - dy * travel + dx * side * fan };
        assert.ok(point.x - ratio >= rectangle.x - 1e-7 && point.x + ratio <= rectangle.x + rectangle.width + 1e-7);
        assert.ok(point.y - ratio - 2 >= rectangle.y - 1e-7 && point.y + ratio + 2 <= rectangle.y + rectangle.height + 1e-7);
      }
    }
  }
});

test("pirates use longer safe sea routes when space permits and skip narrow inland views", (t) => {
  const game = makeGame(); const boardBounds = fittedBoardBounds(game.board); let total = 0; const headings = new Set();
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1100, height: 650 }, { width: 1440, height: 900 }]) {
    const visible = ambientBounds(cameraMetrics(boardBounds, size, fitCamera(boardBounds)).viewBox); let found = 0;
    for (let seed = 0; seed < 20; seed++) {
      const scene = createAmbientScene("pirate_ship", game, visible, ambientRandom(`pirate-${seed}`));
      if (!scene) continue;
      found++; total++; headings.add(scene.heading);
      assert.equal(validPirateShipPath(game.board, visible, scene.path, scene.heading), true);
      assert.equal(ambientSailboatHeading(scene.path), scene.heading);
      const length = Math.hypot(scene.path[1].x - scene.path[0].x, scene.path[1].y - scene.path[0].y);
      assert.ok(length >= 80 - 1e-7 && length <= 240 + 1e-7);
      for (let step = 0; step <= 200; step++) assert.equal(ambientPirateShipPosition(game.board, visible, ambientPathPoint(scene.path, step / 200, "polyline"), scene.heading), true);
    }
    t.diagnostic(`${size.width}×${size.height}: ${found}/20 safe pirate routes; absent routes are intentionally skipped`);
  }
  assert.ok(total > 0, "The fitted overview has some safe visible water for the large ship.");
  const wide = createAmbientScene("pirate_ship", game, { x: -600, y: -600, width: 1200, height: 1200 }, () => 0);
  assert.ok(wide); assert.ok(Math.hypot(wide.path[1].x - wide.path[0].x, wide.path[1].y - wide.path[0].y) >= 160);
  assert.equal(createAmbientScene("pirate_ship", game, { x: -30, y: -30, width: 60, height: 60 }, () => 0), null);
  assert.ok(headings.size > 1, "Available routes include different prepainted headings.");
});

test("pirates share the sea actor exclusion and ordinary scene cap with sailing boats and dolphins", () => {
  assert.deepEqual(AMBIENT_INTERVALS.pirate_ship, [150_000, 240_000]);
  assert.deepEqual(AMBIENT_FIRST_INTERVALS.pirate_ship, [45_000, 70_000]);
  assert.equal(AMBIENT_DURATIONS.pirate_ship, 40_000);
  for (const mobile of [false, true]) {
    const queue = new AmbientSchedule(() => 0); const seen = new Set(); const ids = new Set(); const starts = new Map();
    const seaActors = ["sailboat", "pirate_ship", "dolphin"];
    const create = (kind) => seaActors.includes(kind) || kind === "sheep" ? { point: { x: 0, y: 0 } } : null;
    for (let now = 0; now <= 600_000; now += 800) {
      const scenes = queue.tick(now, { available: true, blocked: false, mobile }, create);
      assert.ok(scenes.length <= (mobile ? 2 : 3));
      assert.ok(scenes.filter((scene) => seaActors.includes(scene.kind)).length <= 1);
      for (const scene of scenes) if (!ids.has(scene.id)) {
        ids.add(scene.id); seen.add(scene.kind);
        const previous = starts.get(scene.kind);
        if (previous !== undefined) assert.ok(scene.startedAt - previous >= AMBIENT_INTERVALS[scene.kind][0]);
        starts.set(scene.kind, scene.startedAt);
      }
    }
    assert.deepEqual([...seen].sort(), [...seaActors, "sheep"].sort());
  }
});

test("sailboats protect the full square, bob and trailing wake in all six atlas headings", () => {
  assert.equal(AMBIENT_SAILBOAT_SIZE, 44); assert.equal(AMBIENT_SAILBOAT_WAKE, 16);
  const board = { vertices: [{ x: -100, y: 0 }, { x: 100, y: 0 }], edges: [{ a: 0, b: 1, hexes: [0] }], hexes: [], harbors: [] };
  assert.equal(ambientSailboatPosition(board, bounds, { x: 0, y: 35 }, 0), false, "Bob and coast reserve protect the complete hull.");
  assert.equal(ambientSailboatPosition(board, bounds, { x: 0, y: 38 }, 0), true);
  for (let heading = 0; heading < 6; heading++) {
    const point = { x: 0, y: 100 }; const rectangle = ambientSailboatRectangle(point, heading);
    assert.ok(rectangle.x <= point.x - 22 + 1e-7 && rectangle.x + rectangle.width >= point.x + 22 - 1e-7);
    assert.ok(rectangle.y <= point.y - 24 + 1e-7 && rectangle.y + rectangle.height >= point.y + 24 - 1e-7);
    const anchor = ambientShipWakeAnchor(heading, 44);
    const end = { x: point.x + anchor.x - Math.cos(heading * Math.PI / 3) * 16, y: point.y + anchor.y - Math.sin(heading * Math.PI / 3) * 16 };
    assert.ok(end.x - 4 >= rectangle.x - 1e-7 && end.x + 4 <= rectangle.x + rectangle.width + 1e-7);
    assert.ok(end.y - 6 >= rectangle.y - 1e-7 && end.y + 6 <= rectangle.y + rectangle.height + 1e-7);
    for (let index = 0; index < 3; index++) {
      const side = index - 1; const to = 16 - index * 3;
      const x = point.x + anchor.x - Math.cos(heading * Math.PI / 3) * to - Math.sin(heading * Math.PI / 3) * side * 6;
      const y = point.y + anchor.y - Math.sin(heading * Math.PI / 3) * to + Math.cos(heading * Math.PI / 3) * side * 6;
      assert.ok(x - 1 >= rectangle.x - 1e-7 && x + 1 <= rectangle.x + rectangle.width + 1e-7);
      assert.ok(y - 3 >= rectangle.y - 1e-7 && y + 3 <= rectangle.y + rectangle.height + 1e-7, "The visible fanned wake, its stroke and bob remain in the protected envelope.");
    }
  }
  assert.equal(ambientSailboatPosition(board, bounds, { x: bounds.x + 30, y: 100 }, 0), false, "A hull that fits can still have a clipped wake.");
});

test("safe sailing paths survive fitted mobile bounds and decline an inland view", (t) => {
  const game = makeGame();
  const boardBounds = fittedBoardBounds(game.board);
  for (const size of [{ width: 360, height: 300 }, { width: 360, height: 680 }, { width: 1100, height: 650 }, { width: 1440, height: 900 }]) {
    const visible = ambientBounds(cameraMetrics(boardBounds, size, fitCamera(boardBounds)).viewBox);
    let found = 0;
    for (let seed = 0; seed < 20; seed++) {
      const scene = createAmbientScene("sailboat", game, visible, ambientRandom(`boat-${seed}`));
      if (!scene) continue;
      found++;
      assert.equal(ambientSailboatHeading(scene.path), scene.heading);
      assert.equal(validSailboatPath(game.board, visible, scene.path, scene.heading), true);
      for (let step = 0; step <= 200; step++) assert.equal(ambientSailboatPosition(game.board, visible, ambientPathPoint(scene.path, step / 200, "polyline"), scene.heading), true);
    }
    t.diagnostic(`${size.width}×${size.height}: ${found}/20 safe sailing routes`);
    assert.equal(found, 20);
    assert.ok(createAmbientScene("gull", game, visible, () => 0), "The fitted view also leaves a longer route for the complete coastal flock.");
  }
  assert.equal(createAmbientScene("sailboat", game, { x: -30, y: -30, width: 60, height: 60 }, () => 0), null);
});

test("flocks travel a longer coast route and dust remains inside its unblocked desert", () => {
  const game = makeGame(); const flock = createAmbientScene("gull", game, bounds, () => 0);
  assert.ok(flock); assert.ok(Math.hypot(flock.path.at(-1).x - flock.path[0].x, flock.path.at(-1).y - flock.path[0].y) >= 100);
  assert.equal(AMBIENT_DURATIONS.gull, 18_000);
  assert.equal(createAmbientScene("desert_dust", game, bounds, () => 0), null);
  const desert = game.board.hexes[game.robberHex]; game.robberHex = (desert.id + 1) % game.board.hexes.length;
  const dust = createAmbientScene("desert_dust", game, bounds, () => 0);
  assert.ok(dust); assert.equal(dust.hexId, desert.id);
  const polygon = desert.vertices.map((id) => game.board.vertices[id]);
  for (let step = 0; step <= 20; step++) {
    const point = ambientPathPoint(dust.path, step / 20, "polyline");
    for (const dx of [-15, 15]) for (const dy of [-5, 5]) assert.equal(pointInPolygon({ x: point.x + dx, y: point.y + dy }, polygon), true);
  }
  assert.equal(ambientSceneValid({ ...dust, kind: "desert_dust" }, game), true);
  game.robberHex = desert.id; assert.equal(ambientSceneValid({ ...dust, kind: "desert_dust" }, game), false);
});

test("rare sea and dust scenes obey the shared cap, sea exclusion, quiet repeats and queue fairness", () => {
  assert.deepEqual(AMBIENT_INTERVALS.sailboat, [90_000, 150_000]);
  assert.deepEqual(AMBIENT_FIRST_INTERVALS.sailboat, [30_000, 50_000]);
  assert.deepEqual(AMBIENT_INTERVALS.desert_dust, [60_000, 100_000]);
  assert.deepEqual(AMBIENT_FIRST_INTERVALS.desert_dust, [20_000, 35_000]);
  for (const mobile of [false, true]) {
    const queue = new AmbientSchedule(() => 0); const seen = new Set(); const ids = new Set(); const starts = new Map();
    const create = (kind) => ["sailboat", "dolphin", "desert_dust", "gull"].includes(kind) ? { point: { x: 0, y: 0 } } : null;
    for (let now = 0; now <= 360_000; now += 800) {
      const scenes = queue.tick(now, { available: true, blocked: false, mobile }, create);
      assert.ok(scenes.length <= (mobile ? 2 : 3));
      assert.ok(scenes.filter((scene) => scene.kind === "dolphin" || scene.kind === "sailboat").length <= 1);
      for (const scene of scenes) if (!ids.has(scene.id)) {
        ids.add(scene.id); seen.add(scene.kind);
        const previous = starts.get(scene.kind);
        if (previous !== undefined) assert.ok(scene.startedAt - previous >= AMBIENT_INTERVALS[scene.kind][0]);
        starts.set(scene.kind, scene.startedAt);
      }
    }
    assert.deepEqual([...seen].sort(), ["desert_dust", "dolphin", "gull", "sailboat"]);
  }
});
