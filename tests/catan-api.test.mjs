import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { legalSettlements } from "../lib/catan.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = resolve(root, `.wrangler/test-artifacts/catan-api-${process.pid}.cjs`);
const db = new DatabaseSync(":memory:");
db.exec(await readFile(resolve(root, "drizzle/0007_catan.sql"), "utf8"));
db.exec("CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
// Use actual SQLite and the real HTTP handlers. Only the Workers binding is
// replaced, so CAS, constraints, projection and request validation are exercised.
globalThis.catanTestDB = {
  prepare(sql) {
    function prepared(args = []) {
      return { bind: (...values) => prepared(values),
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { const result = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
    }
    return prepared();
  },
};
await mkdir(resolve(root, ".wrangler/test-artifacts"), { recursive: true });
await build({ entryPoints: [resolve(root, "app/api/catan/route.ts")], outfile: out, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
  plugins: [{ name: "d1-test", setup(build) {
    build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/db$/ }, () => ({ path: "db", namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const getD1=()=>globalThis.catanTestDB; export const ensureSchema=async()=>{};", loader: "js" }));
  } }],
});
const { GET, POST } = createRequire(import.meta.url)(out);
after(async () => { db.close(); delete globalThis.catanTestDB; await rm(out, { force: true }); });
let requestId = 0;
async function post(body, session) {
  const response = await POST(new Request("https://gameson.test/api/catan", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `test-${++requestId}`, ...(session ? { authorization: `Bearer ${session.token}` } : {}) }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function get(session) { const response = await GET(new Request(`https://gameson.test/api/catan?lobby=${session.lobbyId}`, { headers: { authorization: `Bearer ${session.token}` } })); return { status: response.status, body: await response.json() }; }
async function create(name, points) { const r = await post({ action: "create", name, playerName: "Anna", targetPoints: points }); assert.equal(r.status, 200); return r.body; }
async function join(code, name) { return post({ action: "join", code, playerName: name }); }
async function command(session, action, extra = {}) { const { body } = await get(session); return post({ action, lobbyId: session.lobbyId, revision: body.lobby.revision, ...extra }, session); }

test("Catan-Lobby: Standard 12, einstellbar, Beitritt per Name/Code, maximal vier", async () => {
  const a = await create("Viererspiel"); assert.equal(a.state.lobby.targetPoints, 12); assert.equal(a.state.members.length, 1);
  assert.equal((await command(a.session, "start")).status, 400);
  assert.equal((await command(a.session, "settings", { targetPoints: 10 })).body.state.lobby.targetPoints, 10);
  const b = (await join("viererspiel", "Ben")).body; assert.equal(b.state.members.length, 2);
  assert.equal((await command(b.session, "settings", { targetPoints: 15 })).status, 403);
  assert.equal((await command(b.session, "start")).status, 403);
  assert.equal((await join(a.session.lobbyId, " anna ")).status, 409);
  assert.equal((await join(a.session.lobbyId.toLowerCase(), "Clara")).status, 200);
  const last = await Promise.all([join(a.session.lobbyId, "David"), join(a.session.lobbyId, "Eva")]);
  assert.deepEqual(last.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await get(a.session)).body.members.length, 4);
  const start = await command(a.session, "start"); assert.equal(start.status, 200); assert.equal(start.body.state.game.targetPoints, 10);
  assert.equal((await command(a.session, "settings", { targetPoints: 12 })).status, 400);
  assert.equal((await join(a.session.lobbyId, "Fred")).status, 409);
  assert.equal((await command(a.session, "reset")).status, 400);
});

test("Catan-API hält Hände und Tokens geheim und verliert keine gleichzeitigen Züge", async () => {
  const a = await create("Synchronspiel", 12); const b = (await join(a.session.lobbyId, "Ben")).body; const c = (await join(a.session.lobbyId, "Clara")).body;
  const s = (await command(a.session, "start")).body.state;
  const activeId = s.game.players[s.game.currentPlayer].id;
  const current = [a, b, c].find((p) => p.state.me.id === activeId);
  const other = [a, b, c].find((p) => p.state.me.id !== activeId);
  const own = (await get(current.session)).body;
  assert.ok(own.game.me.resources); assert.equal(own.game.deck, undefined);
  for (const p of own.game.players) { assert.equal(p.resources, undefined); assert.equal(p.development, undefined); assert.equal(p.tokenHash, undefined); }
  assert.ok(!JSON.stringify(own).includes("tokenHash"));
  const position = legalSettlements(own.game, activeId, true)[0];
  assert.equal((await command(other.session, "move", { move: { type: "build", building: "settlement", position } })).status, 400);
  const move = { action: "move", lobbyId: current.session.lobbyId, revision: own.lobby.revision, move: { type: "build", building: "settlement", position } };
  const outcomes = await Promise.all([post(move, current.session), post(move, current.session)]);
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
  const after = (await get(current.session)).body;
  assert.equal(after.game.phase, "setup_road"); assert.equal(after.game.board.vertices.filter((v) => v.owner).length, 1);
  assert.equal(after.lobby.revision, own.lobby.revision + 1);
  assert.equal((await get({ ...current.session, token: "wrong-token" })).status, 401);
  assert.equal((await get(other.session)).body.game.me.id, other.state.me.id);
  assert.equal((await command(current.session, "move", { move: { type: "build", building: "road", position: "0" } })).status, 400);
});

test("Lobby verlassen übergibt die Leitung und entfernte Tokens verlieren ihren Zugriff", async () => {
  const a = await create("Wechselspiel"); const b = (await join(a.session.lobbyId, "Ben")).body;
  assert.equal((await command(a.session, "leave")).body.left, true);
  assert.equal((await get(a.session)).status, 401);
  assert.equal((await get(b.session)).body.lobby.hostPlayerId, b.state.me.id);
  assert.equal((await command(b.session, "leave")).status, 200);
  assert.equal((await get(b.session)).status, 404);
});

test("API lehnt ungültige JSON-Anfragen, Zielwerte und nicht authentifizierte Änderungen ab", async () => {
  assert.equal((await post({ action: "create", name: "bad", playerName: "Anna", targetPoints: 2 })).status, 400);
  const response = await POST(new Request("https://gameson.test/api/catan", { method: "POST", body: "{oops" })); assert.equal(response.status, 400);
  const a = await create("Authspiel");
  assert.equal((await post({ action: "start", lobbyId: a.session.lobbyId, revision: 1 })).status, 401);
  assert.equal((await post({ action: "settings", lobbyId: a.session.lobbyId, targetPoints: 8 }, a.session)).status, 409);
});
