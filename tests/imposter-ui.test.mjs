import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/imposter-ui-${process.pid}.cjs`);
const source = await readFile(resolve(root, "app/imposter/page.tsx"), "utf8");
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: {
    contents: `${source}\nexport { LocalGame, LocalNames, GameModes, GameRules, validateImposterSetup };`,
    resolveDir: resolve(root, "app/imposter"), loader: "tsx",
  },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node",
  format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
  plugins: [{
    name: "framework-image",
    setup(build) {
      build.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "framework-image" }));
      build.onLoad({ filter: /.*/, namespace: "framework-image" }, () => ({ contents: "export default function Image() { return null; }", loader: "js" }));
    },
  }],
});
after(() => rm(output, { force: true }));
const { LocalGame, LocalNames, GameModes, GameRules, validateImposterSetup } = createRequire(import.meta.url)(output);
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const validate = (names, mode = "family", pool = "random", pairs = []) => validateImposterSetup(names, mode, pool, pairs);
const noop = () => {};

test("erklärt den gesperrten Imposter-Start unmittelbar bei der Namensliste", () => {
  const html = render(LocalGame, { onBack: noop, showError: noop });
  assert.match(html, /id="imposter-names-status"[^>]*role="status">Noch 3 Namen erforderlich/);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-describedby="imposter-names-status imposter-pool-status"[^>]*>Rollen verteilen/);
  assert.equal((html.match(/aria-describedby="imposter-names-status"/g) ?? []).length, 3);
});

test("gibt den Start erst mit drei gültigen Namen frei", () => {
  assert.equal(validate(["", "", ""]).canStart, false);
  assert.equal(validate(["Mia", "Ben", ""]).nameError, "Noch 1 Name erforderlich.");
  assert.equal(validate(["Mia", "Ben", "Lea"]).canStart, true);
});

test("markiert alle doppelten Namen und ordnet jedem Feld seinen Hinweis zu", () => {
  const names = ["Mia", " mia ", "Lea", "MIA"];
  const setup = validate(names);
  assert.deepEqual(setup.duplicateIndices, [0, 1, 3]);
  assert.equal(setup.canStart, false);
  const html = render(LocalNames, { names, setup, onChange: noop });
  for (const index of [0, 1, 3]) {
    assert.match(html, new RegExp(`aria-invalid="true"[^>]*aria-describedby="imposter-name-${index}-error imposter-names-status"`));
    assert.match(html, new RegExp(`id="imposter-name-${index}-error">Dieser Name ist bereits vergeben`));
  }
  assert.equal((html.match(/aria-invalid="true"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /id="imposter-name-2-error"/);
});

test("Korrektur oder Entfernen eines Duplikats aktualisiert die Freigabe", () => {
  assert.equal(validate(["Mia", "mia", "Lea", "Ben"]).canStart, false);
  const corrected = validate(["Mia", "Lena", "Lea", "Ben"]);
  assert.equal(corrected.canStart, true);
  assert.deepEqual(corrected.duplicateIndices, []);
  assert.equal(validate(["Mia", "Lea", "Ben"]).canStart, true);
  assert.equal(validate(["Mia", "Lea"]).canStart, false);
});

test("behält einstellige Namen, leere Zusatzzeilen und die Namensreihenfolge bei", () => {
  const setup = validate([" A ", "B", " C", "", "  "]);
  assert.equal(setup.canStart, true);
  assert.deepEqual(setup.validNames, ["A", "B", "C"]);
});

test("führt keine zusätzliche Unicode- oder Leerzeichen-Normalisierung ein", () => {
  assert.equal(validate(["A B", "A  B", "Lea"]).canStart, true);
  assert.equal(validate(["Ａ", "A", "Lea"]).canStart, true);
  assert.equal(validate(["Änne", "änne", "Lea"]).canStart, false);
});

test("eigene Wörter gelten erst nach dem Speichern und nur im passenden Inhaltsmodus", () => {
  const names = ["Mia", "Ben", "Lea"];
  // Draft fields are intentionally not inputs to the validation function.
  assert.equal(validate(names, "family", "custom", []).canStart, false);
  const family = [{ crew: "Kaffee", imposter: "Kakao", rating: "family" }];
  const adult = [{ crew: "Bar", imposter: "Nachtclub", rating: "adult" }];
  assert.equal(validate(names, "family", "custom", family).canStart, true);
  assert.equal(validate(names, "adult", "custom", adult).canStart, true);
  assert.equal(validate(names, "family", "custom", adult).canStart, false);
  assert.deepEqual(validate(names, "family", "custom", [...family, ...adult]).eligiblePairs, family);
  assert.equal(validate(names, "adult", "custom", [...family, ...adult]).eligiblePairs.length, 2);
});

test("verwendet für alle Modi jeweils eine eindeutige Schaltfläche", () => {
  const html = render(GameModes, { onCreate: noop, onJoin: noop, onLocal: noop });
  assert.equal((html.match(/<button\b/g) ?? []).length, 3);
  for (const title of ["Lobby erstellen", "Lobby beitreten", "Ein Gerät für alle"]) assert.ok(html.includes(title));
  assert.doesNotMatch(html, /Ich organisiere|Neue Lobby öffnen|Lobby finden/);
});

test("Spielregeln sind freiwillig aufklappbar und erklären die tatsächlichen Abläufe", () => {
  const imposter = render(GameRules, { game: "imposter" });
  const wolf = render(GameRules, { game: "werewolf" });
  for (const html of [imposter, wolf]) {
    assert.match(html, /<details class="game-rules"><summary>/);
    assert.match(html, /So funktioniert’s/);
    assert.match(html, /3–22 Personen/);
    assert.equal((html.match(/<li>/g) ?? []).length, 3);
    assert.match(html, /Diskussionstempo/);
  }
  assert.match(imposter, /die Imposter ein ähnliches/);
  assert.match(imposter, /die Rollen bleiben geheim/);
  assert.match(wolf, /alle Rollen aufgedeckt/);
  assert.match(wolf, /eigene Siegbedingungen/);
});
