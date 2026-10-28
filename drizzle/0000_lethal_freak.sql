CREATE TABLE `announcement_reads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`announcement_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`app_id` text NOT NULL,
	`read_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_announcement_reads_unique` ON `announcement_reads` (`announcement_id`,`user_id`,`app_id`);--> statement-breakpoint
CREATE INDEX `idx_announcement_reads_user` ON `announcement_reads` (`user_id`,`app_id`);--> statement-breakpoint
CREATE TABLE `announcement_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`announcement_id` integer NOT NULL,
	`user_id` text,
	`app_id` text NOT NULL,
	`viewed_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_announcement_views_announcement` ON `announcement_views` (`announcement_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` text DEFAULT 'anymex' NOT NULL,
	`title` text NOT NULL,
	`short_description` text,
	`full_content` text NOT NULL,
	`author_id` text,
	`author_name` text,
	`author_avatar` text,
	`category` text DEFAULT 'general' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`target_roles` text DEFAULT '[]',
	`target_platforms` text DEFAULT '[]',
	`status` text DEFAULT 'draft' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`published_at` text,
	`expires_at` text,
	`view_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_announcements_app_id` ON `announcements` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_announcements_status` ON `announcements` (`status`);--> statement-breakpoint
CREATE INDEX `idx_announcements_published` ON `announcements` (`published_at`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_type` text NOT NULL,
	`user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`content` text NOT NULL,
	`username` text NOT NULL,
	`user_avatar` text,
	`user_role` text DEFAULT 'user' NOT NULL,
	`avatar_decoration` text,
	`banner_url` text,
	`media_type` text DEFAULT 'anime' NOT NULL,
	`media_title` text DEFAULT '' NOT NULL,
	`media_year` integer,
	`media_poster` text,
	`episode` text,
	`chapter` text,
	`parent_id` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`pinned` integer DEFAULT false NOT NULL,
	`pinned_at` text,
	`pinned_by` text,
	`locked` integer DEFAULT false NOT NULL,
	`locked_at` text,
	`locked_by` text,
	`edited` integer DEFAULT false NOT NULL,
	`edited_at` text,
	`edit_count` integer DEFAULT 0 NOT NULL,
	`edit_history` text DEFAULT '[]',
	`upvotes` integer DEFAULT 0 NOT NULL,
	`downvotes` integer DEFAULT 0 NOT NULL,
	`vote_score` integer DEFAULT 0 NOT NULL,
	`user_votes` text DEFAULT '{}',
	`reported` integer DEFAULT false NOT NULL,
	`report_count` integer DEFAULT 0 NOT NULL,
	`reports` text DEFAULT '[]',
	`report_status` text DEFAULT 'none' NOT NULL,
	`tags` text DEFAULT '[]',
	`tag` integer,
	`tagged_by` text,
	`user_banned` integer DEFAULT false NOT NULL,
	`user_muted_until` text,
	`user_shadow_banned` integer DEFAULT false NOT NULL,
	`user_warnings` integer DEFAULT 0 NOT NULL,
	`moderated` integer DEFAULT false NOT NULL,
	`moderated_at` text,
	`moderated_by` text,
	`moderation_reason` text,
	`moderation_action` text,
	`translated_content` text,
	`translations` text DEFAULT '{}',
	`ip_address` text,
	`user_agent` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_comments_client_user` ON `comments` (`client_type`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_comments_media` ON `comments` (`media_id`,`media_type`);--> statement-breakpoint
CREATE INDEX `idx_comments_parent` ON `comments` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_comments_created` ON `comments` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_comments_deleted` ON `comments` (`deleted`);--> statement-breakpoint
CREATE INDEX `idx_comments_role` ON `comments` (`user_role`);--> statement-breakpoint
CREATE INDEX `idx_comments_report_status` ON `comments` (`report_status`);--> statement-breakpoint
CREATE INDEX `idx_comments_pinned` ON `comments` (`pinned`);--> statement-breakpoint
CREATE INDEX `idx_comments_locked` ON `comments` (`locked`);--> statement-breakpoint
CREATE INDEX `idx_comments_vote_score` ON `comments` (`vote_score`);--> statement-breakpoint
CREATE TABLE `commentum_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`commentum_client_type` text DEFAULT 'anilist' NOT NULL,
	`commentum_user_id` text NOT NULL,
	`commentum_username` text NOT NULL,
	`commentum_user_avatar` text,
	`commentum_user_role` text DEFAULT 'user' NOT NULL,
	`commentum_user_banned` integer DEFAULT false NOT NULL,
	`commentum_user_banned_at` text,
	`commentum_user_banned_by` text,
	`commentum_user_banned_reason` text,
	`commentum_user_banned_until` text,
	`commentum_user_muted` integer DEFAULT false NOT NULL,
	`commentum_user_muted_until` text,
	`commentum_user_muted_by` text,
	`commentum_user_muted_reason` text,
	`commentum_user_shadow_banned` integer DEFAULT false NOT NULL,
	`commentum_user_shadow_banned_at` text,
	`commentum_user_shadow_banned_by` text,
	`commentum_user_shadow_banned_reason` text,
	`commentum_user_shadow_banned_until` text,
	`commentum_user_warnings` integer DEFAULT 0 NOT NULL,
	`commentum_user_warning_details` text DEFAULT '[]',
	`commentum_user_last_warning_at` text,
	`commentum_user_last_warning_by` text,
	`commentum_user_last_warning_reason` text,
	`commentum_user_comment_count` integer DEFAULT 0 NOT NULL,
	`commentum_user_first_comment_at` text,
	`commentum_user_last_comment_at` text,
	`commentum_user_last_comment_id` integer,
	`commentum_user_vote_count` integer DEFAULT 0 NOT NULL,
	`commentum_user_last_vote_at` text,
	`commentum_user_report_count` integer DEFAULT 0 NOT NULL,
	`commentum_user_reported_count` integer DEFAULT 0 NOT NULL,
	`commentum_user_last_reported_at` text,
	`commentum_user_moderated_count` integer DEFAULT 0 NOT NULL,
	`commentum_user_moderation_history` text DEFAULT '[]',
	`commentum_user_last_moderated_at` text,
	`commentum_user_last_moderated_by` text,
	`commentum_user_last_moderation_action` text,
	`commentum_user_last_moderation_reason` text,
	`commentum_user_ip_addresses` text DEFAULT '[]',
	`commentum_user_user_agents` text DEFAULT '[]',
	`commentum_user_notes` text,
	`commentum_user_active` integer DEFAULT true NOT NULL,
	`commentum_user_verified` integer DEFAULT false NOT NULL,
	`commentum_user_premium` integer DEFAULT false NOT NULL,
	`avatar_decoration` text,
	`banner_url` text,
	`banner_theme` text,
	`nameplate_theme` text,
	`profile_effect_url` text,
	`unlocked_customizations` text DEFAULT '[]',
	`linked_anilist_id` text,
	`linked_anilist_username` text,
	`linked_mal_id` text,
	`linked_mal_username` text,
	`linked_simkl_id` text,
	`linked_simkl_username` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commentum_users_unique` ON `commentum_users` (`commentum_client_type`,`commentum_user_id`);--> statement-breakpoint
CREATE INDEX `idx_commentum_users_username` ON `commentum_users` (`commentum_username`);--> statement-breakpoint
CREATE INDEX `idx_commentum_users_role` ON `commentum_users` (`commentum_user_role`);--> statement-breakpoint
CREATE INDEX `idx_commentum_users_linked_al` ON `commentum_users` (`linked_anilist_id`);--> statement-breakpoint
CREATE INDEX `idx_commentum_users_linked_mal` ON `commentum_users` (`linked_mal_id`);--> statement-breakpoint
CREATE INDEX `idx_commentum_users_linked_simkl` ON `commentum_users` (`linked_simkl_id`);--> statement-breakpoint
CREATE TABLE `config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `config_key_unique` ON `config` (`key`);--> statement-breakpoint
CREATE TABLE `customizations_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`url` text NOT NULL,
	`asset_id` text,
	`description` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`points_required` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_customizations_type_active` ON `customizations_catalog` (`type`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_customizations_category` ON `customizations_catalog` (`category`);--> statement-breakpoint
CREATE INDEX `idx_customizations_points` ON `customizations_catalog` (`points_required`);--> statement-breakpoint
CREATE TABLE `dantotsu_id_mappings` (
	`dantotsu_comment_id` integer PRIMARY KEY NOT NULL,
	`commentum_id` integer NOT NULL,
	`media_id` integer NOT NULL,
	`origin` text DEFAULT 'dantotsu' NOT NULL,
	`synced_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dantotsu_mappings_commentum` ON `dantotsu_id_mappings` (`commentum_id`);--> statement-breakpoint
CREATE INDEX `idx_dantotsu_mappings_media` ON `dantotsu_id_mappings` (`media_id`);--> statement-breakpoint
CREATE TABLE `dantotsu_media_cache` (
	`media_id` integer PRIMARY KEY NOT NULL,
	`media_type` text NOT NULL,
	`media_title` text NOT NULL,
	`media_year` integer,
	`media_poster` text,
	`fetched_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dantotsu_mod_tokens` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text,
	`anilist_token` text NOT NULL,
	`dantotsu_auth_token` text NOT NULL,
	`is_mod` integer DEFAULT true NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`last_verified_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dantotsu_sync_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_sessions_token_unique` ON `dashboard_sessions` (`token`);--> statement-breakpoint
CREATE INDEX `idx_dashboard_sessions_token` ON `dashboard_sessions` (`token`);--> statement-breakpoint
CREATE INDEX `idx_dashboard_sessions_user` ON `dashboard_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_dashboard_sessions_expires` ON `dashboard_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `dashboard_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`role` text DEFAULT 'moderator' NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`linked_client_type` text,
	`linked_user_id` text,
	`linked_username` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_users_username_unique` ON `dashboard_users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_dashboard_users_username` ON `dashboard_users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_dashboard_users_role` ON `dashboard_users` (`role`);--> statement-breakpoint
CREATE INDEX `idx_dashboard_users_linked` ON `dashboard_users` (`linked_client_type`,`linked_user_id`);--> statement-breakpoint
CREATE TABLE `discord_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notification_type` text NOT NULL,
	`target_id` text,
	`target_type` text,
	`comment_data` text,
	`user_data` text,
	`media_data` text,
	`webhook_url` text,
	`message_id` text,
	`channel_id` text,
	`guild_id` text,
	`delivery_status` text DEFAULT 'pending' NOT NULL,
	`delivery_error` text,
	`delivered_at` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_discord_notifs_type` ON `discord_notifications` (`notification_type`);--> statement-breakpoint
CREATE INDEX `idx_discord_notifs_status` ON `discord_notifications` (`delivery_status`);--> statement-breakpoint
CREATE INDEX `idx_discord_notifs_created` ON `discord_notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `discord_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`discord_user_id` text NOT NULL,
	`discord_username` text NOT NULL,
	`discord_discriminator` text,
	`discord_avatar` text,
	`platform_user_id` text NOT NULL,
	`platform_type` text NOT NULL,
	`user_role` text DEFAULT 'user' NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`verified_at` text,
	`registered_at` text DEFAULT (datetime('now')) NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_command_at` text,
	`last_action_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_users_discord_user_id_unique` ON `discord_users` (`discord_user_id`);--> statement-breakpoint
CREATE INDEX `idx_discord_users_discord_id` ON `discord_users` (`discord_user_id`);--> statement-breakpoint
CREATE INDEX `idx_discord_users_platform` ON `discord_users` (`platform_type`,`platform_user_id`);--> statement-breakpoint
CREATE INDEX `idx_discord_users_role` ON `discord_users` (`user_role`);--> statement-breakpoint
CREATE INDEX `idx_discord_users_active` ON `discord_users` (`is_active`);--> statement-breakpoint
CREATE TABLE `fcm_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_type` text NOT NULL,
	`user_id` text NOT NULL,
	`fcm_token` text NOT NULL,
	`device_info` text,
	`platform` text DEFAULT 'android' NOT NULL,
	`app_version` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_used_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fcm_tokens_unique` ON `fcm_tokens` (`client_type`,`user_id`,`fcm_token`);--> statement-breakpoint
CREATE INDEX `idx_fcm_tokens_user` ON `fcm_tokens` (`client_type`,`user_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `media_id_map` (
	`client_type` text NOT NULL,
	`media_id` text NOT NULL,
	`map_key` text NOT NULL,
	`media_type` text DEFAULT 'anime' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_id_map_primary` ON `media_id_map` (`client_type`,`media_id`);--> statement-breakpoint
CREATE INDEX `idx_media_id_map_key` ON `media_id_map` (`map_key`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_type` text NOT NULL,
	`user_id` text NOT NULL,
	`notify_on_reply` integer DEFAULT true NOT NULL,
	`notify_on_vote` integer DEFAULT true NOT NULL,
	`notify_on_mention` integer DEFAULT true NOT NULL,
	`notify_on_comment_delete` integer DEFAULT false NOT NULL,
	`notify_on_mod_action` integer DEFAULT true NOT NULL,
	`notify_on_announcement` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notif_prefs_unique` ON `notification_preferences` (`client_type`,`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`client_type` text NOT NULL,
	`actor_id` text,
	`actor_username` text,
	`actor_avatar` text,
	`type` text NOT NULL,
	`comment_id` integer,
	`media_id` text,
	`media_title` text,
	`content` text,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user` ON `notifications` (`client_type`,`user_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `idx_notifications_created` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `server_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_name` text NOT NULL,
	`guild_id` text NOT NULL,
	`webhook_url` text,
	`role_id` text,
	`moderation_webhook_url` text,
	`channel_id` text,
	`moderation_channel_id` text,
	`updates_channel_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`settings` text DEFAULT '{}',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_configs_server_name_unique` ON `server_configs` (`server_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `server_configs_guild_id_unique` ON `server_configs` (`guild_id`);--> statement-breakpoint
CREATE INDEX `idx_server_configs_name` ON `server_configs` (`server_name`);--> statement-breakpoint
CREATE INDEX `idx_server_configs_guild` ON `server_configs` (`guild_id`);--> statement-breakpoint
CREATE INDEX `idx_server_configs_active` ON `server_configs` (`is_active`);--> statement-breakpoint
CREATE TABLE `user_ad_rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_type` text NOT NULL,
	`master_user_id` integer,
	`ad_id` text NOT NULL,
	`points` integer DEFAULT 10 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ad_rewards_ad_id` ON `user_ad_rewards` (`ad_id`);--> statement-breakpoint
CREATE INDEX `idx_ad_rewards_user` ON `user_ad_rewards` (`client_type`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ad_rewards_master` ON `user_ad_rewards` (`master_user_id`);--> statement-breakpoint
CREATE TABLE `user_points` (
	`user_id` text NOT NULL,
	`client_type` text DEFAULT 'anilist' NOT NULL,
	`total_points` integer DEFAULT 0 NOT NULL,
	`real_points` integer DEFAULT 0 NOT NULL,
	`points_spent` integer DEFAULT 0 NOT NULL,
	`points_bonus` integer DEFAULT 0 NOT NULL,
	`tier` text DEFAULT 'newcomer' NOT NULL,
	`current_streak` integer DEFAULT 0 NOT NULL,
	`longest_streak` integer DEFAULT 0 NOT NULL,
	`last_activity_date` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_points_primary` ON `user_points` (`user_id`,`client_type`);--> statement-breakpoint
CREATE INDEX `idx_user_points_tier` ON `user_points` (`client_type`,`tier`);--> statement-breakpoint
CREATE INDEX `idx_user_points_total` ON `user_points` (`client_type`,`total_points`);