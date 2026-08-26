import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const lobbies = sqliteTable("lobbies", {
  id: text("id").primaryKey(), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(),
  status: text("status", { enum: ["waiting", "revealing", "voting", "results"] }).notNull().default("waiting"),
  hostPlayerId: text("host_player_id").notNull(), contentMode: text("content_mode", { enum: ["family", "adult"] }).notNull().default("family"),
  pool: text("pool").notNull().default("random"), imposterCount: integer("imposter_count").notNull().default(1),
  imposterOverridden: integer("imposter_overridden", { mode: "boolean" }).notNull().default(false), discoverable: integer("discoverable", { mode: "boolean" }).notNull().default(true),
  revision: integer("revision").notNull().default(1), networkHash: text("network_hash").notNull(), roundNumber: integer("round_number").notNull().default(0),
  finishedAt: integer("finished_at"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("idx_lobbies_normalized_name").on(t.normalizedName), index("idx_lobbies_network_waiting").on(t.networkHash, t.status, t.updatedAt)]);

export const players = sqliteTable("players", {
  id: text("id").primaryKey(), lobbyId: text("lobby_id").notNull(), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(),
  tokenHash: text("token_hash").notNull(), isHost: integer("is_host", { mode: "boolean" }).notNull().default(false), removed: integer("removed", { mode: "boolean" }).notNull().default(false),
  joinedAt: integer("joined_at").notNull(), lastSeen: integer("last_seen").notNull(),
}, (t) => [uniqueIndex("idx_players_token_hash").on(t.tokenHash), uniqueIndex("idx_players_lobby_name").on(t.lobbyId, t.normalizedName), index("idx_players_lobby_active").on(t.lobbyId, t.removed)]);

export const rounds = sqliteTable("rounds", {
  id: text("id").primaryKey(), lobbyId: text("lobby_id").notNull(), number: integer("number").notNull(),
  status: text("status", { enum: ["revealing", "voting", "results"] }).notNull(), crewWord: text("crew_word").notNull(), imposterWord: text("imposter_word").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("idx_rounds_lobby_number").on(t.lobbyId, t.number)]);

export const assignments = sqliteTable("assignments", {
  roundId: text("round_id").notNull(), playerId: text("player_id").notNull(), role: text("role", { enum: ["crew", "imposter"] }).notNull(), word: text("word").notNull(),
}, (t) => [primaryKey({ columns: [t.roundId, t.playerId] })]);

export const votes = sqliteTable("votes", {
  roundId: text("round_id").notNull(), voterId: text("voter_id").notNull(), targetId: text("target_id").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.roundId, t.voterId] }), index("idx_votes_round_target").on(t.roundId, t.targetId)]);

