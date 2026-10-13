import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test, { after } from "node:test";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, `.wrangler/test-artifacts/catan-atmosphere-render-${process.pid}.cjs`);
await mkdir(resolve(root, ".wrangler/test-artifacts"), { recursive: true });
await build({ stdin: { contents: 'export { paintAtmosphere } from "./components/catan/atmosphere"; export { CatanAmbientIsland } from "./components/catan/ambient-island"; export { createAtmosphere } from "./lib/catan-atmosphere"; export { ambientShipWakeAnchor, ambientSailboatRectangle } from "./lib/catan-ambient"; export { createBoard } from "./lib/catan";', resolveDir: root, loader: "tsx" }, absWorkingDir: root, bundle: true, packages: "external", platform: "node", format: "cjs", outfile: output, logLevel: "silent" });
after(() => rm(output, { force: true }));
const require = createRequire(import.meta.url);
const { paintAtmosphere, createAtmosphere, createBoard, CatanAmbientIsland, ambientShipWakeAnchor, ambientSailboatRectangle } = require(output);
const React = require("react"); const { renderToStaticMarkup } = require("react-dom/server");
const spec = createAtmosphere(createBoard(() => 0), { x: -420, y: -370, width: 840, height: 740 }, "render");
function nodes() {
  return new Map([...spec.clouds.flatMap((cloud) => [cloud.id, `${cloud.id}-shadow`]), ...spec.surf.map((surf) => surf.id), spec.fog.id].map((id) => {
    const attributes = new Map(); return [id, { attributes, setAttribute: (name, value) => attributes.set(name, value) }];
  }));
}
const point = (node) => node.attributes.get("transform").match(/-?[\d.]+/g).map(Number);

test("clouds and land-clipped shadows move together through fades, without brightening their shadows when clouds are strengthened", () => {
  const layer = nodes();
  for (const time of [0, 18_000, 65_000, 110_000]) {
    paintAtmosphere(layer, spec, time, .45, false, true, false, () => false, { visible: false });
    for (const cloud of spec.clouds) {
      const sky = layer.get(cloud.id); const shadow = layer.get(`${cloud.id}-shadow`);
      const a = point(sky); const b = point(shadow);
      assert.ok(Math.abs(b[0] - a[0] - 10) < 1e-8 && Math.abs(b[1] - a[1] - 12) < 1e-8);
      assert.ok(Number(shadow.attributes.get("opacity")) <= .055 + 1e-12);
      assert.equal(Number(sky.attributes.get("opacity")) === 0, Number(shadow.attributes.get("opacity")) === 0);
    }
  }
});

test("a newly busy action blocks fog between scheduler ticks while an already visible fog bank may finish", () => {
  assert.ok(spec.fog, "The fixture contains a safe offshore fog corridor.");
  const layer = nodes(); const state = { visible: false }; const fog = layer.get(spec.fog.id);
  let blocked = true; let checks = 0;
  const action = () => { checks++; return blocked; };
  const paint = (time, preview) => paintAtmosphere(layer, spec, time, 1, false, true, preview, action, state);
  paint(0, true);
  assert.equal(fog.attributes.get("opacity"), "0"); assert.equal(checks, 1);
  blocked = false; paint(33, true);
  assert.ok(Number(fog.attributes.get("opacity")) > 0); assert.equal(checks, 2);
  blocked = true; paint(66, true);
  assert.ok(Number(fog.attributes.get("opacity")) > 0); assert.equal(checks, 2, "Existing fog finishes without repeatedly querying action elements.");
  const quiet = ((.9 - spec.fog.phase + 1) % 1) * spec.fog.duration;
  paint(quiet, false);
  assert.equal(fog.attributes.get("opacity"), "0"); assert.equal(state.visible, false);
  paint(quiet + 33, true);
  assert.equal(fog.attributes.get("opacity"), "0"); assert.equal(checks, 3, "A later fog bank checks the live action state again.");
});

test("disabled water removes shoreline wave nodes and their paint work while retaining island clouds", (t) => {
  assert.ok(spec.surf.length > 0);
  const layer = nodes();
  paintAtmosphere(layer, spec, 1000, 1, false, true, false, () => false, { visible: false }, false);
  assert.ok(spec.surf.every((surf) => layer.get(surf.id).attributes.size === 0), "No shoreline wave transform or opacity writes remain.");
  assert.ok(spec.clouds.every((cloud) => layer.get(cloud.id).attributes.has("transform")), "Cloud movement remains independently enabled.");
  t.mock.method(React, "useState", (initial) => [Array.isArray(initial) ? [] : { clouds: true, sailboat: false, pirate_ship: false }, () => {}]);
  const props = { game: { id: "static-water", board: createBoard(() => 0), robberHex: -1 }, artId: "static-water", viewBox: "-420 -370 840 740", active: true, interacting: false, enabled: true };
  const still = renderToStaticMarkup(React.createElement("svg", null, React.createElement(CatanAmbientIsland, { ...props, waterEnabled: false })));
  const moving = renderToStaticMarkup(React.createElement("svg", null, React.createElement(CatanAmbientIsland, props)));
  assert.doesNotMatch(still, /data-atmosphere-kind="surf"/);
  assert.match(still, /data-atmosphere-kind="cloud"/);
  assert.match(moving, /data-atmosphere-kind="surf"/);
});

test("rendered boat wakes begin at the painted stern in all twelve views and their full curves stay inside the validated envelope", (t) => {
  let scene;
  t.mock.method(React, "useState", (initial) => [Array.isArray(initial) ? [scene] : { clouds: false, sailboat: true, pirate_ship: true }, () => {}]);
  const board = createBoard(() => 0);
  for (const [kind, size, wake] of [["sailboat", 44, 16], ["pirate_ship", 88, 32]]) for (let heading = 0; heading < 6; heading++) {
    scene = { id: "ship", kind, heading, startedAt: 0, duration: 30_000, point: { x: 0, y: 0 } };
    const html = renderToStaticMarkup(React.createElement("svg", null, React.createElement(CatanAmbientIsland, {
      game: { id: "stern", board, robberHex: -1 }, artId: "stern", viewBox: "-420 -370 840 740", active: true, interacting: false, enabled: true,
    })));
    const d = html.match(/data-ambient-wake="1"[^>]*d="([^"]+)"/)[1].match(/-?[\d.]+/g).map(Number);
    const anchor = ambientShipWakeAnchor(heading, size);
    assert.ok(Math.abs(d[0] - anchor.x) < 1e-9 && Math.abs(d[1] - anchor.y) < 1e-9, `${kind}, heading ${heading}: water must start on the stern, not at the atlas cell edge.`);
    const envelope = ambientSailboatRectangle({ x: 0, y: 0 }, heading, size, wake);
    for (const path of html.matchAll(/data-ambient-wake="\d"[^>]*d="([^"]+)"/g)) {
      const points = path[1].match(/-?[\d.]+/g).map(Number);
      for (let index = 0; index < points.length; index += 2) {
        const x = points[index]; const y = points[index + 1]; const stroke = 1.3 * size / 44 / 2;
        assert.ok(x - stroke >= envelope.x - 1e-9 && x + stroke <= envelope.x + envelope.width + 1e-9);
        assert.ok(y - stroke - 2 >= envelope.y - 1e-9 && y + stroke + 2 <= envelope.y + envelope.height + 1e-9);
      }
    }
    assert.match(html, /offset="1" stop-color="#d4e7dd" stop-opacity="0"/);
  }
});
