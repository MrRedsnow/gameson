import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the real views with representative server states. The image shim is
// outside these views; it only replaces the framework-specific image import.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/werewolf-ui-${process.pid}.cjs`);
const source = await readFile(resolve(root, "app/werwolf/page.tsx"), "utf8");
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: {
    contents: `${source}\nexport { GamePhase, RoleRevealGate, ActionPanel, DawnWakePanel, WaitingRoom, VillageOverview, LocalSecret, LocalWerewolf, RoleChoiceList, Notice, getGameGuidance, getSelectionGuidance };`,
    resolveDir: resolve(root, "app/werwolf"),
    loader: "tsx",
  },
  absWorkingDir: root,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  outfile: output,
  logLevel: "silent",
  plugins: [{
    name: "framework-image",
    setup(build) {
      build.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "framework-image" }));
      build.onLoad({ filter: /.*/, namespace: "framework-image" }, () => ({ contents: "export default function Image() { return null; }", loader: "js" }));
    },
  }],
});
after(() => rm(output, { force: true }));
const { GamePhase, RoleRevealGate, ActionPanel, DawnWakePanel, WaitingRoom, VillageOverview, LocalSecret, LocalWerewolf, RoleChoiceList, Notice, getGameGuidance, getSelectionGuidance } = createRequire(import.meta.url)(output);
const noop = () => {};
const post = async () => true;
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

function stateFor(phase, overrides = {}) {
  const players = ["Robin", "Mara", "Lea"].map((name, index) => ({ id: `p${index}`, name, isHost: index === 0, alive: true, online: true, deathCauses: [] }));
  return {
    lobby: { id: "test-village", name: "Mondhain", status: "playing", phase, night: 2, matchNumber: 1, mayorPlayerId: null, wolfCount: 1, selectedRoles: [], mayorEnabled: true, audioMode: "host", resolutionSource: "night" },
    me: players[0], players,
    privateRole: { role: "witch", label: "Hexe", description: "Geheime Rollenbeschreibung", team: "village" },
    action: null, ownSubmission: null, actionResult: null,
    progress: { submitted: 1, required: 3 }, voteHistory: [], canSkip: false,
    ...overrides,
  };
}

function phaseProps(state, busy = false) {
  return { state, busy, post, close: noop, openRole: noop, mayorName: null };
}

test("zeigt die Rolle weder im verdeckten Einstieg noch im passiven Spiel", () => {
  for (const [component, state] of [[RoleRevealGate, stateFor("role_reveal")], [GamePhase, stateFor("wolves")]]) {
    const html = render(component, phaseProps(state));
    assert.doesNotMatch(html, /Hexe|Geheime Rollenbeschreibung/);
    assert.match(html, /lucide-lock-keyhole/);
  }
});

test("verwendet tagsüber die Tagesanzeige und zählt beim Übergang die nächste Nacht", () => {
  const day = render(GamePhase, phaseProps(stateFor("discussion")));
  assert.match(day, /Tag 2/);
  assert.match(day, /Du leitest die Runde/);
  const dawnState = stateFor("dawn");
  dawnState.lobby.resolutionSource = "day";
  const night = render(GamePhase, phaseProps(dawnState));
  assert.match(night, /Nacht 3/);
  assert.match(night, /Erst bestätigen, dann die Augen schließen/);
});

test("bietet nur dem Host die Abstimmung an und sperrt sie während einer Anfrage", () => {
  const host = stateFor("discussion");
  const html = render(GamePhase, phaseProps(host));
  assert.match(html, /<button[^>]*>[^]*?Abstimmung starten/);
  const member = { ...host, me: { ...host.me, isHost: false } };
  assert.doesNotMatch(render(GamePhase, phaseProps(member)), /Abstimmung starten/);
  const busyHtml = render(GamePhase, phaseProps(host, true));
  assert.match(busyHtml, /<button[^>]*disabled=""[^>]*>[^]*?Wird bestätigt/);
  assert.match(busyHtml, /Noch keine Bestätigung erhalten/);
});

test("sperrt eine ungewählte Stimme und erlaubt der Weißen Werwölfin zu passen", () => {
  const action = { phase: "day_vote", candidates: [{ id: "p1", name: "Mara" }], maxTargets: 1 };
  const vote = render(ActionPanel, phaseProps(stateFor("day_vote", { action })));
  assert.match(vote, /aria-pressed="false"/);
  assert.match(vote, /<button[^>]*disabled=""[^>]*>[^]*?Stimme bestätigen/);
  const pass = render(ActionPanel, phaseProps(stateFor("white_werewolf", { action: { ...action, phase: "white_werewolf" } })));
  const passButton = pass.match(/<button(?:(?!<button)[^])*?Ohne Opfer bestätigen<\/button>/)?.[0];
  assert.ok(passButton);
  assert.doesNotMatch(passButton, / disabled=""/);
});

