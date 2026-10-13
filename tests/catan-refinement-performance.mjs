// Optional real-browser QA. Frozen builds keep before/after assets and CSS isolated.
// node tests/catan-refinement-performance.mjs freeze baseline
// node tests/catan-refinement-performance.mjs measure baseline
// node tests/catan-refinement-performance.mjs freeze final
// node tests/catan-refinement-performance.mjs measure final
// node tests/catan-refinement-performance.mjs compare baseline final
// node tests/catan-refinement-performance.mjs serve baseline [port]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { fixture } from "./catan-layout-browser.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".wrangler/catan-refinement");
const detailStyles = ["resource-feedback.css", "event-notice.css", "board-effects.css", "ambient-island.css"];
const sizes = [[390, 844], [1440, 1000]];
const durationMs = 6000;
const runs = 3;
const [command = "measure", name = "baseline", other = "final"] = process.argv.slice(2);
assert.match(name, /^[a-z0-9-]+$/, "Use a simple snapshot name.");
const dir = resolve(output, name);
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)] ?? 0;

async function freeze() {
  await mkdir(dir, { recursive: true });
  await assert.rejects(stat(resolve(dir, "frozen.json")), { code: "ENOENT" }, "A frozen snapshot must never be overwritten.");
  await cp(resolve(root, "public/catan"), resolve(dir, "catan"), { recursive: true });
  await cp(resolve(root, "app/catan/catan.css"), resolve(dir, "catan.css"));
  for (const style of detailStyles) await cp(resolve(root, "components/catan", style), resolve(dir, style));
  // The compiled global stylesheet must be identical for the comparison.
  let globalCss = "baseline/base.css";
  if (name === "baseline") {
    const cssDir = resolve(root, "dist/client/_next/static/css");
    globalCss = (await readdir(cssDir)).find((file) => file.startsWith("index."));
    assert.ok(globalCss, "Build the application once before freezing the baseline.");
    await cp(resolve(cssDir, globalCss), resolve(dir, "base.css"));
  } else await cp(resolve(output, "baseline/base.css"), resolve(dir, "base.css"));
  await build({ entryPoints: [resolve(root, "tests/fixtures/catan-ux.tsx")], outfile: resolve(dir, "app.js"), bundle: true, platform: "browser", format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, minify: true, logLevel: "warning" });
  await writeFile(resolve(dir, "index.html"), `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catan refinement QA</title><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/catan.css">${detailStyles.map((style) => `<link rel="stylesheet" href="/${style}">`).join("")}<style>.qa-controls{position:fixed;z-index:200;right:4px;top:0;color:#fff;background:#334;padding:4px;font:12px Arial}.qa-controls label{display:grid;gap:8px}.qa-controls select{background:#223;padding:8px}body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
  await writeFile(resolve(dir, "frozen.json"), JSON.stringify({ frozenAt: new Date().toISOString(), globalCss, node: process.version }, null, 2));
  console.log(`Frozen ${name}: ${dir}`);
}

async function serve(port = 0) {
  await stat(resolve(dir, "frozen.json"));
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://127.0.0.1").pathname;
      const file = resolve(dir, pathname === "/" ? "index.html" : `.${pathname}`);
      if (!file.startsWith(`${dir}${sep}`)) { res.writeHead(403).end(); return; }
      const content = await readFile(file);
      res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".png") ? "image/png" : "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      res.end(content);
    } catch (error) { res.writeHead(error.code === "ENOENT" ? 404 : 500).end(error.message); }
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function sample(page, scenario) {
  await fixture(page, scenario === "menu" ? "history" : "rich");
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const state = { start: performance.now(), frames: [], tasks: [], cancelled: false };
    window.catanPerformanceSample = state;
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      state.observer = new PerformanceObserver((list) => state.tasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration }))));
      state.observer.observe({ type: "longtask" });
    }
    const frame = (time) => { if (state.cancelled) return; state.frames.push(time); state.raf = requestAnimationFrame(frame); };
    state.raf = requestAnimationFrame(frame);
  });
  const began = Date.now();
  if (scenario === "pan-zoom") {
    for (let round = 0; round < 5; round++) {
      await page.getByRole("button", { name: "Insel vergrößern", exact: true }).click();
      const viewport = await page.locator(".catan-board-viewport").boundingBox();
      const x = viewport.x + viewport.width * .45, y = viewport.y + viewport.height * .4;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + viewport.width * .12, y + viewport.height * .08, { steps: 16 }); await page.mouse.up();
      await page.getByRole("button", { name: "Insel verkleinern", exact: true }).click();
    }
  } else if (scenario === "menu") {
    for (let round = 0; round < 5; round++) {
      await page.locator('[data-catan-menu-trigger="uebersicht"]').click();
      const panel = page.locator('[data-catan-menu-panel="uebersicht"]');
      const historyLink = panel.getByRole("button", { name: "Spielverlauf", exact: true });
      if (await historyLink.count()) await historyLink.click();
      await expect(panel.getByRole("heading", { name: "Spielverlauf", exact: true })).toBeVisible();
      const body = panel.locator(".catan-screen-body");
      assert.ok(await body.evaluate((element) => element.scrollHeight > element.clientHeight + 100), "The menu workload needs a long scrollable history.");
      await body.evaluate((element) => { element.scrollTop = 0; });
      await body.hover();
      await page.mouse.wheel(0, 500); await page.waitForTimeout(200);
      assert.ok(await body.evaluate((element) => element.scrollTop > 0), "The history must actually scroll during the workload.");
      await page.mouse.wheel(0, -500); await page.waitForTimeout(200);
      await panel.getByRole("button", { name: "Menü schließen", exact: true }).click();
    }
  }
  await page.waitForTimeout(Math.max(0, durationMs - (Date.now() - began)));
  const raw = await page.evaluate(() => {
    const state = window.catanPerformanceSample;
    state.tasks.push(...(state.observer?.takeRecords() ?? []).map((entry) => ({ start: entry.startTime, duration: entry.duration })));
    state.cancelled = true; cancelAnimationFrame(state.raf); state.observer?.disconnect();
    const intervals = state.frames.slice(1).map((time, index) => time - state.frames[index]);
    const tasks = state.tasks.filter((task) => task.start >= state.start);
    return { intervals, duration: performance.now() - state.start, tasks, gameId: window.catanQaDeterminism.uuids.at(-2), longTasksSupported: PerformanceObserver.supportedEntryTypes.includes("longtask") };
  });
  const median = percentile(raw.intervals, .5);
  assert.ok(raw.intervals.length >= 100, "At least 100 browser frames are required per run.");
  // Approximation against the browser's refresh cadence, not a GPU present counter.
  const estimatedDropped = raw.intervals.reduce((sum, interval) => sum + Math.max(0, Math.round(interval / median) - 1), 0);
  return { scenario, gameId: raw.gameId, durationMs: raw.duration, frames: raw.intervals.length, medianMs: median, p95Ms: percentile(raw.intervals, .95), estimatedDroppedFrames: estimatedDropped, estimatedDroppedPercent: 100 * estimatedDropped / (raw.intervals.length + estimatedDropped), longTaskCount: raw.tasks.length, longTaskTotalMs: raw.tasks.reduce((sum, task) => sum + task.duration, 0), longTaskMaxMs: Math.max(0, ...raw.tasks.map((task) => task.duration)), longTasksSupported: raw.longTasksSupported };
}

async function inventory(page, requests) {
  const paths = [...new Set(requests.filter((path) => path.startsWith("/catan/")))].sort();
  const images = [];
  for (const path of paths) {
    const content = await readFile(resolve(dir, `.${path}`));
    const dimensions = await page.evaluate(async (path) => { const image = new Image(); image.src = path; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; }, path);
    images.push({ path, bytes: content.byteLength, sha256: createHash("sha256").update(content).digest("hex"), ...dimensions });
  }
  return { requests: requests.filter((path) => path.startsWith("/catan/")), imageRequests: requests.filter((path) => path.startsWith("/catan/")).length, uniqueImages: images.length, images, imageBytes: images.reduce((sum, image) => sum + image.bytes, 0) };
}

async function measure() {
  const { server, url } = await serve();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const report = { snapshot: name, measuredAt: new Date().toISOString(), browser: browser.version(), headless: true, reducedMotion: "no-preference", deviceScaleFactor: 1, randomSeed: 0xCA7A2026, uuidSequence: "00000000-0000-4000-8000-000000000001", durationMs, runs, environment: {}, samples: [], inventory: {} };
    for (const [width, height] of sizes) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width < 1024, reducedMotion: "no-preference" });
      await page.addInitScript((seed) => {
        const state = { random: seed, uuids: [] };
        window.catanQaDeterminism = state;
        Object.defineProperty(crypto, "randomUUID", { value: () => {
          const id = `00000000-0000-4000-8000-${(state.uuids.length + 1).toString(16).padStart(12, "0")}`;
          state.uuids.push(id); return id;
        } });
        Math.random = () => { state.random = (Math.imul(1664525, state.random) + 1013904223) >>> 0; return state.random / 0x100000000; };
      }, report.randomSeed);
      const requests = [], errors = [];
      page.on("request", (request) => requests.push(new URL(request.url()).pathname));
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url); await expect(page.locator(".catan-board")).toBeVisible();
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode().catch(() => {}))); });
      await expect(page.locator(".catan-world-sea")).toHaveAttribute("data-catan-sea-ready", "true");
      await page.waitForTimeout(2000);
      const size = `${width}x${height}`;
      const environment = await page.evaluate(() => {
        const canvas = document.querySelector(".catan-sea-surface"), gl = canvas.getContext("webgl"), debug = gl.getExtension("WEBGL_debug_renderer_info");
        return { canvasCount: document.querySelectorAll(".catan-sea-surface").length, seaWidth: canvas.width, seaHeight: canvas.height, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), userAgent: navigator.userAgent, coarsePointer: matchMedia("(pointer: coarse)").matches, deviceScaleFactor: devicePixelRatio };
      });
      assert.equal(environment.canvasCount, 1);
      assert.ok(environment.seaWidth * environment.seaHeight <= (width < 1024 ? 450000 : 1000000));
      report.environment[size] = environment;
      // Take the request inventory before dimension decoding adds cache revalidation.
      report.inventory[size] = await inventory(page, [...requests]);
      for (let run = 1; run <= runs; run++) for (const scenario of ["idle", "pan-zoom", "menu"]) {
        const result = { size, run, ...await sample(page, scenario) };
        report.samples.push(result);
        console.log(`${name} ${size} ${scenario} run ${run}: median ${result.medianMs.toFixed(2)} ms, p95 ${result.p95Ms.toFixed(2)} ms, estimated drops ${result.estimatedDroppedPercent.toFixed(2)}%, long tasks ${result.longTaskCount}`);
      }
      await fixture(page, "rich");
      for (const expanded of [false, true]) {
        if (expanded) await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
        for (const menu of ["insel", "bauen", "karten", "handel", "uebersicht"]) {
          if (menu !== "insel") await page.locator(`[data-catan-menu-trigger="${menu}"]`).click();
          await page.screenshot({ path: resolve(dir, `${size}-${expanded ? "expanded" : "normal"}-${menu}.png`), style: ".qa-controls { visibility:hidden!important; }" });
          if (menu !== "insel") await page.locator(`[data-catan-menu-panel="${menu}"]`).getByRole("button", { name: "Menü schließen", exact: true }).click();
        }
      }
      assert.deepEqual(errors, [], "Browser errors");
      await page.close();
    }
    await writeFile(resolve(dir, "measurements.json"), JSON.stringify(report, null, 2));
    console.log(`Saved ${dir}/measurements.json`);
  } finally { await browser?.close(); await new Promise((done) => server.close(done)); }
}

async function compare() {
  assert.match(other, /^[a-z0-9-]+$/);
  const baseline = JSON.parse(await readFile(resolve(dir, "measurements.json"), "utf8"));
  const final = JSON.parse(await readFile(resolve(output, other, "measurements.json"), "utf8"));
  for (const property of ["browser", "headless", "reducedMotion", "deviceScaleFactor", "randomSeed", "uuidSequence", "durationMs", "runs"]) assert.equal(final[property], baseline[property], `Comparison environment ${property} changed.`);
  const rows = [], failures = [];
  for (const size of Object.keys(baseline.environment)) {
    assert.deepEqual(final.environment[size], baseline.environment[size], `${size}: browser/sea environment changed.`);
    assert.equal(final.inventory[size].imageRequests, baseline.inventory[size].imageRequests, `${size}: image request count increased.`);
    assert.equal(final.inventory[size].uniqueImages, baseline.inventory[size].uniqueImages, `${size}: image count changed.`);
    assert.ok(final.inventory[size].imageBytes <= baseline.inventory[size].imageBytes, `${size}: compressed image budget increased.`);
    const canonical = (path) => path.replace(/-v\d+\./, ".");
    const dimensions = (report) => report.inventory[size].images.map((image) => ({ path: canonical(image.path), width: image.width, height: image.height }));
    assert.deepEqual(dimensions(final), dimensions(baseline), `${size}: image dimensions changed.`);
    for (const scenario of ["idle", "pan-zoom", "menu"]) {
      const before = baseline.samples.filter((sample) => sample.size === size && sample.scenario === scenario);
      const after = final.samples.filter((sample) => sample.size === size && sample.scenario === scenario);
      assert.equal(before.length, runs); assert.equal(after.length, runs);
      assert.deepEqual(after.map((sample) => sample.gameId), before.map((sample) => sample.gameId), `${size} ${scenario}: seeded game/ambient identifiers changed.`);
      const row = { size, scenario, metrics: {} };
      for (const metric of ["medianMs", "p95Ms", "estimatedDroppedPercent", "longTaskCount", "longTaskTotalMs", "longTaskMaxMs"]) {
        const old = percentile(before.map((sample) => sample[metric]), .5), current = percentile(after.map((sample) => sample[metric]), .5);
        // Timing allowance is the approved max(1 ms, 5%). Discrete drop/task
        // counts have no extra absolute timing allowance.
        const allowance = metric.endsWith("Ms") ? Math.max(1, old * .05) : old * .05;
        const repeats = after.filter((sample) => sample[metric] > old + allowance).length;
        const passed = current <= old + allowance || repeats < 2;
        row.metrics[metric] = { before: old, after: current, allowance, repeats, passed };
        if (!passed) failures.push(`${size} ${scenario} ${metric}: ${old.toFixed(2)} -> ${current.toFixed(2)} (allowance ${allowance.toFixed(2)}; ${repeats}/3 regressions)`);
      }
      rows.push(row);
    }
  }
  const comparison = { baseline: name, final: other, comparedAt: new Date().toISOString(), passed: !failures.length, failures, rows };
  await writeFile(resolve(output, "comparison.json"), JSON.stringify(comparison, null, 2));
  for (const row of rows) {
    const show = (metric) => `${row.metrics[metric].before.toFixed(2)} -> ${row.metrics[metric].after.toFixed(2)}`;
    console.log(`${row.size} ${row.scenario}: median ${show("medianMs")} ms, p95 ${show("p95Ms")} ms, estimated drops ${show("estimatedDroppedPercent")}%, long tasks ${show("longTaskCount")}`);
  }
  console.log(`Saved ${output}/comparison.json: ${comparison.passed ? "passed" : "failed"}`);
  if (failures.length) console.error(failures.join("\n"));
  assert.deepEqual(failures, [], "Repeated performance regressions exceed the approved tolerance.");
}

if (command === "freeze") await freeze();
else if (command === "measure") await measure();
else if (command === "compare") await compare();
else if (command === "serve") {
  const { server, url } = await serve(Number(process.argv[4] ?? 3004));
  console.log(`${name} QA ready: ${url}`);
  process.once("SIGINT", () => server.close());
} else throw new Error(`Unknown command: ${command}`);
