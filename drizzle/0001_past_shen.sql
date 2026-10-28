CREATE TABLE `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` text NOT NULL,
	`client_type` text DEFAULT 'anilist' NOT NULL,
	`map_key` text,
	`title` text NOT NULL,
	`type` text DEFAULT 'anime' NOT NULL,
	`year` integer,
	`poster` text,
	`anilist_id` text,
	`mal_id` text,
	`simkl_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_client_id` ON `media` (`client_type`,`media_id`);--> statement-breakpoint
CREATE INDEX `idx_media_map_key` ON `media` (`map_key`);--> statement-breakpoint
CREATE INDEX `idx_media_title` ON `media` (`title`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media_id_map` (
	`client_type` text NOT NULL,
	`media_id` text NOT NULL,
	`map_key` text NOT NULL,
	`media_type` text DEFAULT 'anime' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`client_type`, `media_id`)
);
--> statement-breakpoint
INSERT INTO `__new_media_id_map`("client_type", "media_id", "map_key", "media_type", "updated_at") SELECT "client_type", "media_id", "map_key", "media_type", "updated_at" FROM `media_id_map`;--> statement-breakpoint
DROP TABLE `media_id_map`;--> statement-breakpoint
ALTER TABLE `__new_media_id_map` RENAME TO `media_id_map`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_media_id_map_key` ON `media_id_map` (`map_key`);--> statement-breakpoint
DROP INDEX `idx_comments_media`;--> statement-breakpoint
CREATE INDEX `idx_comments_media` ON `comments` (`media_id`);--> statement-breakpoint
ALTER TABLE `comments` DROP COLUMN `media_type`;--> statement-breakpoint
ALTER TABLE `comments` DROP COLUMN `media_title`;--> statement-breakpoint
ALTER TABLE `comments` DROP COLUMN `media_year`;--> statement-breakpoint
ALTER TABLE `comments` DROP COLUMN `media_poster`;--> statement-breakpoint
ALTER TABLE `comments` DROP COLUMN `episode`;--> statement-breakpoint
ALTER TABLE `comments` DROP COLUMN `chapter`;