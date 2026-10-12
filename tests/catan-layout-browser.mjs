// Browser regression QA against `node tests/catan-ux-preview.mjs`.
// The exported checks also accept the documented CUA Playwright surface.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export async function fixture(page, name, largeText = false) {
  await page.locator(".qa-controls summary").click();
  await page.getByLabel("Prüfsituation").selectOption(name);
  await page.getByLabel("Text 200%").setChecked(largeText);
  await page.getByLabel("Aktion ablehnen").uncheck();
  await page.getByLabel("Aktion blockieren").uncheck();
  await page.locator(".qa-controls summary").click();
}

async function flag(page, name, checked) {
  await page.locator(".qa-controls summary").click();
  await page.getByLabel(name).setChecked(checked);
  await page.locator(".qa-controls summary").click();
}

async function auditFrame(page) {
  const result = await page.locator(".catan-play").evaluate((play) => {
    const box = (element) => {
      const r = element.getBoundingClientRect();
      return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
    };
    const visibleBox = (element) => {
      const r = box(element);
      r.left = Math.max(0, r.left); r.top = Math.max(0, r.top);
      r.right = Math.min(innerWidth, r.right); r.bottom = Math.min(innerHeight, r.bottom);
      for (let p = element.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p); const clip = box(p);
        if (style.overflowX !== "visible") { r.left = Math.max(r.left, clip.left); r.right = Math.min(r.right, clip.right); }
        if (style.overflowY !== "visible") { r.top = Math.max(r.top, clip.top); r.bottom = Math.min(r.bottom, clip.bottom); }
      }
      return r.right > r.left && r.bottom > r.top ? r : null;
    };
    const selector = '.catan-nav button, .is-game-menu[data-state="active"] button, .is-game-menu[data-state="active"] summary, .catan-island-dock button, .catan-board-controls button, .catan-island-tools button';
    const controls = [...play.querySelectorAll(selector)].filter((element) => {
      if (element.closest("[inert]")) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().width;
    }).map((element) => {
      const rect = visibleBox(element);
      const hit = rect && document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
      return { label:element.getAttribute("aria-label") ?? element.textContent, rect, covered:rect && !(element.contains(hit) || (element.disabled && hit?.contains(element))), height:box(element).height };
    }).filter((control) => control.rect);
    const overflow = [document.documentElement, play, ...play.querySelectorAll('.catan-island-dock, .is-game-menu[data-state="active"], .catan-victim-choice, .catan-screen-heading')]
      .filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.className || element.tagName);
    const panel = play.querySelector('.is-game-menu[data-state="active"]');
    const dock = play.querySelector(".catan-island-dock");
    return { controls, overflow, width:innerWidth, height:innerHeight, nav:box(play.querySelector(".catan-nav")), hand:box(play.querySelector(".catan-hand-bar")), stage:box(play.querySelector(".catan-menu-stage")), panel:panel && box(panel), dock:dock && box(dock), canvas:box(play.querySelector(".catan-island-canvas")), world:box(play.querySelector(".catan-world")), viewport:box(play.querySelector(".catan-board-viewport")) };
  });
  const context = `${result.width}×${result.height}`;
  assert.equal(result.overflow.length, 0, `Horizontal overflow: ${context}: ${result.overflow.join(", ")}`);
  assert.ok(result.nav.top >= 0 && result.nav.bottom <= result.height + 1, `Navigation clipped: ${context}`);
  for (const edge of ["left", "top", "right", "bottom"]) {
    assert.ok(Math.abs(result.viewport[edge] - result.world[edge]) <= 1, `Map must reach the world ${edge} edge behind the HUD: ${context}`);
  }
  if (result.panel) {
    assert.ok(result.panel.top >= result.hand.bottom + 11, `Menu needs resource clearance: ${context}`);
    assert.ok(result.panel.bottom <= result.nav.top - 11, `Menu needs navigation clearance: ${context}`);
    assert.ok(result.panel.left >= result.stage.left + 11 && result.panel.right <= result.stage.right - 11, `Menu needs 12px side clearance: ${context}`);
    assert.ok(result.panel.width <= 561, `Menu exceeds 560px: ${context}`);
  }
  if (result.dock) {
    assert.ok(result.canvas.bottom <= result.dock.top + 1, `Map controls need dock clearance: ${context}`);
    assert.ok(result.dock.bottom <= result.nav.top + 1, `Dock overlaps navigation: ${context}`);
    assert.ok(result.canvas.height >= 40, `Map collapsed: ${context}`);
  }
  for (const control of result.controls) {
    assert.ok(!control.covered, `Control covered: ${context}: ${control.label}`);
    assert.ok(control.height >= 43, `Touch target too short: ${context}: ${control.label}`);
  }
  for (let i = 0; i < result.controls.length; i++) for (let j = i + 1; j < result.controls.length; j++) {
    const a = result.controls[i]; const b = result.controls[j];
    const width = Math.min(a.rect.right,b.rect.right) - Math.max(a.rect.left,b.rect.left);
    const height = Math.min(a.rect.bottom,b.rect.bottom) - Math.max(a.rect.top,b.rect.top);
    assert.ok(width <= 1 || height <= 1, `Controls overlap: ${context}: ${a.label} / ${b.label}`);
  }
  return { size:context, controls:result.controls.length };
}

