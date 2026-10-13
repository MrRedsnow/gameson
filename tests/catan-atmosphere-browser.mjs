// Run with CATAN_QA_FIXTURE=catan-atmosphere.tsx node tests/catan-ux-preview.mjs.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.CATAN_QA_URL ?? "http://127.0.0.1:3002";
const output = new URL("../.wrangler/catan-atmosphere/", import.meta.url).pathname;
const sizes = [[320, 568], [390, 844], [844, 390], [1440, 1000]];
const errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });

function monitor(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
}

async function qa(page, change) {
  const controls = page.locator(".qa-controls");
  if (!await controls.evaluate((element) => element.open)) await controls.locator("summary").click();
  await change();
  await controls.evaluate((element) => { element.open = false; });
}

async function zoom(page, target) {
  await page.getByRole("button", { name: "Ganze Insel anzeigen und zentrieren", exact: true }).click();
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = Number(await page.locator(".catan-board").getAttribute("data-zoom"));
    if (Math.abs(current - target) < .001) break;
    const box = await page.locator(".catan-board-viewport").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, Math.max(-600, Math.min(600, -Math.log(target / current) / .002)));
    await expect(page.locator(".catan-board-viewport")).toHaveAttribute("data-interacting", "false");
  }
  await expect.poll(async () => Number(await page.locator(".catan-board").getAttribute("data-zoom"))).toBeCloseTo(target, 3);
}

async function boundedLayers(page, width) {
  const cloud = page.locator('[data-atmosphere-kind="cloud"]');
  const shadow = page.locator('[data-atmosphere-kind="shadow"]');
  await expect(cloud.first()).toBeAttached();
  const visibleClouds = await cloud.evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== "none").length);
  assert.equal(visibleClouds, width <= 639 ? 1 : 2);
  const widths = await cloud.evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== "none")
    .map((node) => {
      // SVG DOM bounding boxes include the complete referenced atlas even when
      // overflow clips it. Measure the visible viewport through its real CTM.
      const crop = node.querySelector(".catan-atmosphere-cloud-size > svg"); const matrix = crop.getScreenCTM();
      return crop.viewBox.baseVal.width * Math.hypot(matrix.a, matrix.b);
    }));
  assert.ok(widths.every((value) => value >= 89 && value <= (width <= 639 ? 140 : 220) + 1), `Cloud width stays legible and bounded in screen pixels at every camera scale (${width}px viewport: ${widths.join(", ")}).`);
  assert.equal(await shadow.count(), await cloud.count(), "Each cloud has exactly one corresponding shadow.");
  const clouds = await cloud.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-atmosphere-id")));
  const shadows = await shadow.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-atmosphere-id").replace(/-shadow$/, "")));
  assert.deepEqual([...clouds].sort(), [...shadows].sort());
  assert.ok(await page.locator('[data-atmosphere-kind="surf"]').count() <= 2);
  assert.ok(await page.locator('[data-atmosphere-kind="sea_fog"]').count() <= 1);
  assert.ok(await page.locator('[data-atmosphere-kind="sea_fog"]').count() >= 1, "The deterministic preview includes offshore fog.");
  const invalid = await page.locator('.catan-ambient-island, [data-atmosphere-kind]').evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).pointerEvents !== "none").length);
  assert.equal(invalid, 0, "Scenery cannot intercept map selections.");
  await expect(page.locator(".catan-ambient-island")).toHaveAttribute("aria-hidden", "true");
}

async function movement(page, selector) {
  const node = page.locator(selector).first();
  await expect(node).toBeAttached();
  await expect.poll(() => node.getAttribute("transform")).not.toBeNull();
  const before = await node.getAttribute("transform");
  await expect.poll(() => node.getAttribute("transform"), { timeout: 2500 }).not.toBe(before);
}

async function pick(page, kind) {
  await qa(page, () => page.getByLabel("Passiver Effekt", { exact: true }).selectOption(""));
  await qa(page, () => page.getByLabel("Passiver Effekt", { exact: true }).selectOption(kind));
  const scene = page.locator(`[data-ambient-kind="${kind}"]`);
  await expect(scene).toHaveCount(1);
  return scene;
}

async function shipWidth(scene) {
  return scene.locator(".catan-ambient-body > svg").evaluate((crop) => {
    const matrix = crop.getScreenCTM();
    return crop.viewBox.baseVal.width * Math.hypot(matrix.a, matrix.b);
  });
}

