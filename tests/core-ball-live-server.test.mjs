import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { coreBallShotAngle } from "../lib/core-ball.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/core-ball-live-server-${process.pid}.mjs`);
await mkdir(resolve(root, ".wrangler/test-artifacts"), { recursive: true });
await build({
  entryPoints: [resolve(root, "worker/index.ts")], outfile: output, bundle: true, platform: "browser", format: "esm", target: "es2022", logLevel: "silent", external: ["cloudflare:workers"],
  // Exercise the real Worker, D1, API, publisher and hibernating DO; replace only the application renderer.
  plugins: [{ name: "core-ball-test-router", setup(bundle) {
    bundle.onResolve({ filter: /^core-ball-api$/ }, () => ({ path: resolve(root, "app/api/core-ball/route.ts"), namespace: "file" }));
    bundle.onResolve({ filter: /^vinext\/server\/app-router-entry$/ }, () => ({ path: "router", namespace: "test" }));
    bundle.onResolve({ filter: /^vinext\/server\/image-optimization$/ }, () => ({ path: "images", namespace: "test" }));
    bundle.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ loader: "js", contents: path === "router"
      ? "import { GET, POST } from 'core-ball-api'; export default { fetch(request) { return new URL(request.url).pathname === '/api/core-ball' ? (request.method === 'POST' ? POST(request) : GET(request)) : new Response('Not found', {status:404}); } };"
      : "export const DEFAULT_DEVICE_SIZES=[]; export const DEFAULT_IMAGE_SIZES=[]; export const handleImageOptimization=()=>new Response('unused');" }));
  } }],
});
const mf = new Miniflare({
  scriptPath: output, modules: true, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
  d1Databases: { DB: "core-ball-live-tests" }, durableObjects: { CORE_BALL_LIVE: { className: "CoreBallLobbyLive", useSQLite: true } },
});
const clients = [];
after(async () => { clients.forEach((client) => client.socket.close()); await mf.dispose(); await rm(output, { force: true }); });

async function post(body, session) {
  const response = await mf.dispatchFetch("https://gameson.test/api/core-ball", { method: "POST", headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session.token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function get(session) {
  const response = await mf.dispatchFetch(`https://gameson.test/api/core-ball?lobby=${session.lobbyId}`, { headers: { authorization: `Bearer ${session.token}` } });
  return { status: response.status, body: await response.json() };
}
async function create(name, mode = "coop") { const result = await post({ action: "create", name, playerName: "Anna", mode }); assert.equal(result.status, 200); return result.body; }
async function join(session, playerName) { const result = await post({ action: "join", code: session.lobbyId, playerName }); assert.equal(result.status, 200); return result.body; }
async function command(session, action, extra = {}) {
  const current = (await get(session)).body;
  return post({ action, lobbyId: session.lobbyId, revision: current.lobby.revision, commandId: crypto.randomUUID(), commandSeq: current.me.commandSeq + 1, ...extra }, session);
}
async function play(session, action) {
  const current = (await get(session)).body;
  return post({ action: "play", lobbyId: session.lobbyId, revision: current.lobby.revision, commandId: crypto.randomUUID(), commandSeq: current.me.commandSeq + 1,
    move: { gameId: current.game.id, attemptId: current.game.attemptId, turnId: current.game.turnId, ...action } }, session);
}
async function shoot(session) {
  const current = (await get(session)).body;
  const start = Math.max(current.serverSentAt + 40, current.game.lockedUntil + 20);
  let firedAt;
  for (let step = 0; step < 2000; step++) {
    const at = start + step * 5; const angle = coreBallShotAngle(current.game, at);
    const distance = Math.min(...current.game.pins.map((pin) => Math.hypot(Math.cos(angle) - Math.cos(pin.angle), Math.sin(angle) - Math.sin(pin.angle))));
    if (distance > 0.27) { firedAt = at; break; }
  }
  assert.ok(firedAt, "the starting board offers a safe shot");
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, firedAt - Date.now())));
  return play(session, { type: "shoot", firedAt });
}
const waitForLanding = () => new Promise((resolve) => setTimeout(resolve, 170));

