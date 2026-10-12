// Run against `node tests/catan-ux-preview.mjs` (the existing local QA fixture).
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.CATAN_QA_URL ?? "http://127.0.0.1:3002";
const output = new URL("../.wrangler/catan-menu/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const sizes = [[320, 568], [390, 844], [844, 390], [1440, 1000]];
const menu = (page, id) => page.locator(`[data-catan-menu-panel="${id}"]`);
const nav = (page, id) => page.locator(`[data-catan-menu-trigger="${id}"]`);
async function qa(page, change) {
  await page.locator(".qa-controls summary").click();
  await change();
  await page.locator(".qa-controls").evaluate((element) => { element.open = false; });
}
async function scenario(page, name) {
  await qa(page, () => page.getByLabel("Prüfsituation").selectOption(name));
}
async function visibleInViewport(locator, width, height) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `Control clipped: ${JSON.stringify(box)} at ${width}×${height}`);
}
try {
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.on("pageerror", (error) => errors.push(error.message));
    // Exercise the supported expanded layout even without native fullscreen.
    await page.addInitScript(() => Object.defineProperty(document, "fullscreenEnabled", { value: false }));
    await page.goto(baseURL);
    await expect(page.locator(".catan-board")).toBeVisible();
    await page.evaluate(() => { window.qaBoard = document.querySelector(".catan-board"); window.qaHand = document.querySelector(".catan-hand-bar"); });
    for (const expanded of [false, true]) {
      if (expanded) await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
      const endTurn = page.getByRole("button", { name: "Zug beenden", exact: true });
      await visibleInViewport(endTurn, width, height);
      await expect(page.locator(".catan-status .catan-end-turn")).toHaveCount(0);
      const endTurnBox = await endTurn.boundingBox();
      const mapBox = await page.locator(".catan-board-viewport").boundingBox();
      assert.ok(Math.abs(endTurnBox.x + endTurnBox.width / 2 - mapBox.x - mapBox.width / 2) < 1, "End turn must be centered on the map");
      for (const id of ["bauen", "handel", "karten", "uebersicht"]) {
        await nav(page, id).click();
        const panel = menu(page, id);
        await expect(panel).toBeVisible();
        await expect(endTurn).toHaveCount(0);
        await expect(page.locator(".catan-board")).toBeVisible();
        assert.ok(await page.evaluate(() => window.qaBoard === document.querySelector(".catan-board") && window.qaHand === document.querySelector(".catan-hand-bar")), "Map and resource hand must retain their instances");
        await visibleInViewport(page.locator(".catan-nav"), width, height);
        await visibleInViewport(panel.locator(".catan-menu-close"), width, height);
        const footer = panel.locator(".catan-screen-actions");
        if (await footer.count()) await visibleInViewport(footer, width, height);
        if (id === "bauen") assert.ok(await panel.evaluate((element, isExpanded) => {
          const box = element.getBoundingClientRect(); const x = box.left + 25; const y = box.top + 35;
          const overlay = document.createElement("div"); overlay.className = "catan-resource-flights";
          const token = document.createElement("span"); token.className = "catan-resource-flight";
          Object.assign(token.style, { left: `${x - 17}px`, top: `${y - 17}px`, pointerEvents: "auto" });
          overlay.append(token); (isExpanded ? element.closest(".catan-play") : document.body).append(overlay);
          const menuIsAbove = element.contains(document.elementFromPoint(x, y)); overlay.remove(); return menuIsAbove;
        }, expanded), "Resource flights must stay below the menu");
        if (expanded) {
          const hand = await page.locator(".catan-hand-bar").boundingBox();
          const viewport = await page.locator(".catan-board-viewport").boundingBox();
          const sheet = await panel.boundingBox();
          assert.ok(hand.y >= viewport.y - 1 && hand.y + hand.height < sheet.y + 1, "Fullscreen resources must float above the map and clear the menu");
        }
        await page.screenshot({ path: `${output}${width}x${height}-${expanded ? "expanded" : "normal"}-${id}.png` });
        await panel.getByRole("button", { name: "Menü schließen", exact: true }).click();
        await expect(panel).toBeHidden();
        await expect(endTurn).toBeVisible();
        await expect(nav(page, id)).toBeFocused();
      }
    }
    await scenario(page, "rich");
    await nav(page, "handel").click();
    const trade = menu(page, "handel");
    await trade.locator(".catan-trade-option").filter({ hasText: "Mitspielende" }).click();
    const recipients = trade.locator(".catan-person-choice");
    await expect(recipients).toHaveCount(4);
    await expect(recipients.first()).toContainText("An alle schicken");
    await page.screenshot({ path: `${output}${width}x${height}-trade-recipients.png` });
    await recipients.first().click();
    await expect(trade.getByRole("heading", { name: "Was bietest du allen an?", exact: true })).toBeVisible();
    await trade.getByRole("button", { name: "Ich gebe: mehr Holz", exact: true }).click();
    await trade.getByRole("button", { name: /^Weiter: Was möchtest du/ }).click();
    await trade.getByRole("button", { name: "Ich möchte: mehr Erz", exact: true }).click();
    await trade.getByRole("button", { name: /^Angebot prüfen/ }).click();
    await expect(trade.getByRole("heading", { name: "Dein Angebot an alle", exact: true })).toBeVisible();
    await trade.getByRole("button", { name: "Handel anbieten", exact: true }).click();
    await trade.getByRole("button", { name: /^Eigene Angebote/ }).click();
    await expect(trade.getByRole("heading", { name: "Angebot an alle", exact: true })).toBeVisible();
    await expect(trade.getByText(/Benjamin Alexander, Clara, Dominik Maximilian können dein Angebot annehmen/)).toBeVisible();
    await qa(page, () => page.getByLabel("Perspektive").selectOption("qa-1"));
    await expect(trade.getByRole("heading", { name: "Angebot von Anna", exact: true })).toBeVisible();
    await trade.getByRole("button", { name: "Ablehnen", exact: true }).click();
    await expect(trade.getByText(/Du hast dieses Angebot abgelehnt/)).toBeVisible();
    await expect(trade.getByRole("button", { name: "Annehmen", exact: true })).toHaveCount(0);
    await qa(page, () => page.getByLabel("Perspektive").selectOption("qa-2"));
    await expect(trade.getByRole("heading", { name: "Angebot von Anna", exact: true })).toBeVisible();
    await trade.getByRole("button", { name: "Annehmen", exact: true }).click();
    await expect(trade.getByRole("heading", { name: "Angebot von Anna", exact: true })).toHaveCount(0);
    await qa(page, () => page.getByLabel("Perspektive").selectOption("qa-3"));
    await nav(page, "handel").click();
    await trade.locator(".catan-trade-option").filter({ hasText: "Mitspielende" }).click();
    await expect(trade.locator(".catan-person-choice")).toHaveCount(1);
    await expect(trade.getByText("An alle schicken", { exact: true })).toHaveCount(0);
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(document, "fullscreenEnabled", { value: false }));
  await page.goto(baseURL);
  const build = menu(page, "bauen");
  const road = build.locator(".catan-build-choice").filter({ has: page.locator("strong", { hasText: /^Straße$/ }) });
  const development = build.locator(".catan-build-choice").filter({ hasText: "Entwicklungskarte kaufen" });
  await nav(page, "bauen").click();
  await expect(build.getByRole("button", { name: "Auswählen", exact: true })).toBeDisabled();
  const sequence = await page.locator(".catan-play").getAttribute("data-catan-sequence");
  await road.click();
  await expect(road).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".catan-play")).toHaveAttribute("data-catan-sequence", sequence);
  await expect(build).toBeVisible();
  await nav(page, "karten").click();
  await nav(page, "bauen").click();
  await expect(road).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
  await expect(road).toHaveAttribute("aria-pressed", "true");
  await build.getByRole("button", { name: "Auswählen", exact: true }).click();
  await expect(build).toBeHidden();
  await expect(page.getByRole("button", { name: /^Straße auf Weg/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(road).toHaveAttribute("aria-pressed", "false");
  await development.click();
  await qa(page, () => page.getByLabel("Aktion ablehnen").check());
  await nav(page, "bauen").click();
  await build.getByRole("button", { name: "Auswählen", exact: true }).click();
  await expect(development).toHaveAttribute("aria-pressed", "true");
  await expect(build).toBeVisible();
  await qa(page, () => page.getByLabel("Aktion ablehnen").uncheck());
  await qa(page, () => page.getByLabel("Aktion blockieren").check());
  await nav(page, "bauen").click();
  await expect(build.getByRole("button", { name: "Auswählen", exact: true })).toBeDisabled();
  await qa(page, () => page.getByLabel("Aktion blockieren").uncheck());
  await nav(page, "bauen").click();
  await build.getByRole("button", { name: "Auswählen", exact: true }).click();
  await expect(build).toBeHidden();
  await nav(page, "karten").click();
  await expect(menu(page, "karten").locator(".catan-development-choice")).toHaveCount(1);

  await scenario(page, "poor");
  await nav(page, "bauen").click();
  await expect(build.locator(".catan-build-choice[aria-disabled=true]")).toHaveCount(4);
  await expect(build.locator(".catan-cost b.is-missing")).toHaveCount(11);
  await road.click({ force: true });
  await expect(road).toHaveAttribute("aria-pressed", "false");
  await expect(build.getByRole("button", { name: "Auswählen", exact: true })).toBeDisabled();

  await scenario(page, "rich");
  await nav(page, "handel").click();
  const trade = menu(page, "handel");
  await expect(trade.locator(".catan-trade-option")).toHaveCount(3);
  await trade.getByRole("button", { name: "Meine Angebote", exact: true }).click();
  await expect(trade.locator(".catan-trade-option")).toHaveCount(1);
  await trade.locator(".catan-trade-option").click();
  await expect(trade.getByText("Keine offenen Angebote", { exact: true })).toBeVisible();
  await scenario(page, "outgoing");
  await trade.getByRole("button", { name: /^Eigene Angebote/ }).click();
  await expect(trade.getByRole("button", { name: "Zurückziehen", exact: true })).toBeVisible();
  await scenario(page, "incoming");
  await expect(trade).toBeVisible();
  await expect(trade.getByRole("button", { name: "Annehmen", exact: true })).toBeVisible();
  await scenario(page, "discard");
  await expect(menu(page, "karten").getByRole("heading", { name: "Rohstoffe abgeben", exact: true })).toBeVisible();

  // Normal-menu status controls must survive pointerdown and execute their click.
  await scenario(page, "roll");
  await nav(page, "bauen").click();
  await page.locator(".catan-status").getByRole("button", { name: "Würfeln", exact: true }).click();
  await expect(build.getByText("Würfle zuerst.", { exact: true })).toHaveCount(0);
  await scenario(page, "rich");
  await nav(page, "bauen").click();
  await road.click();
  await nav(page, "insel").click();
  await page.locator(".catan-island-screen").getByRole("button", { name: "Zug beenden", exact: true }).click();
  await nav(page, "bauen").click();
  await expect(road).toHaveAttribute("aria-pressed", "false");
  await expect(build.getByText("Du kannst in deinem eigenen Zug bauen.", { exact: true })).toBeVisible();

  await scenario(page, "rich");
  await nav(page, "bauen").click();
  await build.press("Escape");
  await expect(build).toBeHidden();
  await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
  await nav(page, "bauen").click();
  await build.press("Escape");
  await expect(page.locator(".catan-play")).toHaveClass(/is-board-expanded/);
  await nav(page, "bauen").press("Escape");
  await expect(page.locator(".catan-play")).not.toHaveClass(/is-board-expanded/);
  await nav(page, "bauen").click();
  await road.click();
  await qa(page, () => page.getByRole("button", { name: "Bestand leeren", exact: true }).click());
  await nav(page, "bauen").click();
  await expect(road).toHaveAttribute("aria-pressed", "false");
  await expect(build.getByRole("button", { name: "Auswählen", exact: true })).toBeDisabled();
  await scenario(page, "rich");
  const board = page.locator(".catan-board");
  const beforePan = await board.getAttribute("viewBox");
  const viewport = await page.locator(".catan-board-viewport").boundingBox();
  await page.mouse.move(viewport.x + viewport.width * .6, viewport.y + viewport.height * .45);
  await page.mouse.down();
  await page.mouse.move(viewport.x + viewport.width * .7, viewport.y + viewport.height * .55, { steps: 8 });
  await page.mouse.up();
  await expect(board).not.toHaveAttribute("viewBox", beforePan);
  await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
  await nav(page, "bauen").hover();
  await expect(build).toBeVisible();
  await page.mouse.move(1, 1);
  await expect(build).toBeHidden();
  await nav(page, "bauen").click();
  await page.mouse.move(1, 1);
  await expect(build).toBeVisible();
  await build.getByRole("button", { name: "Menü schließen", exact: true }).click();
  await page.getByRole("button", { name: "Vollbild der Insel schließen", exact: true }).click();
  await qa(page, () => page.getByLabel("Text 200%").check());
  await nav(page, "bauen").click();
  await visibleInViewport(build.getByRole("button", { name: "Auswählen", exact: true }), 390, 844);
  await visibleInViewport(page.locator(".catan-nav"), 390, 844);
  const content = await build.locator(".catan-screen-body").boundingBox();
  assert.ok(content.height >= 40, "Enlarged text still needs scrollable menu content");
  await page.screenshot({ path: `${output}390x844-large-text.png` });
  // Compact sheets use all available space; close them to reach map tools.
  await build.getByRole("button", { name: "Menü schließen", exact: true }).click();
  await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
  await nav(page, "bauen").click();
  await visibleInViewport(build.getByRole("button", { name: "Auswählen", exact: true }), 390, 844);
  await visibleInViewport(page.locator(".catan-nav"), 390, 844);
  const expandedContent = await build.locator(".catan-screen-body").boundingBox();
  assert.ok(expandedContent.height >= 40, "Expanded menu remains usable with enlarged text");
  await page.screenshot({ path: `${output}390x844-expanded-large-text.png` });
  await page.setViewportSize({ width: 844, height: 390 });
  const select = build.getByRole("button", { name: "Auswählen", exact: true });
  await select.scrollIntoViewIfNeeded();
  await visibleInViewport(select, 844, 390);
  await visibleInViewport(page.locator(".catan-nav"), 844, 390);
  await page.screenshot({ path: `${output}844x390-expanded-large-text.png` });
  await page.close();
  assert.deepEqual(errors, [], "Browser errors");
  console.log("Catan menu browser checks passed: four sizes, normal/expanded layouts, selection, trade, mandatory tasks, keyboard and 200% text.");
} finally {
  await browser.close();
}
