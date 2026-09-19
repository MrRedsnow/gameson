// Optional interactive QA: node tests/catan-ux-preview.mjs
import { context } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".wrangler/ux-preview/app.js");
await mkdir(resolve(root, ".wrangler/ux-preview"), { recursive: true });
const bundle = await context({ entryPoints: [resolve(root, "tests/fixtures/catan-ux.tsx")], outfile: output, bundle: true, platform: "browser", format: "esm", jsx: "automatic", logLevel: "warning" });
await bundle.watch(); await bundle.rebuild();
const cssDir = resolve(root, "dist/client/_next/static/css");
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (path === "/app.js" || path === "/catan.css" || path === "/base.css") {
      res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : "text/css");
      res.setHeader("cache-control", "no-store");
      const globalCss = path === "/base.css" ? (await readdir(cssDir)).find((f) => f.startsWith("index.")) : undefined;
      res.end(await readFile(path === "/app.js" ? output : path === "/catan.css" ? resolve(root, "app/catan/catan.css") : resolve(cssDir, globalCss)));
    } else {
      res.setHeader("content-type", "text/html");
      res.end('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catan UX-Prüfung</title><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/catan.css"><style>.qa-controls{position:fixed;z-index:200;right:4px;top:0;color:#fff;background:#334;padding:4px;font:12px Arial}.qa-controls label{display:grid;gap:8px}.qa-controls select{background:#223;padding:8px}body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
    }
  } catch (error) { res.statusCode = 500; res.end(error.message); }
});
server.listen(3002, "127.0.0.1", () => console.log("Catan QA ready: http://127.0.0.1:3002"));
process.once("SIGINT", () => { server.close(); void bundle.dispose().then(() => process.exit(0)); });