async function connect(session, token = session.token) {
  const response = await mf.dispatchFetch(`https://gameson.test/api/core-ball/live?lobby=${session.lobbyId}`, { headers: { upgrade: "websocket", origin: "https://gameson.test" } });
  assert.equal(response.status, 101); const socket = response.webSocket; assert.ok(socket);
  const messages = []; const pending = [];
  function drain() {
    for (let i = pending.length - 1; i >= 0; i--) {
      const waiter = pending[i]; const index = messages.findIndex((message) => !message.consumed && waiter.predicate(message.value));
      if (index < 0) continue;
      messages[index].consumed = true; pending.splice(i, 1); clearTimeout(waiter.timer); waiter.resolve(messages[index].value);
    }
  }
  socket.addEventListener("message", (event) => { messages.push({ value: JSON.parse(event.data), consumed: false }); drain(); });
  socket.accept();
  const client = {
    socket, messages,
    send(message) { socket.send(JSON.stringify(message)); },
    next(predicate = () => true) { return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: setTimeout(() => { pending.splice(pending.indexOf(waiter), 1); reject(new Error("Core Ball live message timed out")); }, 5000) };
      pending.push(waiter); drain();
    }); },
  };
  clients.push(client); if (token !== null) client.send({ type: "authenticate", token }); return client;
}

function assertPrivate(state, seat, allSeats) {
  assert.equal(state.me.id, seat.state.me.id); assert.ok(Number.isSafeInteger(state.me.commandSeq));
  assert.ok(state.serverSentAt >= state.serverReceivedAt);
  const serialized = JSON.stringify(state);
  for (const secret of ["tokenHash", "payloadHash", "commandId", '"ack"', '"removed"', ...allSeats.map((entry) => entry.session.token)]) assert.ok(!serialized.includes(secret), `private data ${secret} must not be projected`);
  assert.ok(state.members.every((member) => Object.keys(member).sort().join(",") === "id,name"));
}
async function updates(live, result, seats) {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const messages = await Promise.all(live.map((client) => client.next((message) => message.type === "state" && message.state.lobby.revision === result.body.state.lobby.revision)));
  messages.forEach(({ state }, i) => { assertPrivate(state, seats[i], seats); assert.deepEqual(state.game, result.body.state.game); });
  return messages;
}

test("five authenticated phones receive ready, shots, handoff, skip and finish with private projections", async () => {
  const a = await create("Core Ball fünf Live-Geräte", "competitive");
  const seats = [a]; for (const name of ["Ben", "Clara", "David", "Emilia"]) seats.push(await join(a.session, name));
  const live = await Promise.all(seats.map((seat) => connect(seat.session)));
  const hellos = await Promise.all(live.map((client) => client.next((message) => message.type === "hello")));
  hellos.forEach(({ state }, i) => { assertPrivate(state, seats[i], seats); assert.equal(state.members.length, 5); assert.equal(state.game, null); });
  const started = await command(a.session, "start"); await updates(live, started, seats);
  assert.equal(started.body.state.game.activePlayerId, a.state.me.id); assert.equal(started.body.state.game.phase, "awaiting-ready");
  const ready = await play(a.session, { type: "ready" }); await updates(live, ready, seats);
  const begin = performance.now(); const shot = await shoot(a.session); await updates(live, shot, seats);
  assert.ok(performance.now() - begin < 2000, "a confirmed shot is pushed before the former polling interval");
  assert.equal(shot.body.state.game.remaining, 7); assert.equal(shot.body.state.game.contributions[a.state.me.id], 1);
  await waitForLanding();
  const handoff = await play(a.session, { type: "handoff", targetPlayerId: seats[1].state.me.id }); await updates(live, handoff, seats);
  assert.equal(handoff.body.state.game.phase, "awaiting-ready"); assert.equal(handoff.body.state.game.runningSince, null);
  assert.deepEqual(handoff.body.state.game.pins, shot.body.state.game.pins);
  const bReady = await play(seats[1].session, { type: "ready" }); await updates(live, bReady, seats);
  const bShot = await shoot(seats[1].session); await updates(live, bShot, seats);
  assert.equal(bShot.body.state.game.remaining, 6); await waitForLanding();
  const skipped = await play(a.session, { type: "skip-player" }); await updates(live, skipped, seats);
  assert.equal(skipped.body.state.game.activePlayerId, seats[2].state.me.id); assert.deepEqual(skipped.body.state.game.pins, bShot.body.state.game.pins);
  const cReady = await play(seats[2].session, { type: "ready" }); await updates(live, cReady, seats);
  const cShot = await shoot(seats[2].session); await updates(live, cShot, seats); await waitForLanding();
  const finished = await play(a.session, { type: "finish" }); await updates(live, finished, seats);
  assert.equal(finished.body.state.game.phase, "finished"); assert.equal(finished.body.state.game.completedLevels, 0);
  assert.ok(finished.body.state.game.players.every((player) => player.score === 0), "unfinished contributions remain unsecured");
  assert.deepEqual(finished.body.state.game.result.winnerIds, seats.map((seat) => seat.state.me.id));
  live[0].send({ type: "ping" }); assert.equal((await live[0].next((message) => message.type === "pong")).type, "pong");
  const reconnect = await connect(seats[2].session); const baseline = await reconnect.next((message) => message.type === "hello");
  assert.equal(baseline.state.lobby.revision, finished.body.state.lobby.revision); assert.deepEqual(baseline.state.game, finished.body.state.game);
  assertPrivate(baseline.state, seats[2], seats); assert.equal(reconnect.messages.filter(({ value }) => value.type === "state").length, 0, "reconnect sends a baseline without replaying historical actions");
});

