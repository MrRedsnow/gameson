import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { legalRoads, legalSettlements } from "../lib/catan.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-live-server-${process.pid}.mjs`);
await mkdir(resolve(root, ".wrangler/test-artifacts"), { recursive: true });
await build({
  entryPoints: [resolve(root, "worker/index.ts")], outfile: output, bundle: true, platform: "browser", format: "esm", target: "es2022", logLevel: "silent", external: ["cloudflare:workers"],
  // Keep the real Worker upgrade path and API. Only the unrelated application renderer is replaced.
  plugins: [{ name: "test-router", setup(bundle) {
    bundle.onResolve({ filter: /^catan-api$/ }, () => ({ path: resolve(root, "app/api/catan/route.ts"), namespace: "file" }));
    bundle.onResolve({ filter: /^vinext\/server\/app-router-entry$/ }, () => ({ path: "router", namespace: "test" }));
    bundle.onResolve({ filter: /^vinext\/server\/image-optimization$/ }, () => ({ path: "images", namespace: "test" }));
    bundle.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ loader: "js", contents: path === "router"
      ? "import { GET, POST } from 'catan-api'; export default { fetch(request) { return new URL(request.url).pathname === '/api/catan' ? (request.method === 'POST' ? POST(request) : GET(request)) : new Response('Not found', {status:404}); } };"
      : "export const DEFAULT_DEVICE_SIZES=[]; export const DEFAULT_IMAGE_SIZES=[]; export const handleImageOptimization=()=>new Response('unused');" }));
  } }],
});
const mf = new Miniflare({
  scriptPath: output, modules: true, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
  d1Databases: { DB: "catan-live-tests" }, durableObjects: { CATAN_LIVE: { className: "CatanLobbyLive", useSQLite: true } },
});
const clients = [];
after(async () => { clients.forEach((client) => client.socket.close()); await mf.dispose(); await rm(output, { force: true }); });
const seededDatabase = await mf.getD1Database("DB");
for (const migration of ["0007_catan.sql", "0008_catan_nearby.sql"]) {
  const source = await readFile(resolve(root, "drizzle", migration), "utf8");
  await seededDatabase.exec(source.replaceAll("--> statement-breakpoint", "").replace(/\s+/g, " "));
}

async function post(body, session) {
  const response = await mf.dispatchFetch("https://gameson.test/api/catan", { method: "POST", headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session.token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function get(session) {
  const response = await mf.dispatchFetch(`https://gameson.test/api/catan?lobby=${session.lobbyId}`, { headers: { authorization: `Bearer ${session.token}` } });
  return { status: response.status, body: await response.json() };
}
async function create(name) { const result = await post({ action: "create", name, playerName: "Anna" }); assert.equal(result.status, 200); return result.body; }
async function join(session, playerName) { const result = await post({ action: "join", code: session.lobbyId, playerName }); assert.equal(result.status, 200); return result.body; }
async function command(session, action, extra = {}) { const current = await get(session); return post({ action, lobbyId: session.lobbyId, revision: current.body.lobby.revision, ...extra }, session); }

async function connect(session, token = session.token) {
  const response = await mf.dispatchFetch(`https://gameson.test/api/catan/live?lobby=${session.lobbyId}`, { headers: { upgrade: "websocket", origin: "https://gameson.test" } });
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  assert.ok(socket);
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
      const waiter = { predicate, resolve, timer: setTimeout(() => { pending.splice(pending.indexOf(waiter), 1); reject(new Error("Live message timed out")); }, 5000) };
      pending.push(waiter); drain();
    }); },
  };
  clients.push(client);
  client.send({ type: "authenticate", token });
  return client;
}

