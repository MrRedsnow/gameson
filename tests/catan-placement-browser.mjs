// Run against `node tests/catan-ux-preview.mjs` with the default catan-ux.tsx fixture.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.CATAN_QA_URL ?? "http://127.0.0.1:3002";
const output = new URL("../.wrangler/catan-placement/", import.meta.url).pathname;
const sizes = [[320, 568], [390, 844], [844, 390], [1440, 1000]];
const controlSelector = ".catan-island-dock button, .catan-board-controls button, .catan-island-tools button, .catan-nav button";
const errors = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function qa(page, change) {
  const controls = page.locator(".qa-controls");
  if (!await controls.evaluate((element) => element.open)) await controls.locator("summary").click();
  await change();
  await controls.evaluate((element) => { element.open = false; });
}

async function scenario(page, name, expanded) {
  await qa(page, () => page.getByLabel("Prüfsituation").selectOption(name));
  if (expanded) await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
  await expect(page.locator(".catan-play")).toHaveClass(expanded ? /is-board-expanded/ : /^(?!.*is-board-expanded)/);
}

async function reachable(locator, width, height) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1,
    `Control clipped at ${width}×${height}: ${await locator.getAttribute("aria-label") ?? await locator.textContent()} ${JSON.stringify(box)}`);
  assert.ok(await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    // The shared Button disables pointer events for disabled actions, so its own
    // background container is the expected hit target in that state.
    return element.contains(hit) || (element.disabled && hit?.contains(element));
  }), `Control covered: ${await locator.getAttribute("aria-label") ?? await locator.textContent()}`);
}

async function layout(page, width, height) {
  await expect(page.locator(".catan-island-dock")).toBeVisible();
  await expect(page.locator(".catan-island-canvas .catan-board-selection")).toHaveCount(0);
  const geometry = await page.locator(".catan-play").evaluate((play, selector) => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    // A scrolled-out card has a DOM box but no visible hit area. Compare only the area
    // that survives clipping by scroll containers and the viewport.
    const visibleBox = (element) => {
      const rect = box(element);
      rect.left = Math.max(0, rect.left); rect.top = Math.max(0, rect.top);
      rect.right = Math.min(innerWidth, rect.right); rect.bottom = Math.min(innerHeight, rect.bottom);
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent); const clip = box(parent);
        if (style.overflowX !== "visible") { rect.left = Math.max(rect.left, clip.left); rect.right = Math.min(rect.right, clip.right); }
        if (style.overflowY !== "visible") { rect.top = Math.max(rect.top, clip.top); rect.bottom = Math.min(rect.bottom, clip.bottom); }
      }
      return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
    };
    const controls = [...play.querySelectorAll(selector)].filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().width;
    }).map((element) => ({ label: element.getAttribute("aria-label") ?? element.textContent, rect: visibleBox(element) })).filter((control) => control.rect);
    const overflow = [document.documentElement, play, ...play.querySelectorAll(".catan-island-dock, .catan-steal-panel, .catan-victim-choice")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => `${element.className || element.tagName}: ${element.scrollWidth} > ${element.clientWidth}`);
    return { canvas: box(play.querySelector(".catan-island-canvas")), dock: box(play.querySelector(".catan-island-dock")), nav: box(play.querySelector(".catan-nav")), controls, overflow };
  }, controlSelector);
  assert.deepEqual(geometry.overflow, [], `Horizontal overflow at ${width}×${height}`);
  assert.ok(geometry.canvas.bottom <= geometry.dock.top + 1, "Map canvas must end above the action dock");
  assert.ok(geometry.dock.bottom <= geometry.nav.top + 1, "Action dock must end above the game navigation");
  assert.ok(geometry.canvas.bottom - geometry.canvas.top >= 40, "The map must retain an interactive viewport");
  for (let i = 0; i < geometry.controls.length; i++) for (let j = i + 1; j < geometry.controls.length; j++) {
    const a = geometry.controls[i]; const b = geometry.controls[j];
    const overlapWidth = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
    const overlapHeight = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
    assert.ok(overlapWidth <= 1 || overlapHeight <= 1, `Controls overlap at ${width}×${height}: ${a.label} / ${b.label}`);
  }
  for (const control of await page.locator(controlSelector).all()) await reachable(control, width, height);
  await reachable(page.locator(".catan-nav"), width, height);
}

