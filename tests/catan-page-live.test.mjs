import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-page-live-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [resolve(root, "app/catan/page.tsx")], outfile: output,
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
  plugins: [{
    name: "page-browser-boundaries",
    setup(builder) {
      builder.onLoad({ filter: /[/\\]catan-live-client\.ts$/ }, () => ({
        contents: "export const startCatanLive = (session, callbacks) => globalThis.catanPageLiveTest.connect(session, callbacks);",
        loader: "js",
      }));
      // Keep the real dialog buttons and page event handlers; replace only the
      // portal/focus implementation that needs a complete browser DOM.
      builder.onLoad({ filter: /[/\\]ui[/\\]dialog\.tsx$/ }, () => ({
        contents: 'import { createElement, Fragment } from "react"; export const Dialog = ({ children }) => createElement(Fragment, null, children); export const DialogContent = ({ children, className }) => createElement("div", { className }, children); export const DialogTitle = ({ children }) => createElement("h2", null, children); export const DialogDescription = ({ children }) => createElement("p", null, children);',
        loader: "js",
      }));
    },
  }],
});
after(() => rm(output, { force: true }));
const { default: CatanPage } = createRequire(import.meta.url)(output);

/** Minimal host from the activity-notice tests: real React state, effects and delegated clicks. */
class HostNode {
  constructor(ownerDocument, nodeType, nodeName, namespaceURI = "http://www.w3.org/1999/xhtml") {
    Object.assign(this, { ownerDocument, nodeType, nodeName, tagName: nodeName, namespaceURI, parentNode: null, childNodes: [], nodeValue: "", style: {}, value: "", checked: false, attributes: new Map(), listeners: new Map() });
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((child) => child.textContent).join(""); }
  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (this.nodeType === 3) this.nodeValue = String(value);
    else if (value !== "") this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    child.parentNode?.removeChild(child);
    const index = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
    assert.ok(index >= 0); this.childNodes.splice(index, 0, child); child.parentNode = this; return child;
  }
  removeChild(child) { const index = this.childNodes.indexOf(child); assert.ok(index >= 0); this.childNodes.splice(index, 1); child.parentNode = null; return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setAttributeNS(namespace, name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatchEvent(event) {
    event.target = this;
    const ancestors = [];
    if (event.bubbles) for (let node = this.parentNode; node; node = node.parentNode) ancestors.push(node);
    for (const node of [this, ...ancestors]) {
      event.currentTarget = node;
      for (const callback of node.listeners.get(event.type) ?? []) callback(event);
      if (event.cancelBubble) break;
    }
    return !event.defaultPrevented;
  }
}

const SESSION_KEY = "gameson-catan-session-v1";
const session = { lobbyId: "ABCDEF", token: "private-session-token" };
const waitingLobby = {
  lobby: { id: session.lobbyId, name: "Inselrunde", hostPlayerId: "host", targetPoints: 12, discoverable: true, revision: 2 },
  members: [{ id: "host", name: "Anna" }, { id: "guest", name: "Ben" }], me: { id: "guest", name: "Ben" }, game: null,
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

async function harness(t, { revokeOnRefresh = false } = {}) {
  let nextId = 0;
  const frames = new Map(); const intervals = new Map(); const stored = new Map([[SESSION_KEY, JSON.stringify(session)]]);
  const posts = []; const gets = []; const liveConnections = []; const history = [];
  const document = new HostNode(null, 9, "#document"); document.ownerDocument = document;
  document.hidden = false;
  document.createElement = (name) => new HostNode(document, 1, name.toUpperCase());
  document.createElementNS = (namespace, name) => new HostNode(document, 1, name, namespace);
  document.createTextNode = (text) => { const node = new HostNode(document, 3, "#text"); node.nodeValue = text; return node; };
  document.documentElement = document.createElement("html"); document.body = document.createElement("body"); document.activeElement = document.body;
  document.appendChild(document.documentElement); document.documentElement.appendChild(document.body);
  const window = {
    document, HTMLElement: HostNode, HTMLIFrameElement: class {},
    location: { origin: "https://gameson.test", search: `?lobby=${session.lobbyId}` },
    history: { replaceState(_state, _title, url) { history.push(url); } },
  };
  document.defaultView = window;
  const boundary = {
    connect(current, callbacks) {
      const connection = { session: current, callbacks, refreshes: 0, disposals: 0 };
      liveConnections.push(connection);
      return {
        async refresh() {
          connection.refreshes++;
          if (revokeOnRefresh) {
            callbacks.onConnection(false);
            callbacks.onRevoked(401, "Bitte tritt der Lobby erneut bei.");
          }
        },
        dispose() { connection.disposals++; },
      };
    },
  };
  const globals = {
    document, window, navigator: {}, IS_REACT_ACT_ENVIRONMENT: true, catanPageLiveTest: boundary,
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setInterval(callback) { const id = ++nextId; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    fetch(url, options = {}) {
      if (options.method === "POST") return new Promise((resolve, reject) => { posts.push({ url, options, body: JSON.parse(options.body), resolve, reject }); });
      gets.push(url);
      assert.equal(url, "/api/catan?nearby=1", "Session recovery uses the mounted live controller.");
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ lobbies: [] }) });
    },
  };
  const original = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const container = document.createElement("div"); document.body.appendChild(container);
  const reactRoot = createRoot(container);
  t.after(async () => {
    await act(() => reactRoot.unmount());
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  function find(predicate, node = container) { if (predicate(node)) return node; for (const child of node.childNodes) { const found = find(predicate, child); if (found) return found; } return null; }
  function inDialog(node) { for (let parent = node.parentNode; parent; parent = parent.parentNode) if (parent.getAttribute("class")?.includes("game-confirm-dialog")) return true; return false; }
  async function click(predicate) {
    const button = find((node) => node.tagName === "BUTTON" && predicate(node));
    assert.ok(button, "The requested page action is visible.");
    await act(async () => {
      button.dispatchEvent({ type: "click", bubbles: true, button: 0, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; } });
      await flush();
    });
  }
  await act(async () => { reactRoot.render(createElement(CatanPage)); await flush(); });
  await act(async () => { const queued = [...frames.values()]; frames.clear(); queued.forEach((callback) => callback()); await flush(); });
  assert.equal(liveConnections.length, 1, "The real startup effect resumes the stored session.");
  await act(() => liveConnections[0].callbacks.onState(waitingLobby, { baseline: true }));
  assert.match(container.textContent, /Eure Catan-Lobby/);
  return {
    container, posts, gets, liveConnections, history, stored, find,
    async leave() {
      await click((button) => button.textContent === "Lobby verlassen" && !inDialog(button));
      await click((button) => button.textContent === "Lobby verlassen" && inDialog(button));
      assert.equal(posts.length, 1);
      assert.equal(posts[0].body.action, "leave"); assert.equal(posts[0].body.lobbyId, session.lobbyId);
      assert.equal(posts[0].options.headers.Authorization, `Bearer ${session.token}`);
    },
    async revoke(status = 401) {
      await act(async () => {
        liveConnections[0].callbacks.onConnection(false);
        liveConnections[0].callbacks.onRevoked(status, "Bitte tritt der Lobby erneut bei.");
        await flush();
      });
    },
    async resolvePost() { await act(async () => { posts[0].resolve({ ok: true, status: 200, json: async () => ({ left: true }) }); await flush(); }); },
    async resolvePostThenQueuedRevocation() {
      await act(async () => {
        posts[0].resolve({ ok: true, status: 200, json: async () => ({ left: true }) });
        await flush();
        assert.equal(stored.has(SESSION_KEY), false, "The POST continuation has already completed the leave.");
        assert.equal(history.at(-1), "/catan");
        assert.equal(liveConnections[0].disposals, 0, "The old connection remains mounted until React commits the queued update.");
        liveConnections[0].callbacks.onConnection(false);
        liveConnections[0].callbacks.onRevoked(401, "Bitte tritt der Lobby erneut bei.");
        await flush();
      });
    },
    async rejectPost() { await act(async () => { posts[0].reject(new Error("Response lost")); await flush(); }); },
    assertHome() {
      assert.ok(find((node) => node.getAttribute("aria-label") === "Spielmodus auswählen"));
      assert.equal(find((node) => node.getAttribute("role") === "alert"), null);
      assert.doesNotMatch(container.textContent, /Eure Catan-Lobby|Bitte tritt|Bestätigung fehlt|Lobby beitreten.*Lobbycode/s);
      assert.equal(stored.has(SESSION_KEY), false);
      assert.equal(history.at(-1), "/catan");
      assert.equal(liveConnections[0].disposals, 1);
    },
  };
}