export async function auditLayout(page, observe) {
  let failure;
  // Resizing a panel updates its ResizeObserver budget on the next frame.
  // Re-observe that frame before treating a transient geometry mismatch as a defect.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await auditFrame(page); }
    catch (error) {
      if (!observe) throw error;
      failure = error;
      await observe();
    }
  }
  throw failure;
}

export async function checkRobber(page, { expanded, largeText, failureCases = false, scenario = "robber", observe }) {
  await fixture(page, scenario, largeText);
  if (expanded) await page.getByRole("button", { name:"Insel im Vollbild öffnen", exact:true }).click();
  await observe?.();
  const commit = page.getByRole("button", { name:"Räuber versetzen", exact:true });
  assert.equal(await commit.isEnabled(), false, "Robber needs an explicit field selection");
  assert.equal(await page.locator(".catan-board-selection").count(), 0, "Robber has no arrow selector");
  const before = await page.locator(".catan-robber-layer").getAttribute("data-catan-robber");
  const sequence = await page.locator(".catan-play").getAttribute("data-catan-sequence");
  const field = page.getByRole("button", { name:/^Räuber auf Feld 5:/ });
  // Larger building hit areas can overlap this hex; the real pointer tap is
  // intentionally routed through the board's shared selection handler.
  await field.locator(".catan-hex-border").click({ force:true });
  await observe?.();
  assert.equal(await field.getAttribute("aria-pressed"), "true");
  assert.equal(await commit.isEnabled(), true);
  assert.equal(await page.locator(".catan-robber-layer").getAttribute("data-catan-robber"), before, "Selection must not move the robber");
  assert.equal(await page.locator(".catan-play").getAttribute("data-catan-sequence"), sequence);
  await auditLayout(page,observe);
  if (failureCases) {
    await flag(page, "Aktion blockieren", true);
    assert.equal(await commit.isEnabled(), false);
    assert.equal(await field.getAttribute("aria-disabled"), "true");
    await flag(page, "Aktion blockieren", false);
    await flag(page, "Aktion ablehnen", true);
    await commit.click();
    assert.equal(await field.getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".catan-play").getAttribute("data-catan-sequence"), sequence);
    await flag(page, "Aktion ablehnen", false);
    await commit.click();
    assert.equal(await page.locator(".catan-robber-layer").getAttribute("data-catan-robber"), "4");
  }
}

