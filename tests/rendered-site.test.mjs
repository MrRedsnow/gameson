import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("rendert die Gameson-Spielauswahl", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Gameson – Spieleabend\. Sofort\.<\/title>/i);
  assert.match(html, /Was spielt ihr heute\?/);
  assert.match(html, /IMPOSTER/);
  assert.match(html, /WERWOLF/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|SkeletonPreview/);
});

test("rendert Imposter und Werwolf als eigene Spiele", async () => {
  const imposter = await render("/imposter");
  assert.equal(imposter.status, 200);
  assert.match(await imposter.text(), /Lobby erstellen/);
  const werewolf = await render("/werwolf");
  assert.equal(werewolf.status, 200);
  const html = await werewolf.text();
  assert.match(html, /Wenn das Dorf schläft/);
  assert.match(html, /Lobby erstellen/);
  assert.match(html, /Ein Gerät/);
});

test("liefert ein installierbares deutsches PWA-Manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.name, "Gameson – Spieleabend. Sofort.");
  assert.equal(manifest.short_name, "Gameson");
  assert.equal(manifest.lang, "de");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  assert.deepEqual(manifest.shortcuts.map((shortcut) => shortcut.url), ["/imposter", "/werwolf"]);
});
