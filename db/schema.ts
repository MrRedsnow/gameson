import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const lobbies = sqliteTable("lobbies", {
  id: text("id").primaryKey(), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(),
  status: text("status", { enum: ["waiting", "revealing", "voting", "results"] }).notNull().default("waiting"),
  hostPlayerId: text("host_player_id").notNull(), contentMode: text("content_mode", { enum: ["family", "adult"] }).notNull().default("family"),
  pool: text("pool").notNull().default("random"), imposterCount: integer("imposter_count").notNull().default(1),
  imposterOverridden: integer("imposter_overridden", { mode: "boolean" }).notNull().default(false), discoverable: integer("discoverable", { mode: "boolean" }).notNull().default(true),
  revision: integer("revision").notNull().default(1), networkHash: text("network_hash").notNull(), roundNumber: integer("round_number").notNull().default(0),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
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