test("voluntary WebSocket revocation before HTTP success keeps the home screen free of errors", async (t) => {
  const env = await harness(t); await env.leave(); await env.revoke(); env.assertHome();
  await env.resolvePost(); env.assertHome();
  assert.equal(env.liveConnections[0].refreshes, 0);
});

test("voluntary WebSocket revocation before a lost HTTP response avoids recovery and error notices", async (t) => {
  const env = await harness(t); await env.leave(); await env.revoke(404); env.assertHome();
  await env.rejectPost(); env.assertHome();
  assert.equal(env.liveConnections[0].refreshes, 0);
});

test("recovery revocation after a failed leave response completes the same voluntary leave", async (t) => {
  const env = await harness(t, { revokeOnRefresh: true }); await env.leave(); await env.rejectPost(); env.assertHome();
  assert.equal(env.liveConnections[0].refreshes, 1);
});

test("a queued WebSocket revocation after HTTP success remains voluntary until effect cleanup", async (t) => {
  const env = await harness(t); await env.leave(); await env.resolvePostThenQueuedRevocation(); env.assertHome();
  assert.equal(env.liveConnections[0].refreshes, 0);
});

test("unsolicited revocation still asks the player to rejoin and preserves its reason", async (t) => {
  const env = await harness(t); await env.revoke();
  const alert = env.find((node) => node.getAttribute("role") === "alert");
  assert.ok(alert); assert.match(alert.textContent, /Bitte tritt der Lobby erneut bei\./);
  assert.equal(env.find((node) => node.getAttribute("aria-label") === "Spielmodus auswählen"), null);
  assert.equal(env.find((node) => node.getAttribute("id") === "catan-join-code")?.value, session.lobbyId);
  assert.equal(env.stored.has(SESSION_KEY), false);
  assert.equal(env.posts.length, 0); assert.equal(env.liveConnections[0].refreshes, 0); assert.equal(env.liveConnections[0].disposals, 1);
});
