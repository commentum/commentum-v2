import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ==========================================
// 1. COMMENTS TABLE (001, 020, 027, 043)
// ==========================================
export const comments = sqliteTable("comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientType: text("client_type").notNull(),
  userId: text("user_id").notNull(),
  mediaId: text("media_id").notNull(),
  content: text("content").notNull(),

  username: text("username").notNull(),
  userAvatar: text("user_avatar"),
  userRole: text("user_role").notNull().default("user"), // user, moderator, admin, super_admin, owner, app_owner
  avatarDecoration: text("avatar_decoration"),
  bannerUrl: text("banner_url"),

  mediaType: text("media_type").notNull().default("anime"), // anime, manga, novel
  mediaTitle: text("media_title").notNull().default(""),
  mediaYear: integer("media_year"),
  mediaPoster: text("media_poster"),
  episode: text("episode"),
  chapter: text("chapter"),

  parentId: integer("parent_id"),

  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  deletedAt: text("deleted_at"),
  deletedBy: text("deleted_by"),

  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  pinnedAt: text("pinned_at"),
  pinnedBy: text("pinned_by"),

  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  lockedAt: text("locked_at"),
  lockedBy: text("locked_by"),

  edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  editedAt: text("edited_at"),
  editCount: integer("edit_count").notNull().default(0),
  editHistory: text("edit_history").default("[]"), // JSON array

  upvotes: integer("upvotes").notNull().default(0),
  downvotes: integer("downvotes").notNull().default(0),
  voteScore: integer("vote_score").notNull().default(0),
  userVotes: text("user_votes").default("{}"), // JSON object user_id -> vote_type

  reported: integer("reported", { mode: "boolean" }).notNull().default(false),
  reportCount: integer("report_count").notNull().default(0),
  reports: text("reports").default("[]"), // JSON array
  reportStatus: text("report_status").notNull().default("none"), // none, pending, reviewed, resolved, dismissed

  tags: text("tags").default("[]"), // JSON array
  tag: integer("tag"), // Split comment tag (043)
  taggedBy: text("tagged_by"),

  userBanned: integer("user_banned", { mode: "boolean" }).notNull().default(false),
  userMutedUntil: text("user_muted_until"),
  userShadowBanned: integer("user_shadow_banned", { mode: "boolean" }).notNull().default(false),
  userWarnings: integer("user_warnings").notNull().default(0),

  moderated: integer("moderated", { mode: "boolean" }).notNull().default(false),
  moderatedAt: text("moderated_at"),
  moderatedBy: text("moderated_by"),
  moderationReason: text("moderation_reason"),
  moderationAction: text("moderation_action"),

  translatedContent: text("translated_content"), // 020
  translations: text("translations").default("{}"), // Cached translations JSON
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_comments_client_user").on(table.clientType, table.userId),
  index("idx_comments_media").on(table.mediaId, table.mediaType),
  index("idx_comments_parent").on(table.parentId),
  index("idx_comments_created").on(table.createdAt),
  index("idx_comments_deleted").on(table.deleted),
  index("idx_comments_role").on(table.userRole),
  index("idx_comments_report_status").on(table.reportStatus),
  index("idx_comments_pinned").on(table.pinned),
  index("idx_comments_locked").on(table.locked),
  index("idx_comments_vote_score").on(table.voteScore),
]);

// ==========================================
// 2. CONFIG TABLE (001)
// ==========================================
export const config = sqliteTable("config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").unique().notNull(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ==========================================
// 3. DISCORD USERS TABLE (002)
// ==========================================
export const discordUsers = sqliteTable("discord_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  discordUserId: text("discord_user_id").unique().notNull(),
  discordUsername: text("discord_username").notNull(),
  discordDiscriminator: text("discord_discriminator"),
  discordAvatar: text("discord_avatar"),

  platformUserId: text("platform_user_id").notNull(),
  platformType: text("platform_type").notNull(), // anilist, myanimelist, simkl, other
  userRole: text("user_role").notNull().default("user"), // user, moderator, admin, super_admin, owner

  isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
  verifiedAt: text("verified_at"),
  registeredAt: text("registered_at").notNull().default(sql`(datetime('now'))`),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  lastCommandAt: text("last_command_at"),
  lastActionAt: text("last_action_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_discord_users_discord_id").on(table.discordUserId),
  index("idx_discord_users_platform").on(table.platformType, table.platformUserId),
  index("idx_discord_users_role").on(table.userRole),
  index("idx_discord_users_active").on(table.isActive),
]);

