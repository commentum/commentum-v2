CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`window_start` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window_start`)
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limits_window` ON `rate_limits` (`window_start`);--> statement-breakpoint
CREATE TABLE `user_point_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`client_type` text NOT NULL,
	`user_id` text NOT NULL,
	`points` integer NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_user_point_adj_user` ON `user_point_adjustments` (`client_type`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_user_point_adj_reason` ON `user_point_adjustments` (`reason`);--> statement-breakpoint
CREATE TABLE `user_point_spends` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_type` text NOT NULL,
	`master_user_id` integer,
	`points` integer NOT NULL,
	`ref_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_point_spends_ref` ON `user_point_spends` (`ref_id`);--> statement-breakpoint
CREATE INDEX `idx_user_point_spends_user` ON `user_point_spends` (`client_type`,`user_id`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `title` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `body` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `metadata` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `notifications` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `moderator_id` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `moderator_username` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `click_action` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `read_at` text;