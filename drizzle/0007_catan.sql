CREATE TABLE IF NOT EXISTS `catan_lobbies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`host_player_id` text NOT NULL,
	`target_points` integer DEFAULT 12 NOT NULL,
	`members` text DEFAULT '[]' NOT NULL,
	`game` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_catan_lobbies_name` ON `catan_lobbies` (`normalized_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_catan_lobbies_updated` ON `catan_lobbies` (`updated_at`);
