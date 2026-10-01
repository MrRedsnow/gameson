import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-live-client-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({ entryPoints: [resolve(root, "lib/catan-live-client.ts")], outfile: output, bundle: true, packages: "external", platform: "node", format: "cjs", logLevel: "silent" });
after(() => rm(output, { force: true }));
const { startCatanLive } = createRequire(import.meta.url)(output);

const session = { lobbyId: "AB C/D", token: "private-bearer-secret" };
const state = (revision, lobbyId = session.lobbyId) => ({
  lobby: { id: lobbyId, name: "Freunde", hostPlayerId: "a", targetPoints: 12, discoverable: true, revision },
  members: [{ id: "a", name: "Anna" }], me: { id: "a", name: "Anna" }, game: null,
});
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

class Socket {
  readyState = 0;
  listeners = new Map();
  sent = [];
  closes = 0;
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, extra = {}) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, ...extra }); }
  open() { this.readyState = 1; this.emit("open"); }
  receive(value) { this.emit("message", { data: typeof value === "string" ? value : JSON.stringify(value) }); }
  send(value) { assert.equal(this.readyState, 1); this.sent.push(JSON.parse(value)); }
  close() { this.closes++; this.readyState = 3; this.emit("close"); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function harness(t, { unavailable = false, initialState = null, autoHttp = false, random = .5 } = {}) {
  let now = 0; let timerId = 0; let wake = null;
  const timers = new Map(); const sockets = []; const attempts = []; const requests = [];
  const received = []; const connections = []; const revoked = [];
  const environment = {
    origin: "https://gameson.test",
    createSocket(url) { attempts.push({ url, at: now }); if (unavailable) return null; const socket = new Socket(); sockets.push(socket); return socket; },
    fetch(url, options) {
      const request = { url, options, at: now };
      requests.push(request);
      return new Promise((resolve, reject) => {
        Object.assign(request, { resolve, reject });
        if (autoHttp) resolve({ ok: true, status: 200, json: async () => state(1) });
      });
    },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    random: () => random,
    subscribeWake(callback) { wake = callback; return () => { wake = null; }; },
  };
  const controller = startCatanLive(session, {
    initialState,
    onState(value, metadata) { received.push({ revision: value.lobby.revision, ...metadata }); },
    onConnection(value) { connections.push(value); },
    onRevoked(status, message) { revoked.push({ status, message }); },
  }, environment);
  t.after(() => controller.dispose());
  return {
    controller, timers, sockets, attempts, requests, received, connections, revoked,
    respond(index, value, status = 200) { requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => value }); return flush(); },
    fail(index) { requests[index].reject(new Error("Offline")); return flush(); },
    async advanceTo(time) {
      assert.ok(time >= now);
      await flush();
      let next;
      while ((next = [...timers.entries()].filter(([, timer]) => timer.due <= time).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0])) {
        now = next[1].due; timers.delete(next[0]); next[1].callback(); await flush();
      }
      now = time; await flush();
    },
    wake() { wake?.(); },
    get subscribed() { return wake !== null; },
  };
}

test("authenticates only in the first socket frame and admits push before stale HTTP", async (t) => {
  const env = harness(t);
  assert.equal(env.requests.length, 1);
  const url = new URL(env.attempts[0].url);
  assert.equal(url.protocol, "wss:"); assert.equal(url.origin, "wss://gameson.test");
  assert.equal(url.pathname, "/api/catan/live"); assert.equal(url.searchParams.get("lobby"), session.lobbyId);
  assert.equal(url.searchParams.size, 1); assert.ok(!env.attempts[0].url.includes(session.token));
  assert.equal(env.requests[0].url, "/api/catan?lobby=AB%20C%2FD");
  assert.equal(env.requests[0].options.headers.Authorization, `Bearer ${session.token}`);
  const socket = env.sockets[0]; socket.open();
  assert.deepEqual(socket.sent, [{ type: "authenticate", token: session.token }]);
  assert.equal(env.requests.length, 1, "Opening while initial GET runs does not duplicate GET.");
  socket.receive({ type: "hello", state: state(3) });
  await env.respond(0, state(2));
  socket.receive({ type: "state", state: state(4) });
  socket.receive({ type: "hello", state: state(4) });
  socket.receive({ type: "state", state: state(3) });
  assert.deepEqual(env.received, [{ revision: 3, baseline: true }, { revision: 4, baseline: false }]);
  assert.deepEqual(env.connections, [true]);
});

test("an HTTP baseline remains ordered with a later hello and reconnect GET", async (t) => {
  const env = harness(t);
  await env.respond(0, state(1));
  const socket = env.sockets[0]; socket.open();
  assert.equal(env.requests.length, 2);
  socket.receive({ type: "hello", state: state(2) });
  await env.respond(1, state(3));
  socket.receive({ type: "state", state: state(4) });
  assert.deepEqual(env.received, [
    { revision: 1, baseline: true }, { revision: 2, baseline: true }, { revision: 3, baseline: true }, { revision: 4, baseline: false },
  ]);
});

