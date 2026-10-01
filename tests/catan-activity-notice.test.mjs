import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-activity-notice-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export * from "./components/catan/activity-notice";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { ActivityNotice, ACTIVITY_NOTICE_MS } = createRequire(import.meta.url)(output);

/** Minimal React DOM host: real reconciliation, hooks, effects and delegated clicks. */
class HostNode {
  constructor(ownerDocument, nodeType, nodeName, namespaceURI = "http://www.w3.org/1999/xhtml") {
    Object.assign(this, { ownerDocument, nodeType, nodeName, tagName: nodeName, namespaceURI, parentNode: null, childNodes: [], nodeValue: "", style: {}, attributes: new Map(), listeners: new Map() });
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
    assert.ok(index >= 0, "Insertion reference must be a child.");
    this.childNodes.splice(index, 0, child); child.parentNode = this; return child;
  }
  removeChild(child) { const index = this.childNodes.indexOf(child); assert.ok(index >= 0); this.childNodes.splice(index, 1); child.parentNode = null; return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setAttributeNS(namespace, name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
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

function activity(id, title = "Würfelertrag") {
  return { id, title, message: "Deine Siedlung liefert Holz.", gains: { wood: 1, brick: 0, wool: 0, grain: 0, ore: 0 }, losses: { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 } };
}

async function harness(t, { strict = false } = {}) {
  let now = 0; let nextId = 0; let mounted = true;
  const timers = new Map();
  const document = new HostNode(null, 9, "#document");
  document.ownerDocument = document;
  document.createElement = (name) => new HostNode(document, 1, name.toUpperCase());
  document.createElementNS = (namespace, name) => new HostNode(document, 1, name, namespace);
  document.createTextNode = (text) => { const node = new HostNode(document, 3, "#text"); node.nodeValue = text; return node; };
  document.documentElement = document.createElement("html"); document.body = document.createElement("body"); document.activeElement = document.body;
  document.appendChild(document.documentElement); document.documentElement.appendChild(document.body);
  const window = {
    document, HTMLIFrameElement: class {}, HTMLElement: HostNode,
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  document.defaultView = window;
  const globals = { document, window, IS_REACT_ACT_ENVIRONMENT: true };
  const original = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const container = document.createElement("div"); document.body.appendChild(container);
  const reactRoot = createRoot(container);
  t.after(async () => {
    if (mounted) await act(() => reactRoot.unmount());
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  let props = { scope: JSON.stringify(["game-a", "player-a"]), unread: [], onOpen() {}, onRead() {} };
  const element = () => strict ? createElement(StrictMode, null, createElement(ActivityNotice, props)) : createElement(ActivityNotice, props);
  function find(predicate, node = container) { if (predicate(node)) return node; for (const child of node.childNodes) { const found = find(predicate, child); if (found) return found; } return null; }
  return {
    container, timers,
    async render(next) { props = { ...props, ...next }; await act(() => reactRoot.render(element())); },
    async advanceTo(time) {
      assert.ok(time >= now);
      await act(() => {
        let next;
        while ((next = [...timers.entries()].filter(([, timer]) => timer.due <= time).sort((a, b) => a[1].due - b[1].due)[0])) { now = next[1].due; timers.delete(next[0]); next[1].callback(); }
        now = time;
      });
    },
    notice() { return find((node) => node.getAttribute("class") === "catan-activity-bar"); },
    progress() { return find((node) => node.getAttribute("class") === "catan-activity-progress"); },
    async clickButton(label) {
      const button = find((node) => node.tagName === "BUTTON" && label(node.getAttribute("aria-label") ?? ""));
      assert.ok(button, "Expected notice action exists.");
      await act(() => button.dispatchEvent({ type: "click", bubbles: true, button: 0, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; } }));
    },
    async unmount() { await act(() => reactRoot.unmount()); mounted = false; },
  };
}

test("notice expires at four seconds while keeping unread data and read callbacks untouched", async (t) => {
  const env = await harness(t); const unread = [activity(1)]; let reads = 0;
  assert.equal(ACTIVITY_NOTICE_MS, 4000);
  await env.render({ unread, onRead: () => reads++ });
  assert.ok(env.notice()); assert.equal(env.timers.size, 1);
  assert.equal(env.progress().getAttribute("aria-hidden"), "true"); assert.equal(env.progress().style.animationDuration, "4000ms");
  await env.advanceTo(3999); assert.ok(env.notice());
  await env.advanceTo(4000); assert.equal(env.notice(), null); assert.equal(env.timers.size, 0);
  assert.equal(reads, 0); assert.deepEqual(unread, [activity(1)]);
});

test("same event polls, new callbacks and unread count changes never restart or replay the timer", async (t) => {
  const env = await harness(t);
  await env.render({ unread: [activity(2)] });
  await env.advanceTo(2000);
  await env.render({ unread: [activity(1, "Ältere Meldung"), { ...activity(2) }], onOpen() {}, onRead() {} });
  assert.match(env.notice().textContent, /2 neu/); assert.equal(env.timers.size, 1);
  await env.advanceTo(3999); assert.ok(env.notice());
  await env.advanceTo(4000); assert.equal(env.notice(), null);
  await env.render({ unread: [activity(1), { ...activity(2) }] });
  await env.advanceTo(10000); assert.equal(env.notice(), null); assert.equal(env.timers.size, 0);
});

test("a newer event replaces the banner and receives a fresh complete four seconds", async (t) => {
  const env = await harness(t);
  await env.render({ unread: [activity(1, "Erster Ertrag")] });
  await env.advanceTo(2000);
  await env.render({ unread: [activity(1), activity(2, "Zweiter Ertrag")] });
  assert.match(env.notice().textContent, /Zweiter Ertrag/); assert.equal(env.timers.size, 1);
  await env.advanceTo(4000); assert.ok(env.notice(), "Old timer must not dismiss the replacement.");
  await env.advanceTo(5999); assert.ok(env.notice());
  await env.advanceTo(6000); assert.equal(env.notice(), null);
});

test("opening history invokes only onOpen and preserves the active deadline", async (t) => {
  const env = await harness(t); let opens = 0; let reads = 0;
  await env.render({ unread: [activity(1)], onOpen: () => opens++, onRead: () => reads++ });
  await env.advanceTo(2000);
  await env.clickButton((label) => label.includes("Meldung ansehen"));
  assert.equal(opens, 1); assert.equal(reads, 0); assert.ok(env.notice());
  await env.advanceTo(4000); assert.equal(env.notice(), null); assert.equal(reads, 0);
});

test("manual close invokes onRead and clearing unread cancels its pending timeout", async (t) => {
  const env = await harness(t); let reads = 0;
  await env.render({ unread: [activity(1)], onRead: () => reads++ });
  await env.advanceTo(1000);
  await env.clickButton((label) => label === "Neue Meldungen als gelesen markieren");
  assert.equal(reads, 1);
  await env.render({ unread: [] });
  assert.equal(env.notice(), null); assert.equal(env.timers.size, 0);
  await env.advanceTo(10000); assert.equal(reads, 1); assert.equal(env.notice(), null);
});

for (const [name, scope] of [["viewer", JSON.stringify(["game-a", "player-b"])], ["game", JSON.stringify(["game-b", "player-a"])]]) {
  test(`${name} scope changes replace private text and cancel the old timer even for the same event id`, async (t) => {
    const env = await harness(t);
    await env.render({ unread: [activity(1, "Vorherige private Meldung")] });
    await env.advanceTo(1000);
    await env.render({ scope, unread: [activity(1, "Aktuelle private Meldung")] });
    assert.doesNotMatch(env.container.textContent, /Vorherige/); assert.match(env.container.textContent, /Aktuelle/); assert.equal(env.timers.size, 1);
    await env.advanceTo(4000); assert.ok(env.notice());
    await env.advanceTo(4999); assert.ok(env.notice());
    await env.advanceTo(5000); assert.equal(env.notice(), null);
  });
}

test("unmount cancels the active timeout", async (t) => {
  const env = await harness(t); await env.render({ unread: [activity(1)] });
  await env.advanceTo(1000); assert.equal(env.timers.size, 1);
  await env.unmount(); assert.equal(env.timers.size, 0); assert.equal(env.container.textContent, "");
  await env.advanceTo(10000); assert.equal(env.timers.size, 0);
});

test("Strict Mode effect replay leaves only one timer and still expires once", async (t) => {
  const env = await harness(t, { strict: true }); await env.render({ unread: [activity(1)] });
  assert.equal(env.timers.size, 1); await env.advanceTo(4000);
  assert.equal(env.notice(), null); assert.equal(env.timers.size, 0);
});