test("zeigt abgegebene Entscheidungen als bestätigt und wartet auf das Dorf", () => {
  const state = stateFor("day_vote", { action: { phase: "day_vote", candidates: [], maxTargets: 1 }, ownSubmission: { targetId: "p1" } });
  const html = render(ActionPanel, phaseProps(state));
  assert.match(html, /Deine Entscheidung ist bestätigt/);
  assert.doesNotMatch(html, /Stimme bestätigen/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="33\.333/);
});

test("hält das Ergebnis der Seherin bis zur Bestätigung sichtbar", () => {
  const state = stateFor("seer", { action: { phase: "seer", candidates: [], maxTargets: 1 }, ownSubmission: { targetId: "p1" }, actionResult: { name: "Mara", seenLabel: "Werwolf" } });
  const html = render(ActionPanel, phaseProps(state));
  assert.match(html, /Lies das Ergebnis und bestätige es/);
  assert.match(html, /Mara/);
  assert.match(html, /Werwolf/);
  assert.match(html, /Ergebnis gelesen/);
});

test("lässt ausgeschiedene Personen am Morgen nur zuschauen", () => {
  const state = stateFor("dawn");
  state.me = { ...state.me, alive: false };
  const html = render(DawnWakePanel, phaseProps(state));
  assert.match(html, /Geist/);
  assert.doesNotMatch(html, /<button/);
});

test("zeigt öffentliche Todesrollen, verrät aber keine lebenden Rollen", () => {
  const state = stateFor("discussion");
  state.players[1] = { ...state.players[1], alive: false, role: "seer", deathCauses: ["wolf_attack"] };
  state.players[2] = { ...state.players[2], role: "witch" };
  const html = render(VillageOverview, { players: state.players, mayorPlayerId: "p0", meId: "p0" });
  assert.match(html, /Ausgeschieden · Seherin/);
  assert.match(html, /Bürgermeister/);
  assert.match(html, /cause-wolf_attack/);
  assert.doesNotMatch(html, /Hexe/);
});

test("führt kleine Dörfer zur Einladung und zeigt den Start nur der Spielleitung", () => {
  const state = stateFor("waiting");
  state.players = state.players.slice(0, 2);
  const props = { state, busy: false, post, invite: noop, settings: noop, audioReady: false, enableAudio: post };
  assert.doesNotMatch(render(WaitingRoom, props), /Partie starten/);
  assert.match(render(WaitingRoom, props), /Personen einladen/);
  assert.match(render(WaitingRoom, props), /Es fehlt noch eine Person/);
  state.players.push({ id: "p2", name: "Lea", online: true, alive: true, deathCauses: [] });
  assert.match(render(WaitingRoom, props), /Partie starten/);
  state.me = { ...state.me, isHost: false };
  assert.doesNotMatch(render(WaitingRoom, props), /Partie starten/);
});

test("verbirgt im Ein-Gerät-Modus Rolle und Rudel bis zum ausdrücklichen Öffnen", () => {
  const html = render(LocalSecret, { player: { name: "Robin", role: "werewolf", team: "wolf" }, pack: "Mara", onDone: noop });
  assert.doesNotMatch(html, /Werwolf|Mara/);
  assert.match(html, /Meine Rolle öffnen/);
  assert.match(html, /Schritt 1 von 2 · Ansehen/);
  assert.doesNotMatch(html, /Gedrückt halten|Rolle verbergen &amp; weitergeben/);
});


test("erklärt jede Rollenaktion mit einer eigenen Aufgabe und einer nötigen Bestätigung", () => {
  const phases = ["mayor_vote", "day_vote", "runoff", "wolves", "seer", "healer", "cupid", "wild_child", "hunter", "white_werewolf", "piper", "thief", "witch"];
  for (const phase of phases) {
    const guidance = getGameGuidance({ phase, alive: phase !== "hunter", isHost: false, hasAction: true, submitted: false });
    assert.equal(guidance.requiresConfirmation, true, phase);
    assert.equal(guidance.status, "action", phase);
    assert.ok(guidance.title.length > 10);
    const waiting = getGameGuidance({ phase, alive: true, isHost: false, hasAction: false, submitted: false });
    assert.equal(waiting.requiresConfirmation, false, phase);
    assert.match(waiting.instruction, /nichts antippen oder bestätigen/);
  }
});

test("nennt nach einer bestätigten Entscheidung den automatischen Übergang", () => {
  for (const phase of ["day_vote", "wolves", "witch", "thief", "dawn", "role_reveal"]) {
    const guidance = getGameGuidance({ phase, alive: true, isHost: false, hasAction: true, submitted: true });
    assert.equal(guidance.status, "confirmed", phase);
    assert.equal(guidance.requiresConfirmation, false, phase);
    assert.match(guidance.instruction, /nichts mehr antippen/);
    assert.match(guidance.instruction, /automatisch/);
  }
});

test("unterscheidet Auswahl, Paarwahl und freiwilliges Aussetzen", () => {
  assert.equal(getSelectionGuidance("day_vote", []).valid, false);
  assert.equal(getSelectionGuidance("day_vote", ["Mara"]).valid, true);
  assert.equal(getSelectionGuidance("cupid", ["Mara"]).valid, false);
  assert.match(getSelectionGuidance("cupid", ["Mara"]).instruction, /zweite Person/);
  assert.equal(getSelectionGuidance("cupid", ["Mara", "Lea"]).valid, true);
  assert.equal(getSelectionGuidance("piper", ["Mara"]).valid, true);
  assert.equal(getSelectionGuidance("piper", ["Mara", "Lea"]).valid, true);
  assert.equal(getSelectionGuidance("white_werewolf", []).valid, true);
  assert.match(getSelectionGuidance("day_vote", ["Mara"]).instruction, /Noch nicht bestätigt/);
  assert.equal(getSelectionGuidance("day_vote", ["Mara"]).summary, "Mara");
});

test("die Hexe muss auch ohne verfügbare Tränke ausdrücklich fortfahren", () => {
  const state = stateFor("witch", { action: { phase: "witch", candidates: [], canHeal: false, canPoison: false }, privateRole: { role: "witch", healPotion: false, poisonPotion: false } });
  const html = render(ActionPanel, phaseProps(state));
  assert.match(html, /Auch wenn du keinen Trank verwendest, musst du hier bestätigen/);
  assert.match(html, /Ohne Tränke fortfahren/);
  assert.match(html, /Heiltrank verbraucht/);
  assert.match(html, /Gifttrank verbraucht/);
  assert.doesNotMatch(html, /aufbewahren<\/strong>/);
});

test("beim Dieb ist eine Rollenwahl noch keine Bestätigung", () => {
  const state = stateFor("thief", { action: { phase: "thief", candidates: [] }, privateRole: { role: "thief", reserveRoles: ["villager", "werewolf"] } });
  const html = render(ActionPanel, phaseProps(state));
  assert.match(html, /Erst mit deiner Bestätigung wird sie übernommen/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>[^]*?Rolle bestätigen/);
  const selected = render(RoleChoiceList, { roles: ["thief", "werewolf"], selected: "werewolf", onSelect: noop });
  assert.match(selected, /aria-pressed="true"/);
  assert.match(selected, /Ausgewählt · noch bestätigen/);
});

test("zeigt bei ausstehendem Seher-Ergebnis keine verfrühte Abschlussmeldung", () => {
  const state = stateFor("seer", { action: { phase: "seer", candidates: [] }, ownSubmission: { targetId: "p1" } });
  const html = render(ActionPanel, phaseProps(state));
  assert.match(html, /Dein Ergebnis wird geladen/);
  assert.match(html, /musst du bestätigen, dass du sie gelesen hast/);
  assert.doesNotMatch(html, /nichts mehr antippen/);
});

test("die ausgeschiedene Spielleitung kann weiterhin die Diskussion beenden", () => {
  const state = stateFor("discussion"); state.me = { ...state.me, alive: false };
  const html = render(GamePhase, phaseProps(state));
  assert.match(html, /Du leitest die Runde/);
  assert.match(html, /Abstimmung starten/);
  assert.doesNotMatch(html, /musst nichts bestätigen/);
});

test("beginnt die lokale Vorbereitung mit Namen und erklärt den gesperrten nächsten Schritt", () => {
  const html = render(LocalWerewolf, { onBack: noop, showError: noop });
  assert.match(html, /Wer spielt mit/);
  assert.match(html, /aria-label="Spielvorbereitung"/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /confirm-dock-compact/);
  assert.doesNotMatch(html, /Schritt 1 von 2|Gruppe bestätigen|Bestätigung erforderlich/);
  assert.match(html, /Trage zuerst mindestens drei Namen ein/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>[^]*?Weiter zu den Spielregeln/);
  assert.doesNotMatch(html, /Heiltrank|Wolfsslots|Zusatzrollen hinzufügen/);
});

test("gibt Fehlermeldungen einen sichtbaren Schließen-Knopf", () => {
  const html = render(Notice, { message: "Bestätigung nicht erhalten", clear: noop });
  assert.match(html, /role="alert"/);
  assert.match(html, /Bestätigung nicht erhalten/);
  assert.match(html, /aria-label="Hinweis schließen"/);
});
