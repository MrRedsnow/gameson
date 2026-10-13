import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, `.wrangler/test-artifacts/catan-animation-preferences-${process.pid}.cjs`);
await mkdir(resolve(root, ".wrangler/test-artifacts"), { recursive: true });
await build({ stdin: { contents: 'export { useAmbientPreference } from "./components/catan/use-ambient-preference"; export { useWaterPreference } from "./components/catan/use-water-preference";', resolveDir: root, loader: "ts" }, absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", outfile: output, logLevel: "silent" });
after(() => rm(output, { force: true }));
const require = createRequire(import.meta.url); const React = require("react");
const { useAmbientPreference, useWaterPreference } = require(output);

function PreferenceEnvironment(t) {
  const stored = new Map(); const listeners = new Map(); const stores = [];
  let blocked = false;
  const window = {
    localStorage: {
      getItem(key) { if (blocked) throw new Error("Storage blocked"); return stored.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error("Storage blocked"); stored.set(key, value); },
    },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) ?? []) listener(event); },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: window });
  t.mock.method(React, "useCallback", (callback) => callback);
  t.mock.method(React, "useSyncExternalStore", (subscribe, snapshot, serverSnapshot) => { stores.push({ subscribe, snapshot, serverSnapshot }); return snapshot(); });
  const ambient = useAmbientPreference(); const ambientStore = stores[0];
  const water = useWaterPreference(); const waterStore = stores[1];
  t.after(() => {
    blocked = false; ambient.setEnabled(true); water.setEnabled(true);
    if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window;
  });
  return { stored, window, ambient, water, ambientStore, waterStore, blockStorage(value) { blocked = value; } };
}

test("island life and moving water preferences persist independently and default to enabled", (t) => {
  const env = PreferenceEnvironment(t);
  assert.equal(env.ambient.enabled, true); assert.equal(env.water.enabled, true);
  assert.equal(env.ambientStore.serverSnapshot(), true); assert.equal(env.waterStore.serverSnapshot(), true);
  env.water.setEnabled(false);
  assert.equal(env.stored.get("catan-water-enabled"), "false");
  assert.equal(env.waterStore.snapshot(), false); assert.equal(env.ambientStore.snapshot(), true);
  env.ambient.setEnabled(false); env.water.setEnabled(true);
  assert.equal(env.stored.get("catan-ambient-enabled"), "false");
  assert.equal(env.ambientStore.snapshot(), false); assert.equal(env.waterStore.snapshot(), true);
  env.stored.set("catan-water-enabled", "false");
  assert.equal(useWaterPreference().enabled, false, "A newly mounted menu reads the saved water preference.");
});

test("animation preferences notify their own subscribers and synchronize external storage changes", (t) => {
  const env = PreferenceEnvironment(t); let ambientUpdates = 0; let waterUpdates = 0;
  const disposeAmbient = env.ambientStore.subscribe(() => ambientUpdates++);
  const disposeWater = env.waterStore.subscribe(() => waterUpdates++);
  env.water.setEnabled(false);
  assert.equal(waterUpdates, 1); assert.equal(ambientUpdates, 0);
  env.ambient.setEnabled(false);
  assert.equal(waterUpdates, 1); assert.equal(ambientUpdates, 1);
  env.stored.set("catan-water-enabled", "true");
  env.window.dispatchEvent({ type: "storage", key: "catan-water-enabled" });
  assert.equal(waterUpdates, 2); assert.equal(ambientUpdates, 1); assert.equal(env.waterStore.snapshot(), true);
  env.window.dispatchEvent({ type: "storage", key: "unrelated" });
  assert.equal(waterUpdates, 2); assert.equal(ambientUpdates, 1);
  env.window.dispatchEvent({ type: "storage", key: null });
  assert.equal(waterUpdates, 3); assert.equal(ambientUpdates, 2);
  disposeAmbient(); disposeWater(); env.water.setEnabled(false); env.ambient.setEnabled(true);
  assert.equal(waterUpdates, 3); assert.equal(ambientUpdates, 2);
});

test("disabled storage retains water preference in memory and recovers when storage is available", (t) => {
  const env = PreferenceEnvironment(t); env.blockStorage(true);
  env.water.setEnabled(false);
  assert.equal(env.waterStore.snapshot(), false); assert.equal(useWaterPreference().enabled, false);
  assert.equal(env.ambientStore.snapshot(), true, "Water's memory fallback cannot disable island life.");
  env.water.setEnabled(true); assert.equal(env.waterStore.snapshot(), true);
  env.blockStorage(false); env.water.setEnabled(false);
  assert.equal(env.stored.get("catan-water-enabled"), "false"); assert.equal(env.waterStore.snapshot(), false);
  env.stored.set("catan-water-enabled", "true"); assert.equal(env.waterStore.snapshot(), true);
});
