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
const out = resolve(root, ".wrangler/test-artifacts/hive-api.cjs");
const db = new DatabaseSync(":memory:");
const migration = await readFile(resolve(root, "drizzle/0010_hive.sql"), "utf8");
db.exec(migration); db.exec(migration);
db.exec("CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
globalThis.hiveTestDB = { prepare(sql) {
  function prepared(args = []) { return { bind: (...values) => prepared(values), async first() { return db.prepare(sql).get(...args) ?? null; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async run() { const result = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; } }; }
  return prepared();
} };
await mkdir(resolve(root, ".wrangler/test-artifacts"), { recursive: true });
await build({ entryPoints: [resolve(root, "app/api/hive/route.ts")], outfile: out, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
  plugins: [{ name: "d1-test", setup(build) {
    build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/db$/ }, () => ({ path: "db", namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const getD1=()=>globalThis.hiveTestDB; export const ensureSchema=async()=>{};", loader: "js" }));
  } }],
});
const { GET, POST } = createRequire(import.meta.url)(out);
after(async () => { db.close(); delete globalThis.hiveTestDB; await rm(out, { force: true }); });
let requestId = 0;
const lobbyNetworks = new Map();
async function post(body, session, ip = `hive-${++requestId}`) {
  const response = await POST(new Request("https://gameson.test/api/hive", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(session ? { authorization: `Bearer ${session.token}` } : {}) }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function get(session, ip = lobbyNetworks.get(session.lobbyId) ?? `hive-${++requestId}`) { const response = await GET(new Request(`https://gameson.test/api/hive?lobby=${session.lobbyId}`, { headers: { authorization: `Bearer ${session.token}`, "cf-connecting-ip": ip } })); return { status: response.status, body: await response.json() }; }
async function nearby(ip) { const response = await GET(new Request("https://gameson.test/api/hive?nearby=1", { headers: { "cf-connecting-ip": ip } })); return { status: response.status, body: await response.json() }; }
async function create(name, ip) { const response = await post({ action: "create", name, playerName: "Anna" }, undefined, ip); assert.equal(response.status, 200); if (ip) lobbyNetworks.set(response.body.session.lobbyId, ip); return response.body; }
const join = (code, name) => post({ action: "join", code, playerName: name });
async function command(session, action, extra = {}) {
  const current = await get(session);
  return post({ action, lobbyId: session.lobbyId, revision: current.body.lobby?.revision, ...extra }, session);
}
async function move(session, action) {
  const current = (await get(session)).body;
  return post({ action: "move", lobbyId: session.lobbyId, revision: current.lobby.revision, move: { gameId: current.game.id, ply: current.game.ply, ...action } }, session);
}

test("zwei Plätze, private Tokens, Einladungen, Netzwerk-Lobbys und Hostwechsel", async () => {
  const wlan = "203.0.113.42"; const a = await create("Hive Duel", wlan);
  assert.equal((await command(a.session, "start")).status, 400);
  assert.equal(a.session.token.length, 64); assert.ok(!JSON.stringify(a.state).includes("tokenHash")); assert.ok(!JSON.stringify(a.state).includes(a.session.token));
  assert.equal((await get({ ...a.session, token: "invalid" })).status, 401);
  assert.deepEqual((await nearby(wlan)).body.lobbies.map((l) => l.id), [a.session.lobbyId]);
  assert.deepEqual((await nearby("another-network")).body.lobbies, []);
  assert.equal((await command(a.session, "settings", { discoverable: false })).status, 200);
  assert.deepEqual((await nearby(wlan)).body.lobbies, []);
  assert.equal((await join(a.session.lobbyId, " ANNA ")).status, 409);
  const joined = await join("hive duel", "Ben"); assert.equal(joined.status, 200); const b = joined.body;
  assert.equal((await join(a.session.lobbyId, "Clara")).status, 409);
  for (const action of ["settings", "start", "reset", "remove"]) assert.equal((await command(b.session, action)).status, 403);
  assert.equal((await command(a.session, "leave")).status, 200);
  assert.equal((await get(b.session)).body.lobby.hostPlayerId, b.state.me.id); assert.equal((await get(a.session)).status, 401);
  await command(b.session, "leave"); assert.equal((await get(b.session)).status, 404);
});

test("gleichzeitiger Beitritt überschreitet die Zwei-Personen-Grenze nicht", async () => {
  const a = await create("Concurrent joins");
  const results = await Promise.all([join(a.session.lobbyId.toLowerCase(), "Ben"), join(a.session.lobbyId, "Clara")]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]); assert.equal((await get(a.session)).body.members.length, 2);
});

test("Server validiert Züge, Reihenfolge, Revisionen und hält beide Geräte synchron", async () => {
  const a = await create("Play duel"); const b = (await join(a.session.lobbyId, "Ben")).body;
  const started = await command(a.session, "start"); assert.equal(started.status, 200); const game = started.body.state.game;
  const aPiece = game.pieces.find((p) => p.ownerId === a.state.me.id && p.kind === "queen").id;
  const bPiece = game.pieces.find((p) => p.ownerId === b.state.me.id && p.kind === "queen").id;
  assert.equal((await command(a.session, "reset", { gameId: game.id })).status, 400);
  assert.equal((await move(b.session, { type: "place", pieceId: bPiece, to: { q: 0, r: 0 } })).status, 400);
  assert.equal((await move(a.session, { type: "place", pieceId: aPiece, to: { q: 12, r: 0 } })).status, 400);
  assert.equal((await move(a.session, { type: "pass" })).status, 400);
  const body = { action: "move", lobbyId: a.session.lobbyId, revision: started.body.state.lobby.revision, move: { type: "place", pieceId: aPiece, to: { q: 0, r: 0 }, gameId: game.id, ply: game.ply } };
  const simultaneous = await Promise.all([post(body, a.session), post(body, a.session)]);
  assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
  const synced = (await get(b.session)).body; assert.equal(synced.game.ply, 1); assert.equal(synced.game.pieces.find((p) => p.id === aPiece).position.q, 0);
  assert.equal((await move(b.session, { type: "place", pieceId: bPiece, to: { q: 1, r: 0 } })).status, 200);
  assert.equal((await get(a.session)).body.game.ply, 2);
  assert.equal((await command(a.session, "leave")).status, 400);
  const stateBefore = (await get(a.session)).body;
  assert.equal((await command(a.session, "settings", { discoverable: false })).status, 400);
  assert.equal((await get(a.session)).body.lobby.revision, stateBefore.lobby.revision);
});

test("Remis, Aufgeben, neue Partie mit getauschten Farben und Schutz vor verspäteten Zügen", async () => {
  const a = await create("Rematches"); const b = (await join(a.session.lobbyId, "Ben")).body;
  const start = await command(a.session, "start"); const oldGameId = start.body.state.game.id;
  assert.equal((await move(a.session, { type: "offer-draw" })).status, 200);
  assert.equal((await move(b.session, { type: "answer-draw", accept: true })).status, 200);
  assert.equal((await get(a.session)).body.game.result.reason, "agreement");
  assert.equal((await command(a.session, "reset", { gameId: "wrong-game" })).status, 400);
  assert.equal((await command(a.session, "reset", { gameId: oldGameId })).status, 200);
  const next = await command(a.session, "start"); assert.equal(next.status, 200);
  assert.equal(next.body.state.game.players[0].id, b.state.me.id); assert.notEqual(next.body.state.game.id, oldGameId);
  assert.equal((await move(b.session, { type: "pass", gameId: oldGameId, ply: 0 })).status, 400);
  assert.equal((await move(a.session, { type: "resign" })).status, 200);
  assert.equal((await get(b.session)).body.game.result.winnerId, b.state.me.id);
});

test("ungültige Eingaben und nicht autorisierte Änderungen werden abgewehrt", async () => {
  assert.equal((await post([])).status, 400); assert.equal((await post({ action: "create", name: "x", playerName: "Anna" })).status, 400);
  const a = await create("Input validation");
  assert.equal((await post({ action: "start", lobbyId: a.session.lobbyId, revision: 1 })).status, 401);
  assert.equal((await command(a.session, "remove", { playerId: "missing" })).status, 400);
  assert.equal((await command(a.session, "settings", { discoverable: "false" })).status, 400);
  const malformed = await POST(new Request("https://gameson.test/api/hive", { method: "POST", body: "{oops" })); assert.equal(malformed.status, 400);
  const oversized = await POST(new Request("https://gameson.test/api/hive", { method: "POST", body: "x".repeat(4097) })); assert.equal(oversized.status, 413);
});