// ==========================================
// 4. DISCORD NOTIFICATIONS TABLE (002, 008)
// ==========================================
export const discordNotifications = sqliteTable("discord_notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  notificationType: text("notification_type").notNull(), // comment_created, comment_updated, etc.
  targetId: text("target_id"),
  targetType: text("target_type"), // comment, user, media

  commentData: text("comment_data"), // JSON
  userData: text("user_data"),       // JSON
  mediaData: text("media_data"),     // JSON

  webhookUrl: text("webhook_url"),
  messageId: text("message_id"),
  channelId: text("channel_id"),
  guildId: text("guild_id"),
  deliveryStatus: text("delivery_status").notNull().default("pending"), // pending, sent, failed
  deliveryError: text("delivery_error"),
  deliveredAt: text("delivered_at"),

  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: text("next_retry_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_discord_notifs_type").on(table.notificationType),
  index("idx_discord_notifs_status").on(table.deliveryStatus),
  index("idx_discord_notifs_created").on(table.createdAt),
]);

// ==========================================
// 5. SERVER CONFIGS TABLE (004, 008, 013)
// ==========================================
export const serverConfigs = sqliteTable("server_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serverName: text("server_name").unique().notNull(),
  guildId: text("guild_id").unique().notNull(),
  webhookUrl: text("webhook_url"),
  roleId: text("role_id"),
  moderationWebhookUrl: text("moderation_webhook_url"),
  channelId: text("channel_id"),
  moderationChannelId: text("moderation_channel_id"),
  updatesChannelId: text("updates_channel_id"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  settings: text("settings").default("{}"), // JSON
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_server_configs_name").on(table.serverName),
  index("idx_server_configs_guild").on(table.guildId),
  index("idx_server_configs_active").on(table.isActive),
]);