test("seeding an already accepted state avoids duplicate callbacks and stale snapshots", async (t) => {
  const env = harness(t, { initialState: state(5) });
  const socket = env.sockets[0]; socket.open(); socket.receive({ type: "hello", state: state(5) });
  await env.respond(0, state(4));
  assert.deepEqual(env.received, []); assert.deepEqual(env.connections, [true]);
  socket.receive({ type: "state", state: state(6) });
  assert.deepEqual(env.received, [{ revision: 6, baseline: false }]);
});

test("ignores malformed, cross-lobby and unauthenticated state frames", async (t) => {
  const env = harness(t); const socket = env.sockets[0]; socket.open();
  for (const value of ["broken json", "null", { type: "state", state: state(1) }, { type: "hello", state: state(2, "OTHER") }, { type: "hello", state: { ...state(3), lobby: { ...state(3).lobby, revision: -1 } } }]) socket.receive(value);
  assert.deepEqual(env.received, []); assert.deepEqual(env.connections, []);
  socket.receive({ type: "hello", state: state(1) });
  assert.deepEqual(env.received, [{ revision: 1, baseline: true }]);
});

test("falls back every 2500ms and treats the first successful state as a baseline", async (t) => {
  const env = harness(t, { unavailable: true });
  await env.fail(0); assert.deepEqual(env.connections, [false]);
  await env.advanceTo(2499); assert.equal(env.requests.length, 1);
  await env.advanceTo(2500); assert.equal(env.requests.length, 2);
  await env.respond(1, state(1));
  assert.deepEqual(env.received, [{ revision: 1, baseline: true }]);
  await env.advanceTo(5000); await env.respond(2, state(2));
  assert.deepEqual(env.received.at(-1), { revision: 2, baseline: false });
  assert.deepEqual(env.connections, [false, true]);
});

test("socket failure preserves a working HTTP channel and reconnects to a new baseline", async (t) => {
  const env = harness(t);
  await env.respond(0, state(1));
  const socket = env.sockets[0]; socket.open(); socket.receive({ type: "hello", state: state(1) });
  await env.respond(1, state(1));
  socket.close(); assert.deepEqual(env.connections, [true]);
  assert.equal(env.requests.length, 3, "Socket failure immediately reconciles through HTTP.");
  await env.fail(2); assert.deepEqual(env.connections, [true, false]);
  await env.advanceTo(999); assert.equal(env.sockets.length, 1);
  await env.advanceTo(1000); const reopened = env.sockets[1]; reopened.open();
  reopened.receive({ type: "hello", state: state(3) });
  await env.respond(3, state(2)); reopened.receive({ type: "state", state: state(4) });
  assert.deepEqual(env.connections, [true, false, true]);
  assert.deepEqual(env.received, [{ revision: 1, baseline: true }, { revision: 3, baseline: true }, { revision: 4, baseline: false }]);
  assert.equal(socket.listenerCount, 0);
});

test("healthy push reconciles only every 60 seconds and survives failed HTTP", async (t) => {
  const env = harness(t);
  await env.respond(0, state(1)); const socket = env.sockets[0]; socket.open();
  socket.receive({ type: "hello", state: state(1) }); await env.respond(1, state(1));
  await env.advanceTo(30000); socket.receive({ type: "pong" });
  await env.advanceTo(59999); assert.equal(env.requests.length, 2);
  await env.advanceTo(60000); assert.equal(env.requests.length, 3); socket.receive({ type: "pong" });
  await env.fail(2); assert.deepEqual(env.connections, [true]);
  await env.advanceTo(90000); socket.receive({ type: "pong" });
  await env.advanceTo(120000); socket.receive({ type: "pong" });
  assert.equal(env.requests.length, 4); await env.respond(3, state(2));
  assert.deepEqual(env.received.at(-1), { revision: 2, baseline: false });
});

test("heartbeat sends at 30 seconds and retires a socket without pong after 10 seconds", async (t) => {
  const env = harness(t);
  await env.respond(0, state(1)); const socket = env.sockets[0]; socket.open();
  socket.receive({ type: "hello", state: state(1) }); await env.respond(1, state(1));
  await env.advanceTo(29999); assert.equal(socket.sent.length, 1);
  await env.advanceTo(30000); assert.deepEqual(socket.sent.at(-1), { type: "ping" });
  await env.advanceTo(39999); assert.equal(socket.readyState, 1);
  await env.advanceTo(40000); assert.equal(socket.readyState, 3); assert.equal(socket.listenerCount, 0);
  assert.equal(env.requests.length, 3); assert.deepEqual(env.connections, [true]);
  await env.fail(2); assert.deepEqual(env.connections, [true, false]);
  await env.advanceTo(41000); assert.equal(env.sockets.length, 2);
});

test("pong clears its timeout and schedules the following heartbeat", async (t) => {
  const env = harness(t); const socket = env.sockets[0]; socket.open();
  socket.receive({ type: "hello", state: state(1) }); await env.respond(0, state(1));
  await env.advanceTo(30000); await env.advanceTo(35000); socket.receive({ type: "pong" });
  await env.advanceTo(40000); assert.equal(socket.readyState, 1);
  await env.advanceTo(64999); assert.equal(socket.sent.filter((message) => message.type === "ping").length, 1);
  await env.advanceTo(65000); assert.equal(socket.sent.filter((message) => message.type === "ping").length, 2);
});

