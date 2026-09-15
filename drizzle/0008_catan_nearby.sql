ALTER TABLE `catan_lobbies` ADD `discoverable` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `catan_lobbies` ADD `network_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_catan_lobbies_nearby` ON `catan_lobbies` (`network_hash`,`updated_at`);