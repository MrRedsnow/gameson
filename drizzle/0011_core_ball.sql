CREATE TABLE IF NOT EXISTS `core_ball_lobbies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`host_player_id` text NOT NULL,
	`settings` text NOT NULL,
	`members` text DEFAULT '[]' NOT NULL,
	`game` text,
	`discoverable` integer DEFAULT true NOT NULL,
	`network_hash` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_core_ball_lobbies_name` ON `core_ball_lobbies` (`normalized_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_core_ball_lobbies_nearby` ON `core_ball_lobbies` (`network_hash`,`updated_at`);