test("socket connection or authentication that never finishes times out", async (t) => {
  const env = harness(t); await env.respond(0, state(1));
  await env.advanceTo(10000); assert.equal(env.sockets[0].readyState, 3);
  await env.advanceTo(11000); const socket = env.sockets[1]; socket.open();
  await env.advanceTo(21000); assert.equal(socket.readyState, 3);
  assert.equal(socket.listenerCount, 0);
});

test("HTTP timeout aborts after 15 seconds and late responses cannot overwrite recovery", async (t) => {
  const env = harness(t, { unavailable: true });
  await env.advanceTo(14999); assert.equal(env.requests[0].options.signal.aborted, false);
  await env.advanceTo(15000); assert.equal(env.requests[0].options.signal.aborted, true);
  assert.deepEqual(env.connections, [false]);
  await env.advanceTo(17500); assert.equal(env.requests.length, 2);
  await env.respond(1, state(4)); await env.respond(0, state(10));
  assert.deepEqual(env.received, [{ revision: 4, baseline: true }]);
});

test("overlapping refreshes share one request and can upgrade its baseline", async (t) => {
  const env = harness(t, { unavailable: true }); await env.respond(0, state(1));
  const first = env.controller.refresh(); const second = env.controller.refresh({ baseline: true });
  assert.equal(first, second); assert.equal(env.requests.length, 2);
  await env.respond(1, state(2)); await first;
  assert.deepEqual(env.received.at(-1), { revision: 2, baseline: true });
});

test("cleanup aborts pending GET, closes sockets and removes every timer and wake listener", async (t) => {
  const env = harness(t); const socket = env.sockets[0]; socket.open();
  const outstanding = env.controller.refresh();
  env.controller.dispose(); env.controller.dispose();
  await outstanding;
  assert.equal(env.requests[0].options.signal.aborted, true);
  assert.equal(socket.readyState, 3); assert.equal(socket.listenerCount, 0);
  assert.equal(env.timers.size, 0); assert.equal(env.subscribed, false);
  socket.receive({ type: "hello", state: state(8) }); await env.respond(0, state(9));
  await env.advanceTo(120000); await env.controller.refresh();
  assert.deepEqual(env.received, []); assert.deepEqual(env.connections, []); assert.equal(env.requests.length, 1);
});

test("push revocation cancels all channels and reports the exact status once", async (t) => {
  const env = harness(t); const socket = env.sockets[0]; socket.open();
  socket.receive({ type: "hello", state: state(1) });
  socket.receive({ type: "revoked", status: 404, message: "Diese Lobby gibt es nicht mehr." });
  socket.receive({ type: "revoked", status: 401, message: "Erneut beitreten" });
  assert.deepEqual(env.revoked, [{ status: 404, message: "Diese Lobby gibt es nicht mehr." }]);
  assert.deepEqual(env.connections, [true, false]); assert.equal(env.timers.size, 0);
  assert.equal(env.requests[0].options.signal.aborted, true);
  await env.respond(0, state(2)); await env.advanceTo(60000);
  assert.deepEqual(env.received, [{ revision: 1, baseline: true }]);
});

test("HTTP authentication revocation closes even a healthy socket", async (t) => {
  const env = harness(t); const socket = env.sockets[0]; socket.open();
  socket.receive({ type: "hello", state: state(1) });
  await env.respond(0, { error: "Bitte tritt der Lobby erneut bei." }, 401);
  assert.deepEqual(env.revoked, [{ status: 401, message: "Bitte tritt der Lobby erneut bei." }]);
  assert.deepEqual(env.connections, [true, false]); assert.equal(socket.listenerCount, 0); assert.equal(env.timers.size, 0);
});

test("wake refreshes immediately and skips reconnect backoff while deduplicating HTTP", async (t) => {
  const env = harness(t); const socket = env.sockets[0]; socket.open();
  socket.receive({ type: "hello", state: state(1) }); await env.respond(0, state(1));
  socket.close(); assert.equal(env.requests.length, 2);
  env.wake(); env.wake(); assert.equal(env.requests.length, 2); assert.equal(env.sockets.length, 2);
  const reopened = env.sockets[1]; reopened.open(); reopened.receive({ type: "hello", state: state(2) });
  await env.respond(1, state(3)); assert.deepEqual(env.received.at(-1), { revision: 3, baseline: true });
  await env.advanceTo(1000); assert.equal(env.sockets.length, 2);
});

test("unavailable push uses capped exponential retries with bounded jitter", async (t) => {
  const env = harness(t, { unavailable: true, autoHttp: true });
  await env.advanceTo(60000);
  assert.deepEqual(env.attempts.map((attempt) => attempt.at), [0, 1000, 3000, 7000, 15000, 30000, 45000, 60000]);
  assert.deepEqual(env.connections, [true]);
  assert.ok(env.requests.length > 20, "Polling remains active during socket retries.");
});
