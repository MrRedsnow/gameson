import assert from "node:assert/strict";
import { after } from "node:test";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, ".wrangler/test-artifacts/core-ball-api.cjs");
const engineOut = resolve(root, ".wrangler/test-artifacts/core-ball-api-engine.cjs");
const db = new DatabaseSync(":memory:");
const migration = await readFile(resolve(root, "drizzle/0011_core_ball.sql"), "utf8");
db.exec(migration); db.exec(migration);
db.exec("CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
const actualNow = Date.now;
let now = actualNow(); Date.now = () => now;
let schemaDelay = 0;
globalThis.coreBallTestPublished = [];
globalThis.coreBallTestPublishDelay = 0;
globalThis.coreBallTestDB = { prepare(sql) {
  function prepared(args = []) { return {
    bind: (...values) => prepared(values),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const result = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
  }; }
  return prepared();
} };
globalThis.coreBallTestEnsure = () => { now += schemaDelay; };
globalThis.coreBallTestAdvance = (duration) => { now += duration; };
await mkdir(resolve(root, ".wrangler/test-artifacts"), { recursive: true });
await build({ entryPoints: [resolve(root, "app/api/core-ball/route.ts")], outfile: out, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
  plugins: [{ name: "core-ball-d1-test", setup(build) {
    build.onResolve({ filter: /(?:^|\/)db$/ }, () => ({ path: "db", namespace: "test" }));
    build.onResolve({ filter: /core-ball-live-server$/ }, () => ({ path: "live", namespace: "test" }));
    build.onLoad({ filter: /^db$/, namespace: "test" }, () => ({ contents: "export const getD1=()=>globalThis.coreBallTestDB; export const ensureSchema=async()=>globalThis.coreBallTestEnsure();", loader: "js" }));
    build.onLoad({ filter: /^live$/, namespace: "test" }, () => ({ contents: "export const publishCoreBallLobby=async(lobby,deleted)=>{globalThis.coreBallTestPublished.push({lobby,deleted});globalThis.coreBallTestAdvance(globalThis.coreBallTestPublishDelay);};", loader: "js" }));
  } }],
});
await build({ entryPoints: [resolve(root, "lib/core-ball.ts")], outfile: engineOut, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
const require = createRequire(import.meta.url);
const { GET, POST } = require(out);
const { coreBallShotAngle } = require(engineOut);
after(async () => {
  Date.now = actualNow; db.close();
  delete globalThis.coreBallTestDB; delete globalThis.coreBallTestEnsure; delete globalThis.coreBallTestAdvance;
  delete globalThis.coreBallTestPublished; delete globalThis.coreBallTestPublishDelay;
  await rm(out, { force: true }); await rm(engineOut, { force: true });
});
let requestId = 0;
async function post(body, session, ip = `core-ball-${++requestId}`) {
  const response = await POST(new Request("https://gameson.test/api/core-ball", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(session ? { authorization: `Bearer ${session.token}` } : {}) }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function get(session, ip = `core-ball-${++requestId}`) {
  const response = await GET(new Request(`https://gameson.test/api/core-ball?lobby=${session.lobbyId}`, { headers: { authorization: `Bearer ${session.token}`, "cf-connecting-ip": ip } }));
  return { status: response.status, body: await response.json() };
}
async function nearby(ip) {
  const response = await GET(new Request("https://gameson.test/api/core-ball?nearby=1", { headers: { "cf-connecting-ip": ip } }));
  return { status: response.status, body: await response.json() };
}
async function create(name, settings = {}, ip) {
  const response = await post({ action: "create", name, playerName: "Anna", ...settings }, undefined, ip);
  assert.equal(response.status, 200); return response.body;
}
const join = (code, name) => post({ action: "join", code, playerName: name });
async function bodyFor(session, action, extra = {}) {
  const state = (await get(session)).body;
  return { action, lobbyId: session.lobbyId, revision: state.lobby.revision, commandId: crypto.randomUUID(), commandSeq: state.me.commandSeq + 1, ...extra };
}
async function command(session, action, extra = {}) { return post(await bodyFor(session, action, extra), session); }
async function move(session, action) {
  const state = (await get(session)).body;
  return command(session, "play", { move: { gameId: state.game.id, attemptId: state.game.attemptId, turnId: state.game.turnId, ...action } });
}
async function shoot(session, collision = false) {
  const state = (await get(session)).body; const game = state.game;
  now = Math.max(now, game.lockedUntil) + 200;
  let chosen = null;
  for (let step = 0; step < 3000; step++) {
    const angle = coreBallShotAngle(game, now + step * 5);
    const closest = Math.min(...game.pins.map((pin) => Math.hypot(Math.cos(angle) - Math.cos(pin.angle), Math.sin(angle) - Math.sin(pin.angle))));
    if (collision ? closest < 0.20 : closest > 0.23) { chosen = now + step * 5; break; }
  }
  assert.notEqual(chosen, null, "level has a safe/colliding firing angle"); now = chosen;
  return move(session, { type: "shoot", firedAt: now });
}

test("D1 migration is repeatable, private sessions and nearby lobbies follow network and settings", async () => {
  const wlan = "203.0.113.42"; const a = await create("Core Ball Discovery", {}, wlan);
  assert.equal(a.session.token.length, 64); assert.equal(a.state.me.commandSeq, 0);
  assert.equal(a.state.lobby.settings.mode, "coop");
  assert.ok(!JSON.stringify(a.state).includes("tokenHash")); assert.ok(!JSON.stringify(a.state).includes(a.session.token)); assert.ok(!JSON.stringify(a.state).includes("payloadHash"));
  assert.equal((await get({ ...a.session, token: "invalid" })).status, 401);
  assert.deepEqual((await nearby(wlan)).body.lobbies.map((lobby) => lobby.id), [a.session.lobbyId]);
  assert.deepEqual((await nearby("another-network")).body.lobbies, []);
  assert.equal((await command(a.session, "start")).status, 400);
  assert.equal((await command(a.session, "settings", { discoverable: false, mode: "competitive" })).status, 200);
  assert.deepEqual((await nearby(wlan)).body.lobbies, []);
  assert.equal((await get(a.session)).body.lobby.settings.mode, "competitive");
  assert.equal((await join(a.session.lobbyId, " ANNA ")).status, 409);
  assert.equal((await join("core ball discovery", "Ben")).status, 200);
});

test("concurrent joins preserve the eight-seat cap and ordered members", async () => {
  const a = await create("Core Ball Eight");
  for (let i = 1; i < 7; i++) assert.equal((await join(a.session.lobbyId, `Player ${i}`)).status, 200);
  const results = await Promise.all([join(a.session.lobbyId.toLowerCase(), "Last A"), join(a.session.lobbyId, "Last B")]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const state = (await get(a.session)).body;
  assert.equal(state.members.length, 8); assert.equal(state.members[0].id, a.state.me.id);
});

test("successful commands replay before revision checks, conflicting payloads and sequences never commit", async () => {
  const a = await create("Core Ball Receipts"); await join(a.session.lobbyId, "Ben");
  const body = await bodyFor(a.session, "start"); const pushes = globalThis.coreBallTestPublished.length;
  const simultaneous = await Promise.all([post(body, a.session), post(body, a.session)]);
  assert.deepEqual(simultaneous.map((result) => result.status), [200, 200]);
  assert.equal(globalThis.coreBallTestPublished.length, pushes + 1);
  assert.deepEqual(simultaneous[0].body.ack, simultaneous[1].body.ack);
  assert.deepEqual(simultaneous[0].body.state.game, simultaneous[1].body.state.game);
  assert.equal((await post({ ...body, action: "settings", discoverable: false }, a.session)).status, 409);
  assert.equal((await post({ ...body, commandId: crypto.randomUUID() }, a.session)).status, 409);
  const ready = await move(a.session, { type: "ready" }); assert.equal(ready.status, 200);
  assert.equal((await post(body, a.session)).status, 409, "only the latest receipt is retained");
  const skippedSeq = await bodyFor(a.session, "play", { move: { type: "finish", gameId: ready.body.state.game.id, attemptId: 1, turnId: 1 } });
  skippedSeq.commandSeq++; assert.equal((await post(skippedSeq, a.session)).status, 409);
});

test("different concurrent commands use revision compare-and-swap and leave one persisted acknowledgement", async () => {
  const a = await create("Core Ball CAS"); await join(a.session.lobbyId, "Ben");
  const first = await bodyFor(a.session, "settings", { mode: "competitive" });
  const second = { ...first, commandId: crypto.randomUUID(), mode: "coop", discoverable: false };
  const results = await Promise.all([post(first, a.session), post(second, a.session)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const state = (await get(a.session)).body;
  assert.equal(state.lobby.revision, first.revision + 1); assert.equal(state.me.commandSeq, 1);
});

test("five players share turns, paused handoffs, completion points, failure resets and guarded rematches", async () => {
  const a = await create("Core Ball Five", { mode: "competitive" }); const all = [a];
  for (const name of ["Ben", "Clara", "David", "Emilia"]) all.push((await join(a.session.lobbyId, name)).body);
  assert.equal((await command(a.session, "start")).status, 200);
  assert.equal((await join(a.session.lobbyId, "Late")).status, 409);
  assert.equal((await command(a.session, "leave")).status, 400);
  assert.equal((await command(a.session, "settings", { mode: "coop" })).status, 400);
  assert.equal((await move(all[1].session, { type: "ready" })).status, 403);
  assert.equal((await move(a.session, { type: "handoff", targetPlayerId: all[1].state.me.id })).status, 400);
  assert.equal((await move(a.session, { type: "ready" })).status, 200);
  assert.equal((await shoot(a.session)).status, 200);
  assert.equal((await move(a.session, { type: "handoff", targetPlayerId: all[1].state.me.id })).status, 409, "flight locks transition actions");
  now += 200;
  const handoff = await move(a.session, { type: "handoff", targetPlayerId: all[1].state.me.id }); assert.equal(handoff.status, 200);
  const paused = handoff.body.state.game;
  assert.equal(paused.phase, "awaiting-ready"); assert.equal(paused.runningSince, null); assert.equal(paused.remaining, 7);
  assert.equal(paused.contributions[a.state.me.id], 1); assert.equal(paused.players[0].score, 0);
  now += 5000; assert.equal((await get(all[4].session)).body.game.elapsedMs, paused.elapsedMs);
  assert.equal((await move(all[1].session, { type: "ready" })).status, 200);
  for (let i = 0; i < 7; i++) assert.equal((await shoot(all[1].session)).status, 200);
  now += 200;
  const level2 = (await get(a.session)).body.game;
  assert.equal(level2.level, 2); assert.equal(level2.completedLevels, 1); assert.equal(level2.activePlayerId, all[2].state.me.id);
  assert.equal(level2.players[0].score, 1); assert.equal(level2.players[1].score, 7);
  assert.equal((await move(all[2].session, { type: "ready" })).status, 200);
  assert.equal((await shoot(all[2].session)).status, 200); now += 200;
  assert.equal((await shoot(all[2].session, true)).status, 200); now += 200;
  const failed = (await get(a.session)).body.game;
  assert.equal(failed.level, 2); assert.equal(failed.activePlayerId, all[3].state.me.id); assert.equal(failed.remaining, 8);
  assert.ok(Object.values(failed.contributions).every((value) => value === 0)); assert.equal(failed.players[1].score, 7);
  assert.equal((await move(all[3].session, { type: "skip-player" })).status, 403);
  const skip = await move(a.session, { type: "skip-player" }); assert.equal(skip.status, 200);
  assert.equal(skip.body.state.game.activePlayerId, all[4].state.me.id);
  assert.equal((await move(all[4].session, { type: "finish" })).status, 403);
  const finished = await move(a.session, { type: "finish" }); assert.equal(finished.status, 200);
  assert.deepEqual(finished.body.state.game.result.winnerIds, [all[1].state.me.id]);
  assert.equal((await command(a.session, "reset", { gameId: "wrong-game" })).status, 400);
  assert.equal((await command(a.session, "reset", { gameId: finished.body.state.game.id })).status, 200);
  const restart = await command(a.session, "start"); assert.equal(restart.status, 200);
  assert.equal(restart.body.state.game.level, 1); assert.equal(restart.body.state.game.players[1].score, 0);
  assert.notEqual(restart.body.state.game.id, finished.body.state.game.id);
  assert.equal((await move(a.session, { type: "ready", gameId: finished.body.state.game.id })).status, 409);
});

test("duplicate shots never add pins or points twice and stale timestamps do not cause failure", async () => {
  const a = await create("Core Ball Shots"); await join(a.session.lobbyId, "Ben");
  await command(a.session, "start"); await move(a.session, { type: "ready" });
  const state = (await get(a.session)).body; now += 200;
  const guard = { gameId: state.game.id, attemptId: state.game.attemptId, turnId: state.game.turnId };
  for (const firedAt of [now - 1001, now + 51, "now", null]) {
    const invalid = await move(a.session, { type: "shoot", firedAt }); assert.equal(invalid.status, 409);
  }
  assert.equal((await get(a.session)).body.game.collisions, 0);
  // At this early time the first shot lands between the four initial pins.
  const body = await bodyFor(a.session, "play", { move: { ...guard, type: "shoot", firedAt: now } });
  const results = await Promise.all([post(body, a.session), post(body, a.session)]);
  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  const saved = (await get(a.session)).body.game;
  assert.equal(saved.remaining, 7); assert.equal(saved.pins.length, 5); assert.equal(saved.contributions[a.state.me.id], 1);
  const laterState = (await get(a.session)).body; now += 5000;
  assert.deepEqual((await post(body, a.session)).body.ack, results[0].body.ack, "retry still works after its timestamp has expired");
  assert.equal((await get(a.session)).body.lobby.revision, laterState.lobby.revision);
});

test("reload restores authoritative state, skip keeps the board, and response clocks bracket server work", async () => {
  const a = await create("Core Ball Clock"); const b = (await join(a.session.lobbyId, "Ben")).body;
  await command(a.session, "start"); await move(a.session, { type: "ready" }); await shoot(a.session); now += 200;
  const before = (await get(a.session)).body.game;
  const skipped = await move(a.session, { type: "skip-player" }); assert.equal(skipped.status, 200);
  assert.deepEqual(skipped.body.state.game.pins, before.pins); assert.deepEqual(skipped.body.state.game.contributions, before.contributions);
  assert.equal((await get(b.session)).body.game.activePlayerId, b.state.me.id);
  schemaDelay = 180;
  const startTime = now; const timed = await get(a.session);
  assert.equal(timed.body.serverReceivedAt, startTime); assert.equal(timed.body.serverSentAt, startTime + 180);
  schemaDelay = 0; globalThis.coreBallTestPublishDelay = 250;
  const body = await bodyFor(b.session, "play", { move: { gameId: skipped.body.state.game.id, attemptId: skipped.body.state.game.attemptId, turnId: skipped.body.state.game.turnId, type: "ready" } });
  const publishStarted = now; const published = await post(body, b.session);
  assert.equal(published.status, 200); assert.equal(published.body.state.serverReceivedAt, publishStarted); assert.equal(published.body.state.serverSentAt, publishStarted + 250);
  globalThis.coreBallTestPublishDelay = 0; schemaDelay = 90;
  const retryStarted = now; const retry = await post(body, b.session);
  assert.equal(retry.status, 200); assert.equal(retry.body.state.serverReceivedAt, retryStarted); assert.equal(retry.body.state.serverSentAt, retryStarted + 90);
  schemaDelay = 0;
});

test("the shot timestamp window is checked at receipt, excluding server processing", async () => {
  const a = await create("Core Ball Processing"); await join(a.session.lobbyId, "Ben");
  await command(a.session, "start"); await move(a.session, { type: "ready" });
  now += 200;
  const current = (await get(a.session)).body;
  const body = await bodyFor(a.session, "play", { move: { type: "shoot", gameId: current.game.id, attemptId: current.game.attemptId, turnId: current.game.turnId, firedAt: now } });
  schemaDelay = 2000;
  const receivedAt = now; const response = await post(body, a.session); schemaDelay = 0;
  assert.equal(response.status, 200);
  assert.equal(response.body.state.serverReceivedAt, receivedAt); assert.equal(response.body.state.serverSentAt, receivedAt + 2000);
  assert.equal(response.body.state.game.remaining, 7, "a fresh safe shot survives more than one second of server work");
  assert.equal(response.body.state.game.lastEvent.at, body.move.firedAt);
});

test("host permissions, bounded departure receipts, finished membership changes, and invalid input", async () => {
  const a = await create("Core Ball Departures"); const b = (await join(a.session.lobbyId, "Ben")).body;
  for (const action of ["settings", "start", "reset", "remove"]) assert.equal((await command(b.session, action)).status, 403);
  const leftBody = await bodyFor(a.session, "leave");
  assert.equal((await post(leftBody, a.session)).status, 200); assert.equal((await post(leftBody, a.session)).status, 200);
  assert.equal((await get(a.session)).status, 401); assert.equal((await get(b.session)).body.lobby.hostPlayerId, b.state.me.id);
  assert.equal((await command(b.session, "leave")).status, 200); assert.equal((await get(b.session)).status, 404);
  const c = await create("Core Ball Finished Members"); const d = (await join(c.session.lobbyId, "Ben")).body;
  await command(c.session, "start"); await move(c.session, { type: "finish" });
  assert.equal((await command(c.session, "remove", { playerId: d.state.me.id })).status, 200);
  assert.equal((await get(d.session)).status, 401);
  assert.equal((await post([])).status, 400);
  assert.equal((await post({ action: "create", name: "x", playerName: "Anna" })).status, 400);
  assert.equal((await post({ action: "create", name: "Bad mode", playerName: "Anna", mode: "invalid" })).status, 400);
  assert.equal((await post({ action: "start", lobbyId: c.session.lobbyId, revision: 1 })).status, 401);
  assert.equal((await command(c.session, "settings", { discoverable: "false" })).status, 400);
  const malformed = await POST(new Request("https://gameson.test/api/core-ball", { method: "POST", body: "{oops" })); assert.equal(malformed.status, 400);
  const oversized = await POST(new Request("https://gameson.test/api/core-ball", { method: "POST", body: "x".repeat(4097) })); assert.equal(oversized.status, 413);
});

test("a new departure receipt survives eviction of eight older former members", async () => {
  const a = await create("Core Ball Bounded Receipts");
  const previous = [];
  for (let i = 0; i < 8; i++) {
    const joined = (await join(a.session.lobbyId, `Former ${i}`)).body; previous.push(joined);
    assert.equal((await command(joined.session, "leave")).status, 200);
  }
  const newcomer = (await join(a.session.lobbyId, "Newcomer")).body;
  // A host command writes active members before the existing former-member list.
  assert.equal((await command(a.session, "settings", { mode: "competitive" })).status, 200);
  const body = await bodyFor(newcomer.session, "leave");
  const accepted = await post(body, newcomer.session); const repeated = await post(body, newcomer.session);
  assert.equal(accepted.status, 200); assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body.ack, accepted.body.ack); assert.equal(repeated.body.left, true);
  const row = db.prepare("SELECT members FROM core_ball_lobbies WHERE id = ?").get(a.session.lobbyId);
  const members = JSON.parse(row.members);
  assert.equal(members.filter((member) => member.removed).length, 8);
  assert.equal(members.filter((member) => !member.removed).length, 1);
  assert.equal(members.at(-1).id, newcomer.state.me.id);
  assert.ok(!members.some((member) => member.id === previous[0].state.me.id), "evict the oldest departure, preserving the newest receipt");
});
