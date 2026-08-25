import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("../scripts/setup-ubuntu.sh", import.meta.url), "utf8");

test("aktualisiert Server-Checkouts ausschließlich per Fast-Forward", () => {
  assert.match(script, /status --porcelain --untracked-files=no/);
  assert.match(script, /fetch --prune "\$GIT_REMOTE" "\$GIT_BRANCH"/);
  assert.match(script, /merge --ff-only FETCH_HEAD/);
  assert.match(script, /GAMESON_UPDATE_REPO/);
  assert.match(script, /GAMESON_SETUP_REEXECUTED/);
});

test("verwendet vorhandene Zertifikate und erneuert sie nur bei Bedarf", () => {
  assert.match(script, /openssl x509 .* -checkhost "\$DOMAIN"/);
  assert.match(script, /openssl x509 .* -checkend "\$CERT_RENEW_SECONDS"/);
  assert.match(script, /Certificate is valid beyond the renewal window/);
  assert.match(script, /certbot renew --non-interactive --cert-name/);
  assert.match(script, /No certificate .* requesting the initial certificate/);
});

test("überspringt unveränderte Abhängigkeiten und Builds", () => {
  assert.match(script, /\.gameson-dependency-hash/);
  assert.match(script, /\.gameson-build-revision/);
  assert.match(script, /npm ci is not required/);
  assert.match(script, /rebuilding is not required/);
});
