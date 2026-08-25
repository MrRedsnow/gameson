CREATE TABLE `werewolf_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`lobby_id` text NOT NULL,
	`match_number` integer NOT NULL,
	`cycle` integer NOT NULL,
	`phase` text NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text,
	`target2_id` text,
	`payload` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_werewolf_actions_once` ON `werewolf_actions` (`lobby_id`,`match_number`,`cycle`,`phase`,`actor_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_werewolf_actions_phase` ON `werewolf_actions` (`lobby_id`,`match_number`,`cycle`,`phase`);--> statement-breakpoint
CREATE TABLE `werewolf_lobbies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`phase` text DEFAULT 'waiting' NOT NULL,
	`host_player_id` text NOT NULL,
	`wolf_count` integer DEFAULT 1 NOT NULL,
	`selected_roles` text DEFAULT '[]' NOT NULL,
	`mayor_enabled` integer DEFAULT true NOT NULL,
	`mayor_player_id` text,
	`discoverable` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`match_number` integer DEFAULT 0 NOT NULL,
	`night` integer DEFAULT 0 NOT NULL,
	`runoff_round` integer DEFAULT 0 NOT NULL,
	`pending_wolf_victim_id` text,
	`pending_heal_id` text,
	`pending_poison_id` text,
	`pending_hunter_id` text,
	`winner` text,
	`resolution_source` text,
	`reserve_roles` text DEFAULT '[]' NOT NULL,
	`phase_started_at` integer NOT NULL,
	`network_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_werewolf_lobbies_normalized_name` ON `werewolf_lobbies` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_werewolf_lobbies_nearby` ON `werewolf_lobbies` (`network_hash`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `werewolf_players` (
	`id` text PRIMARY KEY NOT NULL,
	`lobby_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`token_hash` text NOT NULL,
	`is_host` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL,
	`alive` integer DEFAULT true NOT NULL,
	`role` text,
	`team` text,
	`revealed` integer DEFAULT false NOT NULL,
	`lover_id` text,
	`role_model_id` text,
	`charmed` integer DEFAULT false NOT NULL,
	`elder_shield` integer DEFAULT false NOT NULL,
	`heal_potion` integer DEFAULT false NOT NULL,
	`poison_potion` integer DEFAULT false NOT NULL,
	`last_protected_id` text,
	`transformed_night` integer,
	`joined_at` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_werewolf_players_token` ON `werewolf_players` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_werewolf_players_lobby_name` ON `werewolf_players` (`lobby_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_werewolf_players_lobby_active` ON `werewolf_players` (`lobby_id`,`removed`);--> statement-breakpoint
CREATE TABLE `werewolf_votes` (
	`lobby_id` text NOT NULL,
	`match_number` integer NOT NULL,
	`cycle` integer NOT NULL,
	`phase` text NOT NULL,
	`voter_id` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`lobby_id`, `match_number`, `cycle`, `phase`, `voter_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_werewolf_votes_phase_target` ON `werewolf_votes` (`lobby_id`,`match_number`,`cycle`,`phase`,`target_id`);