// ==========================================
// 6. COMMENTUM USERS TABLE (006, 021, 027, 035)
// ==========================================
export const commentumUsers = sqliteTable("commentum_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  commentumClientType: text("commentum_client_type").notNull().default("anilist"),
  commentumUserId: text("commentum_user_id").notNull(),
  commentumUsername: text("commentum_username").notNull(),
  commentumUserAvatar: text("commentum_user_avatar"),
  commentumUserRole: text("commentum_user_role").notNull().default("user"), // user, moderator, admin, super_admin, owner, app_owner

  // Moderation
  commentumUserBanned: integer("commentum_user_banned", { mode: "boolean" }).notNull().default(false),
  commentumUserBannedAt: text("commentum_user_banned_at"),
  commentumUserBannedBy: text("commentum_user_banned_by"),
  commentumUserBannedReason: text("commentum_user_banned_reason"),
  commentumUserBannedUntil: text("commentum_user_banned_until"), // 021

  commentumUserMuted: integer("commentum_user_muted", { mode: "boolean" }).notNull().default(false),
  commentumUserMutedUntil: text("commentum_user_muted_until"),
  commentumUserMutedBy: text("commentum_user_muted_by"),
  commentumUserMutedReason: text("commentum_user_muted_reason"),

  commentumUserShadowBanned: integer("commentum_user_shadow_banned", { mode: "boolean" }).notNull().default(false),
  commentumUserShadowBannedAt: text("commentum_user_shadow_banned_at"),
  commentumUserShadowBannedBy: text("commentum_user_shadow_banned_by"),
  commentumUserShadowBannedReason: text("commentum_user_shadow_banned_reason"),
  commentumUserShadowBannedUntil: text("commentum_user_shadow_banned_until"), // 021

  commentumUserWarnings: integer("commentum_user_warnings").notNull().default(0),
  commentumUserWarningDetails: text("commentum_user_warning_details").default("[]"), // JSON
  commentumUserLastWarningAt: text("commentum_user_last_warning_at"),
  commentumUserLastWarningBy: text("commentum_user_last_warning_by"),
  commentumUserLastWarningReason: text("commentum_user_last_warning_reason"),

  // Counters
  commentumUserCommentCount: integer("commentum_user_comment_count").notNull().default(0),
  commentumUserFirstCommentAt: text("commentum_user_first_comment_at"),
  commentumUserLastCommentAt: text("commentum_user_last_comment_at"),
  commentumUserLastCommentId: integer("commentum_user_last_comment_id"),
  commentumUserVoteCount: integer("commentum_user_vote_count").notNull().default(0),
  commentumUserLastVoteAt: text("commentum_user_last_vote_at"),
  commentumUserReportCount: integer("commentum_user_report_count").notNull().default(0),
  commentumUserReportedCount: integer("commentum_user_reported_count").notNull().default(0),
  commentumUserLastReportedAt: text("commentum_user_last_reported_at"),
  commentumUserModeratedCount: integer("commentum_user_moderated_count").notNull().default(0),
  commentumUserModerationHistory: text("commentum_user_moderation_history").default("[]"), // JSON
  commentumUserLastModeratedAt: text("commentum_user_last_moderated_at"),
  commentumUserLastModeratedBy: text("commentum_user_last_moderated_by"),
  commentumUserLastModerationAction: text("commentum_user_last_moderation_action"),
  commentumUserLastModerationReason: text("commentum_user_last_moderation_reason"),

  // System & Status
  commentumUserIpAddresses: text("commentum_user_ip_addresses").default("[]"), // JSON
  commentumUserUserAgents: text("commentum_user_user_agents").default("[]"),   // JSON
  commentumUserNotes: text("commentum_user_notes"),
  commentumUserActive: integer("commentum_user_active", { mode: "boolean" }).notNull().default(true),
  commentumUserVerified: integer("commentum_user_verified", { mode: "boolean" }).notNull().default(false),
  commentumUserPremium: integer("commentum_user_premium", { mode: "boolean" }).notNull().default(false),

  // Customizations (027, 035)
  avatarDecoration: text("avatar_decoration"),
  bannerUrl: text("banner_url"),
  bannerTheme: text("banner_theme"),
  nameplateTheme: text("nameplate_theme"),
  profileEffectUrl: text("profile_effect_url"),
  unlockedCustomizations: text("unlocked_customizations").default("[]"), // JSON array of item IDs

  // Multi-Service Account Linking (027)
  linkedAnilistId: text("linked_anilist_id"),
  linkedAnilistUsername: text("linked_anilist_username"),
  linkedMalId: text("linked_mal_id"),
  linkedMalUsername: text("linked_mal_username"),
  linkedSimklId: text("linked_simkl_id"),
  linkedSimklUsername: text("linked_simkl_username"),

  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("idx_commentum_users_unique").on(table.commentumClientType, table.commentumUserId),
  index("idx_commentum_users_username").on(table.commentumUsername),
  index("idx_commentum_users_role").on(table.commentumUserRole),
  index("idx_commentum_users_linked_al").on(table.linkedAnilistId),
  index("idx_commentum_users_linked_mal").on(table.linkedMalId),
  index("idx_commentum_users_linked_simkl").on(table.linkedSimklId),
]);

// ==========================================
// 7. ANNOUNCEMENTS TABLE (011, 040)
// ==========================================
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appId: text("app_id").notNull().default("anymex"), // anymex, shonenx, animestream
  title: text("title").notNull(),
  shortDescription: text("short_description"),
  fullContent: text("full_content").notNull(), // Markdown

  authorId: text("author_id"),
  authorName: text("author_name"),
  authorAvatar: text("author_avatar"), // 040

  category: text("category").notNull().default("general"), // general, update, bugfix, feature, maintenance, warning
  priority: integer("priority").notNull().default(0),

  targetRoles: text("target_roles").default("[]"),       // JSON array e.g. ['moderator', 'admin']
  targetPlatforms: text("target_platforms").default("[]"), // JSON array e.g. ['anilist', 'mal']

  status: text("status").notNull().default("draft"), // draft, published, archived
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),

  publishedAt: text("published_at"),
  expiresAt: text("expires_at"),
  viewCount: integer("view_count").notNull().default(0),

  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_announcements_app_id").on(table.appId),
  index("idx_announcements_status").on(table.status),
  index("idx_announcements_published").on(table.publishedAt),
]);

