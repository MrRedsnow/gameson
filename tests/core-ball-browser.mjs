/** Manual integration smoke: node tests/core-ball-browser.mjs [http://localhost:3000]
 * Uses real UI/API state in fresh mobile browser contexts; never seeds or replaces a game.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { coreBallShotAngle, CORE_BALL_PIN_RADIUS } from "../lib/core-ball.ts";

const baseURL = process.env.CORE_BALL_BROWSER_URL ?? process.argv[2] ?? "http://localhost:3000";
const artifactDirectory = resolve(".wrangler/core-ball-browser");
const screenshots = [];
await mkdir(artifactDirectory, { recursive: true });
const names = ["Anna", "Ben", "Clara", "David", "Elias"];
const localKey = "gameson-core-ball-local-v1";
const contexts = [];
const pageErrors = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await chromium.launch({ headless: true });

/** Observes copies of actual server replies and their monotonic clock samples. */
async function mobile(name, { skew = 0, fallback = false, latency = false, lostResponse = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  contexts.push(context);
  await context.addInitScript(({ skew }) => {
    const wallNow = Date.now.bind(Date);
    window.__coreBallQA = { state: null, clock: null, requests: [], socketMessages: 0, clockShift: 0 };
    Date.now = () => wallNow() + skew + window.__coreBallQA.clockShift;
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const sent = performance.now();
      const response = await original(input, options);
      if (new URL(typeof input === "string" ? input : input.url, location.href).pathname === "/api/core-ball") {
        try {
          const data = await response.clone().json();
          const received = performance.now();
          const state = data.state ?? (data.lobby && data.me ? data : null);
          if (state) {
            if (!window.__coreBallQA.state || state.lobby.revision >= window.__coreBallQA.state.lobby.revision) window.__coreBallQA.state = state;
            const processing = state.serverSentAt - state.serverReceivedAt;
            if (Number.isFinite(processing) && processing >= 0) {
              const rtt = Math.max(0, received - sent - processing);
              window.__coreBallQA.clock = { server: state.serverSentAt + rtt / 2, at: received, rtt };
            }
          }
          if (options?.method === "POST") window.__coreBallQA.requests.push({ status: response.status, action: JSON.parse(options.body).action, move: JSON.parse(options.body).move?.type, error: data.error });
        } catch { /* Only JSON game replies are relevant to the probe. */ }
      }
      return response;
    };
    const NativeSocket = window.WebSocket;
    window.WebSocket = class ObservedSocket extends NativeSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.state?.lobby && data.state?.me) {
              window.__coreBallQA.socketMessages++;
              if (!window.__coreBallQA.state || data.state.lobby.revision >= window.__coreBallQA.state.lobby.revision) window.__coreBallQA.state = data.state;
            }
          } catch { /* HMR frames are unrelated. */ }
        });
      }
    };
  }, { skew });
  if (fallback) await context.routeWebSocket(/\/api\/core-ball\/live/, (socket) => socket.close({ code: 1008, reason: "QA: force HTTP fallback" }));
  const recovery = { lostResponse: false, shotRequests: 0 };
  if (latency || lostResponse) await context.route("**/api/core-ball*", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/core-ball") return route.continue();
    const body = route.request().postDataJSON();
    const shooting = body?.move?.type === "shoot";
    if (shooting) recovery.shotRequests++;
    const delay = latency ? shooting ? 180 : 60 : 0;
    if (delay) await pause(delay);
    const response = await route.fetch();
    if (lostResponse && shooting && !recovery.lostResponse && response.ok()) {
      recovery.lostResponse = true;
      // The real API has committed. Lose only the browser response, then let its normal reconciliation run.
      return route.abort("failed");
    }
    if (delay) await pause(delay);
    await route.fulfill({ response });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => pageErrors.push(`${name}: ${error.message}`));
  return { name, context, page, fallback, recovery };
}

async function capture(page, name, fullPage = true) {
  const path = resolve(artifactDirectory, `${name}.png`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage, animations: "disabled" });
  screenshots.push(path);
}

async function noHorizontalOverflow(page, name) {
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.equal(width.viewport, 390, `${name}: page must use the actual mobile viewport`);
  assert.ok(width.content <= width.viewport, `${name}: ${width.content}px content exceeds ${width.viewport}px viewport`);
}

const gameState = (page) => page.evaluate(() => window.__coreBallQA.state);
const waitGame = (page, phase, person) => page.waitForFunction(({ phase, person }) => {
  const game = window.__coreBallQA.state?.game;
  return game?.phase === phase && (!person || game.players.find((player) => player.id === game.activePlayerId)?.name === person);
}, { phase, person });
const heading = (page, person) => expect(page.getByRole("heading", { name: `${person} ist dran`, exact: true })).toBeVisible();