async function shipNotClipped(scene) {
  const result = await scene.evaluate((node) => {
    const svg = node.ownerSVGElement;
    const clipId = node.closest("[clip-path]").getAttribute("clip-path").match(/#([^)]*)/)[1];
    const clip = document.getElementById(clipId).querySelector("path").getBBox();
    const viewport = svg.viewBox.baseVal;
    const source = node.querySelector(".catan-ambient-body > svg");
    const elements = [{ node: source, rect: source.viewBox.baseVal }, ...[...node.querySelectorAll("[data-ambient-wake]")].map((wake) => ({ node: wake, rect: wake.getBBox() }))];
    const points = elements.flatMap(({ node: child, rect }) => {
      const matrix = svg.getScreenCTM().inverse().multiply(child.getScreenCTM());
      return [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
    });
    const within = (rect) => points.every(({ x, y }) => x >= rect.x - .01 && y >= rect.y - .01 && x <= rect.x + rect.width + .01 && y <= rect.y + rect.height + .01);
    return { clip: within(clip), viewport: within(viewport) };
  });
  assert.equal(result.clip, true, "The sea clip contains the whole ship viewport and wake, including routes in the letterboxed water.");
  assert.equal(result.viewport, true, "The whole ship and wake remain inside the fitted camera view.");
}

async function selectionThroughScenery(page) {
  await zoom(page, 1);
  await qa(page, () => page.getByLabel("Kartenaktion", { exact: true }).selectOption("robber"));
  const fields = page.getByRole("button", { name: /^Räuber auf Feld/ });
  const fieldIndex = await fields.evaluateAll((nodes) => nodes.findIndex((node) => {
    const rect = node.querySelector(".catan-hex-border").getBoundingClientRect();
    return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  }));
  assert.ok(fieldIndex >= 0, "There is an unobstructed map selection beneath the decoration.");
  const target = fields.nth(fieldIndex);
  const before = Number(await page.locator("[data-qa-selections]").textContent());
  await target.locator(".catan-hex-border").click();
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-qa-selections]")).toHaveText(String(before + 1));
  await qa(page, () => page.getByLabel("Kartenaktion", { exact: true }).selectOption("road"));
  const roads = page.getByRole("button", { name: /^Straße auf Weg/ });
  const roadIndex = await roads.evaluateAll((nodes) => nodes.findIndex((node) => {
    const rect = node.querySelector(".catan-road-target").getBoundingClientRect();
    return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  }));
  assert.ok(roadIndex >= 0, "There is an unobstructed road target beneath the decoration.");
  const road = roads.nth(roadIndex);
  await road.locator(".catan-road-target").click();
  await expect(road).toHaveAttribute("aria-pressed", "true");
  await qa(page, () => page.getByLabel("Kartenaktion", { exact: true }).selectOption(""));
}

async function gesturePause(page) {
  await zoom(page, 3);
  const box = await page.locator(".catan-board-viewport").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2 + 4);
  await expect(page.locator(".catan-board-viewport")).toHaveAttribute("data-interacting", "true");
  const clouds = page.locator('[data-atmosphere-kind="cloud"]');
  const frozen = await clouds.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform")));
  await page.waitForTimeout(250);
  assert.deepEqual(await clouds.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform"))), frozen, "The ambient renderer makes no cloud presentation writes while the camera owns the gesture.");
  await page.mouse.up();
  await expect(page.locator(".catan-board-viewport")).toHaveAttribute("data-interacting", "false");
  await movement(page, '[data-atmosphere-kind="cloud"]');
  const parse = (transform) => transform.match(/translate\(([-\d.e]+) ([-\d.e]+)\)/).slice(1).map(Number);
  const before = parse(frozen[0]); const after = parse(await clouds.first().getAttribute("transform"));
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 8, "Resuming the scene cannot jump through the time spent panning.");
  await zoom(page, 1);
}

