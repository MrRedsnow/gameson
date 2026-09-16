import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the shared "stored round" panel in each of its states; the countdown itself is driven by the dialog wrapper.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/resume-session-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export * from "./components/game-entry";\nexport { Dialog } from "./components/ui/dialog";\nexport * from "./lib/game-session";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { ResumeSessionPanel, Dialog, RESUME_DISCARD_SECONDS } = createRequire(import.meta.url)(output);
const noop = () => {};
const render = (props) => renderToStaticMarkup(createElement(Dialog, { open: true }, createElement(ResumeSessionPanel, { remaining: null, onResume: noop, onNewGame: noop, onCancel: noop, ...props })));
const buttons = (html) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) => match[1].replace(/<[^>]+>/g, ""));

test("bietet die alte Runde und ein neues Spiel an, solange die Verbindung geprüft wird", () => {
  const html = render({ lobby: undefined });
  assert.match(html, /Zurück zu deiner Runde\?/);
  assert.match(html, /class="resume-lobby" role="status"><span>Verbindung wird geprüft …<\/span>/);
  assert.deepEqual(buttons(html), ["Zurück zur Runde", "Laufende Runde verlassen"]);
  assert.match(html, new RegExp(`nach ${RESUME_DISCARD_SECONDS} Sekunden verworfen`));
  // Rejoining is the confirming colour; only leaving the round is red.
  assert.match(html, /class="[^"]*game-accept-action[^"]*"[^>]*>Zurück zur Runde/);
  assert.match(html, /class="[^"]*game-danger-action[^"]*"[^>]*>.*?Laufende Runde verlassen/);
});

test("nennt die gefundene Lobby mit Namen und Stand", () => {
  const html = render({ lobby: { name: "Wohnzimmer", detail: "5 Personen · Abstimmung läuft" } });
  assert.match(html, /Zurück zu „Wohnzimmer“\?/);
  assert.match(html, /<strong>Wohnzimmer<\/strong><span>5 Personen · Abstimmung läuft<\/span>/);
  const offline = render({ lobby: { detail: "Gerade keine Verbindung. Du kannst trotzdem entscheiden." } });
  assert.match(offline, /Zurück zu deiner Runde\?/);
  assert.match(offline, /Gerade keine Verbindung/);
  assert.deepEqual(buttons(offline), ["Zurück zur Runde", "Laufende Runde verlassen"]);
});

test("zählt beim Verwerfen sichtbar herunter und lässt bis zuletzt abbrechen", () => {
  const html = render({ lobby: { name: "Wohnzimmer", detail: "3 Personen · Runde läuft" }, remaining: 3 });
  assert.match(html, /Du verlässt die Runde/);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"><strong>3<\/strong><p>Noch 3 Sekunden, um es dir anders zu überlegen\./);
  assert.match(html, /class="resume-countdown-bar" aria-hidden="true"><span style="animation-duration:5s"><\/span>/);
  assert.deepEqual(buttons(html), ["Abbrechen – in der Runde bleiben"]);
  assert.match(render({ lobby: undefined, remaining: 1 }), /Noch 1 Sekunde, um/);
  assert.equal(RESUME_DISCARD_SECONDS, 5);
});

test("bietet ohne gültige Sitzung nur noch ein neues Spiel an", () => {
  const html = render({ lobby: null, remaining: 2 });
  assert.match(html, /Diese Runde ist vorbei/);
  assert.deepEqual(buttons(html), ["Neues Spiel starten"]);
  assert.doesNotMatch(html, /Abbrechen|Zurück zur Runde|resume-countdown/);
});
