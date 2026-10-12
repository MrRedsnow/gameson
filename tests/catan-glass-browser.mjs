// Local visual/regression QA: node tests/catan-ux-preview.mjs, then this script.
// A before snapshot can be supplied via CATAN_GLASS_BASELINE for protected UI comparison.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { auditLayout, fixture } from "./catan-layout-browser.mjs";

const baseURL = process.env.CATAN_QA_URL ?? "http://127.0.0.1:3002";
const output = process.env.CATAN_GLASS_OUTPUT ?? new URL("../.wrangler/catan-glass/", import.meta.url).pathname;
const baseline = process.env.CATAN_GLASS_BASELINE ? JSON.parse(await readFile(process.env.CATAN_GLASS_BASELINE, "utf8")) : null;
const browser = await chromium.launch({ headless:true });
const errors = [];
const snapshots = {};
await mkdir(output, { recursive:true });
const panel = (page, id) => page.locator(`[data-catan-menu-panel="${id}"]`);
const trigger = (page, id) => page.locator(`[data-catan-menu-trigger="${id}"]`);
const observe = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function protectedSnapshot(page) {
  return page.locator(".catan-play").evaluate((play) => {
    const props = ["background","backgroundColor","backgroundImage","backdropFilter","border","borderRadius","boxShadow","color","fontFamily","fontSize","fontWeight","lineHeight","padding","gap","display","gridTemplateColumns","gridTemplateRows","height","minHeight","maxHeight","width","minWidth","maxWidth","position","zIndex","overflow","transform"];
    const describe = (element) => {
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return { tag:element.tagName, classes:element.className, rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}, styles:Object.fromEntries(props.map((prop) => [prop,style[prop]])) };
    };
    return { status:[...play.querySelectorAll(".catan-status,.catan-status *")].map(describe), nav:[...play.querySelectorAll(".catan-nav,.catan-nav *")].map(describe) };
  });
}

async function capture(page, name) {
  await observe(page);
  const snapshot = await protectedSnapshot(page);
  snapshots[name] = snapshot;
  if (baseline?.[name]) for (const region of ["status", "nav"]) {
    const original = baseline[name][region]; const current = snapshot[region];
    assert.equal(current.length, original.length, `${name}: protected ${region} structure changed`);
    for (let i = 0; i < current.length; i++) {
      assert.deepEqual(current[i].styles, original[i].styles, `${name}: protected ${region} styles changed at ${i}`);
      for (const dimension of ["x","y","width","height"]) assert.ok(Math.abs(current[i].rect[dimension] - original[i].rect[dimension]) < .1, `${name}: protected ${region} ${dimension} changed at ${i}`);
    }
  }
  await page.screenshot({ path:`${output}/${name}.png`, style:".qa-controls { visibility:hidden!important; }" });
}