// ==========================================
// 8. ANNOUNCEMENT READS TABLE (011)
// ==========================================
export const announcementReads = sqliteTable("announcement_reads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  announcementId: integer("announcement_id").notNull(),
  userId: text("user_id").notNull(),
  appId: text("app_id").notNull(),
  readAt: text("read_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("idx_announcement_reads_unique").on(table.announcementId, table.userId, table.appId),
  index("idx_announcement_reads_user").on(table.userId, table.appId),
]);

// ==========================================
// 9. ANNOUNCEMENT VIEWS TABLE (011)
// ==========================================
export const announcementViews = sqliteTable("announcement_views", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  announcementId: integer("announcement_id").notNull(),
  userId: text("user_id"), // Can be anonymous
  appId: text("app_id").notNull(),
  viewedAt: text("viewed_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_announcement_views_announcement").on(table.announcementId),
]);

// ==========================================
// 10. FCM TOKENS TABLE (014)
// ==========================================
export const fcmTokens = sqliteTable("fcm_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientType: text("client_type").notNull(),
  userId: text("user_id").notNull(),
  fcmToken: text("fcm_token").notNull(),
  deviceInfo: text("device_info"),
  platform: text("platform").notNull().default("android"),
  appVersion: text("app_version"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastUsedAt: text("last_used_at").notNull().default(sql`(datetime('now'))`),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("idx_fcm_tokens_unique").on(table.clientType, table.userId, table.fcmToken),
  index("idx_fcm_tokens_user").on(table.clientType, table.userId, table.isActive),
]);

// ==========================================
// 11. NOTIFICATION PREFERENCES TABLE (014, 025)
// ==========================================
export const notificationPreferences = sqliteTable("notification_preferences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientType: text("client_type").notNull(),
  userId: text("user_id").notNull(),

  notifyOnReply: integer("notify_on_reply", { mode: "boolean" }).notNull().default(true),
  notifyOnVote: integer("notify_on_vote", { mode: "boolean" }).notNull().default(true),
  notifyOnMention: integer("notify_on_mention", { mode: "boolean" }).notNull().default(true),
  notifyOnCommentDelete: integer("notify_on_comment_delete", { mode: "boolean" }).notNull().default(false),
  notifyOnModAction: integer("notify_on_mod_action", { mode: "boolean" }).notNull().default(true),
  notifyOnAnnouncement: integer("notify_on_announcement", { mode: "boolean" }).notNull().default(true), // 025

  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("idx_notif_prefs_unique").on(table.clientType, table.userId),
]);

// ==========================================
// 12. NOTIFICATIONS TABLE (015, 016)
// ==========================================
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(), // Recipient
  clientType: text("client_type").notNull(),
  actorId: text("actor_id"),         // Who initiated action
  actorUsername: text("actor_username"),
  actorAvatar: text("actor_avatar"), // 016
  type: text("type").notNull(),      // reply, mention, vote, badge, system, mod_action
  commentId: integer("comment_id"),
  mediaId: text("media_id"),
  mediaTitle: text("media_title"),
  content: text("content"),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_notifications_user").on(table.clientType, table.userId, table.isRead),
  index("idx_notifications_created").on(table.createdAt),
]);

// ==========================================
// 13. USER POINTS TABLE (018, 044, 047)
// ==========================================
export const userPoints = sqliteTable("user_points", {
  userId: text("user_id").notNull(),
  clientType: text("client_type").notNull().default("anilist"),
  totalPoints: integer("total_points").notNull().default(0),
  realPoints: integer("real_points").notNull().default(0),   // 044
  pointsSpent: integer("points_spent").notNull().default(0), // 044
  pointsBonus: integer("points_bonus").notNull().default(0), // 047
  tier: text("tier").notNull().default("newcomer"),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastActivityDate: text("last_activity_date"), // YYYY-MM-DD
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("idx_user_points_primary").on(table.userId, table.clientType),
  index("idx_user_points_tier").on(table.clientType, table.tier),
  index("idx_user_points_total").on(table.clientType, table.totalPoints),
]);

// ==========================================
// 14. DANTOTSU ID MAPPINGS (023, 039)
// ==========================================
export const dantotsuIdMappings = sqliteTable("dantotsu_id_mappings", {
  dantotsuCommentId: integer("dantotsu_comment_id").primaryKey(),
  commentumId: integer("commentum_id").notNull(),
  mediaId: integer("media_id").notNull(),
  origin: text("origin").notNull().default("dantotsu"), // 039
  syncedAt: text("synced_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_dantotsu_mappings_commentum").on(table.commentumId),
  index("idx_dantotsu_mappings_media").on(table.mediaId),
]);