export async function checkVictims(page, { expanded, largeText, failureCases = false, single = false, clickVisible, observe }) {
  await fixture(page, single ? "steal-single" : "steal", largeText);
  if (expanded) await page.getByRole("button", { name:"Insel im Vollbild öffnen", exact:true }).click();
  await observe?.();
  const choices = page.locator(".catan-victim-choice");
  const commit = page.getByRole("button", { name:"Karte stehlen", exact:true });
  assert.equal(await choices.count(), single ? 1 : 3);
  assert.equal(await commit.isEnabled(), false, "Even a single victim is never preselected");
  const sequence = await page.locator(".catan-play").getAttribute("data-catan-sequence");
  // At 200% text a card can exceed a shallow scroll viewport. Click its visible
  // name instead of the center of the complete, partially clipped card.
  await choices.first().locator("strong").click();
  await observe?.();
  if (largeText && clickVisible && await choices.first().getAttribute("aria-pressed") !== "true") {
    const point = await choices.first().evaluate((button) => {
      const rect = button.getBoundingClientRect();
      let top = Math.max(0,rect.top), bottom = Math.min(innerHeight,rect.bottom);
      for (let parent = button.parentElement; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowY === "visible") continue;
        const clip = parent.getBoundingClientRect(); top = Math.max(top,clip.top); bottom = Math.min(bottom,clip.bottom);
      }
      const x = rect.left + rect.width / 2, y = (top + bottom) / 2;
      return bottom > top && button.contains(document.elementFromPoint(x,y)) ? [x,y] : null;
    });
    assert.ok(point, "Victim needs a visible, unobstructed click area");
    await clickVisible(point);
    await observe?.();
  }
  assert.equal(await choices.first().getAttribute("aria-pressed"), "true");
  assert.equal(await commit.isEnabled(), true);
  assert.equal(await page.locator(".catan-play").getAttribute("data-catan-sequence"), sequence, "Selecting a person must not steal");
  await auditLayout(page,observe);
  if (failureCases) {
    await flag(page, "Aktion blockieren", true);
    assert.equal(await choices.first().isEnabled(), false);
    assert.equal(await commit.isEnabled(), false);
    await flag(page, "Aktion blockieren", false);
    await flag(page, "Aktion ablehnen", true);
    await commit.click();
    assert.equal(await choices.first().getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".catan-play").getAttribute("data-catan-sequence"), sequence);
    await flag(page, "Aktion ablehnen", false);
    await commit.click();
    assert.equal(await choices.count(), 0);
  }
}

export async function checkMenus(page, { expanded, largeText, observe }) {
  await fixture(page, "cards", largeText);
  if (expanded) await page.getByRole("button", { name:"Insel im Vollbild öffnen", exact:true }).click();
  await observe?.();
  const results = [];
  for (const id of ["karten", "bauen", "handel", "uebersicht"]) {
    const trigger = page.locator(`[data-catan-menu-trigger="${id}"]`);
    const panel = page.locator(`[data-catan-menu-panel="${id}"]`);
    await trigger.click();
    await observe?.();
    assert.equal(await panel.isVisible(), true);
    assert.equal(await panel.locator(".catan-screen-heading .catan-menu-close").isVisible(), true);
    results.push({menu:id, ...await auditLayout(page,observe)});
    await panel.getByRole("button", { name:"Menü schließen", exact:true }).click();
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
    await trigger.click();
    await trigger.click();
    assert.equal(await panel.isVisible(), false, "The active menu toggles closed");
  }
  return results;
}

