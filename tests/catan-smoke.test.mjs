import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, `.wrangler/test-artifacts/catan-smoke-${process.pid}.cjs`);
await mkdir(dirname(output), { recursive: true });
await build({
  stdin: { contents: 'export { createAmbientScene, AMBIENT_DURATIONS } from "./lib/catan-ambient"; export { CatanAmbientIsland } from "./components/catan/ambient-island"; export { BuildingPiece } from "./components/catan/landscape";', resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", outfile: output, logLevel: "silent",
});
after(() => rm(output, { force: true }));
const require = createRequire(import.meta.url);
const React = require("react"); const { renderToStaticMarkup } = require("react-dom/server");
const { createAmbientScene, AMBIENT_DURATIONS, CatanAmbientIsland, BuildingPiece } = require(output);
const bounds = { x: -200, y: -200, width: 400, height: 400 };
const makeGame = (building) => ({ id: "chimneys", robberHex: -1, board: { hexes: [], edges: [], harbors: [], vertices: [{ id: 0, x: 40, y: 60, owner: "a", building }] } });

test("smoke starts on the real atlas chimney after each BuildingPiece transform, for settlements and cities", () => {
  // Mouth ranges measured in the actual two-row building atlas. Derive the
  // source back through the rendered SVG placement, including its +11 offset.
  for (const [building, mouth] of [["settlement", { x: [.36, .42], y: [.18, .25] }], ["city", { x: [.445, .49], y: [.055, .11] }]]) {
    const game = makeGame(building); const vertex = game.board.vertices[0];
    const scene = createAmbientScene("smoke", game, bounds, () => 0); assert.ok(scene);
    for (let colorIndex = 0; colorIndex < 4; colorIndex++) {
      const html = renderToStaticMarkup(React.createElement(BuildingPiece, { id: "art", building, colorIndex, x: vertex.x, y: vertex.y }));
      const crop = html.match(/<svg x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/).slice(1).map(Number);
      const structureY = Number(html.match(/transform="translate\(0 ([^)]+)\)"/)[1]);
      const normalizedX = (scene.point.x - vertex.x - crop[0]) / crop[2];
      const normalizedY = (scene.point.y - vertex.y - structureY - crop[1]) / crop[3];
      assert.ok(normalizedX >= mouth.x[0] && normalizedX <= mouth.x[1], `${building} smoke stays within its chimney opening horizontally.`);
      assert.ok(normalizedY >= mouth.y[0] && normalizedY <= mouth.y[1], `${building} smoke rises from its roof, without a floating gap.`);
    }
  }
});

test("only confirmed houses with room for their entire plume emit smoke", () => {
  const game = makeGame("city"); const vertex = game.board.vertices[0];
  assert.equal(createAmbientScene("smoke", game, { x: 0, y: 20, width: 100, height: 100 }, () => 0), null, "A visible building vertex is insufficient when the chimney or rising puff would be clipped.");
  vertex.owner = null; assert.equal(createAmbientScene("smoke", game, bounds, () => 0), null);
  vertex.owner = "a"; vertex.building = null; assert.equal(createAmbientScene("smoke", game, bounds, () => 0), null);
  vertex.building = "settlement"; assert.ok(createAmbientScene("smoke", game, bounds, () => 0));
});

test("the rendered staggered puffs cover the 4.5-second smoke scene through its final fade", async (t) => {
  const game = makeGame("city");
  const scene = { ...createAmbientScene("smoke", game, bounds, () => 0), id: "smoke", kind: "smoke", startedAt: 0, duration: AMBIENT_DURATIONS.smoke };
  t.mock.method(React, "useState", () => [[scene], () => {}]);
  const html = renderToStaticMarkup(React.createElement("svg", null, React.createElement(CatanAmbientIsland, { game, artId: "smoke-art", viewBox: "-200 -200 400 400", active: true, interacting: false, enabled: true })));
  assert.match(html, new RegExp(`data-ambient-kind="smoke"[^>]*transform="translate\\(${scene.point.x} ${scene.point.y}\\)"`));
  const delays = [...html.matchAll(/class="catan-ambient-smoke-puff"[^>]*style="animation-delay:([\d.]+)ms"/g)].map((match) => Number(match[1]));
  assert.equal(delays.length, 3); assert.equal(delays[0], 0);
  const css = await readFile(resolve(root, "components/catan/ambient-island.css"), "utf8");
  const duration = Number(css.match(/\.catan-ambient-smoke-puff\s*\{[^}]*animation:catan-ambient-smoke\s+([\d.]+)s/)[1]) * 1000;
  const intervals = delays.map((delay) => [delay, delay + duration]);
  assert.ok(intervals.at(-1)[1] >= scene.duration - 400, "A puff is still rising during the scene's last visible fade, rather than leaving an empty final second.");
  assert.ok(intervals.at(-1)[1] <= scene.duration, "All puffs end before the scene is removed.");
  for (let time = 100; time < scene.duration - 400; time += 100) assert.ok(intervals.some(([start, end]) => start < time && end > time), "The stagger has no empty gap while the chimney scene is visible.");
});
