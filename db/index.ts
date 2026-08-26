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
      `CREATE TABLE IF NOT EXISTS lobbies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT DEFAULT 'waiting' NOT NULL, host_player_id TEXT NOT NULL, content_mode TEXT DEFAULT 'family' NOT NULL, pool TEXT DEFAULT 'random' NOT NULL, imposter_count INTEGER DEFAULT 1 NOT NULL, imposter_overridden INTEGER DEFAULT 0 NOT NULL, discoverable INTEGER DEFAULT 1 NOT NULL, revision INTEGER DEFAULT 1 NOT NULL, network_hash TEXT NOT NULL, round_number INTEGER DEFAULT 0 NOT NULL, finished_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
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
      `CREATE TABLE IF NOT EXISTS werewolf_lobbies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, status TEXT DEFAULT 'waiting' NOT NULL, phase TEXT DEFAULT 'waiting' NOT NULL, host_player_id TEXT NOT NULL, wolf_count INTEGER DEFAULT 1 NOT NULL, selected_roles TEXT DEFAULT '[]' NOT NULL, mayor_enabled INTEGER DEFAULT 1 NOT NULL, mayor_player_id TEXT, discoverable INTEGER DEFAULT 1 NOT NULL, audio_mode TEXT DEFAULT 'all' NOT NULL, audio_gap_seconds INTEGER DEFAULT 3 NOT NULL, revision INTEGER DEFAULT 1 NOT NULL, match_number INTEGER DEFAULT 0 NOT NULL, night INTEGER DEFAULT 0 NOT NULL, runoff_round INTEGER DEFAULT 0 NOT NULL, pending_wolf_victim_id TEXT, pending_heal_id TEXT, pending_poison_id TEXT, pending_hunter_id TEXT, winner TEXT, resolution_source TEXT, reserve_roles TEXT DEFAULT '[]' NOT NULL, phase_started_at INTEGER NOT NULL, network_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_werewolf_lobbies_normalized_name ON werewolf_lobbies (normalized_name)`,
      `CREATE INDEX IF NOT EXISTS idx_werewolf_lobbies_nearby ON werewolf_lobbies (network_hash, status, updated_at)`,
      `CREATE TABLE IF NOT EXISTS werewolf_players (id TEXT PRIMARY KEY NOT NULL, lobby_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL, token_hash TEXT NOT NULL, is_host INTEGER DEFAULT 0 NOT NULL, removed INTEGER DEFAULT 0 NOT NULL, alive INTEGER DEFAULT 1 NOT NULL, role TEXT, team TEXT, revealed INTEGER DEFAULT 0 NOT NULL, lover_id TEXT, role_model_id TEXT, charmed INTEGER DEFAULT 0 NOT NULL, elder_shield INTEGER DEFAULT 0 NOT NULL, heal_potion INTEGER DEFAULT 0 NOT NULL, poison_potion INTEGER DEFAULT 0 NOT NULL, last_protected_id TEXT, transformed_night INTEGER, death_causes TEXT DEFAULT '[]' NOT NULL, death_match_number INTEGER, death_cycle INTEGER, death_source TEXT, joined_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_werewolf_players_token ON werewolf_players (token_hash)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_werewolf_players_lobby_name ON werewolf_players (lobby_id, normalized_name)`,
      `CREATE INDEX IF NOT EXISTS idx_werewolf_players_lobby_active ON werewolf_players (lobby_id, removed)`,
      `CREATE TABLE IF NOT EXISTS werewolf_actions (id TEXT PRIMARY KEY NOT NULL, lobby_id TEXT NOT NULL, match_number INTEGER NOT NULL, cycle INTEGER NOT NULL, phase TEXT NOT NULL, actor_id TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT, target2_id TEXT, payload TEXT, created_at INTEGER NOT NULL)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_werewolf_actions_once ON werewolf_actions (lobby_id, match_number, cycle, phase, actor_id, kind)`,
      `CREATE INDEX IF NOT EXISTS idx_werewolf_actions_phase ON werewolf_actions (lobby_id, match_number, cycle, phase)`,
      `CREATE TABLE IF NOT EXISTS werewolf_votes (lobby_id TEXT NOT NULL, match_number INTEGER NOT NULL, cycle INTEGER NOT NULL, phase TEXT NOT NULL, voter_id TEXT NOT NULL, target_id TEXT NOT NULL, weight INTEGER DEFAULT 1 NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (lobby_id, match_number, cycle, phase, voter_id))`,
      `CREATE INDEX IF NOT EXISTS idx_werewolf_votes_phase_target ON werewolf_votes (lobby_id, match_number, cycle, phase, target_id)`,
    ];
    await db.batch(statements.map((statement) => db.prepare(statement)));
    const lobbyColumns = await db.prepare("PRAGMA table_info(lobbies)").all<{ name: string }>();
    const existingLobbyColumns = new Set((lobbyColumns.results ?? []).map((column) => column.name));
    if (!existingLobbyColumns.has("finished_at")) {
      await db.prepare("ALTER TABLE lobbies ADD COLUMN finished_at INTEGER").run();
    }
    const werewolfColumns = await db.prepare("PRAGMA table_info(werewolf_lobbies)").all<{ name: string }>();
    const existingWerewolfColumns = new Set((werewolfColumns.results ?? []).map((column) => column.name));
    const additiveWerewolfColumns = [
      ["pending_hunter_id", "ALTER TABLE werewolf_lobbies ADD COLUMN pending_hunter_id TEXT"],
      ["resolution_source", "ALTER TABLE werewolf_lobbies ADD COLUMN resolution_source TEXT"],
      ["audio_mode", "ALTER TABLE werewolf_lobbies ADD COLUMN audio_mode TEXT DEFAULT 'all' NOT NULL"],
      ["audio_gap_seconds", "ALTER TABLE werewolf_lobbies ADD COLUMN audio_gap_seconds INTEGER DEFAULT 3 NOT NULL"],
    ] as const;
    const missingWerewolfColumns = additiveWerewolfColumns.filter(([name]) => !existingWerewolfColumns.has(name));
    if (missingWerewolfColumns.length) await db.batch(missingWerewolfColumns.map(([, statement]) => db.prepare(statement)));
    const werewolfPlayerColumns = await db.prepare("PRAGMA table_info(werewolf_players)").all<{ name: string }>();
    const existingWerewolfPlayerColumns = new Set((werewolfPlayerColumns.results ?? []).map((column) => column.name));
    const additiveWerewolfPlayerColumns = [
      ["death_causes", "ALTER TABLE werewolf_players ADD COLUMN death_causes TEXT DEFAULT '[]' NOT NULL"],
      ["death_match_number", "ALTER TABLE werewolf_players ADD COLUMN death_match_number INTEGER"],
      ["death_cycle", "ALTER TABLE werewolf_players ADD COLUMN death_cycle INTEGER"],
      ["death_source", "ALTER TABLE werewolf_players ADD COLUMN death_source TEXT"],
    ] as const;
    const missingWerewolfPlayerColumns = additiveWerewolfPlayerColumns.filter(([name]) => !existingWerewolfPlayerColumns.has(name));
    if (missingWerewolfPlayerColumns.length) await db.batch(missingWerewolfPlayerColumns.map(([, statement]) => db.prepare(statement)));
    const werewolfVoteColumns = await db.prepare("PRAGMA table_info(werewolf_votes)").all<{ name: string }>();
    if (!(werewolfVoteColumns.results ?? []).some((column) => column.name === "weight")) {
      await db.prepare("ALTER TABLE werewolf_votes ADD COLUMN weight INTEGER DEFAULT 1 NOT NULL").run();
    }
    await db.prepare("PRAGMA optimize").run();
  })().catch((error) => { initialization = null; throw error; });
  return initialization;
}
