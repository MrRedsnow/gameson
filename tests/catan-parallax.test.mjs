import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-parallax-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export * from "./lib/catan-parallax"; export * from "./lib/catan-camera";', resolveDir: root, loader: "ts" },
  absWorkingDir: root, bundle: true, platform: "node", format: "cjs", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { seaParallax, fitCamera, cameraMetrics, constrainCamera, panCamera, BoardGestureController } = createRequire(import.meta.url)(output);

const bounds = { x: -400, y: -300, width: 800, height: 600 };
const size = { width: 400, height: 300 };
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message ?? "Wert"}: ${actual} statt ${expected}`);

// These are the rendered image edges, independent of how the helper computes its offsets.
function coversViewport(sea, viewport, context = "Meer") {
  for (const value of [sea.size, sea.x, sea.y]) assert.ok(Number.isFinite(value), `${context}: endliche Darstellung`);
  const left = (viewport.width - sea.size) / 2 + sea.x;
  const top = (viewport.height - sea.size) / 2 + sea.y;
  assert.ok(left <= 1e-8, `${context}: linker Rand ${left}`);
  assert.ok(top <= 1e-8, `${context}: oberer Rand ${top}`);
  assert.ok(left + sea.size >= viewport.width - 1e-8, `${context}: rechter Rand`);
  assert.ok(top + sea.size >= viewport.height - 1e-8, `${context}: unterer Rand`);
}

test("Reset bewahrt das zentrierte Cover-Bild in jedem Bildschirmformat", () => {
  const board = { x: 120, y: -240, width: 760, height: 640 };
  for (const viewport of [size, { width: 360, height: 640 }, { width: 1280, height: 720 }, { width: 1, height: 1 }]) {
    const expected = { size: Math.max(viewport.width, viewport.height), x: 0, y: 0 };
    assert.deepEqual(seaParallax(board, viewport, fitCamera(board)), expected);
    assert.deepEqual(seaParallax(board, viewport, { x: 1e6, y: -1e6, zoom: 1 }), expected, "Auch ein versetzter Reset bleibt zentriert.");
  }
});

test("Meerzoom wächst stetig und bleibt bei maximal einem Sechstel zusätzlicher Bildgröße", () => {
  let previous = size.width;
  for (const zoom of [1, 1.0001, 1.35, 2, 4, 6, 1000]) {
    const sea = seaParallax(bounds, size, { ...fitCamera(bounds), zoom });
    assert.ok(sea.size >= previous);
    assert.ok(sea.size <= size.width * (1 + 1 / 6) + 1e-8);
    near(sea.x, 0); near(sea.y, 0);
    coversViewport(sea, size);
    previous = sea.size;
  }
  near(seaParallax(bounds, size, { x: 0, y: 0, zoom: 6 }).size, size.width * (1 + 1 / 6));
  assert.deepEqual(seaParallax(bounds, size, { x: 0, y: 0, zoom: 1000 }), seaParallax(bounds, size, { x: 0, y: 0, zoom: 6 }));
});

test("Verschieben bewegt das Meer in Fingerrichtung mit zwanzig Prozent geteilt durch den Zoom", () => {
  const drag = { x: 24, y: -18 };
  for (const zoom of [1.35, 2, 4, 6]) {
    const camera = { ...fitCamera(bounds), zoom };
    const before = seaParallax(bounds, size, camera);
    const afterCamera = panCamera(camera, bounds, size, drag.x, drag.y);
    const after = seaParallax(bounds, size, afterCamera);
    assert.ok(after.x > before.x, "Meer folgt dem Zug nach rechts.");
    assert.ok(after.y < before.y, "Meer folgt dem Zug nach oben.");
    near(after.x - before.x, drag.x * 0.20 / zoom, "Langsame horizontale Bewegung");
    near(after.y - before.y, drag.y * 0.20 / zoom, "Langsame vertikale Bewegung");
    near(after.size, before.size, "Pan ändert die Meergröße nicht");
    coversViewport(after, size);
  }
});

test("Ungültige Viewportachsen erhalten eine endliche Darstellung mit einem Pixel Ersatzgröße", () => {
  const camera = { x: 80, y: -40, zoom: 3 };
  for (const [viewport, fallback] of [
    [{ width: 0, height: 0 }, { width: 1, height: 1 }],
    [{ width: Number.NaN, height: Number.NaN }, { width: 1, height: 1 }],
    [{ width: -200, height: 360 }, { width: 1, height: 360 }],
    [{ width: Number.POSITIVE_INFINITY, height: 240 }, { width: 1, height: 240 }],
    [{ width: 320, height: Number.NEGATIVE_INFINITY }, { width: 320, height: 1 }],
    [{ width: 640, height: 0 }, { width: 640, height: 1 }],
  ]) {
    const sea = seaParallax(bounds, viewport, camera);
    assert.deepEqual(sea, seaParallax(bounds, fallback, camera));
    coversViewport(sea, fallback);
  }
});

test("Ungültige Kameraangaben werden wie die vorhandene Kartenkamera aufgelöst", () => {
  for (const camera of [
    { x: Number.NaN, y: Number.POSITIVE_INFINITY, zoom: 3 },
    { x: 1e9, y: -1e9, zoom: 2 },
    { x: 30, y: -30, zoom: Number.NaN },
    { x: 30, y: -30, zoom: Number.POSITIVE_INFINITY },
    { x: 30, y: -30, zoom: 0 },
    { x: 30, y: -30, zoom: -2 },
  ]) {
    const sea = seaParallax(bounds, size, camera);
    assert.deepEqual(sea, seaParallax(bounds, size, constrainCamera(camera, bounds, size)));
    coversViewport(sea, size);
  }
});

test("Alle Kameraecken und extremen Seitenverhältnisse behalten bedeckte Viewportkanten", () => {
  const boards = [
    bounds,
    { x: 1200, y: -1800, width: 1000, height: 700 },
    { x: -12, y: 200, width: 0.5, height: 1e6 },
    { x: 500, y: -40, width: 1e6, height: 0.5 },
  ];
  const viewports = [
    { width: 1, height: 1 }, { width: 0.25, height: 0.5 },
    { width: 360, height: 640 }, { width: 1280, height: 720 },
    { width: 10000, height: 1 }, { width: 1, height: 10000 },
    { width: 3840, height: 2160 },
  ];
  for (const board of boards) for (const viewport of viewports) for (const zoom of [1, 1.00001, 1.1, 2, 6, 1000]) {
    for (const x of [board.x - board.width, board.x + board.width * 2]) for (const y of [board.y - board.height, board.y + board.height * 2]) {
      const context = JSON.stringify({ board, viewport, x, y, zoom });
      const sea = seaParallax(board, viewport, { x, y, zoom });
      coversViewport(sea, viewport, context);
      assert.ok(sea.size <= Math.max(viewport.width, viewport.height) * (1 + 1 / 6) + 1e-8, `${context}: höchstens ein Sechstel Overscan`);
      for (const [offset, axis] of [[sea.x, viewport.width], [sea.y, viewport.height]]) {
        assert.ok(Math.abs(offset) <= Math.max(0, (sea.size - axis) / 2 - 1) + 1e-8, `${context}: Reserve gegen Rundungsränder`);
      }
    }
  }
});

test("Resize und Vollbild verwenden die sichtbare Kamera und die Rückkehr stellt das Meer wieder her", () => {
  const gesture = new BoardGestureController(bounds, size);
  gesture.setCamera({ x: 60, y: -40, zoom: 3 });
  const originalCamera = { ...gesture.camera };
  const originalSea = seaParallax(bounds, size, originalCamera);
  const originalScale = cameraMetrics(bounds, size, originalCamera).scale;
  const fullscreen = { width: 1200, height: 700 };
  gesture.updateViewport(bounds, fullscreen);
  near(cameraMetrics(bounds, fullscreen, gesture.camera).scale, originalScale);
  assert.notEqual(gesture.camera.zoom, originalCamera.zoom);
  const expandedSea = seaParallax(bounds, fullscreen, gesture.camera);
  coversViewport(expandedSea, fullscreen);
  assert.ok(expandedSea.size < seaParallax(bounds, fullscreen, originalCamera).size, "Meer folgt dem angepassten relativen Zoom statt einem veralteten Kamerawert.");

  const oversized = { width: 2400, height: 1800 };
  gesture.updateViewport(bounds, oversized);
  assert.deepEqual(gesture.camera, fitCamera(bounds));
  assert.deepEqual(seaParallax(bounds, oversized, gesture.camera), { size: 2400, x: 0, y: 0 });

  gesture.updateViewport(bounds, size);
  assert.deepEqual(gesture.camera, originalCamera);
  assert.deepEqual(seaParallax(bounds, size, gesture.camera), originalSea);
});

test("Die Darstellung verändert weder Kamera noch Grenzen oder Viewport", () => {
  const board = Object.freeze({ ...bounds }); const viewport = Object.freeze({ ...size });
  const camera = Object.freeze({ x: 60, y: -40, zoom: 3 });
  assert.doesNotThrow(() => seaParallax(board, viewport, camera));
  assert.deepEqual(board, bounds); assert.deepEqual(viewport, size);
  assert.deepEqual(camera, { x: 60, y: -40, zoom: 3 });
});