test("four authenticated clients receive confirmed builds immediately with private viewer projections", async () => {
  const a = await create("Vier Live-Geräte"); const b = await join(a.session, "Ben"); const c = await join(a.session, "Clara"); const d = await join(a.session, "David");
  const seats = [a, b, c, d];
  const live = await Promise.all(seats.map((seat) => connect(seat.session)));
  const hello = await Promise.all(live.map((client) => client.next((message) => message.type === "hello")));
  hello.forEach((message, i) => { assert.equal(message.state.me.id, seats[i].state.me.id); assert.equal(message.state.members.length, 4); });
  const started = await command(a.session, "start"); assert.equal(started.status, 200);
  const initial = await Promise.all(live.map((client) => client.next((message) => message.type === "state" && message.state.lobby.revision === started.body.state.lobby.revision)));
  const actorId = started.body.state.game.players[started.body.state.game.currentPlayer].id;
  const actor = seats.find((seat) => seat.state.me.id === actorId);
  const position = legalSettlements(started.body.state.game, actorId, true)[0];
  const begin = performance.now();
  const built = await post({ action: "move", lobbyId: a.session.lobbyId, revision: started.body.state.lobby.revision, move: { type: "build", building: "settlement", position } }, actor.session);
  assert.equal(built.status, 200);
  const updates = await Promise.all(live.map((client) => client.next((message) => message.type === "state" && message.state.lobby.revision === built.body.state.lobby.revision)));
  assert.ok(performance.now() - begin < 2000, "The push arrives before the old 2.5-second polling interval.");
  updates.forEach(({ state }, i) => {
    assert.equal(state.game.board.vertices[position].owner, actorId);
    assert.equal(state.game.me.id, seats[i].state.me.id);
    assert.equal(state.game.sequence, built.body.state.game.sequence);
    assert.equal(state.game.deck, undefined);
    state.game.players.forEach((player) => { assert.equal(player.resources, undefined); assert.equal(player.development, undefined); });
    assert.ok(!JSON.stringify(state).includes("tokenHash"));
    assert.ok(state.game.notifications.every((notice) => notice.playerId === null || notice.playerId === state.me.id));
  });
  assert.equal(initial[0].state.game.board.vertices[position].owner, null);
  const road = legalRoads(built.body.state.game, actorId, built.body.state.game.setupVertex)[0];
  const street = await command(actor.session, "move", { move: { type: "build", building: "road", position: road } });
  const streets = await Promise.all(live.map((client) => client.next((message) => message.type === "state" && message.state.lobby.revision === street.body.state.lobby.revision)));
  streets.forEach(({ state }) => assert.equal(state.game.board.edges[road].owner, actorId));
  live[0].send({ type: "ping" }); assert.equal((await live[0].next((message) => message.type === "pong")).type, "pong");

  const reconnect = await connect(actor.session);
  const baseline = await reconnect.next((message) => message.type === "hello");
  assert.equal(baseline.state.lobby.revision, street.body.state.lobby.revision);
  assert.equal(baseline.state.game.board.edges[road].owner, actorId, "Reconnect gets the current baseline without a historical state replay.");
});

test("duplicate and out-of-order publications never regress or repeat a viewer state", async () => {
  const a = await create("Live-Reihenfolge"); const b = await join(a.session, "Ben");
  const client = await connect(a.session); await client.next((message) => message.type === "hello");
  const database = await mf.getD1Database("DB");
  const old = await database.prepare("SELECT * FROM catan_lobbies WHERE id = ?").bind(a.session.lobbyId).first();
  const saved = await command(a.session, "settings", { targetPoints: 10 });
  await client.next((message) => message.type === "state" && message.state.lobby.revision === saved.body.state.lobby.revision);
  const current = await database.prepare("SELECT * FROM catan_lobbies WHERE id = ?").bind(a.session.lobbyId).first();
  const namespace = await mf.getDurableObjectNamespace("CATAN_LIVE");
  const stub = namespace.get(namespace.idFromName(a.session.lobbyId));
  const count = client.messages.filter(({ value }) => value.type === "state").length;
  for (const lobby of [current, old, current]) {
    const response = await stub.fetch("https://catan-live.internal/publish", { method: "POST", body: JSON.stringify({ lobbyId: lobby.id, revision: lobby.revision, lobby }) });
    assert.equal(response.status, 204);
  }
  client.send({ type: "ping" }); await client.next((message) => message.type === "pong");
  assert.equal(client.messages.filter(({ value }) => value.type === "state").length, count);
  const other = await connect(b.session); assert.equal((await other.next((message) => message.type === "hello")).state.lobby.revision, current.revision);
});

test("lobby isolation, removal and deletion revoke only the affected subscriptions", async () => {
  const a = await create("Live-Zugang"); const b = await join(a.session, "Ben"); const unrelated = await create("Andere Live-Lobby");
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

test("upgrades enforce origin and first-frame authentication without URL secrets", async () => {
  const a = await create("Live-Sicherheit");
  const address = `https://gameson.test/api/catan/live?lobby=${a.session.lobbyId}`;
  assert.equal((await mf.dispatchFetch(address)).status, 426);
  assert.equal((await mf.dispatchFetch(address, { headers: { upgrade: "websocket", origin: "https://elsewhere.test" } })).status, 403);
  assert.equal((await mf.dispatchFetch(`${address}&token=${a.session.token}`, { headers: { upgrade: "websocket", origin: "https://gameson.test" } })).status, 400);
  const wrong = await connect(a.session, "a".repeat(64)); assert.equal((await wrong.next((message) => message.type === "revoked")).status, 401);
  const proxy = await mf.dispatchFetch(`http://gameson.test/api/catan/live?lobby=${a.session.lobbyId}`, { headers: { upgrade: "websocket", origin: "https://gameson.test", "x-forwarded-proto": "https" } });
  assert.equal(proxy.status, 101, "HTTPS terminated by the documented reverse proxy retains the correct origin.");
  proxy.webSocket.accept(); proxy.webSocket.close();
});