test("stale, duplicate and mismatched publications never regress or duplicate viewer state", async () => {
  const a = await create("Core Ball Live-Reihenfolge"); const b = await join(a.session, "Ben");
  const client = await connect(a.session); await client.next((message) => message.type === "hello");
  const database = await mf.getD1Database("DB");
  const old = await database.prepare("SELECT * FROM core_ball_lobbies WHERE id = ?").bind(a.session.lobbyId).first();
  const saved = await command(a.session, "settings", { mode: "competitive" });
  await client.next((message) => message.type === "state" && message.state.lobby.revision === saved.body.state.lobby.revision);
  const current = await database.prepare("SELECT * FROM core_ball_lobbies WHERE id = ?").bind(a.session.lobbyId).first();
  const namespace = await mf.getDurableObjectNamespace("CORE_BALL_LIVE"); const stub = namespace.get(namespace.idFromName(a.session.lobbyId));
  const count = client.messages.filter(({ value }) => value.type === "state").length;
  for (const lobby of [current, old, current]) {
    const response = await stub.fetch("https://core-ball-live.internal/publish", { method: "POST", body: JSON.stringify({ lobbyId: lobby.id, revision: lobby.revision, lobby }) }); assert.equal(response.status, 204);
  }
  const mismatched = await stub.fetch("https://core-ball-live.internal/publish", { method: "POST", body: JSON.stringify({ lobbyId: current.id, revision: current.revision + 1, lobby: current }) }); assert.equal(mismatched.status, 400);
  const foreign = await stub.fetch("https://core-ball-live.internal/publish", { method: "POST", body: JSON.stringify({ lobbyId: "ZZZZZZ", revision: current.revision + 1, lobby: null }) }); assert.equal(foreign.status, 400);
  client.send({ type: "ping" }); await client.next((message) => message.type === "pong");
  assert.equal(client.messages.filter(({ value }) => value.type === "state").length, count);
  const reconnect = await connect(b.session); assert.equal((await reconnect.next((message) => message.type === "hello")).state.lobby.revision, current.revision);
});

