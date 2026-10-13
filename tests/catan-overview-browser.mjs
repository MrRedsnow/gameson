// Run against `node tests/catan-ux-preview.mjs` after building the application.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.CATAN_QA_URL ?? "http://127.0.0.1:3002";
const output = new URL("../.wrangler/catan-overview/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const sizes = [[320, 568], [390, 844], [1440, 1000]];
const overview = (page) => page.locator('[data-catan-menu-panel="uebersicht"]');
async function qa(page, change) {
  const controls = page.locator(".qa-controls");
  if (!await controls.evaluate((element) => element.open)) await controls.locator("summary").click();
  await change();
  await controls.evaluate((element) => { element.open = false; });
}
async function openOverview(page) {
  await page.locator('[data-catan-menu-trigger="uebersicht"]').click();
  await expect(overview(page)).toBeVisible();
}
async function assertStatColumns(page, width, snapshotName) {
  const panel = overview(page);
  const players = panel.getByRole("heading", { name: "Spieler", exact: true });
  const settings = panel.getByRole("heading", { name: "Verlauf und Einstellungen", exact: true });
  await expect(players).toBeVisible();
  await expect(settings).toBeAttached();
  const cards = panel.locator(".catan-player-card");
  await expect(cards).toHaveCount(4);
  assert.equal(await cards.evaluateAll((nodes) => nodes.some((node) => node.open)), false, "Additional player details begin collapsed.");
  for (const [kind, counts] of [["resources", [25, 5, 14, 9]], ["knights", [10, 3, 12, 1]], ["road", [12, 3, 10, 1]]]) {
    const stats = cards.locator(`[data-catan-stat="${kind}"]`);
    await expect(stats).toHaveCount(4);
    assert.deepEqual(await stats.locator("[data-catan-stat-value]").allTextContents(), counts.map(String));
    const boxes = await stats.evaluateAll((nodes) => nodes.map((node) => {
      const icon = node.querySelector("svg").getBoundingClientRect();
      const number = node.querySelector("[data-catan-stat-value]").getBoundingClientRect();
      const style = getComputedStyle(node.querySelector("[data-catan-stat-value]"));
      return { iconX: icon.x, iconRight: icon.right, valueX: number.x, valueRight: number.right, width: number.width, fontSize: parseFloat(style.fontSize) };
    }));
    for (const box of boxes) {
      assert.ok(Math.abs(box.iconX - boxes[0].iconX) < 1, `${kind} icons have a shared column at ${width}px.`);
      assert.ok(Math.abs(box.valueX - boxes[0].valueX) < 1, `${kind} numbers have a shared column at ${width}px.`);
      assert.ok(Math.abs(box.valueRight - boxes[0].valueRight) < 1, `${kind} numbers reserve the same width at ${width}px.`);
      assert.ok(box.valueX - box.iconRight >= 3, `${kind} symbols and counts have a visible gap.`);
      assert.ok(box.width >= box.fontSize, `${kind} numbers reserve room for two digits.`);
    }
  }
  const clipping = await panel.evaluate((element) => {
    const body = element.querySelector(".catan-screen-body");
    const screen = element.querySelector(".catan-screen");
    const summaries = [...element.querySelectorAll(".catan-player-card summary")];
    return { body: body.scrollWidth - body.clientWidth, bodyHeight: body.clientHeight, screenScrolls: getComputedStyle(screen).overflowY === "auto", summaries: summaries.map((summary) => summary.scrollWidth - summary.clientWidth) };
  });
  assert.ok(clipping.body <= 1 && clipping.summaries.every((overflow) => overflow <= 1), `Names and double digit stats fit without horizontal overflow at ${width}px.`);
  assert.ok(clipping.bodyHeight >= 44 || clipping.screenScrolls, `The player list has usable visible height or the whole menu scrolls at ${width}px (${clipping.bodyHeight}px body).`);
  const firstStats = panel.locator(".catan-player-stats").first();
  await firstStats.scrollIntoViewIfNeeded();
  assert.ok(await firstStats.evaluate((element) => {
    const number = element.querySelector('[data-catan-stat="road"] [data-catan-stat-value]');
    const range = document.createRange(); range.selectNodeContents(number);
    const box = range.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return element.closest(".catan-player-card").contains(target);
  }), `Stats can actually be seen inside the menu clipping area at ${width}px.`);
  await page.screenshot({ path: `${output}${snapshotName}-stats.png` });
  await panel.getByLabel("Bewegtes Wasser", { exact: true }).scrollIntoViewIfNeeded();
  await expect(panel.getByLabel("Bewegtes Wasser", { exact: true })).toBeVisible();
  assert.ok(await panel.getByLabel("Bewegtes Wasser", { exact: true }).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
  }), `The water checkbox can actually be reached inside the menu at ${width}px.`);
  await expect(panel.getByLabel("Lebendige Insel", { exact: true })).toBeVisible();
  const groups = await panel.locator(".catan-overview-section").all();
  assert.equal(groups.length, 2);
  for (const name of ["Spielverlauf", "Deine Meldungen", "Spielregeln & Baukosten"]) await expect(groups[1].getByRole("button", { name: name === "Deine Meldungen" ? /^Deine Meldungen/ : name, exact: true })).toBeAttached();
}