export const customPairs = sqliteTable("custom_pairs", {
  id: text("id").primaryKey(), lobbyId: text("lobby_id").notNull(), crewWord: text("crew_word").notNull(), imposterWord: text("imposter_word").notNull(),
  rating: text("rating", { enum: ["family", "adult"] }).notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [index("idx_custom_pairs_lobby").on(t.lobbyId)]);

export const rateLimits = sqliteTable("rate_limits", { key: text("key").primaryKey(), count: integer("count").notNull(), expiresAt: integer("expires_at").notNull() });

export const werewolfLobbies = sqliteTable("werewolf_lobbies", {
  id: text("id").primaryKey(), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(),
  status: text("status", { enum: ["waiting", "playing", "results"] }).notNull().default("waiting"), phase: text("phase").notNull().default("waiting"),
  hostPlayerId: text("host_player_id").notNull(), wolfCount: integer("wolf_count").notNull().default(1), selectedRoles: text("selected_roles").notNull().default("[]"),
  mayorEnabled: integer("mayor_enabled", { mode: "boolean" }).notNull().default(true), mayorPlayerId: text("mayor_player_id"), discoverable: integer("discoverable", { mode: "boolean" }).notNull().default(true), audioMode: text("audio_mode", { enum: ["all", "host"] }).notNull().default("all"), audioGapSeconds: integer("audio_gap_seconds").notNull().default(3),
  revision: integer("revision").notNull().default(1), matchNumber: integer("match_number").notNull().default(0), night: integer("night").notNull().default(0), runoffRound: integer("runoff_round").notNull().default(0),
  pendingWolfVictimId: text("pending_wolf_victim_id"), pendingHealId: text("pending_heal_id"), pendingPoisonId: text("pending_poison_id"), pendingHunterId: text("pending_hunter_id"), winner: text("winner"), resolutionSource: text("resolution_source"),
  reserveRoles: text("reserve_roles").notNull().default("[]"), phaseStartedAt: integer("phase_started_at").notNull(), networkHash: text("network_hash").notNull(),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [uniqueIndex("idx_werewolf_lobbies_normalized_name").on(t.normalizedName), index("idx_werewolf_lobbies_nearby").on(t.networkHash, t.status, t.updatedAt)]);

export const werewolfPlayers = sqliteTable("werewolf_players", {
  id: text("id").primaryKey(), lobbyId: text("lobby_id").notNull(), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(), tokenHash: text("token_hash").notNull(),
  isHost: integer("is_host", { mode: "boolean" }).notNull().default(false), removed: integer("removed", { mode: "boolean" }).notNull().default(false), alive: integer("alive", { mode: "boolean" }).notNull().default(true),
  role: text("role"), team: text("team"), revealed: integer("revealed", { mode: "boolean" }).notNull().default(false), loverId: text("lover_id"), roleModelId: text("role_model_id"), charmed: integer("charmed", { mode: "boolean" }).notNull().default(false),
  elderShield: integer("elder_shield", { mode: "boolean" }).notNull().default(false), healPotion: integer("heal_potion", { mode: "boolean" }).notNull().default(false), poisonPotion: integer("poison_potion", { mode: "boolean" }).notNull().default(false),
  lastProtectedId: text("last_protected_id"), transformedNight: integer("transformed_night"), deathCauses: text("death_causes").notNull().default("[]"), deathMatchNumber: integer("death_match_number"), deathCycle: integer("death_cycle"), deathSource: text("death_source", { enum: ["night", "day"] }),
  joinedAt: integer("joined_at").notNull(), lastSeen: integer("last_seen").notNull(),
}, (t) => [uniqueIndex("idx_werewolf_players_token").on(t.tokenHash), uniqueIndex("idx_werewolf_players_lobby_name").on(t.lobbyId, t.normalizedName), index("idx_werewolf_players_lobby_active").on(t.lobbyId, t.removed)]);

export const werewolfActions = sqliteTable("werewolf_actions", {
  id: text("id").primaryKey(), lobbyId: text("lobby_id").notNull(), matchNumber: integer("match_number").notNull(), cycle: integer("cycle").notNull(), phase: text("phase").notNull(),
  actorId: text("actor_id").notNull(), kind: text("kind").notNull(), targetId: text("target_id"), target2Id: text("target2_id"), payload: text("payload"), createdAt: integer("created_at").notNull(),
}, (t) => [uniqueIndex("idx_werewolf_actions_once").on(t.lobbyId, t.matchNumber, t.cycle, t.phase, t.actorId, t.kind), index("idx_werewolf_actions_phase").on(t.lobbyId, t.matchNumber, t.cycle, t.phase)]);

export const werewolfVotes = sqliteTable("werewolf_votes", {
  lobbyId: text("lobby_id").notNull(), matchNumber: integer("match_number").notNull(), cycle: integer("cycle").notNull(), phase: text("phase").notNull(), voterId: text("voter_id").notNull(), targetId: text("target_id").notNull(), weight: integer("weight").notNull().default(1), createdAt: integer("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.lobbyId, t.matchNumber, t.cycle, t.phase, t.voterId] }), index("idx_werewolf_votes_phase_target").on(t.lobbyId, t.matchNumber, t.cycle, t.phase, t.targetId)]);
