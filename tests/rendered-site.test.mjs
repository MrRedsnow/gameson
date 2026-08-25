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
  assert.match(html, /App installieren/);
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

test("nutzt robuste Spielnavigation und getrennte Offline-Seiten", async () => {
  const homeSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const imposterSource = await readFile(new URL("../app/imposter/page.tsx", import.meta.url), "utf8");
  const werewolfSource = await readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8");
  const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.doesNotMatch(homeSource + imposterSource + werewolfSource, /from ["']next\/link["']/);
  assert.match(homeSource, /<a className="library-card imposter-library-card" href="\/imposter">/);
  assert.match(homeSource, /<a className="library-card werewolf-library-card" href="\/werwolf">/);
  assert.match(serviceWorker, /cache\.put\(url\.pathname, copy\)/);
  assert.match(serviceWorker, /caches\.match\(url\.pathname\)/);
});

test("macht Werwolf-Schalter vollständig antippbar", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.switch-row input \{[^}]*inset:0;[^}]*width:100%;[^}]*height:100%;/);
  const werewolfSource = await readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8");
  assert.match(werewolfSource, /online-witch-heal/);
  assert.match(werewolfSource, /audioMode/);
});

test("nutzt lesbare Typografie und vermeidet erzwungene Werwolf-Umbrüche", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const werewolfSource = await readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8");
  assert.match(css, /h1,h2,h3\s*\{[^}]*text-wrap:balance;/);
  assert.match(css, /\.page-intro p,[^{]+\{[^}]*line-height:1\.65;/);
  assert.match(css, /\.wolf-phase\s*\{[^}]*margin-inline:-20px;/);
  assert.match(css, /@media\(max-width:420px\)/);
  assert.match(werewolfSource, /<h1>WERWOLF<\/h1>/);
  assert.doesNotMatch(werewolfSource, /WER<br\s*\/>WOLF/);
});