async function robber(page, width, height, expanded, largeText = false) {
  await scenario(page, "robber", expanded);
  const previous = page.getByRole("button", { name: "Vorheriger Bauplatz oder Räuberplatz", exact: true });
  const next = page.getByRole("button", { name: "Nächster Bauplatz oder Räuberplatz", exact: true });
  const commit = page.locator(".catan-placement-actions").getByRole("button", { name: "Räuber versetzen", exact: true });
  const selected = page.locator('.catan-board g[role="button"][aria-pressed="true"]');
  await expect(page.locator(".catan-placement-heading")).toContainText("Räuber");
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(commit).toBeDisabled();
  await layout(page, width, height);
  await next.click();
  await expect(selected).toHaveCount(1);
  const first = await selected.getAttribute("aria-label");
  await expect(commit).toBeEnabled();
  await next.click();
  await expect(selected).not.toHaveAttribute("aria-label", first);
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(selected).toHaveAttribute("aria-label", first);
  const field = page.getByRole("button", { name: /^Räuber auf Feld/ }).nth(3);
  const fieldLabel = await field.getAttribute("aria-label");
  // Terrain artwork extends beyond the clipped hex in SVG geometry. Click the
  // actual hex polygon rather than the artwork group's oversized bounding box.
  await field.locator(".catan-hex-border").click();
  await expect(selected).toHaveAttribute("aria-label", fieldLabel);
  await layout(page, width, height);
  await page.screenshot({ path: `${output}${width}x${height}-${expanded ? "expanded" : "normal"}-${largeText ? "large-text-" : ""}robber.png` });
  if (largeText) return;

  await qa(page, () => page.getByLabel("Aktion blockieren").check());
  for (const button of [previous, next, commit]) await expect(button).toBeDisabled();
  await expect(field).toHaveAttribute("aria-disabled", "true");
  await expect(selected).toHaveAttribute("aria-label", fieldLabel);
  await qa(page, () => page.getByLabel("Aktion blockieren").uncheck());
  await qa(page, () => page.getByLabel("Aktion ablehnen").check());
  const sequence = await page.locator(".catan-play").getAttribute("data-catan-sequence");
  await commit.click();
  await expect(page.getByRole("alert")).toContainText("Aktion wurde abgelehnt");
  await expect(selected).toHaveAttribute("aria-label", fieldLabel);
  await expect(commit).toBeEnabled();
  await expect(page.locator(".catan-play")).toHaveAttribute("data-catan-sequence", sequence);
  await qa(page, () => page.getByLabel("Aktion ablehnen").uncheck());
  await commit.click();
  await expect(page.locator(".catan-placement-controls")).toHaveCount(0);
  await expect(page.locator(".catan-robber-layer")).toHaveAttribute("data-catan-robber", String(Number(fieldLabel.match(/Feld (\d+)/)[1]) - 1));
  await expect(page.locator(".catan-play")).not.toHaveAttribute("data-catan-sequence", sequence);
}

async function steal(page, width, height, expanded, largeText = false) {
  await scenario(page, "steal", expanded);
  const choices = page.locator(".catan-victim-choice");
  await expect(page.locator(".catan-steal-panel")).toBeVisible();
  await expect(choices).toHaveCount(3);
  for (const [index, name] of ["Benjamin Alexander", "Clara", "Dominik Maximilian"].entries()) {
    await expect(choices.nth(index)).toHaveAttribute("aria-label", `${name} bestehlen`);
    await expect(choices.nth(index)).toContainText(name);
    await expect(choices.nth(index)).toContainText("Rohstoffkarten");
    await expect(choices.nth(index).locator(".catan-victim-avatar")).toHaveCount(1);
    assert.ok(await choices.nth(index).evaluate((element) => element.style.getPropertyValue("--player-color")), "Victim choice needs its player's color");
  }
  await layout(page, width, height);
  await page.screenshot({ path: `${output}${width}x${height}-${expanded ? "expanded" : "normal"}-${largeText ? "large-text-" : ""}steal.png` });
  if (largeText) return;

  await qa(page, () => page.getByLabel("Aktion blockieren").check());
  for (const choice of await choices.all()) await expect(choice).toBeDisabled();
  await qa(page, () => page.getByLabel("Aktion blockieren").uncheck());
  await qa(page, () => page.getByLabel("Aktion ablehnen").check());
  const sequence = await page.locator(".catan-play").getAttribute("data-catan-sequence");
  await choices.first().click();
  await expect(page.getByRole("alert")).toContainText("Aktion wurde abgelehnt");
  await expect(choices).toHaveCount(3);
  await expect(page.locator(".catan-play")).toHaveAttribute("data-catan-sequence", sequence);
  await qa(page, () => page.getByLabel("Aktion ablehnen").uncheck());
  await choices.first().click();
  await expect(choices).toHaveCount(0);
  await expect(page.locator(".catan-play")).not.toHaveAttribute("data-catan-sequence", sequence);
}

async function building(page, width, height, expanded) {
  await scenario(page, "rich", expanded);
  await page.locator('[data-catan-menu-trigger="bauen"]').click();
  const menu = page.locator('[data-catan-menu-panel="bauen"]');
  await menu.locator(".catan-build-choice").filter({ has: page.locator("strong", { hasText: /^Straße$/ }) }).click();
  await menu.getByRole("button", { name: "Auswählen", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".catan-placement-actions button")).toHaveCount(2);
  await layout(page, width, height);
  await page.getByRole("button", { name: "Nächster Bauplatz oder Räuberplatz", exact: true }).click();
  await expect(page.locator(".catan-placement-actions .catan-primary")).toBeEnabled();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(page.locator(".catan-island-dock")).toHaveCount(0);
}

try {
  for (const [width, height] of sizes) for (const expanded of [false, true]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(document, "fullscreenEnabled", { value: false }));
    await page.goto(baseURL);
    await robber(page, width, height, expanded);
    await steal(page, width, height, expanded);
    await building(page, width, height, expanded);
    await page.close();
  }
  for (const [width, height] of [[390, 844], [844, 390]]) for (const expanded of [false, true]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(document, "fullscreenEnabled", { value: false }));
    await page.goto(baseURL);
    await qa(page, () => page.getByLabel("Text 200%").check());
    await robber(page, width, height, expanded, true);
    await steal(page, width, height, expanded, true);
    await page.close();
  }
  assert.deepEqual(errors, [], "Browser errors");
  console.log("Catan placement browser checks passed: four sizes, normal/expanded layouts, collision-free controls, robber selection, victim selection, busy/rejected actions and 200% text.");
} finally {
  await browser.close();
}
