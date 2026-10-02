import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { chooseDemoAction } from "./catan-demo-policy.mjs";
import { observeDemoAudio, waitForDemoAudio } from "./catan-demo-audio.mjs";

const bundled = await build({ stdin: { contents: 'export * from "./lib/catan"; export { CATAN_SOUND_FILES } from "./lib/catan-sounds"; export { catanSoundEvents } from "./lib/catan-sound-events";', resolveDir: new URL("../../", import.meta.url).pathname }, bundle: true, write: false, platform: "node", format: "esm" });
const rules = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const labels = { road: "Straße", settlement: "Siedlung", city: "Stadt" };

function integerOption(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name}: erwartet ${minimum}–${maximum}.`);
  return value;
}
const pause = integerOption("CATAN_DEMO_STEP_MS", 1500, 0, 60000);
const target = integerOption("CATAN_DEMO_TARGET", 8, 8, 15);
const rounds = integerOption("CATAN_DEMO_ROUNDS", 0, 0, 100);
const maxTurns = integerOption("CATAN_DEMO_MAX_TURNS", 300, 1, 3000);
const hold = integerOption("CATAN_DEMO_HOLD_MS", 15000, 0, 3600000);
const waitForAudio = process.env.CATAN_DEMO_WAIT_FOR_AUDIO !== "0";

async function tab(page, label) {
  const control = page.getByRole("tab", { name: new RegExp(`^${label}`) });
  if (await control.getAttribute("aria-selected") !== "true") await control.click();
}
function button(page, name) {
  // Tabs are force-mounted; only the active panel's actions are visible.
  return page.locator('.catan-tab-panel[data-state="active"]').getByRole("button", { name, exact: true });
}
async function caption(page, text) {
  console.log(text);
  await page.evaluate((label) => {
    let banner = document.getElementById("catan-playwright-demo");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "catan-playwright-demo";
      banner.style.cssText = "position:fixed;top:4px;right:8px;max-width:65vw;padding:7px 12px;border-radius:10px;background:#172b32ed;color:#fff;font:13px system-ui;z-index:9999;pointer-events:none";
      document.body.append(banner);
    }
    banner.textContent = label;
  }, text);
}
function describe(action, game) {
  switch (action.type) {
    case "map_vote": return "Zufällige Karte akzeptieren";
    case "resolve_map_tie": return "Karte annehmen";
    case "build": return `${labels[action.building]} bauen`;
    case "roll": return "Würfeln";
    case "end_turn": return "Zug beenden";
    case "buy_development": return "Entwicklungskarte kaufen";
    case "play_development": return `${rules.DEVELOPMENT_INFO[game.players.flatMap((p) => p.development).find((card) => card.id === action.cardId).type].label} ausspielen`;
    case "bank_trade": return `${rules.RESOURCE_INFO[action.give].label} gegen ${rules.RESOURCE_INFO[action.receive].label} tauschen`;
    case "discard": return "Rohstoffe nach einer 7 abgeben";
    case "move_robber": return "Räuber versetzen";
    case "steal": return "Eine Rohstoffkarte stehlen";
    default: return action.type;
  }
}

async function perform(page, game, action) {
  const actor = game.players.find((p) => p.id === rules.localActorId(game));
  switch (action.type) {
    case "map_vote":
    case "resolve_map_tie":
      await tab(page, "Insel");
      await button(page, action.type === "map_vote" ? "Karte akzeptieren" : "Karte annehmen").click();
      break;
    case "build": {
      if (game.phase === "main") {
        await tab(page, "Bauen");
        await page.locator(".catan-build-choice").filter({ has: page.locator("strong", { hasText: new RegExp(`^${labels[action.building]}$`) }) }).click();
      } else await tab(page, "Insel");
      const name = action.building === "road" ? `Straße auf Weg ${action.position + 1} bauen` : `${labels[action.building]} auf Kreuzung ${action.position + 1} bauen`;
      const place = page.getByRole("button", { name, exact: true });
      // SVG touch areas overlap; the game's keyboard control selects exactly
      // the advertised legal position, also on differently randomized islands.
      await place.press("Enter");
      await expect(place).toHaveAttribute("aria-pressed", "true");
      if (pause) await page.waitForTimeout(pause);
      await button(page, "Bauen bestätigen").click();
      break;
    }
    case "roll":
    case "end_turn":
      await tab(page, "Insel");
      await button(page, action.type === "roll" ? "Würfeln" : "Zug beenden").click();
      break;
    case "buy_development":
      await tab(page, "Bauen");
      await page.locator(".catan-build-choice").filter({ hasText: "Entwicklungskarte kaufen" }).click();
      break;
    case "bank_trade": {
      await tab(page, "Handel");
      const bank = button(page, /^Hafen & Bank/);
      if (await bank.isVisible()) await bank.click();
      await button(page, new RegExp(`^Du gibst \\d: ${rules.RESOURCE_INFO[action.give].label}$`)).click();
      await button(page, `Du erhältst 1 · Bankvorrat: ${rules.RESOURCE_INFO[action.receive].label}`).click();
      if (pause) await page.waitForTimeout(pause);
      await button(page, "Tausch bestätigen").click();
      break;
    }
    case "discard":
      await tab(page, "Karten");
      for (const resource of rules.RESOURCES) {
        for (let i = 0; i < (action.resources[resource] ?? 0); i++) await button(page, `Abgeben: mehr ${rules.RESOURCE_INFO[resource].label}`).click();
      }
      await button(page, "Abgabe bestätigen").click();
      break;
    case "move_robber":
      await tab(page, "Insel");
      await page.getByRole("button", { name: new RegExp(`^Räuber auf Feld ${action.hex + 1}:`) }).press("Enter");
      if (pause) await page.waitForTimeout(pause);
      await button(page, "Räuber versetzen").click();
      break;
    case "steal":
      await tab(page, "Insel");
      await button(page, `${game.players.find((p) => p.id === action.victimId).name} bestehlen`).click();
      break;
    case "play_development": {
      await tab(page, "Karten");
      // Return from the previous card's detail view when another card is chosen.
      const back = button(page, "Einen Schritt zurück");
      if (await back.isVisible()) await back.click();
      const card = actor.development.find((card) => card.id === action.cardId);
      const label = rules.DEVELOPMENT_INFO[card.type].label;
      await page.locator(".catan-development-choice").filter({ has: page.locator("strong", { hasText: new RegExp(`^${label}$`) }) }).click();
      await button(page, `${label} ausspielen`).click();
      if (card.type === "monopoly") {
        await button(page, `Diesen Rohstoff fordern: ${rules.RESOURCE_INFO[action.resource].label}`).click();
        await button(page, "Karte bestätigen").click();
      } else if (card.type === "plenty") {
        const chosen = rules.RESOURCES.flatMap((r) => Array(action.resources[r] ?? 0).fill(r));
        if (chosen.length) await button(page, `Erster Rohstoff: ${rules.RESOURCE_INFO[chosen[0]].label}`).click();
        if (chosen.length > 1) {
          await button(page, "Weiter: Zweiter Rohstoff").click();
          await button(page, `Zweiter Rohstoff: ${rules.RESOURCE_INFO[chosen[1]].label}`).click();
        }
        await button(page, "Karte bestätigen").click();
      }
      break;
    }
    case "accept_trade":
    case "cancel_trade":
      await tab(page, "Handel");
      await button(page, action.type === "accept_trade" ? "Annehmen" : "Ablehnen").click();
      break;
    default: throw new Error(`Kein UI-Schritt für ${action.type}`);
  }
}

test("sichtbare Catan-Partie mit echter Zufallskarte und hörbaren Sounds", async ({ browser, baseURL }, testInfo) => {
  const seats = [];
  const pageErrors = [];
  const audioErrors = [];
  let initialBoard;
  let game;
  let completedTurns = 0;
  const names = ["Anna", "Ben", "Clara"];
  const viewerName = process.env.CATAN_DEMO_VIEWER ?? "Anna";
  if (!names.includes(viewerName)) throw new Error("CATAN_DEMO_VIEWER: Anna, Ben oder Clara wählen.");
  let reference;

  // Independent player sessions/tabs; no saved local match is overwritten.
  async function newSeat(name) {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference", serviceWorkers: "block" });
    await context.addInitScript(observeDemoAudio);
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(`${name}: ${error.message}`));
    page.on("response", (response) => {
      if (response.url().includes("/audio/catan/") && !response.ok()) audioErrors.push(`${response.status()} ${response.url()}`);
    });
    page.on("requestfailed", (request) => {
      if (request.url().includes("/audio/catan/")) audioErrors.push(request.url());
    });
    const seat = { name, context, page };
    seats.push(seat);
    return seat;
  }
  async function readSeat(seat) {
    // Read the same authenticated view a human player receives. Never post an
    // action here or retrieve the hidden deck; every move goes through the UI.
    const response = await seat.page.request.get(`/api/catan?lobby=${seat.session.lobbyId}`, { headers: { Authorization: `Bearer ${seat.session.token}` } });
    expect(response.ok(), "Die lokale Catan-API muss erreichbar sein (siehe README Datenbank-Setup).").toBeTruthy();
    return response.json();
  }
  async function snapshot() {
    let states;
    await expect.poll(async () => {
      states = await Promise.all(seats.map(readSeat));
      return new Set(states.map((state) => state.lobby.revision)).size;
    }).toBe(1);
    const publicGame = states[0].game;
    const players = publicGame.players.map((p) => states.find((state) => state.me.id === p.id).game.me);
    const notifications = [...new Map(states.flatMap((state) => state.game.notifications ?? []).map((notice) => [notice.id, notice])).values()];
    return { ...publicGame, players, notifications, deck: Array(publicGame.deckCount).fill(null) };
  }
  async function focus(seat) {
    // Keep one human spectator's perspective visible for the entire match.
    // Other players act in their own background tabs with audio disabled.
    await reference.page.bringToFront();
    // The authoritative API can be ahead of a tab's WebSocket/React update.
    // Consume the previous move while still muted, before unlocking audio.
    await expect(seat.page.locator(".catan-play")).toHaveAttribute("data-catan-sequence", String(game.sequence));
    await expect(reference.page.locator(".catan-play")).toHaveAttribute("data-catan-sequence", String(game.sequence));
    await reference.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await tab(reference.page, "Insel");
    const enable = reference.page.getByRole("button", { name: "Soundeffekte einschalten", exact: true });
    if (await enable.count()) await enable.click();
    await expect(reference.page.getByRole("button", { name: "Soundeffekte ausschalten", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => reference.page.evaluate(() => window.__catanDemoAudio.decoded)).toBe(Object.keys(rules.CATAN_SOUND_FILES).length);
  }

  try {
    const host = await newSeat(names[0]);
    await host.page.goto("/catan");
    await host.page.getByRole("button", { name: /^Lobby erstellen/ }).click();
    await host.page.getByRole("textbox", { name: "Dein Name", exact: true }).fill(host.name);
    await host.page.getByRole("textbox", { name: "Gruppenname", exact: true }).fill(`Demo ${Date.now().toString(36)}`);
    for (let n = rules.DEFAULT_TARGET_POINTS; n > target; n--) await host.page.getByRole("button", { name: "Siegpunkte verringern" }).click();
    for (let n = rules.DEFAULT_TARGET_POINTS; n < target; n++) await host.page.getByRole("button", { name: "Siegpunkte erhöhen" }).click();
    await host.page.getByRole("button", { name: "Lobby erstellen", exact: true }).click();
    await expect(host.page.getByRole("heading", { name: "Mitspielende" })).toBeVisible();
    host.session = await host.page.evaluate(() => JSON.parse(localStorage.getItem("gameson-catan-session-v1")));

    for (const name of names.slice(1)) {
      const seat = await newSeat(name);
      await seat.page.goto(`/catan?lobby=${host.session.lobbyId}&join=1`);
      await seat.page.getByRole("textbox", { name: "Dein Name", exact: true }).fill(name);
      await seat.page.getByRole("button", { name: "Beitreten", exact: true }).click();
      await expect(seat.page.getByRole("heading", { name: "Mitspielende" })).toBeVisible();
      seat.session = await seat.page.evaluate(() => JSON.parse(localStorage.getItem("gameson-catan-session-v1")));
    }
    await host.page.bringToFront();
    await host.page.getByRole("button", { name: "Partie starten", exact: true }).click();
    reference = seats.find((seat) => seat.name === viewerName);
    await reference.page.bringToFront();
    await expect(host.page.getByRole("region", { name: "Kartenabstimmung", exact: true })).toBeVisible();
    game = await snapshot();
    initialBoard = structuredClone(game.board);
    expect(game.phase).toBe("map_vote");
    expect(game.board.hexes).toHaveLength(19);
    expect(game.board.harbors).toHaveLength(9);
    expect(game.targetPoints).toBe(target);
    for (const edge of game.board.edges.filter((edge) => edge.hexes.length === 2)) {
      expect(edge.hexes.every((id) => [6, 8].includes(game.board.hexes[id].number)), "Rote Zahlen dürfen nicht aneinandergrenzen.").toBeFalsy();
    }
    await testInfo.attach("zufaellig-generierte-karte", { body: JSON.stringify(initialBoard, null, 2), contentType: "application/json" });

    let actions = 0;
    while (game.phase !== "finished" && (!rounds || completedTurns < rounds * seats.length)) {
      expect(game.turn, "Das Zuglimit schützt vor endlosen Bot-Partien.").toBeLessThanOrEqual(maxTurns);
      expect(++actions, "Auch Aktionen ohne Zugwechsel sind begrenzt.").toBeLessThanOrEqual(maxTurns * 40 + 60);
      const action = chooseDemoAction(game, rules);
      const actor = rules.localActorId(game);
      const seat = seats.find((seat) => seat.session && game.players.find((p) => p.id === actor)?.name === seat.name);
      await focus(seat);
      await caption(reference.page, `Ansicht ${reference.name} · Zug ${game.turn} · ${seat.name}: ${describe(action, game)}`);
      await test.step(`${seat.name}: ${describe(action, game)}`, async () => {
        const beforeAudio = await reference.page.evaluate(() => window.__catanDemoAudio.started);
        const [response] = await Promise.all([
          seat.page.waitForResponse((response) => response.url().includes("/api/catan") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "move"),
          perform(seat.page, game, action),
        ]);
        expect(response.ok(), JSON.stringify(await response.json())).toBeTruthy();
        const next = await snapshot();
        expect(next.sequence).toBeGreaterThan(game.sequence);
        const viewerId = game.players.find((p) => p.name === reference.name).id;
        const expectedSounds = rules.catanSoundEvents(rules.catanView(game, viewerId), rules.catanView(next, viewerId));
        // Wait for React to schedule the confirmed cues, then drain every real
        // sample before another action/tab can stop it.
        await reference.page.bringToFront();
        await waitForDemoAudio(reference.page, pause, waitForAudio, beforeAudio + expectedSounds.length);
        if (waitForAudio) {
          const afterAudio = await reference.page.evaluate(() => window.__catanDemoAudio.started);
          expect(afterAudio - beforeAudio, `Erwartete Sounds: ${expectedSounds.join(", ")}`).toBe(expectedSounds.length);
        }
        expect(next.board.hexes).toEqual(initialBoard.hexes);
        expect(next.board.harbors).toEqual(initialBoard.harbors);
        game = next;
        if (action.type === "end_turn") completedTurns++;
      });
    }

    if (!rounds) {
      expect(game.phase).toBe("finished");
      const winner = game.players.find((p) => p.id === game.winner);
      expect(rules.victoryPoints(game, winner)).toBeGreaterThanOrEqual(target);
    }
    expect(pageErrors).toEqual([]);
    expect(audioErrors).toEqual([]);
    const audio = await Promise.all(seats.map(async (seat) => ({ name: seat.name, ...await seat.page.evaluate(() => {
      const { started, ended, cancelled, decoded, decodeErrors } = window.__catanDemoAudio;
      return { started, ended, cancelled, decoded, decodeErrors };
    }) })));
    expect(audio.reduce((sum, seat) => sum + seat.started, 0)).toBeGreaterThan(0);
    expect(audio.every((seat) => seat.decodeErrors === 0)).toBeTruthy();
    if (waitForAudio) expect(audio.every((seat) => seat.cancelled === 0), "Kein Sound darf durch den nächsten Demo-Schritt abgebrochen werden.").toBeTruthy();
    await testInfo.attach("audio-pruefung", { body: JSON.stringify(audio, null, 2), contentType: "application/json" });
    const last = reference;
    await last.page.bringToFront();
    await tab(last.page, "Übersicht");
    await caption(last.page, game.winner ? `${game.players.find((p) => p.id === game.winner).name} gewinnt · ${game.turn} Züge · echte Zufallskarte` : `${rounds} vollständige Spielrunden abgeschlossen · echte Zufallskarte`);
    await testInfo.attach("spielstand", { body: JSON.stringify({ ...game, deck: undefined, players: game.players.map((p) => ({ name: p.name, points: rules.victoryPoints(game, p) })) }, null, 2), contentType: "application/json" });
    await last.page.screenshot({ path: testInfo.outputPath("catan-demo.png"), fullPage: true });
    if (hold) await last.page.waitForTimeout(hold);
  } finally {
    for (const seat of seats) {
      const failed = testInfo.status !== testInfo.expectedStatus;
      if (failed) {
        await seat.page.screenshot({ path: testInfo.outputPath(`${seat.name}-failure.png`), fullPage: true }).catch(() => {});
      }
      await seat.context.close();
    }
  }
});
