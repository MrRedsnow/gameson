ALTER TABLE `werewolf_players` ADD `death_causes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `werewolf_players` ADD `death_match_number` integer;--> statement-breakpoint
ALTER TABLE `werewolf_players` ADD `death_cycle` integer;--> statement-breakpoint
ALTER TABLE `werewolf_players` ADD `death_source` text;