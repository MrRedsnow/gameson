CREATE TABLE IF NOT EXISTS `hive_lobbies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`host_player_id` text NOT NULL,
	`members` text DEFAULT '[]' NOT NULL,
	`game` text,
	`discoverable` integer DEFAULT true NOT NULL,
	`network_hash` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_hive_lobbies_name` ON `hive_lobbies` (`normalized_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hive_lobbies_nearby` ON `hive_lobbies` (`network_hash`,`updated_at`);
