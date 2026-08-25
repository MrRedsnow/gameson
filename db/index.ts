import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let initialization: Promise<void> | null = null;

export function getD1(): D1Database {
  if (!env.DB) throw new Error("Die Spieldatenbank ist momentan nicht erreichbar.");
  return env.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

export async function ensureSchema() {
  if (initialization) return initialization;
  const db = getD1();
  initialization = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS lobbies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT DEFAULT 'waiting' NOT NULL, host_player_id TEXT NOT NULL, content_mode TEXT DEFAULT 'family' NOT NULL, pool TEXT DEFAULT 'random' NOT NULL, imposter_count INTEGER DEFAULT 1 NOT NULL, imposter_overridden INTEGER DEFAULT 0 NOT NULL, discoverable INTEGER DEFAULT 1 NOT NULL, revision INTEGER DEFAULT 1 NOT NULL, network_hash TEXT NOT NULL, round_number INTEGER DEFAULT 0 NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_lobbies_normalized_name ON lobbies (normalized_name)`,
      `CREATE INDEX IF NOT EXISTS idx_lobbies_network_waiting ON lobbies (network_hash, status, updated_at)`,
      `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY NOT NULL, lobby_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, token_hash TEXT NOT NULL, is_host INTEGER DEFAULT 0 NOT NULL, removed INTEGER DEFAULT 0 NOT NULL, joined_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_players_token_hash ON players (token_hash)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_players_lobby_name ON players (lobby_id, normalized_name)`,
      `CREATE INDEX IF NOT EXISTS idx_players_lobby_active ON players (lobby_id, removed)`,
      `CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY NOT NULL, lobby_id TEXT NOT NULL, number INTEGER NOT NULL, status TEXT NOT NULL, crew_word TEXT NOT NULL, imposter_word TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_rounds_lobby_number ON rounds (lobby_id, number)`,
      `CREATE TABLE IF NOT EXISTS assignments (round_id TEXT NOT NULL, player_id TEXT NOT NULL, role TEXT NOT NULL, word TEXT NOT NULL, PRIMARY KEY (round_id, player_id))`,
      `CREATE TABLE IF NOT EXISTS votes (round_id TEXT NOT NULL, voter_id TEXT NOT NULL, target_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (round_id, voter_id))`,
      `CREATE INDEX IF NOT EXISTS idx_votes_round_target ON votes (round_id, target_id)`,
      `CREATE TABLE IF NOT EXISTS custom_pairs (id TEXT PRIMARY KEY NOT NULL, lobby_id TEXT NOT NULL, crew_word TEXT NOT NULL, imposter_word TEXT NOT NULL, rating TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_custom_pairs_lobby ON custom_pairs (lobby_id)`,
      `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
    ];
    await db.batch(statements.map((statement) => db.prepare(statement)));
    await db.prepare("PRAGMA optimize").run();
  })().catch((error) => { initialization = null; throw error; });
  return initialization;
}