async function tapSafe(page, local = false) {
  const button = page.getByRole("button", { name: "Kugel setzen", exact: true });
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  const sample = await page.evaluate(({ local, localKey }) => {
    if (local) {
      const game = JSON.parse(localStorage.getItem(localKey));
      // Persisted snapshots are paused copies. The real UI began this first shot's turn at its ready event.
      game.phase = "playing";
      game.runningSince = game.lastEvent.at;
      return { game, clock: { server: Date.now(), at: performance.now() }, now: Date.now() };
    }
    const { state, clock } = window.__coreBallQA;
    return { game: state.game, clock, now: clock.server + Math.max(0, performance.now() - clock.at) };
  }, { local, localKey });
  assert.ok(sample.clock, "Monotonic server clock must have been calibrated");
  let target = null, widest = 0;
  for (let ms = 500; ms <= 5000; ms += 10) {
    const at = sample.now + ms;
    const angle = coreBallShotAngle(sample.game, at);
    const clearance = Math.min(...sample.game.pins.map((pin) => Math.hypot(Math.cos(angle) - Math.cos(pin.angle), Math.sin(angle) - Math.sin(pin.angle))));
    if (clearance > widest) { widest = clearance; target = at; }
  }
  assert.ok(widest > 2 * CORE_BALL_PIN_RADIUS + 0.08, "Selected shot has a wide collision-free timing margin");
  const performanceTarget = sample.clock.at + target - sample.clock.server;
  await page.evaluate(async (at) => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, at - performance.now())));
    const button = document.querySelector('button[aria-label="Kugel setzen"]');
    if (!button || button.disabled) throw new Error("Shot UI became disabled before the timed tap");
    button.click();
  }, performanceTarget);
  const previousId = sample.game.lastEvent?.id;
  if (local) await page.waitForFunction(({ key, previousId }) => {
    const event = JSON.parse(localStorage.getItem(key)).lastEvent;
    return event.id !== previousId && ["shot", "level-complete"].includes(event.type);
  }, { key: localKey, previousId });
  else await page.waitForFunction((previousId) => {
    const event = window.__coreBallQA.state?.game?.lastEvent;
    return event?.id !== previousId && ["shot", "level-complete"].includes(event?.type);
  }, previousId);
  const game = local ? await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), localKey) : (await gameState(page)).game;
  assert.equal(game.collisions, 0);
  assert.ok(["shot", "level-complete"].includes(game.lastEvent.type));
  if (game.lastEvent.type === "shot") await expect(page.getByRole("button", { name: "Abgeben", exact: true })).toBeEnabled();
  else await expect(page.locator(".core-ball-ready")).toBeVisible();
  return game;
}

async function handoff(page, target) {
  await page.getByRole("button", { name: "Abgeben", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(target) }).click();
  await heading(page, target);
}

async function skip(page, person) {
  await page.getByRole("button", { name: "Partiemenü öffnen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: `${person} überspringen`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Weitergeben", exact: true }).click();
}

async function finish(page, { completedLevels = 0, winner = null } = {}) {
  await page.getByRole("button", { name: "Partiemenü öffnen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Partie beenden", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Eure Partie beenden?", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Partie beenden", exact: true }).click();
  await expect(page.getByRole("heading", { name: winner ? `${winner} gewinnt!` : "Gemeinsamer Sieg!", exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`${completedLevels} Level gemeinsam geschafft\\..*Unfertige Punkte sind verfallen\\.`))).toBeVisible();
  await expect(page.locator(".core-ball-ranking li")).toHaveCount(5);
}

