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
  assert.match(html, /CATAN/);
  assert.match(html, /href="\/catan"/);
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
  assert.match(html, /Wie möchtet ihr/);
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
  assert.deepEqual(manifest.shortcuts.map((shortcut) => shortcut.url), ["/imposter", "/werwolf", "/catan", "/stadt-land-fluss"]);
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
  assert.match(werewolfSource, /<h1>Wie möchtet ihr<br \/>spielen\?<\/h1>/);
  assert.doesNotMatch(werewolfSource, /WER<br\s*\/>WOLF/);
});

test("gruppiert die Online-Lobbys nach spielbereiten und nicht bereiten Personen", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const imposterSource = await readFile(new URL("../app/imposter/page.tsx", import.meta.url), "utf8");
  const werewolfSource = await readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8");
  assert.match(imposterSource, /const readyPlayers = indexedPlayers\.filter/);
  assert.match(imposterSource, /const waitingPlayers = indexedPlayers\.filter/);
  assert.match(imposterSource, /Online &amp; spielbereit/);
  assert.match(imposterSource, /Nicht bereit/);
  assert.match(werewolfSource, /const readyPlayers = indexedPlayers\.filter/);
  assert.match(werewolfSource, /const waitingPlayers = indexedPlayers\.filter/);
  assert.match(werewolfSource, /wolf-ready-players/);
  assert.match(werewolfSource, /Gerade offline/);
  assert.match(werewolfSource, /player-presence/);
  assert.match(werewolfSource, /player\.online \? "Online" : "Offline"/);
  assert.match(werewolfSource, /aria-label={`\$\{player\.name\} aus dem Dorf entfernen`}/);
  assert.match(css, /\.player-groups\s*\{/);
  assert.match(css, /\.player-group-heading\.is-ready/);
  assert.match(css, /\.player-group-heading\.is-waiting/);
  assert.match(css, /\.player-group-empty\s*\{/);
  assert.match(css, /\.player-chip\s*\{[^}]*grid-template-columns:44px minmax\(0,1fr\) auto auto;/);
  assert.match(css, /\.player-presence\.is-ready/);
  assert.match(css, /\.player-presence\.is-offline/);
});

test("kennzeichnet die manuellen Übergänge für den Host eindeutig", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const werewolfSource = await readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8");
  const routeSource = await readFile(new URL("../app/api/werwolf/route.ts", import.meta.url), "utf8");
  // The host-only discussion action is exercised with rendered states in werewolf-ui.test.mjs.
  assert.match(werewolfSource, /state\.lobby\.phase === "dawn" && state\.lobby\.resolutionSource === "day"/);
  assert.match(werewolfSource, /Du leitest die Runde/);
  assert.match(werewolfSource, /zuerst ihre Bereitschaft zu bestätigen/);
  assert.match(werewolfSource, /Bereit für die Nacht/);
  assert.match(routeSource, /resolutionSource: lobby\.resolution_source/);
  assert.match(css, /\.host-night-cue\s*\{[^}]*border:2px solid #f47718;/);
  assert.match(werewolfSource, /label="Abstimmung starten"/);
  assert.match(css, /\.host-phase-frame\s*\{[^}]*border:4px solid #ff8a24;/);
  assert.match(css, /@keyframes host-phase-pulse/);
});

test("sperrt Spielstart und Morgengrauen bis jede Person selbst bestätigt", async () => {
  const werewolfSource = await readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8");
  const routeSource = await readFile(new URL("../app/api/werwolf/route.ts", import.meta.url), "utf8");
  assert.match(werewolfSource, /Meine Rolle öffnen/);
  assert.match(werewolfSource, /post\("acknowledge_role"/);
  assert.match(werewolfSource, /post\("wake_up"/);
  assert.match(routeSource, /phase = 'role_reveal'/);
  assert.match(routeSource, /if \(phase === "role_reveal"\) return allPlayers/);
  assert.match(routeSource, /if \(phase === "dawn"\) return players/);
  assert.match(routeSource, /\["role_reveal", "dawn"\]\.includes\(lobby\.phase\)/);
  assert.match(routeSource, /awake_\$\{lobby\.resolution_source/);
});

test("zeigt der Seherin die erkannte Rolle vor der nächsten Nachtphase", async () => {
  const werewolfSource = await readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8");
  const routeSource = await readFile(new URL("../app/api/werwolf/route.ts", import.meta.url), "utf8");
  assert.match(werewolfSource, /Ergebnis gelesen/);
  assert.match(werewolfSource, /state\.actionResult\.seenLabel/);
  assert.match(werewolfSource, /post\("acknowledge_seer_result"/);
  assert.match(routeSource, /if \(lobby\.phase === "seer"\) return reply\(\{ ok: true \}\)/);
  assert.match(routeSource, /action === "acknowledge_seer_result"/);
});

test("zeigt vollständige öffentliche Abstimmungen und Rollen ausgeschiedener Personen im Werwolf-Dashboard", async () => {
  const [werewolfSource, routeSource, schemaSource, css] = await Promise.all([
    readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/werwolf/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const beginNightSource = routeSource.slice(routeSource.indexOf("async function beginNight"), routeSource.indexOf("async function nextNightPhase"));
  assert.doesNotMatch(beginNightSource, /DELETE FROM werewolf_votes/);
  assert.match(routeSource, /publicVoteHistory/);
  assert.match(routeSource, /v\.phase IN \('mayor_vote', 'day_vote', 'runoff'\)/);
  assert.match(routeSource, /weight = excluded\.weight/);
  assert.match(schemaSource, /weight: integer\("weight"\)\.notNull\(\)\.default\(1\)/);
  assert.match(werewolfSource, /Dorfübersicht/);
  assert.match(werewolfSource, /Ausgeschieden · \$\{ROLE_INFO\[player\.role\]\.label\}/);
  assert.match(werewolfSource, /Wer hat wen gewählt\?/);
  assert.match(werewolfSource, /vote\.weight > 1/);
  assert.match(css, /\.vote-statistics\s*\{/);
  assert.match(css, /\.village-roster>div\.is-dead/);
});

test("signalisiert Opfern ihre Todesart und zeigt sie öffentlich als Symbol", async () => {
  const [werewolfSource, routeSource, schemaSource, css] = await Promise.all([
    readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/werwolf/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(werewolfSource, /function VictimDeathAlert/);
  assert.match(werewolfSource, /setTimeout\(\(\) => setVisible\(false\), 10000\)/);
  assert.match(werewolfSource, /cause-\$\{cause\}/);
  assert.match(werewolfSource, /cause === "wolf_attack"/);
  assert.match(werewolfSource, /cause === "witch_poison"/);
  assert.match(werewolfSource, /<DeathCauseList causes=\{player\.deathCauses\} compact/);
  assert.match(css, /\.role-reveal-list>div>span\{display:grid;place-items:center;/);
  assert.doesNotMatch(css, /\.role-reveal-list span\{display:grid;place-items:center;/);
  assert.match(css, /\.result-player-meta\s*\{[^}]*display:flex;[^}]*align-items:center;/);
  assert.match(routeSource, /cause: "hunter_shot"/);
  assert.match(routeSource, /villageConsequence \? \["heartbreak", "village_vote"\] : \["heartbreak"\]/);
  assert.match(werewolfSource, /villageConsequence \? \["heartbreak", "village_vote"\] : \["heartbreak"\]/);
  assert.match(routeSource, /deathMatchNumber: item\.death_match_number/);
  assert.match(schemaSource, /deathCauses: text\("death_causes"\)/);
  assert.match(css, /@keyframes victim-death-pulse/);
  assert.match(css, /\.victim-death-frame\s*\{[^}]*border:5px solid #ff293d;/);
});

test("verdichtet den blutigen Dorfrand nach jedem gemeinschaftlich verursachten Tod", async () => {
  const [werewolfSource, css] = await Promise.all([
    readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(werewolfSource, /function VillageGuiltFrame/);
  assert.match(werewolfSource, /data-village-kills=\{count\}/);
  assert.match(werewolfSource, /aria-hidden="true"/);
  assert.match(werewolfSource, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.equal(werewolfSource.match(/<VillageGuiltFrame count=\{villageKillCount\} \/>/g)?.length, 3);
  assert.match(werewolfSource, /village-guilt-summary/);
  assert.match(css, /\.village-guilt-frame\s*\{[^}]*position:fixed;[^}]*pointer-events:none;/);
  assert.match(css, /--village-blood-depth/);
  assert.doesNotMatch(css, /--village-blood[^;]*(?:calc\([^)]*\*|\*[^)]*\))/);
  assert.match(css, /@media\(forced-colors:active\)/);
});

test("hält zentrale UI-Rückmeldungen, Dialoge und mobile Aktionen zugänglich", async () => {
  const [homeSource, imposterSource, werewolfSource, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/imposter/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(homeSource, /aria-controls="gameson-install-dialog"/);
  assert.match(homeSource, /event\.key === "Escape"/);
  assert.match(imposterSource, /const activeNotice = notice/);
  assert.match(werewolfSource, /const activeNotice = notice/);
  assert.match(imposterSource + werewolfSource, /role="alert" aria-live="assertive"/);
  assert.match(imposterSource, /function ModalSheet/);
  assert.match(werewolfSource, /function ModalSheet/);
  assert.match(imposterSource + werewolfSource, /aria-labelledby=\{labelledBy\}/);
  assert.match(imposterSource + werewolfSource, /Lokales Spiel – kein Internet nötig/);
  assert.match(werewolfSource, /game-floating-actions/);
  assert.match(werewolfSource, /<TabsTrigger value="village"/);
  assert.match(werewolfSource, /<TabsTrigger value="votes"/);
  assert.match(werewolfSource, /victim-death-dismiss/);
  assert.match(werewolfSource, /survival-badge/);
  assert.match(css, /\.connection-pill\.local/);
  assert.match(css, /\.wolf-sticky-action/);
  assert.match(css, /\.settings-sheet \.role-selector\s*\{[^}]*max-height:none;/);
  assert.match(css, /\.library-card\s*\{[^}]*min-height:330px;/);
});

test("fragt beim Start aus der Spielauswahl nach einer gespeicherten Online-Runde", async () => {
  const [imposterSource, werewolfSource, catanSource, sessionSource, entrySource, css] = await Promise.all([
    readFile(new URL("../app/imposter/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/werwolf/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/catan/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/game-session.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/game-entry.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  for (const [source, theme] of [[imposterSource, "imposter"], [werewolfSource, "werewolf"], [catanSource, "catan"]]) {
    assert.match(source, /startup\.kind === "choose"/, theme);
    assert.match(source, /startup\.kind === "resume"/, theme);
    assert.match(source, new RegExp(`<ResumeSessionDialog theme="${theme}" lobby=\\{storedLobby\\} onResume=\\{resumeStoredSession\\} onDiscard=\\{discardStoredSession\\} />`), theme);
  }
  assert.match(sessionSource, /export const RESUME_DISCARD_SECONDS = 5;/);
  assert.match(entrySource, /onEscapeKeyDown=\{\(event\) => \{ event\.preventDefault\(\); setRemaining\(null\); \}\}/);
  assert.match(entrySource, /if \(remaining <= 1\) discard\.current\(\); else setRemaining\(remaining - 1\);/);
  assert.match(css, /@keyframes resume-drain/);
  assert.match(css, /\.resume-countdown-bar span \{[^}]*animation:resume-drain 5s linear forwards;/);
});

test("macht Catan-Lobbys im selben Netzwerk auffindbar", async () => {
  const [catanSource, routeSource, schemaSource, dbSource, css] = await Promise.all([
    readFile(new URL("../app/catan/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/catan/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/catan/catan.css", import.meta.url), "utf8"),
  ]);
  assert.match(catanSource, /\/api\/catan\?nearby=1/);
  assert.match(catanSource, /In deiner Nähe/);
  assert.match(catanSource, /Lobby in der Nähe anzeigen/);
  assert.match(catanSource, /setInterval\(load, 10000\)/);
  assert.match(routeSource, /searchParams\.get\("nearby"\) === "1"/);
  assert.match(routeSource, /discoverable = 1 AND game IS NULL AND network_hash IN \(\?, \?\)/);
  assert.match(schemaSource, /networkHash: text\("network_hash"\)\.notNull\(\)\.default\(""\)/);
  assert.match(dbSource, /ALTER TABLE catan_lobbies ADD COLUMN network_hash TEXT DEFAULT '' NOT NULL/);
  assert.match(css, /\.catan-theme \.nearby-list button \{/);
});
