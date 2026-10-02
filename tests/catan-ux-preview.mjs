// Optional interactive QA: node tests/catan-ux-preview.mjs
import { context } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const fixture = process.env.CATAN_QA_FIXTURE ?? "catan-ux.tsx";
const port = Number(process.env.CATAN_QA_PORT ?? 3002);
const output = resolve(root, ".wrangler/ux-preview/app.js");
const detailStyles = ["resource-feedback.css", "event-notice.css", "board-effects.css", "ambient-island.css"];
await mkdir(resolve(root, ".wrangler/ux-preview"), { recursive: true });
const bundle = await context({ entryPoints: [resolve(root, "tests/fixtures", fixture)], outfile: output, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "warning" });
await bundle.watch(); await bundle.rebuild();
const cssDir = resolve(root, "dist/client/_next/static/css");
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (["/catan/terrain-atlas-v3.jpg", "/catan/sea-v3.jpg", "/catan/buildings-v3.png", "/catan/harbor-atlas-v3.png", "/catan/boats-directions-v1.png", "/catan/robber-v2.png", "/catan/ambient-atlas-v1.png", "/catan/wildlife-atlas-v1.png", "/catan/pasture-v1.png"].includes(path)) {
      res.setHeader("content-type", path.endsWith(".png") ? "image/png" : "image/jpeg");
      res.setHeader("cache-control", "no-store");
      res.end(await readFile(resolve(root, "public", path.slice(1))));
    } else if (detailStyles.includes(path.slice(1))) {
      res.setHeader("content-type", "text/css"); res.setHeader("cache-control", "no-store");
      res.end(await readFile(resolve(root, "components/catan", path.slice(1))));
    } else if (path === "/app.js" || path === "/catan.css" || path === "/base.css") {
      res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : "text/css");
      res.setHeader("cache-control", "no-store");
      const globalCss = path === "/base.css" ? (await readdir(cssDir)).find((f) => f.startsWith("index.")) : undefined;
      res.end(await readFile(path === "/app.js" ? output : path === "/catan.css" ? resolve(root, "app/catan/catan.css") : resolve(cssDir, globalCss)));
    } else {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catan UX-Prüfung</title><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/catan.css">${detailStyles.map((style) => `<link rel="stylesheet" href="/${style}">`).join("")}<style>.qa-controls{position:fixed;z-index:200;right:4px;top:0;color:#fff;background:#334;padding:4px;font:12px Arial}.qa-controls label{display:grid;gap:8px}.qa-controls select{background:#223;padding:8px}body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
    }
  } catch (error) { res.statusCode = 500; res.end(error.message); }
});
server.listen(port, "127.0.0.1", () => console.log(`Catan QA ready: http://127.0.0.1:${port}`));
process.once("SIGINT", () => { server.close(); void bundle.dispose().then(() => process.exit(0)); });