// ==========================================
// 15. DANTOTSU MEDIA CACHE (023)
// ==========================================
export const dantotsuMediaCache = sqliteTable("dantotsu_media_cache", {
  mediaId: integer("media_id").primaryKey(),
  mediaType: text("media_type").notNull(),
  mediaTitle: text("media_title").notNull(),
  mediaYear: integer("media_year"),
  mediaPoster: text("media_poster"),
  fetchedAt: text("fetched_at").notNull().default(sql`(datetime('now'))`),
});

// ==========================================
// 16. DANTOTSU SYNC META (023)
// ==========================================
export const dantotsuSyncMeta = sqliteTable("dantotsu_sync_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ==========================================
// 17. DANTOTSU MOD TOKENS (025)
// ==========================================
export const dantotsuModTokens = sqliteTable("dantotsu_mod_tokens", {
  userId: text("user_id").primaryKey(),
  username: text("username"),
  anilistToken: text("anilist_token").notNull(),
  dantotsuAuthToken: text("dantotsu_auth_token").notNull(),
  isMod: integer("is_mod", { mode: "boolean" }).notNull().default(true),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  lastVerifiedAt: text("last_verified_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ==========================================
// 18. DASHBOARD STAFF USERS (026)
// ==========================================
export const dashboardUsers = sqliteTable("dashboard_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  role: text("role").notNull().default("moderator"), // owner, super_admin, admin, moderator
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  linkedClientType: text("linked_client_type"), // anilist, myanimelist, simkl
  linkedUserId: text("linked_user_id"),
  linkedUsername: text("linked_username"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_dashboard_users_username").on(table.username),
  index("idx_dashboard_users_role").on(table.role),
  index("idx_dashboard_users_linked").on(table.linkedClientType, table.linkedUserId),
]);

// ==========================================
// 19. DASHBOARD SESSIONS (026)
// ==========================================
export const dashboardSessions = sqliteTable("dashboard_sessions", {
  id: text("id").primaryKey(), // UUID string
  token: text("token").unique().notNull(),
  userId: integer("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_dashboard_sessions_token").on(table.token),
  index("idx_dashboard_sessions_user").on(table.userId),
  index("idx_dashboard_sessions_expires").on(table.expiresAt),
]);

// ==========================================
// 20. MEDIA ID MAP (034 - Cross-client merging)
// ==========================================
export const mediaIdMap = sqliteTable("media_id_map", {
  clientType: text("client_type").notNull(), // anilist, mal, simkl
  mediaId: text("media_id").notNull(),
  mapKey: text("map_key").notNull(),         // e.g. 'anime:mal:21'
  mediaType: text("media_type").notNull().default("anime"), // anime, manga
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("idx_media_id_map_primary").on(table.clientType, table.mediaId),
  index("idx_media_id_map_key").on(table.mapKey),
]);

// ==========================================
// 21. CUSTOMIZATIONS CATALOG (035 - Discord frames, banners, effects)
// ==========================================
export const customizationsCatalog = sqliteTable("customizations_catalog", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // decoration, banner, nameplate, effect, frame
  title: text("title").notNull(),
  category: text("category").notNull(),
  url: text("url").notNull(),
  assetId: text("asset_id"),
  description: text("description"),
  metadata: text("metadata").notNull().default("{}"), // JSON
  pointsRequired: integer("points_required").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("idx_customizations_type_active").on(table.type, table.isActive),
  index("idx_customizations_category").on(table.category),
  index("idx_customizations_points").on(table.pointsRequired),
]);

// ==========================================
// 22. USER AD REWARDS (047 - AdMob claims deduplication)
// ==========================================
export const userAdRewards = sqliteTable("user_ad_rewards", {
  id: text("id").primaryKey(), // UUID string
  userId: text("user_id").notNull(),
  clientType: text("client_type").notNull(),
  masterUserId: integer("master_user_id"),
  adId: text("ad_id").notNull(),
  points: integer("points").notNull().default(10),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("idx_ad_rewards_ad_id").on(table.adId),
  index("idx_ad_rewards_user").on(table.clientType, table.userId),
  index("idx_ad_rewards_master").on(table.masterUserId),
]);
