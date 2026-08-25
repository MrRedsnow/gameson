CREATE TABLE `assignments` (
	`round_id` text NOT NULL,
	`player_id` text NOT NULL,
	`role` text NOT NULL,
	`word` text NOT NULL,
	PRIMARY KEY(`round_id`, `player_id`)
);
--> statement-breakpoint
CREATE TABLE `custom_pairs` (
	`id` text PRIMARY KEY NOT NULL,
	`lobby_id` text NOT NULL,
	`crew_word` text NOT NULL,
	`imposter_word` text NOT NULL,
	`rating` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_custom_pairs_lobby` ON `custom_pairs` (`lobby_id`);--> statement-breakpoint
CREATE TABLE `lobbies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`host_player_id` text NOT NULL,
	`content_mode` text DEFAULT 'family' NOT NULL,
	`pool` text DEFAULT 'random' NOT NULL,
	`imposter_count` integer DEFAULT 1 NOT NULL,
	`imposter_overridden` integer DEFAULT false NOT NULL,
	`discoverable` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`network_hash` text NOT NULL,
	`round_number` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_lobbies_normalized_name` ON `lobbies` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_lobbies_network_waiting` ON `lobbies` (`network_hash`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`lobby_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`token_hash` text NOT NULL,
	`is_host` integer DEFAULT false NOT NULL,
	`removed` integer DEFAULT false NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_players_token_hash` ON `players` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_players_lobby_name` ON `players` (`lobby_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_players_lobby_active` ON `players` (`lobby_id`,`removed`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`lobby_id` text NOT NULL,
	`number` integer NOT NULL,
	`status` text NOT NULL,
	`crew_word` text NOT NULL,
	`imposter_word` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rounds_lobby_number` ON `rounds` (`lobby_id`,`number`);--> statement-breakpoint
CREATE TABLE `votes` (
	`round_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`round_id`, `voter_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_votes_round_target` ON `votes` (`round_id`,`target_id`);