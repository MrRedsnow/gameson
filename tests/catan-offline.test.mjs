import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const artwork = await readFile(new URL("../public/catan/robber-v2.png", import.meta.url));
const additionalArtwork = new Map(await Promise.all(["boats-directions-v1.png", "wildlife-atlas-v1.png", "field-forest-wildlife-v1.png"].map(async (name) => [
  `/catan/${name}`, await readFile(new URL(`../public/catan/${name}`, import.meta.url)),
])));
const offlineArtwork = new Map([["/catan/robber-v2.png", artwork], ...additionalArtwork]);
const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("die Räubergrafik ist eine quadratische PNG mit echtem Alphakanal", () => {
  assert.deepEqual([...artwork.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(artwork.readUInt32BE(16), artwork.readUInt32BE(20));
  assert.ok([4, 6].includes(artwork[25]), "Der PNG-Farbtyp muss einen Alphakanal enthalten.");
});

test("die Weizenfeld- und Waldtiere besitzen eine PNG-Grafik mit echtem Alphakanal", () => {
  const animals = additionalArtwork.get("/catan/field-forest-wildlife-v1.png");
  assert.deepEqual([...animals.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(animals.readUInt32BE(16) > 0 && animals.readUInt32BE(20) > 0);
  assert.ok([4, 6].includes(animals[25]), "Die isolierten Tiere müssen sich mit transparentem Hintergrund über ihr Gelände legen.");
});

test("der echte Service Worker liefert Räuber, Bootsansichten und alle Geländetiere auch ohne Netzwerk", async () => {
  const origin = "https://gameson.test"; const handlers = new Map();
  const buckets = new Map([["gameson-shell-v21", new Map()]]);
  let online = true; let fetches = 0;
  const key = (request) => new URL(typeof request === "string" ? request : request.url, origin).href;
  const fetch = async (request) => {
    assert.ok(online, "Ein Offline-Asset muss aus dem Cache geliefert werden."); fetches++;
    return new Response(offlineArtwork.get(new URL(key(request)).pathname) ?? "shell", { headers: { "content-type": "image/png" } });
  };
  const caches = {
    async open(name) {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const entries = buckets.get(name);
      return {
        async addAll(urls) { for (const url of urls) entries.set(key(url), await fetch(url)); },
        async put(request, response) { entries.set(key(request), response.clone()); },
      };
    },
    async match(request) {
      for (const entries of buckets.values()) if (entries.has(key(request))) return entries.get(key(request)).clone();
    },
    async keys() { return [...buckets.keys()]; },
    async delete(name) { return buckets.delete(name); },
  };
  let skipped = false; let claimed = false;
  runInNewContext(worker, { URL, caches, fetch, self: {
    location: { origin }, addEventListener: (name, callback) => handlers.set(name, callback),
    skipWaiting: () => { skipped = true; }, clients: { claim: () => { claimed = true; } },
  } });
  async function lifecycle(name) {
    let pending; handlers.get(name)({ waitUntil: (promise) => { pending = promise; } }); await pending;
  }
  await lifecycle("install"); await lifecycle("activate");
  assert.ok(skipped && claimed); assert.equal(buckets.has("gameson-shell-v21"), false);
  online = false; const fetchedBefore = fetches;
  for (const [path, expected] of offlineArtwork) {
    assert.ok(await caches.match(path), `${path} muss im Installationscache liegen.`);
    let response;
    handlers.get("fetch")({ request: new Request(`${origin}${path}`), respondWith: (promise) => { response = promise; } });
    const cached = await response;
    assert.equal(cached.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await cached.arrayBuffer()), expected);
  }
  assert.equal(fetches, fetchedBefore, "Das Bild benötigt offline keinen neuen Netzwerkzugriff.");
});