test("lobby isolation, removal and deletion revoke only affected subscriptions", async () => {
  const a = await create("Core Ball Live-Zugang"); const b = await join(a.session, "Ben"); const unrelated = await create("Andere Core Ball Lobby");
  const [host, guest, stranger] = await Promise.all([connect(a.session), connect(b.session), connect(unrelated.session)]);
  await Promise.all([host, guest, stranger].map((client) => client.next((message) => message.type === "hello")));
  const removed = await command(a.session, "remove", { playerId: b.state.me.id }); assert.equal(removed.status, 200);
  assert.equal((await guest.next((message) => message.type === "revoked")).status, 401);
  await host.next((message) => message.type === "state" && message.state.lobby.revision === removed.body.state.lobby.revision);
  stranger.send({ type: "ping" }); await stranger.next((message) => message.type === "pong");
  assert.equal(stranger.messages.filter(({ value }) => value.type === "state").length, 0);
  const rejected = await connect(b.session); assert.equal((await rejected.next((message) => message.type === "revoked")).status, 401);
  assert.equal((await command(a.session, "leave")).status, 200);
  assert.equal((await host.next((message) => message.type === "revoked")).status, 404);
});

test("finished host departure transfers lobby administration and the next game's host", async () => {
  const a = await create("Core Ball Hostwechsel"); const b = await join(a.session, "Ben"); const c = await join(a.session, "Clara");
  const live = await connect(b.session); await live.next((message) => message.type === "hello");
  const started = await command(a.session, "start"); assert.equal(started.status, 200);
  const ended = await play(a.session, { type: "finish" }); assert.equal(ended.status, 200);
  assert.equal((await command(a.session, "leave")).status, 200);
  const transferred = await live.next((message) => message.type === "state" && message.state.lobby.hostPlayerId === b.state.me.id);
  assert.equal(transferred.state.game.phase, "finished"); assert.equal(transferred.state.members.length, 2);
  assert.equal((await command(c.session, "reset", { gameId: ended.body.state.game.id })).status, 403);
  const reset = await command(b.session, "reset", { gameId: ended.body.state.game.id }); assert.equal(reset.status, 200);
  const resetMessage = await live.next((message) => message.type === "state" && message.state.lobby.revision === reset.body.state.lobby.revision);
  assert.equal(resetMessage.state.game, null);
  const next = await command(b.session, "start"); assert.equal(next.status, 200);
  const newGame = await live.next((message) => message.type === "state" && message.state.lobby.revision === next.body.state.lobby.revision);
  assert.equal(newGame.state.game.hostPlayerId, b.state.me.id); assert.equal(newGame.state.game.activePlayerId, b.state.me.id);
  assert.equal(newGame.state.game.level, 1); assert.ok(newGame.state.game.players.every((player) => player.score === 0));
});

test("upgrades enforce origin, URL secrecy and first-frame authentication", async () => {
  const a = await create("Core Ball Live-Sicherheit");
  const address = `https://gameson.test/api/core-ball/live?lobby=${a.session.lobbyId}`;
  assert.equal((await mf.dispatchFetch(address)).status, 426);
  assert.equal((await mf.dispatchFetch(address, { headers: { upgrade: "websocket", origin: "https://elsewhere.test" } })).status, 403);
  assert.equal((await mf.dispatchFetch(`${address}&token=${a.session.token}`, { headers: { upgrade: "websocket", origin: "https://gameson.test" } })).status, 400);
  assert.equal((await mf.dispatchFetch(`${address}&authorization=secret`, { headers: { upgrade: "websocket", origin: "https://gameson.test" } })).status, 400);
  const wrong = await connect(a.session, "a".repeat(64)); assert.equal((await wrong.next((message) => message.type === "revoked")).status, 401);
  const anonymous = await connect(a.session, null); anonymous.send({ type: "shoot", firedAt: Date.now() });
  assert.equal((await anonymous.next((message) => message.type === "revoked")).status, 401);
  const proxy = await mf.dispatchFetch(`http://gameson.test/api/core-ball/live?lobby=${a.session.lobbyId}`, { headers: { upgrade: "websocket", origin: "https://gameson.test", "x-forwarded-proto": "https" } });
  assert.equal(proxy.status, 101, "HTTPS terminated by the documented reverse proxy preserves origin checks");
  proxy.webSocket.accept(); proxy.webSocket.close();
  assert.equal((await mf.dispatchFetch("https://gameson.test/publish", { method: "POST", body: "{}" })).status, 404, "publication endpoint remains internal to the DO");
});
