import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { isModeratorOrHigher, isAdminOrHigher } from "../shared/roles";
import { createDb } from "../db";
import { comments, commentumUsers } from "../db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { queueDiscordNotification } from "../shared/discord";
import { queueFcmNotification } from "../shared/fcm";

export const moderationRoutes = new Hono<AppContext>();

/**
 * GET /moderation/queue
 * Paginated moderation queue with status filter (flagged, pending, rejected, approved)
 */
moderationRoutes.get("/queue", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (!isModeratorOrHigher(user.role)) {
    return c.json({ success: false, error: "Moderator permissions required" }, 403);
  }

  const status = c.req.query("status") || "flagged";
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);
  const offset = (page - 1) * limit;

  const db = createDb(c.env.DB);

  let whereClause = eq(comments.reported, true);
  if (status === "pending") {
    whereClause = eq(comments.reportStatus, "pending");
  } else if (status === "rejected") {
    whereClause = eq(comments.reportStatus, "rejected");
  } else if (status === "approved") {
    whereClause = eq(comments.reportStatus, "approved");
  }

  const queue = await db
    .select()
    .from(comments)
    .where(whereClause)
    .orderBy(desc(comments.reportCount), desc(comments.createdAt))
    .limit(limit)
    .offset(offset);

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(comments)
    .where(whereClause);

  return c.json({
    success: true,
    page,
    limit,
    total: total[0]?.count || 0,
    items: queue,
  });
});

/**
 * POST /moderation
 * Moderation actions: pin_comment, unpin_comment, lock_thread, unlock_thread,
 * warn_user, unwarn_user, mute_user, unmute_user, shadowban_user, unshadowban_user,
 * ban_user, unban_user
 */