async function preferences(page) {
  const panel = overview(page);
  const island = panel.getByLabel("Lebendige Insel", { exact: true });
  const water = panel.getByLabel("Bewegtes Wasser", { exact: true });
  await island.scrollIntoViewIfNeeded();
  await expect(island).toBeChecked();
  await expect(water).toBeChecked();
  await island.uncheck();
  await expect(water).toBeChecked();
  await expect(page.locator(".catan-board")).toHaveAttribute("data-catan-ambient-active", "false");
  await expect(page.locator(".catan-board")).toHaveAttribute("data-catan-water-enabled", "true");
  await water.uncheck();
  await expect(page.locator(".catan-board")).toHaveAttribute("data-catan-water-enabled", "false");
  await expect(page.locator(".catan-sea-surface")).toHaveCSS("opacity", "0");
  await expect(page.locator("[data-catan-sea-ready]")).toHaveAttribute("data-catan-sea-ready", "false");
  const before = await page.evaluate(() => window.qaWaterDraws);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.qaWaterDraws), before, "Disabled water performs no continuous canvas draws.");
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem("catan-ambient-enabled"), localStorage.getItem("catan-water-enabled")]), ["false", "false"]);
  await page.reload();
  await expect(page.locator(".catan-board")).toBeVisible();
  await openOverview(page);
  await island.scrollIntoViewIfNeeded();
  await expect(island).not.toBeChecked();
  await expect(water).not.toBeChecked();
  await expect(page.locator(".catan-board")).toHaveAttribute("data-catan-water-enabled", "false");
  await island.check();
  await expect(water).not.toBeChecked();
  await expect(page.locator(".catan-board")).toHaveAttribute("data-catan-ambient-active", "true");
  await expect(page.locator(".catan-sea-surface")).toHaveCSS("opacity", "0");
  await water.check();
  await expect(page.locator(".catan-board")).toHaveAttribute("data-catan-water-enabled", "true");
  await expect(page.locator("[data-catan-sea-ready]")).toHaveAttribute("data-catan-sea-ready", "true");
  const resumed = await page.evaluate(() => window.qaWaterDraws);
  await expect.poll(() => page.evaluate(() => window.qaWaterDraws)).toBeGreaterThan(resumed);
  await page.reload();
  await openOverview(page);
  await expect(island).toBeChecked();
  await expect(water).toBeChecked();
}

try {
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "no-preference" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.qaWaterDraws = 0;
      const original = WebGLRenderingContext.prototype.drawArrays;
      WebGLRenderingContext.prototype.drawArrays = function (...args) {
        if (this.canvas.classList.contains("catan-sea-surface")) window.qaWaterDraws++;
        return original.apply(this, args);
      };
    });
    await page.goto(baseURL);
    await expect(page.locator(".catan-board")).toBeVisible();
    await qa(page, () => page.getByLabel("Prüfsituation").selectOption("overview-stats"));
    for (const expanded of [false, true]) {
      if (expanded) await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
      for (const largeText of [false, true]) {
        await qa(page, () => page.getByLabel("Text 200%", { exact: true }).setChecked(largeText));
        await openOverview(page);
        const snapshotName = `${width}x${height}-${expanded ? "expanded" : "normal"}-${largeText ? "text200" : "text100"}`;
        await assertStatColumns(page, width, snapshotName);
        await overview(page).evaluate((element) => {
          element.querySelector(".catan-screen-body").scrollTop = 0;
          element.querySelector(".catan-screen").scrollTop = 0;
          element.closest(".catan-shell-play").scrollTop = 0;
        });
        await page.screenshot({ path: `${output}${snapshotName}.png` });
        await overview(page).getByRole("button", { name: "Menü schließen", exact: true }).click();
      }
      await qa(page, () => page.getByLabel("Text 200%", { exact: true }).uncheck());
    }
    await page.getByRole("button", { name: "Vollbild der Insel schließen", exact: true }).click();
    await openOverview(page);
    await preferences(page);
    await page.close();
  }
  assert.deepEqual(errors, [], "Overview changes cause no browser runtime errors.");
  console.log("Catan overview passed: aligned symbol/count columns, two-digit values, grouped settings and persistent independent motion preferences at three sizes and 200% text.");
} finally { await browser.close(); }
