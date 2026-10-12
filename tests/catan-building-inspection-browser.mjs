// After npm run build, run directly: node tests/catan-building-inspection-browser.mjs.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const output = new URL("../.wrangler/catan-building-inspection/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
await build({ entryPoints: [resolve(root, "tests/fixtures/catan-building-inspection.tsx")], outfile: `${output}app.js`, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "silent" });
const cssDir = resolve(root, "dist/client/_next/static/css");
const baseCss = (await readdir(cssDir)).find((name) => name.startsWith("index."));
const detailStyles = ["resource-feedback.css", "event-notice.css", "board-effects.css", "ambient-island.css"];
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/catan.css">${detailStyles.map((style) => `<link rel="stylesheet" href="/${style}">`).join("")}<style>.qa-controls{position:fixed;z-index:200;right:4px;top:0;color:#fff;background:#334;padding:4px;font:12px Arial}.qa-controls label{display:grid;gap:8px}.qa-controls select{background:#223;padding:8px}body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
    } else {
      const file = path === "/app.js" ? `${output}app.js` : path === "/base.css" ? resolve(cssDir, baseCss) : path === "/catan.css" ? resolve(root, "app/catan/catan.css") : detailStyles.includes(path.slice(1)) ? resolve(root, "components/catan", path.slice(1)) : path.startsWith("/catan/") ? resolve(root, "public", path.slice(1)) : null;
      if (!file) { response.writeHead(404); response.end(); return; }
      response.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".png") ? "image/png" : "image/jpeg");
      response.end(await readFile(file));
    }
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const baseURL = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const info = (page) => page.locator(".catan-board-field-info");
const owner = (page, name, kind = "Siedlung") => page.getByRole("button", { name: new RegExp(`^Besitzer ansehen: ${kind} · ${name},`) }).first();
const expectedInfo = async (building) => (await building.getAttribute("aria-label")).replace("Besitzer ansehen: ", "").replace(/, Kreuzung \d+$/, "");
async function qa(page, change) {
  const controls = page.locator(".qa-controls");
  if (!await controls.evaluate((element) => element.open)) await controls.locator("summary").click();
  await change();
  await controls.evaluate((element) => { element.open = false; });
}
async function reset(page, expanded = false) {
  const cancel = page.locator(".catan-island-screen").getByRole("button", { name: "Abbrechen", exact: true });
  if (await cancel.isVisible()) {
    await cancel.click();
    await page.locator('[data-catan-menu-panel="bauen"]').getByRole("button", { name: "Menü schließen", exact: true }).click();
  }
  await qa(page, () => page.getByRole("button", { name: "Neue Partie", exact: true }).click());
  const isExpanded = await page.locator(".catan-play").evaluate((element) => element.classList.contains("is-board-expanded"));
  if (expanded !== isExpanded) await page.getByRole("button", { name: expanded ? "Insel im Vollbild öffnen" : "Vollbild der Insel schließen", exact: true }).click();
  await expect(info(page)).toHaveCount(0);
  await page.locator(".catan-board").evaluate(async (svg) => {
    let previous = ""; let stable = 0;
    for (let frame = 0; frame < 30 && stable < 3; frame++) {
      await new Promise(requestAnimationFrame);
      const next = svg.getAttribute("viewBox"); stable = next === previous ? stable + 1 : 0; previous = next;
    }
  });
}
async function clickBuilding(page, building, touch = false) {
  const hit = building.locator(".catan-building-hit-area");
  const box = await hit.boundingBox();
  assert.ok(box && box.width >= 47 && box.height >= 47, "Buildings need a touch-sized hit area");
  const point = await hit.evaluate((rect) => {
    const box = rect.getBoundingClientRect();
    for (const [x, y] of [[.5, .5], [.5, .75], [.5, .25], [.25, .5], [.75, .5]]) {
      const point = { x: box.left + box.width * x, y: box.top + box.height * y };
      if (document.elementFromPoint(point.x, point.y)?.closest(".catan-board") === rect.ownerSVGElement) return point;
    }
    return null;
  });
  // Existing floating controls can cover a particular house; its keyboard target stays usable.
  if (!point) { await building.focus(); await page.keyboard.press("Enter"); }
  else if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect(info(page)).toHaveText(await expectedInfo(building));
}
async function layout(page) {
  const geometry = await info(page).evaluate((element) => {
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    const play = element.closest(".catan-play");
    const controls = [...play.querySelectorAll(".catan-hand-bar,.catan-island-context,.catan-island-tools button,.catan-board-controls button,.catan-nav")]
      .filter((node) => { const style = getComputedStyle(node); return style.display !== "none" && style.visibility !== "hidden" && node.getBoundingClientRect().height; })
      .map((node) => ({ label: node.getAttribute("aria-label") || node.className, rect: box(node) }));
    return { info: box(element), viewport: box(element.closest(".catan-board-viewport")), controls, overflow: element.scrollWidth > element.clientWidth + 1 };
  });
  assert.equal(geometry.overflow, false, "Long player names must wrap");
  assert.ok(geometry.info.left >= geometry.viewport.left && geometry.info.right <= geometry.viewport.right + 1 && geometry.info.top >= geometry.viewport.top && geometry.info.bottom <= geometry.viewport.bottom + 1, "Owner info must stay inside the map");
  for (const control of geometry.controls) {
    const width = Math.min(geometry.info.right, control.rect.right) - Math.max(geometry.info.left, control.rect.left);
    const height = Math.min(geometry.info.bottom, control.rect.bottom) - Math.max(geometry.info.top, control.rect.top);
    assert.ok(width <= 1 || height <= 1, `Owner info overlaps ${control.label}`);
  }
}
async function buildMode(page, kind) {
  await page.locator('[data-catan-menu-trigger="bauen"]').click();
  const menu = page.locator('[data-catan-menu-panel="bauen"]');
  await menu.locator(".catan-build-choice").filter({ has: page.locator("strong", { hasText: new RegExp(`^${kind}$`) }) }).click();
  await menu.getByRole("button", { name: "Auswählen", exact: true }).click();
  await expect(menu).toBeHidden();
}