moderationRoutes.post("/", requireAuth, async (c) => {
  try {
    const user = c.get("user")!;
    if (!isModeratorOrHigher(user.role)) {
      return c.json({ success: false, error: "Moderator permissions required" }, 403);
    }

    const body = await c.req.json();
    const action = (body.action || "").toLowerCase();
    const db = createDb(c.env.DB);

    // ==========================================
    // PIN / UNPIN COMMENT
    // ==========================================
    if (action === "pin_comment" || action === "unpin_comment") {
      const commentId = parseInt(body.comment_id, 10);
      const isPin = action === "pin_comment";

      const commentRows = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      const targetComment = commentRows[0];

      await db
        .update(comments)
        .set({
          pinned: isPin,
          pinnedAt: isPin ? sql`(datetime('now'))` : null,
          pinnedBy: isPin ? user.uid : null,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(comments.id, commentId));

      queueDiscordNotification(
        {
          type: isPin ? "comment_pinned" : "comment_unpinned",
          comment: { id: commentId },
          moderator: { id: user.uid, username: user.username },
        },
        c.env
      );

      if (targetComment) {
        queueFcmNotification(c, {
          type: isPin ? "comment_pinned" : "comment_unpinned",
          targetUserId: targetComment.userId,
          targetClientType: targetComment.clientType,
          comment: { id: commentId, media_id: targetComment.mediaId },
          moderator: { id: user.uid, username: user.username },
        });
      }

      return c.json({ success: true, message: isPin ? "Comment pinned" : "Comment unpinned" });
    }

    // ==========================================
    // LOCK / UNLOCK THREAD
    // ==========================================
    if (action === "lock_thread" || action === "unlock_thread") {
      const commentId = parseInt(body.comment_id, 10);
      const isLock = action === "lock_thread";

      const commentRows = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      const targetComment = commentRows[0];

      await db
        .update(comments)
        .set({
          locked: isLock,
          lockedAt: isLock ? sql`(datetime('now'))` : null,
          lockedBy: isLock ? user.uid : null,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(comments.id, commentId));

      queueDiscordNotification(
        {
          type: isLock ? "comment_locked" : "comment_unlocked",
          comment: { id: commentId },
          moderator: { id: user.uid, username: user.username },
        },
        c.env
      );

      if (targetComment) {
        queueFcmNotification(c, {
          type: isLock ? "comment_locked" : "comment_unlocked",
          targetUserId: targetComment.userId,
          targetClientType: targetComment.clientType,
          comment: { id: commentId, media_id: targetComment.mediaId },
          moderator: { id: user.uid, username: user.username },
        });
      }

      return c.json({ success: true, message: isLock ? "Thread locked" : "Thread unlocked" });
    }

    // ==========================================
    // WARN USER
    // ==========================================
    if (action === "warn_user") {
      const targetUserId = String(body.target_user_id || body.user_id || "");
      const clientType = (body.client_type || "anilist").toLowerCase();
      const reason = body.reason || "Violated community rules";

      const targetUsers = await db
        .select()
        .from(commentumUsers)
        .where(
          and(
            eq(commentumUsers.commentumClientType, clientType),
            eq(commentumUsers.commentumUserId, targetUserId)
          )
        )
        .limit(1);

      const targetUser = targetUsers[0];
      if (!targetUser) {
        return c.json({ success: false, error: "Target user not found" }, 404);
      }

      const warnings = JSON.parse(targetUser.commentumUserWarningDetails || "[]");
      warnings.push({
        warned_by: user.uid,
        reason,
        warned_at: new Date().toISOString(),
      });

      const modHistory = JSON.parse(targetUser.commentumUserModerationHistory || "[]");
      modHistory.push({
        action: "warn",
        moderator: user.username,
        reason,
        timestamp: new Date().toISOString(),
      });

      const newWarningCount = targetUser.commentumUserWarnings + 1;

      // Auto-escalation: 3 warnings -> mute 24h, 5 warnings -> ban
      let autoMute = false;
      let autoBan = false;
      let mutedUntil: string | null = null;

      if (newWarningCount >= 5) {
        autoBan = true;
      } else if (newWarningCount >= 3) {
        autoMute = true;
        mutedUntil = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      }

      await db
        .update(commentumUsers)
        .set({
          commentumUserWarnings: newWarningCount,
          commentumUserWarningDetails: JSON.stringify(warnings),
          commentumUserLastWarningAt: sql`(datetime('now'))`,
          commentumUserLastWarningBy: user.uid,
          commentumUserLastWarningReason: reason,
          commentumUserModerationHistory: JSON.stringify(modHistory),
          commentumUserMuted: autoMute ? true : targetUser.commentumUserMuted,
          commentumUserMutedUntil: autoMute ? mutedUntil : targetUser.commentumUserMutedUntil,
          commentumUserBanned: autoBan ? true : targetUser.commentumUserBanned,
          commentumUserBannedReason: autoBan ? "Auto-banned: exceeded warning limit" : targetUser.commentumUserBannedReason,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(commentumUsers.id, targetUser.id));

      // Cascade warnings count to user's comments
      await db
        .update(comments)
        .set({
          userWarnings: newWarningCount,
          userBanned: autoBan ? true : undefined,
          userMutedUntil: autoMute ? mutedUntil : undefined,
        })
        .where(
          and(
            eq(comments.clientType, clientType),
            eq(comments.userId, targetUserId)
          )
        );

      queueDiscordNotification(
        {
          type: "user_warned",
          user: { id: targetUserId, username: targetUser.commentumUsername },
          moderator: { id: user.uid, username: user.username },
          reason,
        },
        c.env
      );

      queueFcmNotification(c, {
        type: "user_warned",
        targetUserId,
        targetClientType: clientType,
        moderator: { id: user.uid, username: user.username },
        reason,
      });

      return c.json({
        success: true,
        message: "Warning issued successfully",
        warnings_count: newWarningCount,
        auto_muted: autoMute,
        auto_banned: autoBan,
      });
    }

    // ==========================================
    // UNWARN USER
    // ==========================================
    if (action === "unwarn_user") {
      const targetUserId = String(body.target_user_id || body.user_id || "");
      const clientType = (body.client_type || "anilist").toLowerCase();

      const targetUsers = await db
        .select()
        .from(commentumUsers)
        .where(
          and(
            eq(commentumUsers.commentumClientType, clientType),
            eq(commentumUsers.commentumUserId, targetUserId)
          )
        )
        .limit(1);

      const targetUser = targetUsers[0];
      if (!targetUser) {
        return c.json({ success: false, error: "Target user not found" }, 404);
      }

      const warnings = JSON.parse(targetUser.commentumUserWarningDetails || "[]");
      if (warnings.length > 0) warnings.pop();
      const newWarningCount = Math.max(0, targetUser.commentumUserWarnings - 1);

      await db
        .update(commentumUsers)
        .set({
          commentumUserWarnings: newWarningCount,
          commentumUserWarningDetails: JSON.stringify(warnings),
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(commentumUsers.id, targetUser.id));

      await db
        .update(comments)
        .set({ userWarnings: newWarningCount })
        .where(
          and(
            eq(comments.clientType, clientType),
            eq(comments.userId, targetUserId)
          )
        );

      queueDiscordNotification(
        {
          type: "user_unwarned",
          user: { id: targetUserId, username: targetUser.commentumUsername },
          moderator: { id: user.uid, username: user.username },
        },
        c.env
      );

      queueFcmNotification(c, {
        type: "user_unwarned",
        targetUserId,
        targetClientType: clientType,
        moderator: { id: user.uid, username: user.username },
      });

      return c.json({ success: true, message: "Warning removed", warnings_count: newWarningCount });
    }

    // ==========================================
    // MUTE / UNMUTE USER
    // ==========================================
    if (action === "mute_user" || action === "unmute_user") {
      const targetUserId = String(body.target_user_id || body.user_id || "");
      const clientType = (body.client_type || "anilist").toLowerCase();
      const isMute = action === "mute_user";
      const reason = body.reason || "";
      const until = body.muted_until || (isMute ? new Date(Date.now() + 24 * 3600 * 1000).toISOString() : null);

      await db
        .update(commentumUsers)
        .set({
          commentumUserMuted: isMute,
          commentumUserMutedUntil: isMute ? until : null,
          commentumUserMutedBy: isMute ? user.uid : null,
          commentumUserMutedReason: isMute ? reason : null,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(
          and(
            eq(commentumUsers.commentumClientType, clientType),
            eq(commentumUsers.commentumUserId, targetUserId)
          )
        );

      await db
        .update(comments)
        .set({ userMutedUntil: isMute ? until : null })
        .where(
          and(
            eq(comments.clientType, clientType),
            eq(comments.userId, targetUserId)
          )
        );

      queueDiscordNotification(
        {
          type: isMute ? "user_muted" : "user_unmuted",
          user: { id: targetUserId },
          moderator: { id: user.uid, username: user.username },
          reason,
        },
        c.env
      );

      queueFcmNotification(c, {
        type: isMute ? "user_muted" : "user_unmuted",
        targetUserId,
        targetClientType: clientType,
        moderator: { id: user.uid, username: user.username },
        reason,
        duration: isMute ? "24 hours" : undefined,
      });

      return c.json({ success: true, message: isMute ? "User muted" : "User unmuted", until });
    }

    // ==========================================
    // SHADOWBAN / UNSHADOWBAN USER (Admin+)
    // ==========================================
    if (action === "shadowban_user" || action === "unshadowban_user") {
      if (!isAdminOrHigher(user.role)) {
        return c.json({ success: false, error: "Admin permissions required" }, 403);
      }

      const targetUserId = String(body.target_user_id || body.user_id || "");
      const clientType = (body.client_type || "anilist").toLowerCase();
      const isShadow = action === "shadowban_user";
      const reason = body.reason || "Shadowbanned by admin";

      await db
        .update(commentumUsers)
        .set({
          commentumUserShadowBanned: isShadow,
          commentumUserShadowBannedAt: isShadow ? sql`(datetime('now'))` : null,
          commentumUserShadowBannedBy: isShadow ? user.uid : null,
          commentumUserShadowBannedReason: isShadow ? reason : null,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(
          and(
            eq(commentumUsers.commentumClientType, clientType),
            eq(commentumUsers.commentumUserId, targetUserId)
          )
        );

      await db
        .update(comments)
        .set({ userShadowBanned: isShadow })
        .where(
          and(
            eq(comments.clientType, clientType),
            eq(comments.userId, targetUserId)
          )
        );

      queueDiscordNotification(
        {
          type: isShadow ? "user_shadow_banned" : "user_unshadow_banned",
          user: { id: targetUserId },
          moderator: { id: user.uid, username: user.username },
          reason,
        },
        c.env
      );

      queueFcmNotification(c, {
        type: isShadow ? "user_shadow_banned" : "user_unshadow_banned",
        targetUserId,
        targetClientType: clientType,
        moderator: { id: user.uid, username: user.username },
        reason,
      });

      return c.json({ success: true, message: isShadow ? "User shadowbanned" : "User unshadowbanned" });
    }

    // ==========================================
    // BAN / UNBAN USER (Admin+)
    // ==========================================
    if (action === "ban_user" || action === "unban_user") {
      if (!isAdminOrHigher(user.role)) {
        return c.json({ success: false, error: "Admin permissions required to ban/unban" }, 403);
      }

      const targetUserId = String(body.target_user_id || body.user_id || "");
      const clientType = (body.client_type || "anilist").toLowerCase();
      const isBan = action === "ban_user";
      const reason = body.reason || "Banned by admin";

      await db
        .update(commentumUsers)
        .set({
          commentumUserBanned: isBan,
          commentumUserBannedAt: isBan ? sql`(datetime('now'))` : null,
          commentumUserBannedBy: isBan ? user.uid : null,
          commentumUserBannedReason: isBan ? reason : null,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(
          and(
            eq(commentumUsers.commentumClientType, clientType),
            eq(commentumUsers.commentumUserId, targetUserId)
          )
        );

      await db
        .update(comments)
        .set({ userBanned: isBan })
        .where(
          and(
            eq(comments.clientType, clientType),
            eq(comments.userId, targetUserId)
          )
        );

      queueDiscordNotification(
        {
          type: isBan ? "user_banned" : "user_unbanned",
          user: { id: targetUserId },
          moderator: { id: user.uid, username: user.username },
          reason,
        },
        c.env
      );

      queueFcmNotification(c, {
        type: isBan ? "user_banned" : "user_unbanned",
        targetUserId,
        targetClientType: clientType,
        moderator: { id: user.uid, username: user.username },
        reason,
        duration: isBan ? "Permanent" : undefined,
      });

      return c.json({ success: true, message: isBan ? "User banned" : "User unbanned" });
    }

    return c.json({ success: false, error: `Unknown moderation action: ${action}` }, 400);
  } catch (error: any) {
    console.error("POST /moderation error:", error);
    return c.json({ success: false, error: error?.message || "Internal server error" }, 500);
  }
});
