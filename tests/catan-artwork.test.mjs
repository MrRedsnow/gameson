import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const assets = [
  ["terrain-atlas-v3.jpg", "terrain-atlas-v4.jpg", 1536, 1024],
  ["sea-v3.jpg", "sea-v4.jpg", 1254, 1254],
  ["buildings-v3.png", "buildings-v4.png", 1774, 887],
  ["pasture-v1.png", "pasture-v2.png", 1254, 1254],
];
const read = (name) => readFile(new URL(`../public/catan/${name}`, import.meta.url));

function dimensions(bytes, name) {
  if (name.endsWith(".png")) {
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  assert.equal(bytes.readUInt16BE(0), 0xffd8, "JPEG assets must retain their production format.");
  let offset = 2;
  while (offset < bytes.length) {
    assert.equal(bytes[offset++], 0xff);
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    const length = bytes.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    offset += length;
  }
  assert.fail(`Missing JPEG dimensions: ${name}`);
}

test("refined artwork preserves atlas dimensions, transparency and the compressed download budget", async () => {
  let before = 0; let after = 0;
  for (const [oldName, name, width, height] of assets) {
    const [oldBytes, bytes] = await Promise.all([read(oldName), read(name)]);
    before += oldBytes.length; after += bytes.length;
    assert.deepEqual(dimensions(bytes, name), [width, height], `${name} must not increase decoded texture memory or change the atlas crop.`);
    if (name === "buildings-v4.png") assert.ok([4, 6].includes(bytes[25]), "Buildings require an alpha channel.");
    if (name === "pasture-v2.png") assert.equal(bytes[25], 2, "The full ground texture remains RGB without an unused alpha channel.");
  }
  assert.ok(after <= before, `${after} refined artwork bytes exceed the original ${before}-byte budget.`);
});

test("all refined graphics are precached and obsolete versions are no longer downloaded", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  for (const [oldName, name] of assets) {
    assert.ok(worker.includes(`"/catan/${name}"`), `${name} must be available offline.`);
    assert.ok(!worker.includes(`"/catan/${oldName}"`), `${oldName} must not consume another download request.`);
  }
});
