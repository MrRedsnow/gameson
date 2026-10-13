import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-overview-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export { OverviewPanel } from "./components/catan/overview-panel"; export { createCatanGame, catanView } from "./lib/catan";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const { OverviewPanel, createCatanGame, catanView } = createRequire(import.meta.url)(output);
const seats = ["Anna", "Benjamin Alexander", "Clara", "Dominik Maximilian"].map((name, i) => ({ id: `overview-${i}`, name }));
const game = catanView(createCatanGame(seats, 12, () => 0), seats[0].id);
game.players.forEach((player, i) => {
  player.resourceCount = [25, 5, 14, 9][i];
  player.knights = [10, 3, 12, 1][i];
  player.roadLength = [12, 3, 10, 1][i];
});
const render = (extra = {}) => renderToStaticMarkup(createElement(OverviewPanel, {
  game, page: "menu", setPage() {}, activity: [], unreadActivity: [], unread: 2, onRead() {}, local: true, onHide() {}, busy: false,
  onAmbientChange() {}, onWaterChange() {}, ...extra,
}));

test("overview groups the visible player list above history and settings", () => {
  const html = render();
  const sections = html.match(/<section\b[^>]*class="catan-overview-section\b[^"]*"[^>]*>[\s\S]*?<\/section>/g) ?? [];
  assert.equal(sections.length, 2);
  assert.match(sections[0], /<h3\b[^>]*>Spieler<\/h3>/);
  assert.equal((sections[0].match(/class="catan-player-card"/g) ?? []).length, 4);
  assert.match(sections[1], /<h3\b[^>]*>Verlauf und Einstellungen<\/h3>/);
  for (const text of ["Spielverlauf", "Deine Meldungen", "Spielregeln &amp; Baukosten", "Lebendige Insel", "Bewegtes Wasser", "Zur Spielauswahl"]) assert.ok(sections[1].includes(text), `${text} belongs to the lower section.`);
  assert.equal((sections[1].match(/class="catan-overview-link"/g) ?? []).length, 3);
  assert.doesNotMatch(sections[0], /<details\b[^>]*class="catan-overview-section"/, "Player scores remain visible immediately.");
});

test("each player summary exposes resource, knight and road symbols with exact accessible counts", () => {
  const summaries = [...render().matchAll(/<details class="catan-player-card"[^>]*>\s*<summary>([\s\S]*?)<\/summary>/g)].map((match) => match[1]);
  assert.equal(summaries.length, 4);
  const statTypes = [["resources", "Rohstoffkarten", "wallet-cards", "resourceCount"], ["knights", "Ritter", "shield", "knights"], ["road", "Straße", "route", "roadLength"]];
  summaries.forEach((summary, index) => {
    assert.equal((summary.match(/data-catan-stat=/g) ?? []).length, 3);
    for (const [stat, label, icon, field] of statTypes) {
      const segment = summary.split(`data-catan-stat="${stat}"`)[1]?.split('<span class="catan-player-stat"')[0];
      assert.ok(segment, `Missing ${stat} for ${seats[index].name}.`);
      assert.match(segment, new RegExp(`title="[^"]*${label}[^"]*"`));
      assert.match(segment, new RegExp(`lucide-${icon}\\b`));
      assert.match(segment, /<svg\b[^>]*aria-hidden="true"/);
      assert.match(segment, new RegExp(`<span\\b[^>]*data-catan-stat-value[^>]*>${game.players[index][field]}<\\/span>`));
      assert.match(segment, new RegExp(`<span class="sr-only">[^<]*${label}[^<]*<\\/span>`));
    }
  });
});

test("island life and moving water have independent checked states", () => {
  for (const ambientEnabled of [false, true]) for (const waterEnabled of [false, true]) {
    const html = render({ ambientEnabled, waterEnabled });
    for (const [label, enabled] of [["Lebendige Insel", ambientEnabled], ["Bewegtes Wasser", waterEnabled]]) {
      const checkbox = html.match(new RegExp(`<input\\b[^>]*type="checkbox"[^>]*aria-label="${label}"[^>]*>`))?.[0];
      assert.ok(checkbox);
      assert.equal(checkbox.includes('checked=""'), enabled, `${label} reflects only its own preference.`);
    }
  }
});