async function online() {
  console.log("Core Ball browser: five mobile devices, real online lobby/actions");
  const devices = [];
  for (const [index, name] of names.entries()) devices.push(await mobile(name, { skew: index === 2 ? 120000 : index === 4 ? -600000 : 0, fallback: index === 4, latency: index === 2, lostResponse: index === 0 }));
  const host = devices[0].page;
  await host.goto(`${baseURL}/core-ball`);
  await host.getByRole("button", { name: /^Lobby erstellen/ }).click();
  await host.locator("#core-ball-player-name").fill("Anna");
  await host.locator("#core-ball-group-name").fill(`Core Ball QA ${Date.now()}`);
  await host.getByRole("button", { name: /^Gegeneinander/ }).click();
  await host.getByRole("switch").click();
  await host.getByRole("button", { name: "Lobby erstellen", exact: true }).click();
  await host.waitForFunction(() => window.__coreBallQA.state?.members?.length === 1);
  const lobby = (await gameState(host)).lobby.id;
  for (const device of devices.slice(1)) {
    await device.page.goto(`${baseURL}/core-ball?lobby=${lobby}&join=1`);
    await device.page.locator("#core-ball-player-name").fill(device.name);
    await device.page.getByRole("button", { name: "Beitreten", exact: true }).click();
    await device.page.waitForFunction(() => window.__coreBallQA.state?.me?.id);
  }
  await host.waitForFunction(() => window.__coreBallQA.state?.members?.length === 5);
  await expect(host.locator(".core-ball-lobby-players li")).toHaveCount(5);
  await host.getByRole("button", { name: "Partie starten", exact: true }).click();
  for (const device of devices) { await waitGame(device.page, "awaiting-ready", "Anna"); await heading(device.page, "Anna"); await noHorizontalOverflow(device.page, device.name); }
  assert.equal((await gameState(host)).game.mode, "competitive");
  await host.getByRole("button", { name: "Bereit", exact: true }).click();
  await waitGame(host, "playing", "Anna");
  const first = await tapSafe(host);
  assert.equal(first.remaining, 7);
  assert.equal(devices[0].recovery.lostResponse, true);
  assert.equal(first.pins.filter((pin) => pin.playerId === first.activePlayerId).length, 1, "Lost POST response must never duplicate a committed pin");
  await handoff(host, "Clara");
  for (const device of devices) {
    await waitGame(device.page, "awaiting-ready", "Clara");
    await heading(device.page, "Clara");
    await capture(device.page, `online-shared-circle-${device.name.toLowerCase()}`);
  }
  await capture(host, "online-play-mobile", false);
  const clara = devices[2].page;
  await clara.evaluate(() => { window.__coreBallQA.clockShift += 12 * 3600000; });
  await clara.getByRole("button", { name: "Bereit", exact: true }).click();
  await waitGame(clara, "playing", "Clara");
  const second = await tapSafe(clara);
  assert.equal(second.remaining, 6);
  assert.equal(second.players.reduce((total, player) => total + player.score, 0), 0);
  console.log("PASS online shooting: Anna and Clara with clock jump + latency");
  await handoff(clara, "David");
  await waitGame(host, "awaiting-ready", "David");
  await devices[3].page.close();
  await skip(host, "David");
  await waitGame(host, "awaiting-ready", "Elias");
  const beforeReload = (await gameState(host)).game;
  await host.reload();
  await waitGame(host, "awaiting-ready", "Elias");
  await heading(host, "Elias");
  const afterReload = (await gameState(host)).game;
  assert.equal(afterReload.id, beforeReload.id);
  assert.equal(afterReload.turnId, beforeReload.turnId);
  assert.deepEqual(afterReload.pins, beforeReload.pins);
  assert.deepEqual(afterReload.contributions, beforeReload.contributions);
  const fallback = devices[4].page;
  await waitGame(fallback, "awaiting-ready", "Elias");
  await fallback.getByRole("button", { name: "Bereit", exact: true }).click();
  await waitGame(fallback, "playing", "Elias");
  assert.equal(await fallback.evaluate(() => window.__coreBallQA.socketMessages), 0, "HTTP fallback worked without WebSocket state");
  const input = fallback.getByRole("button", { name: "Kugel setzen", exact: true });
  await expect(input).toBeEnabled();
  const beforeOffline = (await gameState(fallback)).game;
  await devices[4].context.setOffline(true);
  await expect(fallback.locator(".core-ball-offline")).toBeVisible();
  await expect(input).toBeDisabled();
  await devices[4].context.setOffline(false);
  await fallback.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(input).toBeEnabled();
  assert.deepEqual((await gameState(fallback)).game.pins, beforeOffline.pins);
  await waitGame(host, "playing", "Elias");
  console.log("PASS online control: lost committed POST response, recipient ready, absent player skip, reload, HTTP fallback and offline/resume input guard");
  let completed;
  for (let remaining = 6; remaining >= 1; remaining--) {
    completed = await tapSafe(fallback);
    if (remaining > 1) {
      assert.equal(completed.remaining, remaining - 1);
      assert.equal(completed.players.reduce((total, player) => total + player.score, 0), 0, "The unfinished level has not banked points yet");
    }
  }
  assert.equal(completed.lastEvent.type, "level-complete");
  assert.equal(completed.level, 2);
  assert.equal(completed.completedLevels, 1);
  assert.equal(completed.players.find((player) => player.id === completed.activePlayerId).name, "Anna");
  assert.deepEqual(completed.players.map((player) => [player.name, player.score]), [["Anna", 1], ["Ben", 0], ["Clara", 1], ["David", 0], ["Elias", 6]]);
  for (const device of devices.filter((device) => device.name !== "David")) {
    await waitGame(device.page, "awaiting-ready", "Anna");
    await heading(device.page, "Anna");
  }
  await capture(host, "online-level-completed");
  console.log("PASS online banking: 8 successful UI taps complete level 1, award 1/0/1/0/6 points, and automatically pass to Anna");
  await finish(host, { completedLevels: 1, winner: "Elias" });
  await capture(host, "online-result");
  for (const device of devices.filter((device) => device.name !== "David")) {
    await waitGame(device.page, "finished");
    const state = await gameState(device.page);
    assert.equal(state.game.players.reduce((total, player) => total + player.score, 0), 8);
    assert.deepEqual(state.game.result.winnerIds, [state.game.players.find((player) => player.name === "Elias").id]);
    const errors = await device.page.evaluate(() => window.__coreBallQA.requests.filter((entry) => entry.status >= 400));
    assert.deepEqual(errors, [], `${device.name}: UI actions must succeed`);
  }
  console.log("Online transport observations", await Promise.all(devices.filter((device) => device.name !== "David").map(async (device) => ({ name: device.name, socketMessages: await device.page.evaluate(() => window.__coreBallQA.socketMessages), forcedHttpFallback: device.fallback }))));
  console.log("PASS online: 5 mobiles without horizontal overflow, HTTP fallback + offline/resume, lost POST, ±clock skew + wall clock jump, latency, 8 safe shots, handoff, absent player skip, reload, completed level, banked scores, automatic turn, finish");
}