async function auditWorld(page, activeMenu = null) {
  const result = await page.locator(".catan-world").evaluate((world) => {
    const rect = (element) => { if (!element) return null; const box = element.getBoundingClientRect(); return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height}; };
    const sea = world.querySelector(".catan-world-sea");
    const active = world.querySelector('.is-game-menu[data-state="active"]');
    return { sea:rect(sea), world:rect(world), hand:rect(world.querySelector(".catan-hand-bar")), stage:rect(world.querySelector(".catan-menu-stage")), dock:rect(world.querySelector(".catan-island-dock")), canvases:world.querySelectorAll(".catan-sea-surface").length, canvasInHost:Boolean(sea.querySelector(".catan-sea-surface")), seaPointerEvents:getComputedStyle(sea).pointerEvents, viewportBackground:getComputedStyle(world.querySelector(".catan-board-viewport")).backgroundImage, active:active && {opacity:getComputedStyle(active).opacity,radius:getComputedStyle(active).borderTopLeftRadius,filter:getComputedStyle(active).backdropFilter}, disabledOpacity:[...world.querySelectorAll('.is-game-menu[data-state="active"] :is(button:disabled,[aria-disabled="true"],.is-unavailable)')].map((element) => getComputedStyle(element).opacity) };
  });
  assert.equal(result.canvases, 1, "World must keep one sea canvas");
  assert.equal(result.canvasInHost, true, "Sea canvas belongs to the shared background host");
  assert.equal(result.seaPointerEvents, "none", "Decorative sea must not intercept input");
  assert.equal(result.viewportBackground, "none", "Map must not paint another opaque sea layer");
  for (const [name, rect] of Object.entries({world:result.world,hand:result.hand,stage:result.stage,dock:result.dock})) {
    if (!rect) continue; // A waiting player has no action dock.
    assert.ok(result.sea.left <= rect.left + 1 && result.sea.right >= rect.right - 1 && result.sea.top <= rect.top + 1 && result.sea.bottom >= rect.bottom - 1, `Shared sea does not cover ${name}`);
  }
  if (activeMenu) {
    assert.ok(result.active, `${activeMenu} must be open for its material audit`);
    assert.equal(result.active.opacity, "1", "Panel opacity must not dim content");
    assert.equal(result.active.radius, "28px", "Menus share the 28px glass radius");
    assert.match(result.active.filter, /blur\(20px\)/, "Only the shell owns the main blur");
    assert.ok(result.disabledOpacity.every((value) => value === "1"), "Unavailable options retain sharp, undimmed content");
  }
  return auditLayout(page, () => observe(page));
}

async function rememberWorld(page) {
  await page.evaluate(() => { window.glassWorld = {board:document.querySelector(".catan-board"),hand:document.querySelector(".catan-hand-bar"),sea:document.querySelector(".catan-sea-surface")}; });
}

async function assertPersistentWorld(page, camera, canvasBox) {
  assert.ok(await page.evaluate(() => Object.entries(window.glassWorld).every(([name,element]) => element === document.querySelector(name === "board" ? ".catan-board" : name === "hand" ? ".catan-hand-bar" : ".catan-sea-surface"))), "Board, resources and sea must retain their DOM instances");
  assert.equal(await page.locator(".catan-board").getAttribute("viewBox"), camera.viewBox, "Opening menus must preserve the panned camera");
  assert.equal(await page.locator(".catan-board").getAttribute("data-zoom"), camera.zoom, "Opening menus must preserve zoom");
  assert.deepEqual(await page.locator(".catan-island-canvas").boundingBox(), canvasBox, "Opening menus must not resize the map");
}

async function preparePage(width, height, reducedMotion = "reduce") {
  const page = await browser.newPage({viewport:{width,height},reducedMotion});
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseURL); await expect(page.locator(".catan-board")).toBeVisible(); await page.evaluate(() => document.fonts.ready);
  return page;
}

