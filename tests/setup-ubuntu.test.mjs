import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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

test("migriert aus einem gesperrten Arbeitsverzeichnis und erhält vorhandene Lobbys", { timeout: 60_000, skip: process.platform === "win32" }, async (t) => {
  const migration = script.match(/^migrate_local_database\(\) \([\s\S]*?^\)/m)?.[0];
  assert.ok(migration, "migration helper must exist");
  assert.match(script, /^migrate_local_database$/m);
  const directory = await mkdtemp(join(tmpdir(), "gameson-migration-"));
  const app = join(directory, "app");
  const data = join(directory, "data");
  const caller = join(directory, "private-caller");
  await mkdir(caller);
  t.after(async () => {
    await chmod(caller, 0o700);
    await rm(directory, { recursive: true, force: true });
  });
  for (const path of [join(app, "dist/server"), join(app, "node_modules/.bin"), join(app, "drizzle"), join(data, "tmp")]) {
    await mkdir(path, { recursive: true });
  }
  await symlink(fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url)), join(app, "node_modules/.bin/wrangler"));
  await copyFile(new URL("../drizzle/0007_catan.sql", import.meta.url), join(app, "drizzle/0007_catan.sql"));
  await writeFile(join(app, "dist/server/wrangler.json"), JSON.stringify({
    name: "gameson-migration-test",
    compatibility_date: "2026-05-15",
    d1_databases: [{ binding: "DB", database_name: "gameson-test", database_id: "00000000-0000-4000-8000-000000000000" }],
  }));
  // Exercise the actual helper and Wrangler/SQLite without requiring root in
  // the test runner. The closed caller directory models runuser inheriting /root.
  // Only the identity switch is replaced; paths, permissions and D1 are real.
  const shell = `set -Eeuo pipefail
runuser() {
  [[ $1 == -u && $2 == "$APP_USER" && $3 == -- ]]
  pwd -P > "$DATA_DIR/migration-cwd"
  shift 3
  "$@"
}
${migration}
trap 'chmod 700 "$PRIVATE_CALLER"' EXIT
chmod 000 "$PRIVATE_CALLER"
migrate_local_database
`;
  const options = {
    cwd: caller,
    timeout: 25_000,
    env: { ...process.env, APP_DIR: app, APP_USER: "gameson-test", DATA_DIR: data, SERVICE_TMP_DIR: join(data, "tmp"), PRIVATE_CALLER: caller },
  };
  await promisify(execFile)("bash", ["-c", shell], options);
  assert.equal((await readFile(join(data, "migration-cwd"), "utf8")).trim(), await realpath(app));
  const storage = join(data, "v3/d1/miniflare-D1DatabaseObject");
  const databases = (await readdir(storage)).filter((name) => {
    if (!name.endsWith(".sqlite")) return false;
    const candidate = new DatabaseSync(join(storage, name));
    try {
      return Boolean(candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'catan_lobbies'").get());
    } finally {
      candidate.close();
    }
  });
  assert.equal(databases.length, 1, "migration must use the configured persistent database");
  const databasePath = join(storage, databases[0]);
  let db = new DatabaseSync(databasePath);
  try {
    db.exec("CREATE TABLE existing_lobbies (id TEXT PRIMARY KEY); INSERT INTO existing_lobbies VALUES ('keep-me')");
    db.exec("INSERT INTO catan_lobbies (id, name, normalized_name, host_player_id, created_at, updated_at) VALUES ('CATAN1', 'Catan', 'catan', 'host', 1, 1)");
  } finally {
    db.close();
  }
  await promisify(execFile)("bash", ["-c", shell], options);
  db = new DatabaseSync(databasePath);
  try {
    assert.equal(db.prepare("SELECT id FROM existing_lobbies").get().id, "keep-me");
    const lobby = db.prepare("SELECT id, target_points FROM catan_lobbies").get();
    assert.equal(lobby.id, "CATAN1");
    assert.equal(lobby.target_points, 12);
  } finally {
    db.close();
  }
});