async function motionOff(page) {
  await qa(page, () => page.getByLabel("Insel beleben", { exact: true }).uncheck());
  await expect(page.locator(".catan-board")).toHaveAttribute("data-catan-ambient-active", "false");
  const frozen = await page.locator('[data-atmosphere-kind="cloud"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform")));
  await page.waitForTimeout(250);
  assert.deepEqual(await page.locator('[data-atmosphere-kind="cloud"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform"))), frozen);
  await page.reload();
  await qa(page, async () => { await expect(page.getByLabel("Insel beleben", { exact: true })).not.toBeChecked(); await page.getByLabel("Insel beleben", { exact: true }).check(); });
  await movement(page, '[data-atmosphere-kind="cloud"]');
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".catan-board")).toHaveAttribute("data-catan-ambient-active", "false");
  const reduced = await page.locator('[data-atmosphere-kind="cloud"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform")));
  await page.waitForTimeout(250);
  assert.deepEqual(await page.locator('[data-atmosphere-kind="cloud"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform"))), reduced);
  await expect(page.locator(".catan-sea-surface")).toBeHidden();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await movement(page, '[data-atmosphere-kind="cloud"]');
  await qa(page, () => page.getByLabel("Insel sichtbar", { exact: true }).uncheck());
  await expect(page.locator(".catan-board")).toHaveAttribute("data-catan-ambient-active", "false");
  const inactive = await page.locator('[data-atmosphere-kind="cloud"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform")));
  await page.waitForTimeout(250);
  assert.deepEqual(await page.locator('[data-atmosphere-kind="cloud"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("transform"))), inactive);
  await qa(page, () => page.getByLabel("Insel sichtbar", { exact: true }).check());
  await movement(page, '[data-atmosphere-kind="cloud"]');
}

try {
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "no-preference" });
    monitor(page);
    await page.goto(baseURL);
    await boundedLayers(page, width);
    await movement(page, '[data-atmosphere-kind="cloud"]');
    await expect.poll(async () => Number(await page.locator('[data-atmosphere-kind="cloud"]').first().getAttribute("opacity"))).toBeGreaterThan(.3);
    for (const expanded of [false, true]) {
      if (expanded) await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
      await expect(page.locator("[data-qa-expanded]")).toHaveAttribute("data-qa-expanded", String(expanded));
      for (const level of [1, 3, 6]) {
        await zoom(page, level);
        await boundedLayers(page, width);
        const viewport = await page.locator(".catan-board-viewport").boundingBox();
        assert.ok(viewport.width >= width - 20 && viewport.height >= height - 80, "The overview and zoom preserve a usable map viewport.");
        await page.screenshot({ path: `${output}${width}x${height}-${expanded ? "fullscreen" : "normal"}-zoom${level}.png` });
      }
    }
    await page.getByRole("button", { name: "Vollbild der Insel schließen", exact: true }).click();
    await zoom(page, 1);
    await gesturePause(page);
    const gull = await pick(page, "gull");
    assert.ok(await gull.locator("[data-ambient-flock-bird]").count() >= 2);
    assert.equal(await gull.locator("[data-ambient-flock-bird]").evaluateAll((birds) => birds.filter((bird) => getComputedStyle(bird).display !== "none").length), width <= 639 ? 2 : 3);
    await movement(page, '[data-ambient-kind="gull"]');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${output}${width}x${height}-gull.png` });
    const boat = await pick(page, "sailboat");
    await expect(boat).toHaveAttribute("data-boat-size", "44");
    assert.ok(await boat.locator("[data-ambient-wake]").count() >= 1);
    await movement(page, '[data-ambient-kind="sailboat"]');
    await page.waitForTimeout(450);
    await shipNotClipped(boat);
    await page.screenshot({ path: `${output}${width}x${height}-sailboat.png` });
    const sailboatWidth = await shipWidth(boat);
    const pirate = await pick(page, "pirate_ship");
    await expect(pirate).toHaveAttribute("data-boat-size", "88");
    assert.ok(await pirate.locator("[data-ambient-wake]").count() >= 1);
    assert.ok(Math.abs(await shipWidth(pirate) / sailboatWidth - 2) < .001, "The pirate ship renders at twice the sailboat's visible viewport width with the same camera.");
    await movement(page, '[data-ambient-kind="pirate_ship"]');
    await page.waitForTimeout(450);
    await shipNotClipped(pirate);
    await page.screenshot({ path: `${output}${width}x${height}-pirate-ship.png` });
    await selectionThroughScenery(page);
    await pick(page, "desert_dust");
    await movement(page, '[data-ambient-kind="desert_dust"]');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${output}${width}x${height}-desert-dust.png` });
    await pick(page, "wind");
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${output}${width}x${height}-wind.png` });
    await selectionThroughScenery(page);
    await motionOff(page);
    await page.close();
  }

  for (const assets of [["clouds-atlas-v1.png"], ["sailboats-directions-v1.png"], ["pirate-ships-directions-v1.png"], ["clouds-atlas-v1.png", "sailboats-directions-v1.png"], ["clouds-atlas-v1.png", "sailboats-directions-v1.png", "pirate-ships-directions-v1.png"]]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" });
    monitor(page);
    for (const asset of assets) await page.route(`**/catan/${asset}`, (route) => route.abort());
    await page.goto(baseURL);
    await page.waitForTimeout(250);
    if (assets.includes("clouds-atlas-v1.png")) {
      await expect(page.locator('[data-atmosphere-kind="cloud"]')).toHaveCount(0);
      await expect(page.locator('[data-atmosphere-kind="sea_fog"]')).toHaveCount(0);
    } else await expect(page.locator('[data-atmosphere-kind="cloud"]').first()).toBeAttached();
    await qa(page, () => page.getByLabel("Passiver Effekt", { exact: true }).selectOption("sailboat"));
    await expect(page.locator('[data-ambient-kind="sailboat"]')).toHaveCount(assets.includes("sailboats-directions-v1.png") ? 0 : 1);
    await qa(page, () => page.getByLabel("Passiver Effekt", { exact: true }).selectOption("pirate_ship"));
    await expect(page.locator('[data-ambient-kind="pirate_ship"]')).toHaveCount(assets.includes("pirate-ships-directions-v1.png") ? 0 : 1);
    assert.ok(await page.locator('[data-atmosphere-kind="surf"]').count() >= 1, "A failed atlas does not remove procedural coastal surf.");
    await selectionThroughScenery(page);
    await page.screenshot({ path: `${output}failed-${assets.length === 3 ? "all" : assets.length === 2 ? "both" : assets[0].startsWith("cloud") ? "cloud" : assets[0].startsWith("pirate") ? "pirate" : "boat"}.png` });
    await page.close();
  }
  assert.deepEqual(errors, [], "Atmosphere fixture browser errors");
  console.log("Catan atmosphere checks passed: four screen sizes; zoom 1, 3 and 6; normal/native fullscreen where available; moving clouds/flocks/sailing boat/pirate ship at double size; selection through scenery; persisted ambient toggle; reduced motion; independent asset failures.");
} finally {
  await browser.close();
}