try {
  for (const [width,height] of [[360,800],[390,844],[1440,1000]]) {
    const page = await preparePage(width,height);
    for (const expanded of [false,true]) {
      if (expanded) await page.getByRole("button", {name:"Insel im Vollbild öffnen",exact:true}).click();
      await rememberWorld(page); await observe(page);
      const camera = {viewBox:await page.locator(".catan-board").getAttribute("viewBox"),zoom:await page.locator(".catan-board").getAttribute("data-zoom")};
      const canvasBox = await page.locator(".catan-island-canvas").boundingBox();
      const prefix = `${width}x${height}-${expanded ? "expanded" : "normal"}`;
      await auditWorld(page); await capture(page, `${prefix}-insel`);
      for (const id of ["karten","bauen","handel","uebersicht"]) {
        await trigger(page,id).click(); await observe(page);
        await auditWorld(page,id); await assertPersistentWorld(page,camera,canvasBox); await capture(page,`${prefix}-${id}`);
        await panel(page,id).getByRole("button", {name:"Menü schließen",exact:true}).click(); await observe(page);
        await assertPersistentWorld(page,camera,canvasBox); await expect(trigger(page,id)).toBeFocused();
      }
    }
    await page.close();
  }

  const page = await preparePage(390,844);
  await page.getByRole("button", {name:"Insel vergrößern",exact:true}).click(); await observe(page);
  const fixedHand = await page.locator(".catan-hand-bar").boundingBox();
  const viewport = await page.locator(".catan-board-viewport").boundingBox();
  const beforePan = await page.locator(".catan-board").getAttribute("viewBox");
  await page.mouse.move(viewport.x + viewport.width * .5, viewport.y + viewport.height * .4); await page.mouse.down();
  await page.mouse.move(viewport.x + viewport.width * .7, viewport.y + viewport.height * .55, {steps:8}); await page.mouse.up(); await observe(page);
  assert.notEqual(await page.locator(".catan-board").getAttribute("viewBox"), beforePan, "Map can still be panned");
  assert.deepEqual(await page.locator(".catan-hand-bar").boundingBox(), fixedHand, "Resources remain fixed during map gestures");
  await rememberWorld(page);
  const camera = {viewBox:await page.locator(".catan-board").getAttribute("viewBox"),zoom:await page.locator(".catan-board").getAttribute("data-zoom")};
  const canvasBox = await page.locator(".catan-island-canvas").boundingBox();
  for (const id of ["bauen","karten","handel","uebersicht"]) {
    await trigger(page,id).click(); await observe(page); await assertPersistentWorld(page,camera,canvasBox);
    await panel(page,id).press("Escape"); await observe(page); await assertPersistentWorld(page,camera,canvasBox);
  }

  await fixture(page,"cards"); await trigger(page,"karten").click();
  const cards = panel(page,"karten");
  await expect(cards.locator(".catan-development-choice")).toHaveCount(5); await auditWorld(page,"karten"); await capture(page,"390x844-cards-filled");
  await cards.locator(".catan-development-choice").filter({hasText:"Erfindung"}).click();
  await capture(page,"390x844-card-detail");
  await cards.getByRole("button",{name:"Erfindung ausspielen",exact:true}).click();
  await capture(page,"390x844-card-resource-first"); await auditWorld(page,"karten");
  await cards.getByRole("button",{name:"Weiter: Zweiter Rohstoff",exact:true}).click();
  await capture(page,"390x844-card-resource-second");
  await cards.getByRole("button",{name:"Einen Schritt zurück",exact:true}).click();
  await cards.getByRole("button",{name:"Einen Schritt zurück",exact:true}).click();
  await cards.getByRole("button",{name:"Einen Schritt zurück",exact:true}).click();
  await cards.locator(".catan-development-choice").filter({hasText:"Siegpunkt"}).click();
  await expect(cards.getByText(/bereits in deinem Punktestand enthalten/)).toBeVisible(); await capture(page,"390x844-card-victory-disabled");

  await fixture(page,"poor"); await trigger(page,"bauen").click();
  const build = panel(page,"bauen");
  await expect(build.locator('.catan-build-choice[aria-disabled="true"]')).toHaveCount(4);
  for (const hint of await build.locator(".is-unavailable").all()) await expect(hint).toBeVisible();
  await auditWorld(page,"bauen"); await capture(page,"390x844-build-poor");
  await fixture(page,"rich"); await trigger(page,"bauen").click();
  await build.locator(".catan-build-choice").filter({has:page.locator("strong",{hasText:/^Straße$/})}).click();
  await capture(page,"390x844-build-selected");

  await fixture(page,"rich"); await trigger(page,"handel").click(); const trade = panel(page,"handel");
  await trade.locator(".catan-trade-option").filter({hasText:"Hafen & Bank"}).click();
  await auditWorld(page,"handel"); await capture(page,"390x844-trade-bank");
  await trade.getByRole("button",{name:"Einen Schritt zurück",exact:true}).click();
  await trade.locator(".catan-trade-option").filter({hasText:"Mitspielende"}).click();
  await capture(page,"390x844-trade-step1"); await trade.locator(".catan-person-choice").first().click();
  await trade.getByRole("button",{name:"Ich gebe: mehr Holz",exact:true}).click(); await capture(page,"390x844-trade-step2");
  await trigger(page,"karten").click(); await trigger(page,"handel").click();
  await expect(trade.getByRole("heading",{name:"Was bietest du allen an?",exact:true})).toBeVisible();
  await expect(trade.locator(".catan-amount-controls").first().locator("output")).toHaveText("1");
  await trade.getByRole("button",{name:/^Weiter: Was möchtest du/}).click();
  await trade.getByRole("button",{name:"Ich möchte: mehr Erz",exact:true}).click(); await auditWorld(page,"handel"); await capture(page,"390x844-trade-step3");
  await trade.getByRole("button",{name:/^Angebot prüfen/}).click(); await auditWorld(page,"handel"); await capture(page,"390x844-trade-step4");
  await trade.getByRole("button",{name:"Einen Schritt zurück",exact:true}).click();
  await expect(trade.getByRole("heading",{name:"Was möchtest du erhalten?",exact:true})).toBeVisible();

  for (const scenario of ["incoming","outgoing","discard","setup","robber","steal"]) {
    await fixture(page,scenario);
    if (scenario === "incoming" && !await trade.isVisible()) await trigger(page,"handel").click();
    if (scenario === "discard" && !await cards.isVisible()) await trigger(page,"karten").click();
    if (scenario === "outgoing") { await trigger(page,"handel").click(); await trade.getByRole("button",{name:/^Eigene Angebote/}).click(); }
    await auditWorld(page,["incoming","outgoing"].includes(scenario) ? "handel" : scenario === "discard" ? "karten" : null);
    await capture(page,`390x844-${scenario}`);
  }

  await fixture(page,"history"); await trigger(page,"uebersicht").click(); const overview = panel(page,"uebersicht");
  const ambient = overview.getByLabel("Lebendige Insel",{exact:true});
  await expect(ambient).toBeChecked();
  const ambientSequence = await page.locator(".catan-play").getAttribute("data-catan-sequence");
  await ambient.uncheck(); await expect(ambient).not.toBeChecked();
  await ambient.check(); await expect(ambient).toBeChecked();
  await expect(page.locator(".catan-play")).toHaveAttribute("data-catan-sequence",ambientSequence);
  const ambientCard = overview.locator(".catan-ambient-preference");
  await ambientCard.scrollIntoViewIfNeeded();
  assert.equal(await ambientCard.evaluate((element) => getComputedStyle(element).borderRadius),"20px","Ambient preference shares the inner glass card material");
  await capture(page,"390x844-overview-ambient-preference");
  await overview.getByRole("button",{name:"Spielverlauf",exact:true}).click();
  assert.ok(await overview.locator(".catan-log-entry").count() >= 60, "History fixture retains every long log entry");
  assert.ok(await overview.locator(".catan-screen-body").evaluate((element) => element.scrollHeight > element.clientHeight), "Long histories have scrollable content");
  await capture(page,"390x844-overview-history");
  await overview.getByRole("button",{name:"Einen Schritt zurück",exact:true}).click();
  await overview.getByRole("button",{name:"Spielregeln & Baukosten",exact:true}).click();
  await overview.locator(".catan-rule-section").filter({hasText:"Die ersten Siedlungen"}).locator("summary").click();
  await auditWorld(page,"uebersicht"); await capture(page,"390x844-overview-rules");

  for (const [width,height] of [[390,844],[844,390]]) for (const expanded of [false,true]) {
    await page.setViewportSize({width,height}); await fixture(page,"cards",true);
    if (expanded) await page.getByRole("button",{name:"Insel im Vollbild öffnen",exact:true}).click();
    for (const id of ["karten","bauen","handel","uebersicht"]) {
      await trigger(page,id).click(); await observe(page); await auditWorld(page,id);
      await capture(page,`${width}x${height}-${expanded ? "expanded" : "normal"}-${id}-text200`);
      const actions = panel(page,id).locator(".catan-screen-actions");
      if (await actions.count()) {
        await actions.scrollIntoViewIfNeeded(); await observe(page); await auditWorld(page,id);
        const actionBox = await actions.boundingBox();
        assert.ok(actionBox.y >= 0 && actionBox.y + actionBox.height <= height + 1,"Enlarged-text menu actions remain reachable by scrolling");
        await capture(page,`${width}x${height}-${expanded ? "expanded" : "normal"}-${id}-actions-text200`);
      }
      await panel(page,id).getByRole("button",{name:"Menü schließen",exact:true}).focus();
      await expect(panel(page,id).getByRole("button",{name:"Menü schließen",exact:true})).toBeFocused();
      await observe(page); await auditWorld(page,id);
      await panel(page,id).getByRole("button",{name:"Menü schließen",exact:true}).click();
    }
  }
  await page.close();

  const fallback = await preparePage(390,844,"no-preference");
  await expect(fallback.locator(".catan-world-sea")).toHaveAttribute("data-catan-sea-ready","true");
  assert.equal(await fallback.locator(".catan-sea-surface").evaluate((element) => getComputedStyle(element).opacity),"1","Active renderer paints the shared sea");
  const world = await fallback.locator(".catan-world").boundingBox(); const hand = await fallback.locator(".catan-hand-bar").boundingBox();
  const seaClip = {x:world.x + 1,y:hand.y + hand.height + 10,width:8,height:64};
  const seaFrame = await fallback.screenshot({clip:seaClip});
  await fallback.waitForTimeout(300);
  assert.notDeepEqual(await fallback.screenshot({clip:seaClip}),seaFrame,"Shared sea waves remain animated");
  await capture(fallback,"390x844-glass-active-sea");
  await trigger(fallback,"handel").click();
  const activeTrade = panel(fallback,"handel");
  await activeTrade.locator(".catan-trade-option").filter({hasText:"Hafen & Bank"}).click();
  await activeTrade.getByRole("button",{name:"Tausch bestätigen",exact:true}).click();
  await expect(fallback.locator('.catan-hand-resource[data-catan-resource="wood"] .catan-hand-loss')).toBeVisible();
  await expect(fallback.locator('.catan-hand-resource[data-catan-resource="brick"] .catan-hand-gain')).toBeVisible();
  await expect(activeTrade).toBeVisible();
  assert.equal(await fallback.locator(".catan-world-sea").getAttribute("data-catan-sea-ready"),"true","Confirmed loss/gain feedback retains the active sea");
  await auditWorld(fallback,"handel"); await capture(fallback,"390x844-glass-active-gain-loss");
  await trigger(fallback,"bauen").click();
  await fallback.addStyleTag({content:'.catan-world { --catan-glass-background:rgba(12,48,63,.86)!important; } .catan-world :is(.is-game-menu,.catan-island-dock) { backdrop-filter:none!important; -webkit-backdrop-filter:none!important; }'});
  assert.equal(await panel(fallback,"bauen").evaluate((element) => getComputedStyle(element).backdropFilter), "none");
  await auditLayout(fallback,()=>observe(fallback)); await capture(fallback,"390x844-glass-no-filter");
  await fallback.emulateMedia({reducedMotion:"reduce"}); await observe(fallback);
  assert.ok(await panel(fallback,"bauen").evaluate((element) => [element,...element.querySelectorAll("button")].every((node) => getComputedStyle(node).transitionDuration.split(",").every((value) => parseFloat(value) <= .01))), "Reduced motion removes menu transitions");
  await capture(fallback,"390x844-glass-reduced-motion"); await fallback.close();
  assert.deepEqual(errors,[],"Browser errors");
  await writeFile(`${output}/protected-after.json`,JSON.stringify(snapshots,null,2));
  console.log(`Catan glass checks passed: ${Object.keys(snapshots).length} screenshots, protected status/nav${baseline ? " compared to before" : " captured"}, one continuous sea, stable camera/DOM, menu clearance, subviews, 200% text, landscape and fallback.`);
} finally { await browser.close(); }
