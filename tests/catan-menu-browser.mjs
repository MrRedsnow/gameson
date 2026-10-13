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
async function loadPreview(page) {
  await page.goto(baseURL);
  await expect(page.locator(".catan-board")).toBeVisible();
  await expect(page.locator(".catan-nav .sr-only").first()).toHaveCSS("position","absolute");
}
async function assertDisplayOnlyStatus(page) {
  const status = page.locator(".catan-status");
  await expect(status).toBeVisible();
  await expect(status.locator('button, [role="button"], a, input, select, textarea, [tabindex]')).toHaveCount(0);
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
    await loadPreview(page);
    await expect(page.locator(".catan-board")).toBeVisible();
    await page.evaluate(() => { window.qaBoard = document.querySelector(".catan-board"); window.qaHand = document.querySelector(".catan-hand-bar"); });
    for (const expanded of [false, true]) {
      if (expanded) await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
      const endTurn = page.getByRole("button", { name: "Zug beenden", exact: true });
      await visibleInViewport(endTurn, width, height);
      await page.mouse.move(1, 1);
      await expect(endTurn).toHaveCSS("background-color", "rgb(239, 209, 138)");
      await expect(endTurn).toHaveCSS("color", "rgb(28, 43, 49)");
      await expect(endTurn).toHaveCSS("border-radius", "12px");
      await expect(page.locator(".catan-board-panel")).toHaveCSS("border-radius", "18px");
      await expect(page.locator(".catan-status .catan-end-turn")).toHaveCount(0);
      const endTurnBox = await endTurn.boundingBox();
      const dockBox = await page.locator(".catan-island-dock").boundingBox();
      assert.ok(Math.abs(endTurnBox.x + endTurnBox.width / 2 - dockBox.x - dockBox.width / 2) < 1, "End turn must be centered in its action dock");
      for (const id of ["bauen", "handel", "karten", "uebersicht"]) {
        await nav(page, id).click();
        await assertDisplayOnlyStatus(page);
        const panel = menu(page, id);
        await expect(panel).toBeVisible();
        await expect(endTurn).toBeHidden();
        await expect(page.locator(".catan-island-dock")).toHaveAttribute("data-menu-hidden", "true");
        await expect(page.locator(".catan-island-dock")).toHaveAttribute("inert", "");
        await expect(page.locator(".catan-island-dock")).toHaveAttribute("aria-hidden", "true");
        await expect(page.locator(".catan-board")).toBeVisible();
        await expect(panel.locator(".catan-screen-heading .catan-menu-close")).toBeVisible();
        assert.ok(await page.evaluate(() => window.qaBoard === document.querySelector(".catan-board") && window.qaHand === document.querySelector(".catan-hand-bar")), "Map and resource hand must retain their instances");
        await visibleInViewport(page.locator(".catan-nav"), width, height);
        await visibleInViewport(panel.locator(".catan-menu-close"), width, height);
        const footer = panel.locator(".catan-screen-actions");
        if (await footer.count()) await visibleInViewport(footer, width, height);
        if (id === "bauen") {
          await expect(panel.locator(".catan-build-choice").first()).toHaveCSS("border-radius", "16px");
          await expect(panel.locator(".catan-build-choice").first()).toHaveCSS("box-shadow", "none");
        }
        if (width >= 1024) {
          const fitting = await panel.evaluate((element) => {
            const body = element.querySelector(".catan-screen-body");
            const heading = element.querySelector(".catan-screen-heading");
            const footer = element.querySelector(".catan-screen-actions");
            return { height:element.getBoundingClientRect().height, cap:parseFloat(getComputedStyle(element).maxHeight), bodyHeight:body.clientHeight, contentHeight:body.scrollHeight, headingHeight:heading.getBoundingClientRect().height, footerHeight:footer?.getBoundingClientRect().height ?? 0 };
          });
          assert.ok(fitting.height <= fitting.cap + 1, "Desktop menu respects its existing height budget");
          assert.ok(fitting.bodyHeight <= fitting.contentHeight + 1, "Short desktop menu does not inflate its content area");
          if (id === "bauen" || id === "handel") assert.ok(fitting.height < fitting.cap - 20, "Short desktop menu fits its content instead of filling the height cap");
        }
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
          const sheet = await panel.boundingBox();
          assert.ok(hand.y + hand.height <= sheet.y + 1, "Fullscreen resources must clear the menu");
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

  const desktop = await browser.newPage({ viewport:{width:1440,height:1000}, reducedMotion:"reduce" });
  desktop.on("pageerror", (error) => errors.push(error.message));
  await loadPreview(desktop);
  for (const expanded of [false,true]) {
    await scenario(desktop,"rich");
    await scenario(desktop,"history");
    if (expanded) await desktop.getByRole("button", { name:"Insel im Vollbild öffnen", exact:true }).click();
    const board = desktop.locator(".catan-island-canvas"); const boardBox = await board.boundingBox();
    await nav(desktop,"uebersicht").click();
    const overview = menu(desktop,"uebersicht");
    await overview.getByRole("button", {name:"Spielverlauf",exact:true}).click();
    const body = overview.locator(".catan-screen-body");
    assert.ok(await body.evaluate((element) => element.scrollHeight > element.clientHeight + 100), "Long desktop histories scroll inside the capped menu");
    const heading = overview.locator(".catan-screen-heading"); const headingBox = await heading.boundingBox();
    const footer = overview.locator(".catan-screen-actions"); const footerBox = await footer.count() ? await footer.boundingBox() : null;
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    assert.deepEqual(await heading.boundingBox(),headingBox,"Scrolling long desktop history keeps its heading fixed");
    if (footerBox) assert.deepEqual(await footer.boundingBox(),footerBox,"Scrolling keeps the footer fixed");
    assert.deepEqual(await board.boundingBox(),boardBox,"A long desktop menu preserves island dimensions");
    await visibleInViewport(heading,1440,1000);
    if (footerBox) await visibleInViewport(footer,1440,1000);
    await desktop.screenshot({path:`${output}1440x1000-${expanded ? "expanded" : "normal"}-history.png`});
    await qa(desktop, () => desktop.getByLabel("Text 200%").check());
    await nav(desktop,"bauen").click();
    const build = menu(desktop,"bauen"); const buildBody = build.locator(".catan-screen-body");
    assert.ok(await buildBody.evaluate((element) => element.scrollHeight > element.clientHeight + 10), "Enlarged desktop build options scroll at the cap");
    const buildHeading = build.locator(".catan-screen-heading"); const buildFooter = build.locator(".catan-screen-actions");
    const buildHeadingBox = await buildHeading.boundingBox(); const buildFooterBox = await buildFooter.boundingBox();
    await buildBody.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    assert.deepEqual(await buildHeading.boundingBox(),buildHeadingBox,"Enlarged-text desktop heading stays fixed");
    assert.deepEqual(await buildFooter.boundingBox(),buildFooterBox,"Enlarged-text desktop confirmation stays fixed");
    await visibleInViewport(buildFooter,1440,1000);
    await desktop.screenshot({path:`${output}1440x1000-${expanded ? "expanded" : "normal"}-build-text200.png`});
    await qa(desktop, () => desktop.getByLabel("Text 200%").uncheck());
  }
  await desktop.close();

  console.log("Catan menu layouts passed at four viewport sizes, including compact desktop sheets and scrolling histories.");
  const statusPage = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  statusPage.on("pageerror", (error) => errors.push(error.message));
  await loadPreview(statusPage);
  for (const expanded of [false, true]) for (const name of ["map-vote", "map-waiting", "map-tie", "map-tie-guest", "setup", "setup-road", "roll", "rich", "discard", "robber", "steal", "free-roads", "incoming", "outgoing", "waiting", "finished"]) {
    await scenario(statusPage, name);
    await nav(statusPage, "insel").click();
    if (expanded) await statusPage.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
    for (const local of [false, true]) {
      await qa(statusPage, () => statusPage.getByLabel("Lokales Spiel", { exact: true }).setChecked(local));
      await assertDisplayOnlyStatus(statusPage);
      for (const id of ["karten", "bauen", "handel", "uebersicht"]) {
        if (await nav(statusPage, id).isDisabled()) continue;
        await nav(statusPage, id).click();
        await expect(menu(statusPage, id)).toBeVisible();
        await assertDisplayOnlyStatus(statusPage);
      }
      await qa(statusPage, async () => {
        await statusPage.getByLabel("Aktion blockieren", { exact: true }).check();
        await statusPage.getByRole("checkbox", { name: "Verbindung unterbrochen", exact: true }).check();
      });
      await nav(statusPage, "uebersicht").click();
      await assertDisplayOnlyStatus(statusPage);
      await expect(statusPage.locator(".catan-status-offline")).toBeVisible();
      await qa(statusPage, async () => {
        await statusPage.getByLabel("Aktion blockieren", { exact: true }).uncheck();
        await statusPage.getByRole("checkbox", { name: "Verbindung unterbrochen", exact: true }).uncheck();
      });
    }
  }

  console.log("Catan display-only status passed for all phases with open menus, local/online play and normal/expanded layouts.");
  // Opening a menu during an active placement used to insert a header button.
  for (const expanded of [false, true]) for (const [name, building] of [["rich", "Straße"], ["build-settlement", "Siedlung"], ["rich", "Stadt"]]) {
    await scenario(statusPage, name);
    await nav(statusPage, "insel").click();
    if (expanded) await statusPage.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
    await nav(statusPage, "bauen").click();
    await menu(statusPage, "bauen").locator(".catan-build-choice").filter({ has: statusPage.locator("strong", { hasText: new RegExp(`^${building}$`) }) }).click();
    await menu(statusPage, "bauen").getByRole("button", { name: "Auswählen", exact: true }).click();
    await expect(statusPage.getByRole("button", { name: new RegExp(`^${building} auf (Weg|Kreuzung)`) }).first()).toBeVisible();
    for (const id of ["karten", "bauen", "handel", "uebersicht"]) {
      await nav(statusPage, id).click();
      await assertDisplayOnlyStatus(statusPage);
    }
    await nav(statusPage, "insel").click();
    await statusPage.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(menu(statusPage, "bauen")).toBeVisible();
  }

  console.log("Catan display-only status passed during road, settlement and city placement.");
  // Privacy controls live in Overview and still close fullscreen before handoff.
  for (const [width, height] of sizes) for (const expanded of [false, true]) for (const name of ["rich", "map-vote"]) {
    await statusPage.setViewportSize({ width, height });
    await scenario(statusPage, name);
    await nav(statusPage, "insel").click();
    if (expanded) await statusPage.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
    await qa(statusPage, () => statusPage.getByLabel("Lokales Spiel", { exact: true }).check());
    await nav(statusPage, "uebersicht").click();
    const hide = menu(statusPage, "uebersicht").getByRole("button", { name: name === "map-vote" ? "Gerät weitergeben" : "Handkarten verdecken", exact: true });
    await hide.scrollIntoViewIfNeeded();
    await visibleInViewport(hide, width, height);
    await visibleInViewport(menu(statusPage, "uebersicht").getByRole("link", { name: "Zur Spielauswahl", exact: true }), width, height);
    await statusPage.screenshot({ path: `${output}${width}x${height}-${expanded ? "expanded" : "normal"}-${name}-local-overview.png` });
    const count = Number(await statusPage.locator('output[aria-label="Verdeckte Handkarten"]').textContent());
    await hide.click();
    await expect(statusPage.locator('output[aria-label="Verdeckte Handkarten"]')).toHaveText(String(count + 1));
    await expect(statusPage.locator(".catan-play")).not.toHaveClass(/is-board-expanded/);
    await assertDisplayOnlyStatus(statusPage);
    await qa(statusPage, () => statusPage.getByLabel("Lokales Spiel", { exact: true }).uncheck());
    await nav(statusPage, "uebersicht").click();
    await expect(menu(statusPage, "uebersicht").locator(".catan-hide-button")).toHaveCount(0);
  }
  await statusPage.close();

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(document, "fullscreenEnabled", { value: false }));
  await loadPreview(page);
  const build = menu(page, "bauen");
  const road = build.locator(".catan-build-choice").filter({ has: page.locator("strong", { hasText: /^Straße$/ }) });
  const development = build.locator(".catan-build-choice").filter({ hasText: "Entwicklungskarte kaufen" });
  await nav(page, "bauen").click();
  await expect(build.getByRole("button", { name: "Auswählen", exact: true })).toBeDisabled();
  await expect(build.getByRole("button", { name: "Auswählen", exact: true })).toHaveCSS("opacity", "1");
  await road.hover();
  await expect(road).toHaveCSS("background-color", "rgba(255, 255, 255, 0.07)");
  const sequence = await page.locator(".catan-play").getAttribute("data-catan-sequence");
  await road.click();
  await expect(road).toHaveAttribute("aria-pressed", "true");
  await expect(road).toHaveCSS("background-color", "rgba(242, 211, 139, 0.12)");
  await page.mouse.move(1, 1);
  await expect(build.getByRole("button", { name: "Auswählen", exact: true })).toHaveCSS("background-color", "rgb(239, 209, 138)");
  await expect(build.getByRole("button", { name: "Auswählen", exact: true })).toHaveCSS("color", "rgb(28, 43, 49)");
  await expect(page.locator(".catan-play")).toHaveAttribute("data-catan-sequence", sequence);
  await expect(build).toBeVisible();
  await nav(page, "karten").click();
  await nav(page, "bauen").click();
  await expect(road).toHaveAttribute("aria-pressed", "true");
  await nav(page, "insel").click();
  await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
  await nav(page, "bauen").click();
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

  // Close the menu to reach the island action; the header stays display-only.
  await scenario(page, "roll");
  await nav(page, "bauen").click();
  await assertDisplayOnlyStatus(page);
  await nav(page, "insel").click();
  await page.locator(".catan-island-dock").getByRole("button", { name: "Würfeln", exact: true }).click();
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
  await page.getByRole("button", { name: "Insel vergrößern", exact: true }).click();
  const beforePan = await board.getAttribute("viewBox");
  const viewport = await page.locator(".catan-board-viewport").boundingBox();
  await page.mouse.move(viewport.x + viewport.width * .6, viewport.y + viewport.height * .45);
  await page.mouse.down();
  await page.mouse.move(viewport.x + viewport.width * .7, viewport.y + viewport.height * .55, { steps: 8 });
  await page.mouse.up();
  await expect(board).not.toHaveAttribute("viewBox", beforePan);
  await page.getByRole("button", { name: "Insel im Vollbild öffnen", exact: true }).click();
  await nav(page, "bauen").hover();
  await expect(build).toBeHidden();
  await page.mouse.move(1, 1);
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
  console.log("Catan menu browser checks passed: four sizes, display-only status in every phase, normal/expanded layouts, local handoff, selection, trade, mandatory tasks, keyboard and 200% text.");
} finally {
  await browser.close();
}
