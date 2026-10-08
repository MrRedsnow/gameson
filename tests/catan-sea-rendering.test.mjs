import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-sea-rendering-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({ stdin: { contents: 'export { seaRenderBudget } from "./lib/catan-render-budget"; export { CatanSeaBackground } from "./components/catan/sea-background";', resolveDir: root, loader: "tsx" }, absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent" });
after(() => rm(output, { force: true }));
const require = createRequire(import.meta.url);
const React = require("react");
const { seaRenderBudget, CatanSeaBackground } = require(output);

class Listeners {
  handlers = new Map();
  addEventListener(type, callback) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(callback); }
  removeEventListener(type, callback) { this.handlers.get(type)?.delete(callback); }
  emit(type, event = {}) { this.handlers.get(type)?.forEach((callback) => callback(event)); }
  get size() { return [...this.handlers.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}
const defaults = { width: 412, height: 892, size: 940, x: 8, y: -5, active: true, interacting: false, ambientEnabled: true };

function environment(t, { reducedMotion = false, handheld = true, contextAvailable = true } = {}) {
  const frames = new Map(); const images = []; const hooks = [];
  const uniforms = new Map(); const draws = []; const deleted = { textures: 0, buffers: 0, programs: 0, shaders: 0 };
  let nextFrame = 0; let hookIndex = 0; let renders = 0; let contextLost = false; let disposed = false;
  let pendingLayout = []; let pendingEffects = []; let props = { ...defaults };
  const handle = { current: null };
  const viewport = { attributes: new Map(), style: { values: new Map(), setProperty(name, value) { this.values.set(name, value); } }, setAttribute(name, value) { this.attributes.set(name, value); } };
  const gl = {
    isContextLost: () => contextLost, createShader: () => ({}), getShaderParameter: () => true,
    getShaderPrecisionFormat: () => ({ precision: 23 }), createProgram: () => ({}), getProgramParameter: () => true,
    getUniformLocation: (_program, name) => name, createBuffer: () => ({}), createTexture: () => ({}), getAttribLocation: () => 0,
    uniform1i: (name, value) => uniforms.set(name, value), uniform1f: (name, value) => uniforms.set(name, value),
    uniform2f: (name, ...values) => uniforms.set(name, values), uniform3f: (name, ...values) => uniforms.set(name, values),
    drawArrays: () => draws.push({ time: uniforms.get("u_time"), ambient: uniforms.get("u_ambient"), sea: [...uniforms.get("u_sea")], pixels: [canvas.width, canvas.height] }),
    deleteTexture: () => deleted.textures++, deleteBuffer: () => deleted.buffers++, deleteProgram: () => deleted.programs++, deleteShader: () => deleted.shaders++,
  };
  for (const name of ["shaderSource", "compileShader", "attachShader", "linkProgram", "useProgram", "bindBuffer", "bufferData", "enableVertexAttribArray", "vertexAttribPointer", "activeTexture", "bindTexture", "texParameteri", "texImage2D", "viewport"]) gl[name] = () => {};
  for (const [index, name] of ["VERTEX_SHADER", "FRAGMENT_SHADER", "HIGH_FLOAT", "COMPILE_STATUS", "LINK_STATUS", "ARRAY_BUFFER", "STATIC_DRAW", "FLOAT", "TEXTURE0", "TEXTURE_2D", "TEXTURE_MIN_FILTER", "TEXTURE_MAG_FILTER", "LINEAR", "TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "CLAMP_TO_EDGE", "RGBA", "UNSIGNED_BYTE", "TRIANGLES"].entries()) gl[name] = index + 1;
  const canvas = Object.assign(new Listeners(), { width: 300, height: 150, style: { opacity: "" }, parentElement: viewport, getContext: () => contextAvailable ? gl : null });
  const document = Object.assign(new Listeners(), { hidden: false });
  const motion = Object.assign(new Listeners(), { matches: reducedMotion });
  const device = Object.assign(new Listeners(), { matches: handheld });
  const globals = {
    document, window: { devicePixelRatio: 3, matchMedia: (query) => query.includes("reduced-motion") ? motion : device },
    requestAnimationFrame: (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; }, cancelAnimationFrame: (id) => frames.delete(id),
    Image: class { naturalWidth = 0; naturalHeight = 0; complete = false; onload = null; onerror = null; constructor() { images.push(this); } },
  };
  const originals = Object.fromEntries(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const effect = (callback, dependencies, queue) => {
    const index = hookIndex++; const old = hooks[index];
    if (!old || !dependencies || dependencies.some((value, offset) => !Object.is(value, old.dependencies[offset]))) {
      const hook = { dependencies, cleanup: old?.cleanup }; hooks[index] = hook;
      queue.push(() => { hook.cleanup?.(); hook.cleanup = callback(); });
    }
  };
  t.mock.method(React, "useRef", (initial) => { const index = hookIndex++; return hooks[index] ??= { current: initial }; });
  t.mock.method(React, "useLayoutEffect", (callback, dependencies) => effect(callback, dependencies, pendingLayout));
  t.mock.method(React, "useEffect", (callback, dependencies) => effect(callback, dependencies, pendingEffects));
  t.mock.method(React, "useImperativeHandle", (ref, create, dependencies) => effect(() => { ref.current = create(); return () => { ref.current = null; }; }, dependencies, pendingLayout));
  const render = (changes = {}) => {
    props = { ...props, ...changes }; hookIndex = 0; pendingLayout = []; pendingEffects = []; renders++;
    const node = CatanSeaBackground({ ...props, ref: handle }); node.props.ref.current = canvas;
    pendingLayout.forEach((callback) => callback()); pendingEffects.forEach((callback) => callback());
  };
  const dispose = () => { if (disposed) return; disposed = true; for (const hook of [...hooks].reverse()) hook?.cleanup?.(); };
  t.after(() => { dispose(); for (const [name, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  render();
  return {
    canvas, viewport, gl, draws, deleted, frames, images, document, motion, device, handle, render, dispose, get renders() { return renders; },
    load() { const image = images.at(-1); assert.ok(image); image.complete = true; image.naturalWidth = image.naturalHeight = 1536; image.onload?.(); },
    frameAt(now) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(now)); },
    loseContext() { contextLost = true; let prevented = false; canvas.emit("webglcontextlost", { preventDefault() { prevented = true; } }); assert.equal(prevented, true); },
    restoreContext() { contextLost = false; canvas.emit("webglcontextrestored"); },
  };
}

test("high-density phone and fullscreen sea buffers stay within the decorative pixel budget", () => {
  for (const handheld of [true, false]) for (const viewport of [
    { width: 412, height: 892 }, { width: 384, height: 854 }, { width: 1440, height: 3200 },
    { width: 1920, height: 1080 }, { width: 3840, height: 2160 }, { width: 100000, height: 100000 },
  ]) for (const density of [1, 2, 3, 4]) {
    const budget = seaRenderBudget(viewport, density, handheld);
    assert.ok(budget.width * budget.height <= (handheld ? 450000 : 1000000));
    assert.ok(budget.width <= viewport.width * (handheld ? 1 : 1.5));
    assert.ok(budget.height <= viewport.height * (handheld ? 1 : 1.5));
    assert.ok(budget.width <= 4096 && budget.height <= 4096);
    assert.equal(budget.interval, 1000 / 30);
  }
  for (const size of [{ width: Number.NaN, height: Number.POSITIVE_INFINITY }, { width: 0, height: -12 }]) {
    for (const density of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(seaRenderBudget(size, density, true), { width: 1, height: 1, interval: 1000 / 30 });
  }
});

test("120Hz animation callbacks draw the sea at 30fps with a bounded phone backing buffer", (t) => {
  const env = environment(t); env.load(); env.draws.length = 0;
  for (let frame = 0; frame <= 120; frame++) env.frameAt(frame * 1000 / 120);
  assert.equal(env.draws.length, 31, "One initial frame and 30 subsequent frames are painted during one second.");
  assert.ok(env.draws.every((draw) => draw.pixels[0] * draw.pixels[1] <= 450000));
  assert.ok(Math.abs(env.draws.at(-1).time - 1) < 1e-8);
  assert.equal(env.frames.size, 1);
});

test("panning keeps the sea visible and paints imperative camera changes at the frozen wave phase", (t) => {
  const env = environment(t); env.load(); env.frameAt(0); env.frameAt(500);
  const phase = env.draws.at(-1).time;
  env.render({ interacting: true });
  assert.equal(env.frames.size, 0); assert.equal(env.canvas.style.opacity, "1");
  assert.equal(env.viewport.attributes.get("data-catan-sea-ready"), "true");
  const renderCount = env.renders; const previousDraws = env.draws.length;
  env.handle.current.setCameraLayout({ size: 1100, x: 24, y: -18 });
  assert.equal(env.renders, renderCount, "The camera update must not require React reconciliation.");
  assert.equal(env.draws.length, previousDraws + 1); assert.deepEqual(env.draws.at(-1).sea, [1100, 24, -18]);
  assert.equal(env.draws.at(-1).time, phase); assert.equal(env.frames.size, 0);
  env.render({ interacting: false, size: 1100, x: 24, y: -18 });
  env.frameAt(10000); assert.equal(env.draws.at(-1).time, phase, "Resuming after a long drag cannot jump ahead through the suspended time.");
  env.frameAt(10034); assert.ok(Math.abs(env.draws.at(-1).time - phase - .034) < 1e-8);
});

test("hidden, inactive and reduced-motion states stop draws and restore the aligned static fallback", (t) => {
  const env = environment(t); env.load(); env.frameAt(0); env.frameAt(250);
  const phase = env.draws.at(-1).time;
  for (const [disable, enable] of [
    [() => { env.document.hidden = true; env.document.emit("visibilitychange"); }, () => { env.document.hidden = false; env.document.emit("visibilitychange"); }],
    [() => env.render({ active: false }), () => env.render({ active: true, size: 1010, x: 33, y: 12 })],
    [() => { env.motion.matches = true; env.motion.emit("change"); }, () => { env.motion.matches = false; env.motion.emit("change"); }],
  ]) {
    disable(); const count = env.draws.length;
    assert.equal(env.frames.size, 0); assert.equal(env.canvas.style.opacity, "0");
    env.handle.current.setCameraLayout({ size: 1010, x: 33, y: 12 }); env.frameAt(5000);
    assert.equal(env.draws.length, count);
    assert.equal(env.viewport.style.values.get("--catan-sea-size"), "1010px");
    assert.equal(env.viewport.style.values.get("--catan-sea-x"), "33px"); assert.equal(env.viewport.style.values.get("--catan-sea-y"), "12px");
    enable(); assert.equal(env.canvas.style.opacity, "1"); assert.equal(env.frames.size, 1);
    env.frameAt(10000); assert.equal(env.draws.at(-1).time, phase);
  }
});

test("context loss uses the fallback, restores one animation loop and frees all resources and listeners", (t) => {
  const env = environment(t); env.load(); env.frameAt(0); env.frameAt(400);
  const phase = env.draws.at(-1).time; const image = env.images[0];
  env.loseContext(); assert.equal(env.canvas.style.opacity, "0"); assert.equal(env.frames.size, 0);
  assert.deepEqual(env.deleted, { textures: 1, buffers: 1, programs: 1, shaders: 2 });
  env.handle.current.setCameraLayout({ size: 1040, x: -14, y: 25 });
  assert.equal(env.viewport.style.values.get("--catan-sea-x"), "-14px");
  env.restoreContext(); assert.equal(env.images.length, 1, "The already loaded sea texture is reused.");
  assert.equal(env.canvas.style.opacity, "1"); assert.equal(env.frames.size, 1); assert.equal(env.draws.at(-1).time, phase);
  env.dispose(); assert.equal(env.frames.size, 0); assert.equal(env.handle.current, null);
  assert.deepEqual(env.deleted, { textures: 2, buffers: 2, programs: 2, shaders: 4 });
  assert.equal(env.canvas.size + env.document.size + env.motion.size + env.device.size, 0);
  assert.equal(image.onload, null); assert.equal(image.onerror, null);
});

test("failed texture loading leaves no live frames and retains the aligned camera fallback", (t) => {
  const env = environment(t); const image = env.images[0]; image.onerror();
  assert.equal(env.frames.size, 0); assert.equal(env.canvas.style.opacity, "0");
  assert.deepEqual(env.deleted, { textures: 1, buffers: 1, programs: 1, shaders: 2 });
  env.handle.current.setCameraLayout({ size: 980, x: 20, y: 30 });
  assert.equal(env.viewport.style.values.get("--catan-sea-y"), "30px");
});

test("unavailable WebGL immediately keeps the static image aligned without loading an unused texture", (t) => {
  const env = environment(t, { contextAvailable: false });
  assert.equal(env.images.length, 0); assert.equal(env.frames.size, 0); assert.equal(env.canvas.style.opacity, "0");
  env.handle.current.setCameraLayout({ size: 980, x: 20, y: 30 });
  assert.equal(env.viewport.style.values.get("--catan-sea-y"), "30px");
});