async function local() {
  console.log("Core Ball browser: five people passing one phone");
  const device = await mobile("local");
  const page = device.page;
  await page.goto(`${baseURL}/core-ball?local=1`);
  for (let index = 2; index < 5; index++) await page.getByRole("button", { name: "Person hinzufügen", exact: true }).click();
  for (const [index, name] of names.entries()) await page.locator(`#core-ball-local-name-${index}`).fill(name);
  await page.getByRole("button", { name: /^Gegeneinander/ }).click();
  await page.getByRole("button", { name: "Partie starten", exact: true }).click();
  await heading(page, "Anna");
  await noHorizontalOverflow(page, "local phone");
  await page.getByRole("button", { name: "Bereit", exact: true }).click();
  const shot = await tapSafe(page, true);
  assert.equal(shot.remaining, 7);
  await handoff(page, "Clara");
  const paused = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), localKey);
  assert.equal(paused.phase, "awaiting-ready");
  assert.equal(paused.activePlayerId, "local-2");
  await page.getByRole("button", { name: "Bereit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kugel setzen", exact: true })).toBeEnabled();
  await page.evaluate(() => { window.__coreBallQA.clockShift += 24 * 3600000; });
  await page.reload();
  await heading(page, "Clara");
  await expect(page.getByRole("button", { name: "Bereit", exact: true })).toBeEnabled();
  await capture(page, "local-ready-after-reload");
  const restored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), localKey);
  assert.equal(restored.id, paused.id);
  assert.equal(restored.activePlayerId, paused.activePlayerId);
  assert.equal(restored.turnId, paused.turnId);
  assert.deepEqual(restored.pins, paused.pins);
  const angle = await page.locator(".core-ball-board g[transform^='rotate']").first().getAttribute("transform");
  await pause(120);
  assert.equal(await page.locator(".core-ball-board g[transform^='rotate']").first().getAttribute("transform"), angle, "Reload restores a frozen circle");
  await finish(page);
  await capture(page, "local-result");
  const final = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), localKey);
  assert.equal(final.phase, "finished");
  assert.equal(final.players.reduce((total, player) => total + player.score, 0), 0);
  console.log("PASS local: 5 names, safe shot, chosen recipient, ready, wall clock jump, reload pauses same player, finish");
}

try {
  await online();
  await local();
  assert.deepEqual(pageErrors, [], "No browser runtime errors");
  console.log("PASS Core Ball real-browser smoke");
  console.log(JSON.stringify({ screenshots }, null, 2));
} catch (error) {
  for (const context of contexts) for (const page of context.pages()) {
    if (!page.isClosed()) console.error("QA failure context", await page.evaluate(() => ({ headings: [...document.querySelectorAll("h1,h2")].map((item) => item.textContent), dialogs: [...document.querySelectorAll('[role="dialog"]')].map((item) => item.textContent), phase: window.__coreBallQA.state?.game?.phase, requests: window.__coreBallQA.requests, clock: window.__coreBallQA.clock, wallNow: Date.now(), performanceNow: performance.now(), lastEvent: window.__coreBallQA.state?.game?.lastEvent, lockedUntil: window.__coreBallQA.state?.game?.lockedUntil, controls: [...document.querySelectorAll(".core-ball-action-dock button")].map((item) => ({ text: item.textContent, disabled: item.disabled })), hint: document.querySelector(".core-ball-tap-hint")?.textContent })).catch(() => ({ unavailable: true })));
  }
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