export async function checkTransitions(page, options = {}) {
  for (const scenario of ["robber-after-seven","robber-after-knight"]) {
    await checkRobber(page, { ...options, expanded:false, largeText:false, failureCases:true, scenario });
    if (await page.locator(".catan-victim-choice").count()) {
      await page.locator(".catan-victim-choice").first().click();
      await options.observe?.();
      await page.getByRole("button", { name:"Karte stehlen", exact:true }).click();
      await options.observe?.();
    }
    const action = scenario === "robber-after-knight" ? "Würfeln" : "Zug beenden";
    assert.equal(await page.getByRole("button", { name:action, exact:true }).isVisible(), true, "Robber must return to the correct turn phase");
  }
  await checkVictims(page, { ...options, expanded:false, largeText:false, single:true, failureCases:true });
  await fixture(page,"steal",false);
  await page.locator(".catan-victim-choice").first().click();
  await options.observe?.();
  await page.locator(".qa-controls summary").click();
  await page.getByRole("button", { name:"Erste Opferauswahl entfernen", exact:true }).click();
  await page.locator(".qa-controls summary").click();
  await options.observe?.();
  assert.equal(await page.getByRole("button", { name:"Karte stehlen", exact:true }).isEnabled(), false, "Invalid victims must clear the selection");
}

async function checkMapUnderHud(page, { expanded, largeText, observe }) {
  await fixture(page, "rich", largeText);
  if (expanded) await page.getByRole("button", { name:"Insel im Vollbild öffnen", exact:true }).click();
  await observe();
  await auditLayout(page, observe);
  for (let step = 0; step < 5; step++) await page.getByRole("button", { name:"Insel vergrößern", exact:true }).click();
  const points = await page.locator(".catan-play").evaluate((play) => {
    const resources = play.querySelectorAll(".catan-hand-resource");
    const first = resources[0].getBoundingClientRect(); const second = resources[1].getBoundingClientRect();
    const actions = play.querySelector(".catan-island-dock>.catan-screen-actions").getBoundingClientRect();
    return [
      { label:"resource gap", x:(first.right + second.left) / 2, y:(first.top + first.bottom) / 2, dy:24 },
      { label:"action gap", x:(actions.left + actions.right) / 2, y:actions.top + 2, dy:-24 },
    ];
  });
  const sequence = await page.locator(".catan-play").getAttribute("data-catan-sequence");
  for (const point of points) {
    assert.ok(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x,y)?.closest(".catan-board-viewport")), point), `${point.label} must pass input to the map`);
    const before = await page.locator(".catan-board").getAttribute("viewBox");
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 24, point.y + point.dy, { steps:6 }); await page.mouse.up();
    await observe();
    assert.notEqual(await page.locator(".catan-board").getAttribute("viewBox"), before, `Dragging in the ${point.label} must pan the map`);
    assert.equal(await page.locator(".catan-play").getAttribute("data-catan-sequence"), sequence, "Panning must not trigger a game action");
  }
  assert.ok(await page.getByRole("button", { name:"Zug beenden", exact:true }).isEnabled(), "The action remains usable over the map");
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({headless:true});
  try {
    for (const [width,height] of [[320,568],[390,844],[844,390],[1440,1000]]) for (const expanded of [false,true]) for (const largeText of [false,true]) {
      const page = await browser.newPage({viewport:{width,height}, reducedMotion:"reduce"});
      await page.addInitScript(() => Object.defineProperty(document,"fullscreenEnabled",{value:false}));
      await page.goto(process.env.CATAN_QA_URL ?? "http://127.0.0.1:3002");
      const options = {expanded,largeText,failureCases:!largeText,clickVisible:([x,y]) => page.mouse.click(x,y),observe:() => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))};
      await checkMapUnderHud(page, options);
      await checkRobber(page, options); await checkVictims(page, options); await checkMenus(page, options);
      await page.close();
    }
    const page = await browser.newPage({viewport:{width:390,height:844}, reducedMotion:"reduce"});
    await page.goto(process.env.CATAN_QA_URL ?? "http://127.0.0.1:3002");
    await checkTransitions(page);
    console.log("Catan layout checks passed: four sizes, normal/fullscreen, 200% text, map panning behind the HUD, menu controls, map selection and confirmed theft.");
  } finally { await browser.close(); }
}
