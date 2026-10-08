import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

// Exercise the same controller used by the board with real pointer sequences.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-camera-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: ["lib/catan-camera.ts"], absWorkingDir: root,
  bundle: true, platform: "node", format: "cjs", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const {
  fitCamera, cameraMetrics, constrainCamera, panCamera, zoomCamera, transformCamera,
  BoardCameraFrameScheduler, BoardGestureController,
} = createRequire(import.meta.url)(output);
const bounds = { x: -400, y: -300, width: 800, height: 600 };
const size = { width: 400, height: 300 };
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message ?? "Wert"}: ${actual} statt ${expected}`);
const worldAt = (camera, point, viewport = size, board = bounds) => {
  const { scale } = cameraMetrics(board, viewport, camera);
  return { x: camera.x + (point.x - viewport.width / 2) / scale, y: camera.y + (point.y - viewport.height / 2) / scale };
};
const samePoint = (actual, expected) => { near(actual.x, expected.x, "x"); near(actual.y, expected.y, "y"); };
const controller = () => new BoardGestureController(bounds, size);
const down = (gesture, id, x, y) => gesture.pointerDown({ id, x, y });
const move = (gesture, id, x, y) => gesture.pointerMove({ id, x, y });

const frameQueue = () => {
  let id = 0;
  const callbacks = new Map();
  return {
    request: (callback) => { callbacks.set(++id, callback); return id; },
    cancel: (frame) => callbacks.delete(frame),
    get pending() { return callbacks.size; },
    paint: () => {
      const frame = [...callbacks.values()];
      callbacks.clear();
      for (const callback of frame) callback();
    },
  };
};

test("Schnelle Pan-Ereignisse zeichnen je Frame nur die letzte Kamera ohne Bewegungen zu verlieren", () => {
  const gesture = controller();
  gesture.setCamera({ x: 0, y: 0, zoom: 3 });
  const frames = frameQueue();
  const painted = [];
  const scheduler = new BoardCameraFrameScheduler(() => painted.push({ ...gesture.camera }), frames.request, frames.cancel);
  down(gesture, 1, 200, 150);
  for (let x = 201; x <= 270; x++) {
    move(gesture, 1, x, 150);
    scheduler.request();
  }
  assert.equal(frames.pending, 1, "70 Pointer-Ereignisse dürfen nur einen Frame planen.");
  assert.equal(painted.length, 0, "Der Pointer-Handler selbst baut das Board nicht neu auf.");
  frames.paint();
  assert.deepEqual(painted, [gesture.camera]);
  samePoint(worldAt(painted[0], { x: 270, y: 150 }), { x: 0, y: 0 });
  for (let x = 271; x <= 285; x++) {
    move(gesture, 1, x, 160);
    scheduler.request();
  }
  frames.paint();
  assert.equal(painted.length, 2);
  assert.deepEqual(painted[1], gesture.camera);
});

test("Ein zusammengefasster Pinch nutzt beide neuesten Fingerpositionen und bleibt nach dem Loslassen stabil", () => {
  const gesture = controller();
  const frames = frameQueue();
  const painted = [];
  const scheduler = new BoardCameraFrameScheduler(() => painted.push({ ...gesture.camera }), frames.request, frames.cancel);
  down(gesture, 1, 150, 150);
  down(gesture, 2, 250, 150);
  for (let step = 1; step <= 30; step++) {
    move(gesture, 1, 150 - step, 150 + step);
    scheduler.request();
    move(gesture, 2, 250 + step, 150 + step);
    scheduler.request();
  }
  frames.paint();
  assert.equal(painted.length, 1);
  near(painted[0].zoom, 1.6);
  samePoint(worldAt(painted[0], { x: 200, y: 180 }), { x: 0, y: 0 });
  // The last position may arrive on pointerup before the next scheduled paint.
  move(gesture, 2, 290, 190);
  scheduler.request();
  gesture.pointerUp(1);
  gesture.pointerUp(2);
  scheduler.flush();
  assert.equal(frames.pending, 0);
  assert.deepEqual(painted[1], gesture.camera);
  frames.paint();
  assert.equal(painted.length, 2, "Nach dem Flush darf kein veralteter Frame die Endposition überschreiben.");
  assert.equal(gesture.interactionActive, false);
  assert.equal(gesture.suppressClick(), true);
});

test("Abmelden des Boards entfernt einen geplanten Frame, eine erneute Nutzung kann wieder zeichnen", () => {
  const frames = frameQueue();
  let paints = 0;
  const scheduler = new BoardCameraFrameScheduler(() => { paints++; }, frames.request, frames.cancel);
  scheduler.request();
  scheduler.cancel();
  frames.paint();
  assert.equal(paints, 0);
  assert.equal(frames.pending, 0);
  scheduler.request();
  frames.paint();
  assert.equal(paints, 1);
});

test("Ganze Insel zentriert auch versetzte Grenzen und zeigt sie in jedem Bildschirmformat vollständig", () => {
  const board = { x: -320, y: -230, width: 760, height: 640 };
  const fit = fitCamera(board);
  assert.deepEqual(fit, { x: 60, y: 90, zoom: 1 });
  for (const viewport of [size, { width: 320, height: 480 }, { width: 1024, height: 400 }]) {
    const metrics = cameraMetrics(board, viewport, fit);
    near(metrics.width / metrics.height, viewport.width / viewport.height, "Seitenverhältnis");
    assert.ok(metrics.width >= board.width - 1e-8);
    assert.ok(metrics.height >= board.height - 1e-8);
    const [left, top, width, height] = metrics.viewBox.split(" ").map(Number);
    near(left + width / 2, fit.x, "horizontale Mitte");
    near(top + height / 2, fit.y, "vertikale Mitte");
    assert.ok(left <= board.x + 1e-8 && top <= board.y + 1e-8);
    assert.ok(left + width >= board.x + board.width - 1e-8);
    assert.ok(top + height >= board.y + board.height - 1e-8);
  }
});

test("Zoomen hält das Landschaftsdetail unter dem gewählten Bildschirmanker", () => {
  const before = { x: 0, y: 0, zoom: 2 };
  const anchor = { x: 250, y: 100 };
  const after = zoomCamera(before, bounds, size, 1.5, anchor);
  near(after.zoom, 3);
  samePoint(worldAt(after, anchor), worldAt(before, anchor));
});

test("Pinch verbindet den Zoom mit der Bewegung des Fingermittelpunkts", () => {
  const before = fitCamera(bounds);
  const from = { x: 200, y: 150 };
  const to = { x: 220, y: 170 };
  const after = transformCamera(before, bounds, size, 2, from, to);
  near(after.zoom, 2);
  samePoint(worldAt(after, to), worldAt(before, from));
});

test("Verschieben folgt dem Finger in CSS-Pixeln bei unterschiedlichen Zoomstufen", () => {
  for (const zoom of [2, 4, 6]) {
    const before = { x: 0, y: 0, zoom };
    const from = { x: 200, y: 150 };
    const to = { x: 240, y: 125 };
    const after = panCamera(before, bounds, size, to.x - from.x, to.y - from.y);
    near(after.zoom, zoom);
    samePoint(worldAt(after, to), worldAt(before, from));
  }
});

test("Zoomgrenzen verhindern eine verlorene Insel und begrenzen maximales Vergrößern", () => {
  const fit = fitCamera(bounds);
  const maximum = zoomCamera(fit, bounds, size, 1e6);
  near(maximum.zoom, 6);
  const minimum = zoomCamera({ x: 100, y: 50, zoom: 4 }, bounds, size, 1e-6);
  assert.deepEqual(minimum, fit);
  assert.deepEqual(constrainCamera({ x: 1e6, y: -1e6, zoom: 1 }, bounds, size), fit);
  const clamped = constrainCamera({ x: 1e6, y: -1e6, zoom: 2 }, bounds, size);
  const metrics = cameraMetrics(bounds, size, clamped);
  near(clamped.x + metrics.width / 2, bounds.x + bounds.width);
  near(clamped.y - metrics.height / 2, bounds.y);
  assert.deepEqual(constrainCamera(clamped, bounds, size), clamped);
});

test("Bildschirmwechsel erhält tatsächliche Vergrößerung und Weltmittelpunkt statt den relativen Zoomfaktor", () => {
  const gesture = controller();
  gesture.setCamera({ x: 60, y: -40, zoom: 3 });
  const scale = cameraMetrics(bounds, size, gesture.camera).scale;
  const portrait = { width: 300, height: 400 };
  gesture.updateViewport(bounds, portrait);
  samePoint(gesture.camera, { x: 60, y: -40 });
  near(cameraMetrics(bounds, portrait, gesture.camera).scale, scale);
  near(gesture.camera.zoom, 4, "Relativer Zoom wird an die neue Übersicht angepasst");
  gesture.updateViewport(bounds, size);
  assert.deepEqual(gesture.camera, { x: 60, y: -40, zoom: 3 });
});

test("Ein- und Ausblenden der Bauvorschau ändert die Höhe ohne Zoomsprung oder Kameraverschiebung", () => {
  const gesture = controller();
  gesture.setCamera({ x: 60, y: -40, zoom: 3 });
  const before = { ...gesture.camera };
  const scale = cameraMetrics(bounds, size, before).scale;
  const withPreview = { width: size.width, height: 200 };
  gesture.updateViewport(bounds, withPreview);
  samePoint(gesture.camera, before);
  near(cameraMetrics(bounds, withPreview, gesture.camera).scale, scale);
  near(gesture.camera.zoom, 4.5);
  gesture.updateViewport(bounds, size);
  assert.deepEqual(gesture.camera, before);
});

test("Die zentrierte Gesamtübersicht passt sich beim Resize vollständig an und Reset wirkt auch mit Bauvorschau", () => {
  const gesture = controller();
  const portrait = { width: 300, height: 400 };
  gesture.updateViewport(bounds, portrait);
  assert.deepEqual(gesture.camera, fitCamera(bounds));
  const overview = cameraMetrics(bounds, portrait, gesture.camera);
  assert.ok(overview.width >= bounds.width && overview.height >= bounds.height);
  gesture.setCamera({ x: 60, y: -40, zoom: 3 });
  const withPreview = { width: 300, height: 200 };
  gesture.updateViewport(bounds, withPreview);
  gesture.setCamera(fitCamera(bounds));
  assert.deepEqual(gesture.camera, fitCamera(bounds));
  const reset = cameraMetrics(bounds, withPreview, gesture.camera);
  assert.ok(reset.width >= bounds.width && reset.height >= bounds.height);
  gesture.updateViewport(bounds, size);
  assert.deepEqual(gesture.camera, fitCamera(bounds));
});

test("Resize respektiert die Zoomgrenzen, wenn die bisherige Vergrößerung nicht in den neuen Bereich passt", () => {
  const gesture = controller();
  gesture.setCamera({ x: 60, y: -40, zoom: 5 });
  const smaller = { width: 200, height: 150 };
  gesture.updateViewport(bounds, smaller);
  near(gesture.camera.zoom, 6);
  samePoint(gesture.camera, { x: 60, y: -40 });
  assert.deepEqual(constrainCamera(gesture.camera, bounds, smaller), gesture.camera);
  const larger = { width: 2400, height: 1800 };
  gesture.updateViewport(bounds, larger);
  assert.deepEqual(gesture.camera, fitCamera(bounds));
  gesture.updateViewport(bounds, size);
  assert.deepEqual(gesture.camera, { x: 60, y: -40, zoom: 5 }, "Ein vorübergehendes Größenlimit darf die zuvor gewählte Kamera nicht verlieren.");
});

test("Ein Tap während eines vorübergehenden Resize-Limits erhält die bisher gewählte Kamera", () => {
  const gesture = controller();
  const before = { x: 60, y: -40, zoom: 5 };
  gesture.setCamera(before);
  const smaller = { width: 200, height: 150 };
  gesture.updateViewport(bounds, smaller);
  near(gesture.camera.zoom, 6);
  down(gesture, 1, 100, 75);
  gesture.pointerUp(1);
  assert.equal(gesture.suppressClick(), false);
  gesture.updateViewport(bounds, size);
  assert.deepEqual(gesture.camera, before);
});

test("Bewusstes Verschieben nach Resize übernimmt die tatsächlich sichtbare Kamera als neue Wahl", () => {
  const gesture = controller();
  gesture.setCamera({ x: 60, y: -40, zoom: 5 });
  const smaller = { width: 200, height: 150 };
  gesture.updateViewport(bounds, smaller);
  down(gesture, 1, 100, 75);
  move(gesture, 1, 130, 75);
  gesture.pointerUp(1);
  const selectedCamera = { ...gesture.camera };
  const selectedScale = cameraMetrics(bounds, smaller, selectedCamera).scale;
  gesture.updateViewport(bounds, size);
  samePoint(gesture.camera, selectedCamera);
  near(cameraMetrics(bounds, size, gesture.camera).scale, selectedScale);
  near(gesture.camera.zoom, 3, "Nach einer Geste bleibt die neue tatsächlich gewählte Vergrößerung erhalten.");
});

test("Ein gezielter Tap mit kleinem Fingerzittern bleibt eine Auswahl und verändert die Kamera nicht", () => {
  const gesture = controller();
  gesture.setCamera({ x: 0, y: 0, zoom: 2 });
  const before = { ...gesture.camera };
  assert.deepEqual(down(gesture, 1, 140, 120).capture, [], "Ein Tap braucht keine explizite Pointer-Erfassung.");
  move(gesture, 1, 144, 123);
  gesture.pointerUp(1);
  assert.deepEqual(gesture.camera, before);
  assert.equal(gesture.interactionActive, false);
  assert.equal(gesture.suppressClick(), false);
});

test("Verschieben sperrt alle Klicks beim Loslassen bis zu einem neuen gezielten Tap", () => {
  const gesture = controller();
  gesture.setCamera({ x: 0, y: 0, zoom: 2 });
  down(gesture, 1, 140, 120);
  assert.deepEqual(move(gesture, 1, 160, 120).capture, [1], "Eine erkannte Verschiebegeste erfasst ihren Pointer.");
  assert.equal(gesture.interactionActive, true);
  assert.notEqual(gesture.camera.x, 0);
  gesture.pointerUp(1);
  assert.equal(gesture.interactionActive, false);
  assert.equal(gesture.suppressClick(), true);
  assert.equal(gesture.suppressClick(), true, "Auch ein nachfolgender Kompatibilitätsklick bleibt gesperrt.");
  assert.equal(gesture.suppressClick(false), false, "Tastaturbedienung bleibt nach einer Geste möglich.");
  assert.equal(gesture.suppressClick(), true, "Die Tastatur hebt die Sperre für alte Pointer-Klicks nicht auf.");
  down(gesture, 2, 140, 120);
  gesture.pointerUp(2);
  assert.equal(gesture.suppressClick(), false);
});

test("Pinch sperrt auch den letzten Finger nach dem Loslassen des anderen Fingers", () => {
  for (const firstReleased of [1, 2]) {
    const gesture = controller();
    down(gesture, 1, 150, 150);
    assert.deepEqual(down(gesture, 2, 250, 150).capture, [1, 2], "Pinch erfasst beide Finger bis zum Ende.");
    move(gesture, 2, 300, 150);
    assert.ok(gesture.camera.zoom > 1);
    gesture.pointerUp(firstReleased);
    assert.equal(gesture.interactionActive, true);
    assert.equal(gesture.suppressClick(), true);
    const remaining = firstReleased === 1 ? 2 : 1;
    move(gesture, remaining, remaining === 1 ? 170 : 320, 160);
    gesture.pointerUp(remaining);
    assert.equal(gesture.interactionActive, false);
    assert.equal(gesture.suppressClick(), true);
    down(gesture, 3, 200, 150);
    gesture.pointerUp(3);
    assert.equal(gesture.suppressClick(), false);
  }
});

test("Schon ein zweiter Finger ohne Bewegung macht die komplette Geste auswahlsicher", () => {
  const gesture = controller();
  down(gesture, 1, 150, 150);
  down(gesture, 2, 250, 150);
  gesture.pointerUp(2);
  gesture.pointerUp(1);
  assert.deepEqual(gesture.camera, fitCamera(bounds));
  assert.equal(gesture.suppressClick(), true);
});

test("Pointer-Abbruch und verlorene Erfassung verhindern eine Auswahl, ein späterer Tap funktioniert", () => {
  for (const cancel of ["pointerCancel", "lostPointerCapture"]) {
    const gesture = controller();
    down(gesture, 1, 200, 150);
    gesture[cancel](1);
    assert.equal(gesture.interactionActive, false);
    assert.equal(gesture.suppressClick(), true);
    down(gesture, 2, 200, 150);
    gesture.pointerUp(2);
    assert.equal(gesture.suppressClick(), false);
  }
});

test("Automatischer Verlust der Pointer-Erfassung nach einem vollständigen Tap sperrt diesen nicht", () => {
  const gesture = controller();
  down(gesture, 1, 200, 150);
  gesture.pointerUp(1);
  gesture.lostPointerCapture(1);
  gesture.pointerCancel(99);
  move(gesture, 99, 1000, 1000);
  assert.equal(gesture.interactionActive, false);
  assert.equal(gesture.suppressClick(), false);
  assert.deepEqual(gesture.camera, fitCamera(bounds));
});

test("Abbruch eines Pinch-Fingers hält auch den verbleibenden Finger für Auswahl gesperrt", () => {
  const gesture = controller();
  down(gesture, 1, 150, 150);
  down(gesture, 2, 250, 150);
  gesture.pointerCancel(2);
  assert.equal(gesture.interactionActive, true);
  gesture.pointerUp(1);
  assert.equal(gesture.interactionActive, false);
  assert.equal(gesture.suppressClick(), true);
});

test("Fensterwechsel beendet alle Finger ohne einen späteren Klick oder eine hängende Geste", () => {
  const gesture = controller();
  down(gesture, 1, 150, 150);
  down(gesture, 2, 250, 150);
  gesture.cancelAll();
  assert.equal(gesture.interactionActive, false);
  assert.equal(gesture.suppressClick(), true);
  const camera = { ...gesture.camera };
  move(gesture, 1, 400, 300);
  gesture.pointerUp(2);
  assert.deepEqual(gesture.camera, camera);
  assert.equal(gesture.suppressClick(), true);
  down(gesture, 3, 200, 150);
  gesture.pointerUp(3);
  assert.equal(gesture.suppressClick(), false);
});