try {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 1000]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: "reduce" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(document, "fullscreenEnabled", { value: false }));
    await page.goto(baseURL);
    await expect(page.locator(".catan-board")).toBeVisible();
    for (const expanded of [false, true]) {
      await reset(page, expanded);
      const originalCamera = await page.locator(".catan-board").getAttribute("viewBox");
      for (const [name, kind, touch] of [["Anna", "Siedlung", false], ["BenjaminAlexanderWagner", "Siedlung", true], ["Clara", "Stadt", false]]) {
        await clickBuilding(page, owner(page, name, kind), touch);
        await layout(page);
        await expect(page.locator(".catan-board")).toHaveAttribute("viewBox", originalCamera);
        await expect(page.locator("[data-qa-actions]")).toHaveText("0");
      }
      await owner(page, "Anna").focus();
      await page.keyboard.press("Enter");
      await expect(info(page)).toHaveText("Siedlung · Anna");
      await owner(page, "BenjaminAlexanderWagner").focus();
      await page.keyboard.press("Space");
      await expect(info(page)).toHaveText("Siedlung · BenjaminAlexanderWagner");
      await qa(page, () => page.getByRole("button", { name: "Name ändern", exact: true }).click());
      await expect(info(page)).toHaveText("Siedlung · Mara");
      const field = page.getByRole("button", { name: /^Feld ansehen:/ }).first();
      await field.focus(); await page.keyboard.press("Enter");
      await expect(info(page)).not.toContainText("Mara");
      await clickBuilding(page, owner(page, "Mara"), true);
      await page.getByRole("button", { name: "Ganze Insel anzeigen und zentrieren", exact: true }).click();
      await expect(info(page)).toHaveCount(0);

      const house = owner(page, "Anna");
      const hit = await house.locator(".catan-building-hit-area").boundingBox();
      await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
      await page.mouse.down();
      await page.mouse.move(hit.x + hit.width / 2 + 35, hit.y + hit.height / 2 + 15, { steps: 6 });
      await page.mouse.up();
      await expect(info(page)).toHaveCount(0);
      await page.getByRole("button", { name: "Ganze Insel anzeigen und zentrieren", exact: true }).click();
      await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
      await page.mouse.wheel(0, -120);
      await expect(info(page)).toHaveCount(0);
      await page.getByRole("button", { name: "Ganze Insel anzeigen und zentrieren", exact: true }).click();

      await buildMode(page, "Stadt");
      const cityTarget = page.getByRole("button", { name: /^Stadt auf Kreuzung/ }).first();
      const cityPoint = await cityTarget.locator("circle").first().evaluate((circle) => {
        const box = circle.getBoundingClientRect();
        for (const [x, y] of [[.5, .5], [.5, .75], [.5, .25], [.25, .5], [.75, .5]]) {
          const point = { x: box.left + box.width * x, y: box.top + box.height * y };
          if (document.elementFromPoint(point.x, point.y)?.closest(".catan-board") === circle.ownerSVGElement) return point;
        }
        return null;
      });
      if (cityPoint) await page.mouse.click(cityPoint.x, cityPoint.y);
      else { await cityTarget.focus(); await page.keyboard.press("Enter"); }
      await expect(cityTarget).toHaveAttribute("aria-pressed", "true");
      await expect(info(page)).toHaveText("Siedlung · Anna");
      await expect(page.locator("[data-qa-actions]")).toHaveText("0");
      await layout(page);
      await page.locator(".catan-island-screen").getByRole("button", { name: /^(Bauen|Bauen bestätigen)$/ }).click();
      await expect(info(page)).toHaveText("Stadt · Anna");
      await clickBuilding(page, owner(page, "Anna", "Stadt"), true);
      await expect(page.locator("[data-qa-actions]")).toHaveText("1");

      for (const kind of ["Straße", "Siedlung"]) {
        await reset(page, expanded);
        await buildMode(page, kind);
        const foreign = owner(page, "Clara", "Stadt");
        await foreign.focus(); await page.keyboard.press("Enter");
        await expect(info(page)).toHaveText("Stadt · Clara");
        await expect(page.locator("[data-qa-actions]")).toHaveText("0");
        const target = page.getByRole("button", { name: kind === "Straße" ? /^Straße auf Weg/ : /^Siedlung auf Kreuzung/ }).first();
        await target.focus(); await page.keyboard.press("Enter");
        await expect(target).toHaveAttribute("aria-pressed", "true");
        await layout(page);
      }

      await reset(page, expanded);
      await qa(page, () => page.getByLabel("Prüfphase").selectOption("robber"));
      const foreign = owner(page, "BenjaminAlexanderWagner");
      await clickBuilding(page, foreign, true);
      await expect(page.locator('.catan-board [aria-label^="Räuber auf Feld"][aria-pressed="true"]')).toHaveCount(1);
      await expect(page.locator("[data-qa-actions]")).toHaveText("0");
      await layout(page);
      await page.screenshot({ path: `${output}${width}x${height}-${expanded ? "expanded" : "normal"}.png` });
      await reset(page, expanded);
      await qa(page, () => page.getByLabel("Prüfphase").selectOption("waiting"));
      await clickBuilding(page, owner(page, "BenjaminAlexanderWagner"), true);
      await layout(page);
    }
    await page.close();
  }
  assert.deepEqual(errors, [], "Browser errors");
  console.log("Catan building inspection passed: mouse, touch, keyboard, live ownership, city upgrade, new game, placement priority, gestures and four viewport sizes in normal/fullscreen layouts.");
} finally {
  if (errors.length) console.error("Browser errors:", errors);
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
