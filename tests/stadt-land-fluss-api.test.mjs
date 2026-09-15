import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = resolve(root, `.wrangler/test-artifacts/slf-api-${process.pid}.cjs`);
const db = new DatabaseSync(":memory:");
const migration = await readFile(resolve(root, "drizzle/0009_stadt_land_fluss.sql"), "utf8");
db.exec(migration); db.exec(migration); // Runtime bootstrap and deployment migration may run in either order.
db.exec("CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
globalThis.slfTestDB = {
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
await build({ entryPoints: [resolve(root, "app/api/stadt-land-fluss/route.ts")], outfile: out, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
  plugins: [{ name: "d1-test", setup(build) {
    build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/db$/ }, () => ({ path: "db", namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const getD1=()=>globalThis.slfTestDB; export const ensureSchema=async()=>{};", loader: "js" }));
  } }],
});
const { GET, POST } = createRequire(import.meta.url)(out);
after(async () => { db.close(); delete globalThis.slfTestDB; await rm(out, { force: true }); });
let requestId = 0;
async function post(body, session, ip = `test-${++requestId}`) {
  const response = await POST(new Request("https://gameson.test/api/stadt-land-fluss", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(session ? { authorization: `Bearer ${session.token}` } : {}) }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function get(session, ip = `test-${++requestId}`) { const response = await GET(new Request(`https://gameson.test/api/stadt-land-fluss?lobby=${session.lobbyId}`, { headers: { authorization: `Bearer ${session.token}`, "cf-connecting-ip": ip } })); return { status: response.status, body: await response.json() }; }
async function nearby(ip) { const response = await GET(new Request("https://gameson.test/api/stadt-land-fluss?nearby=1", { headers: { "cf-connecting-ip": ip } })); return { status: response.status, body: await response.json() }; }
async function create(name, settings, ip) { const response = await post({ action: "create", name, playerName: "Anna", settings }, undefined, ip); assert.equal(response.status, 200); return response.body; }
async function join(code, name, ip) { return post({ action: "join", code, playerName: name }, undefined, ip); }
const command = (session, action, extra = {}) => post({ action, lobbyId: session.lobbyId, ...extra }, session);
const move = (session, roundId, action) => command(session, "move", { move: { ...action, roundId } });
const gameInDB = (id) => JSON.parse(db.prepare("SELECT game FROM slf_lobbies WHERE id = ?").get(id).game);
const replaceGame = (id, game) => db.prepare("UPDATE slf_lobbies SET game = ? WHERE id = ?").run(JSON.stringify(game), id);

test("freie Lobby-Einstellungen, Authentifizierung, Nähe, Hostwechsel und Entfernen", async () => {
  const wlan = "203.0.113.9"; const a = await create("Wortakrobaten", undefined, wlan);
  assert.equal(a.state.lobby.settings.timerSeconds, 120); assert.deepEqual(a.state.lobby.settings.columns, ["Stadt", "Land", "Fluss", "Tier", "Beruf"]);
  assert.equal((await command(a.session, "start")).status, 400);
  assert.equal((await join("WORTAKROBATEN", " anna ")).status, 409);
  const b = (await join(a.session.lobbyId.toLowerCase(), "Ben")).body;
  assert.equal((await get({ ...a.session, token: "invalid" })).status, 401);
  assert.equal((await post({ action: "start", lobbyId: a.session.lobbyId })).status, 401);
  for (const action of ["settings", "start", "timer", "remove", "reset"]) assert.equal((await command(b.session, action)).status, 403, action);
  assert.equal((await command(a.session, "settings", { settings: { columns: ["Essen", "Beruf"], timerSeconds: null, rounds: 3 } })).status, 200);
  assert.deepEqual((await get(b.session)).body.lobby.settings, { columns: ["Essen", "Beruf"], timerSeconds: null, rounds: 3 });
  assert.deepEqual((await nearby(wlan)).body.lobbies.map((lobby) => lobby.id), [a.session.lobbyId]);
  assert.deepEqual((await nearby("elsewhere")).body.lobbies, []);
  await command(a.session, "settings", { discoverable: false }); assert.deepEqual((await nearby(wlan)).body.lobbies, []);
  assert.equal((await command(a.session, "remove", { playerId: b.state.me.id })).status, 200);
  assert.equal((await get(b.session)).status, 401);
  const c = (await join(a.session.lobbyId, "Clara")).body;
  await command(a.session, "leave"); assert.equal((await get(c.session)).body.lobby.hostPlayerId, c.state.me.id);
  assert.equal((await get(a.session)).status, 401); await command(c.session, "leave"); assert.equal((await get(c.session)).status, 404);
});

test("22 parallele Spieler behalten Antworten; verzögerte Saves überschreiben weder neuere Daten noch Abgaben", async () => {
  const a = await create("Parallelspiel", { columns: ["Stadt", "Land"], timerSeconds: null, rounds: 2 });
  const joins = await Promise.all(Array.from({ length: 21 }, (_, i) => join(a.session.lobbyId, `Person ${i + 1}`)));
  assert.ok(joins.every((r) => r.status === 200), joins.map((r) => r.body.error).join(", "));
  const people = [a, ...joins.map((r) => r.body)];
  assert.equal((await join(a.session.lobbyId, "Zu viel")).status, 409);
  const started = await command(a.session, "start"); assert.equal(started.status, 200);
  const roundId = started.body.state.game.round.id; const letter = started.body.state.game.round.letter;
  const saves = await Promise.all(people.map((person, i) => move(person.session, roundId, { type: "answers", values: [`${letter}stadt ${i}`, `${letter}land ${i}`], sequence: 1 })));
  assert.ok(saves.every((r) => r.status === 200), saves.map((r) => r.body.error).join(", "));
  const stored = gameInDB(a.session.lobbyId);
  for (let i = 0; i < people.length; i++) assert.equal(stored.round.answers[people[i].state.me.id].values[0], `${letter}stadt ${i}`);
  const own = (await get(a.session)).body;
  assert.deepEqual(Object.keys(own.game.round.answers), [a.state.me.id]); assert.equal(own.game.progress.length, 22);
  assert.ok(!JSON.stringify(own).includes("tokenHash")); assert.ok(!JSON.stringify(own).includes(`${letter}stadt 1`));
  await move(a.session, roundId, { type: "answers", values: [`${letter}neu`, ""], sequence: 3 });
  await move(a.session, roundId, { type: "answers", values: ["OLD", ""], sequence: 2 });
  assert.equal((await get(a.session)).body.game.round.answers[a.state.me.id].values[0], `${letter}neu`);
  const submissions = await Promise.all(people.map((person, i) => move(person.session, roundId, { type: "answers", values: [`${letter}fertig ${i}`, ""], sequence: 4, submit: true })));
  assert.ok(submissions.every((r) => r.status === 200));
  assert.equal((await get(a.session)).body.game.phase, "review");
  assert.equal(Object.keys((await get(people[1].session)).body.game.round.answers).length, 22);
  assert.equal((await move(a.session, roundId, { type: "answers", values: ["LATE", ""], sequence: 9 })).status, 400);
});

test("gleiche Deadline auf allen Geräten, Live-Timeränderungen und abgelaufene Antworten", async () => {
  const a = await create("Timerspiel", { columns: ["Stadt", "Land"], timerSeconds: 60, rounds: 2 });
  const b = (await join(a.session.lobbyId, "Ben")).body; const start = (await command(a.session, "start")).body.state;
  const roundId = start.game.round.id; const letter = start.game.round.letter;
  assert.equal((await get(b.session)).body.game.round.endsAt, start.game.round.endsAt);
  assert.ok(Math.abs(start.serverNow - Date.now()) < 1000);
  assert.equal((await command(a.session, "settings", { settings: { columns: ["Tier", "Beruf"], timerSeconds: 60, rounds: 2 } })).status, 400);
  assert.equal((await command(b.session, "timer", { roundId, timerSeconds: 30 })).status, 403);
  assert.equal((await command(a.session, "timer", { roundId: "stale", timerSeconds: null })).status, 409);
  const changed = await command(a.session, "timer", { roundId, timerSeconds: 30 }); assert.equal(changed.status, 200);
  const deadline = changed.body.state.game.round.endsAt; assert.ok(Math.abs(deadline - Date.now() - 30000) < 1000);
  assert.equal((await get(b.session)).body.game.round.endsAt, deadline);
  await command(a.session, "timer", { roundId, timerSeconds: null }); assert.equal((await get(b.session)).body.game.round.endsAt, null);
  await command(a.session, "timer", { roundId, timerSeconds: 15 });
  await move(b.session, roundId, { type: "answers", values: [`${letter}vorher`, ""], sequence: 1 });
  const expired = gameInDB(a.session.lobbyId); expired.round.endsAt = Date.now() - 1; replaceGame(a.session.lobbyId, expired);
  const late = await move(b.session, roundId, { type: "answers", values: [`${letter}nachher`, ""], sequence: 2 }); assert.equal(late.status, 400);
  const done = (await get(a.session)).body; assert.equal(done.game.phase, "review"); assert.equal(done.game.round.stopReason, "timer");
  assert.equal(done.game.round.answers[b.state.me.id].values[0], `${letter}vorher`);
  assert.equal(gameInDB(a.session.lobbyId).phase, "review", "Expiry is persisted even on a rejected write");
});

test("gleichzeitige Tap-Stimmen, idempotente Wertung, Spaltenwechsel und kompletter Neustart", async () => {
  const a = await create("Abstimmung", { columns: ["Stadt", "Land"], timerSeconds: null, rounds: 2 });
  const b = (await join(a.session.lobbyId, "Ben")).body; const c = (await join(a.session.lobbyId, "Clara")).body; const people = [a, b, c];
  const started = (await command(a.session, "start")).body.state; const roundId = started.game.round.id; const letter = started.game.round.letter;
  await Promise.all(people.map((p) => move(p.session, roundId, { type: "answers", values: [`${letter}gleich`, `${letter}land`], sequence: 1, submit: true })));
  const target = { playerId: a.state.me.id, column: 1 };
  const flags = await Promise.all(people.map((p) => move(p.session, roundId, { type: "challenge", ...target })));
  assert.ok(flags.every((r) => r.status === 200));
  const votes = await Promise.all(people.map((p, i) => move(p.session, roundId, { type: "vote", ...target, valid: i === 0 })));
  assert.ok(votes.every((r) => r.status === 200));
  const challenged = Object.values((await get(a.session)).body.game.round.challenges);
  assert.equal(challenged.length, 1); assert.equal(Object.keys(challenged[0].votes).length, 3);
  assert.equal((await move(a.session, roundId, { type: "score" })).status, 400);
  await Promise.all(people.map((p) => move(p.session, roundId, { type: "ready" })));
  const scoring = await Promise.all([move(a.session, roundId, { type: "score" }), move(a.session, roundId, { type: "score" })]);
  assert.deepEqual(scoring.map((r) => r.status).sort(), [200, 400]);
  const result = (await get(a.session)).body; assert.equal(result.game.scores[a.state.me.id], 5); assert.equal(result.game.history.length, 1);
  assert.equal((await command(a.session, "settings", { settings: { columns: ["Lieblingsessen", "Vorname", "Marke"], timerSeconds: 90, rounds: 2 } })).status, 200);
  const next = await move(a.session, roundId, { type: "next" }); assert.equal(next.status, 200); assert.notEqual(next.body.state.game.round.letter, letter);
  assert.deepEqual(next.body.state.game.round.columns, ["Lieblingsessen", "Vorname", "Marke"]);
  assert.equal((await move(a.session, roundId, { type: "stop" })).status, 400);
  const lastRoundId = next.body.state.game.round.id;
  await move(a.session, lastRoundId, { type: "stop" });
  await move(a.session, lastRoundId, { type: "score", force: true });
  const final = (await get(a.session)).body.game; assert.equal(final.phase, "finished"); assert.equal(final.history.length, 2);
  assert.equal((await command(a.session, "reset", { gameId: final.id })).status, 200);
  assert.equal((await get(b.session)).body.game, null);
  assert.equal((await join(a.session.lobbyId, "Dana")).status, 200);
  assert.equal((await command(a.session, "start")).status, 200);
});

test("API verwirft fehlerhafte JSON-, Spalten-, Timer- und Stimmenwerte", async () => {
  const invalid = await POST(new Request("https://gameson.test/api/stadt-land-fluss", { method: "POST", body: "{oops" })); assert.equal(invalid.status, 400);
  assert.equal((await post([])).status, 400); assert.equal((await post({ action: "create", name: "Invalid", playerName: "Anna", settings: { columns: ["Stadt", "Stadt"], rounds: 5, timerSeconds: 60 } })).status, 400);
  const a = await create("Validierung"); const b = (await join(a.session.lobbyId, "Ben")).body;
  assert.equal((await command(a.session, "timer", { timerSeconds: 0 })).status, 400);
  const start = (await command(a.session, "start")).body.state;
  assert.equal((await move(b.session, start.game.round.id, { type: "answers", values: [], sequence: 1 })).status, 400);
  assert.equal((await move(b.session, start.game.round.id, { type: "answers", values: Array(5).fill("a"), sequence: 1, submit: "false" })).status, 400);
});
