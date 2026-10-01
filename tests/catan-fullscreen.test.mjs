import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-fullscreen-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({ entryPoints: [resolve(root, "lib/catan-fullscreen.ts")], outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
after(() => rm(output, { force: true }));
const { IslandFullscreenController } = createRequire(import.meta.url)(output);

function browser({ supported = true, enabled = true, current = null, throws = false } = {}) {
  const listeners = new Set(); const requests = []; const changes = [];
  const document = {
    documentElement: {}, fullscreenElement: current, fullscreenEnabled: enabled, exits: 0,
    addEventListener(type, listener) { assert.equal(type, "fullscreenchange"); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, "fullscreenchange"); listeners.delete(listener); },
    exitFullscreen() { this.exits++; this.fullscreenElement = null; emit(); return Promise.resolve(); },
  };
  function emit() { for (const listener of listeners) listener(); }
  if (supported) document.documentElement.requestFullscreen = (options) => {
    assert.deepEqual(options, { navigationUI: "hide" });
    if (throws) throw new TypeError("Fullscreen unavailable");
    return new Promise((resolve, reject) => requests.push({
      accept() { document.fullscreenElement = document.documentElement; emit(); resolve(); }, reject,
    }));
  };
  const controller = new IslandFullscreenController(document, (value) => changes.push(value));
  return { document, requests, changes, controller, listeners, browserExit() { document.fullscreenElement = null; emit(); } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("entry requests the document synchronously and minimization exits native fullscreen", async () => {
  const b = browser(); b.controller.enter();
  assert.equal(b.requests.length, 1); assert.equal(b.controller.expanded, true);
  b.requests[0].accept(); await settle();
  b.controller.exit(); await settle();
  assert.equal(b.document.exits, 1); assert.equal(b.controller.expanded, false);
  assert.deepEqual(b.changes, [true, false]); b.controller.dispose();
});

test("browser Escape synchronizes the island and allows a fresh entry", async () => {
  const b = browser(); b.controller.enter(); b.requests[0].accept(); await settle();
  b.browserExit();
  assert.equal(b.controller.expanded, false); assert.deepEqual(b.changes, [true, false]);
  b.controller.enter(); assert.equal(b.requests.length, 2);
  b.requests[1].accept(); await settle(); b.controller.dispose();
});

test("missing or disabled fullscreen leaves a usable expanded layout", () => {
  for (const options of [{ supported: false }, { enabled: false }]) {
    const b = browser(options); b.controller.enter();
    assert.equal(b.controller.expanded, true); assert.equal(b.requests.length, 0);
    b.controller.exit(); assert.equal(b.controller.expanded, false); b.controller.dispose();
  }
});

test("a rejected request retains the expanded fallback and has no unhandled rejection", async () => {
  const b = browser(); b.controller.enter(); b.requests[0].reject(new TypeError("Permission denied")); await settle();
  assert.equal(b.controller.expanded, true); assert.equal(b.document.exits, 0);
  b.controller.exit(); assert.deepEqual(b.changes, [true, false]); b.controller.dispose();
});

test("a synchronous platform error retains the fallback", () => {
  const b = browser({ throws: true });
  assert.doesNotThrow(() => b.controller.enter()); assert.equal(b.controller.expanded, true);
  b.controller.exit(); assert.equal(b.controller.expanded, false); b.controller.dispose();
});

test("a late entry after minimization or navigation is immediately released", async () => {
  const b = browser(); b.controller.enter(); b.controller.exit();
  b.requests[0].accept(); await settle();
  assert.equal(b.controller.expanded, false); assert.equal(b.document.fullscreenElement, null);
  assert.equal(b.document.exits, 1); assert.deepEqual(b.changes, [true, false]); b.controller.dispose();
});

test("unmount releases native fullscreen and removes its event listener", async () => {
  const b = browser(); b.controller.enter(); b.requests[0].accept(); await settle();
  b.controller.dispose(); await settle();
  assert.equal(b.document.fullscreenElement, null); assert.equal(b.document.exits, 1); assert.equal(b.listeners.size, 0);
  b.controller.enter(); assert.equal(b.requests.length, 1);
});

test("unmount during a pending entry releases its late result without calling React", async () => {
  const b = browser(); b.controller.enter(); b.controller.dispose();
  b.requests[0].accept(); await settle();
  assert.equal(b.document.fullscreenElement, null); assert.equal(b.document.exits, 1);
  assert.deepEqual(b.changes, [true]); assert.equal(b.listeners.size, 0);
});

test("an existing fullscreen belonging to another surface is left alone", () => {
  const previous = {}; const b = browser({ current: previous });
  b.controller.enter(); assert.equal(b.controller.expanded, true); assert.equal(b.requests.length, 0);
  b.controller.exit(); b.controller.dispose();
  assert.equal(b.document.fullscreenElement, previous); assert.equal(b.document.exits, 0);
});

test("repeated entry shares a pending request; cancel and reopen keep the final chosen state", async () => {
  const b = browser(); b.controller.enter(); b.controller.enter();
  assert.equal(b.requests.length, 1);
  b.controller.exit(); b.controller.enter(); b.requests[0].accept(); await settle();
  assert.equal(b.document.fullscreenElement, b.document.documentElement); assert.equal(b.controller.expanded, true);
  b.controller.dispose(); await settle(); assert.equal(b.document.exits, 1);
});

test("reopening while native exit is pending preserves the expanded fallback", async () => {
  const b = browser(); b.controller.enter(); b.requests[0].accept(); await settle();
  let finishExit;
  b.document.exitFullscreen = () => {
    b.document.exits++;
    return new Promise((resolve) => { finishExit = () => { b.browserExit(); resolve(); }; });
  };
  b.controller.exit(); b.controller.enter();
  finishExit(); await settle();
  assert.equal(b.controller.expanded, true); assert.equal(b.document.fullscreenElement, null);
  assert.deepEqual(b.changes, [true, false, true]);
  b.controller.exit(); assert.equal(b.controller.expanded, false); b.controller.dispose();
});
