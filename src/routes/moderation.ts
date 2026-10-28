import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { isModeratorOrHigher, isAdminOrHigher } from "../shared/roles";
import { createDb } from "../db";
import { comments, commentumUsers } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";

export const moderationRoutes = new Hono<AppContext>();

/**
 * POST /moderation
 * Moderation actions (pin, unpin, lock, unlock, warn, mute, ban)
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

      await db
        .update(comments)
        .set({
          pinned: isPin,
          pinnedAt: isPin ? sql`(datetime('now'))` : null,
          pinnedBy: isPin ? user.uid : null,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(comments.id, commentId));

      return c.json({ success: true, message: isPin ? "Comment pinned" : "Comment unpinned" });
    }

    // ==========================================
    // LOCK / UNLOCK THREAD
    // ==========================================
    if (action === "lock_thread" || action === "unlock_thread") {
      const commentId = parseInt(body.comment_id, 10);
      const isLock = action === "lock_thread";

      await db
        .update(comments)
        .set({
          locked: isLock,
          lockedAt: isLock ? sql`(datetime('now'))` : null,
          lockedBy: isLock ? user.uid : null,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(comments.id, commentId));

      return c.json({ success: true, message: isLock ? "Thread locked" : "Thread unlocked" });
    }

    // ==========================================
    // WARN USER
    // ==========================================
    if (action === "warn_user") {
      const targetUserId = String(body.target_user_id || body.user_id || "");
      const clientType = body.client_type || "anilist";
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

      await db
        .update(commentumUsers)
        .set({
          commentumUserWarnings: targetUser.commentumUserWarnings + 1,
          commentumUserWarningDetails: JSON.stringify(warnings),
          commentumUserLastWarningAt: sql`(datetime('now'))`,
          commentumUserLastWarningBy: user.uid,
          commentumUserLastWarningReason: reason,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(commentumUsers.id, targetUser.id));

      return c.json({ success: true, message: "Warning issued successfully" });
    }

    // ==========================================
    // MUTE / UNMUTE USER
    // ==========================================
    if (action === "mute_user" || action === "unmute_user") {
      const targetUserId = String(body.target_user_id || body.user_id || "");
      const clientType = body.client_type || "anilist";
      const isMute = action === "mute_user";
      const reason = body.reason || "";
      const until = body.muted_until || null;

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

      return c.json({ success: true, message: isMute ? "User muted" : "User unmuted" });
    }

    // ==========================================
    // BAN / UNBAN USER (Admin+)
    // ==========================================
    if (action === "ban_user" || action === "unban_user") {
      if (!isAdminOrHigher(user.role)) {
        return c.json({ success: false, error: "Admin permissions required to ban/unban" }, 403);
      }

      const targetUserId = String(body.target_user_id || body.user_id || "");
      const clientType = body.client_type || "anilist";
      const isBan = action === "ban_user";
      const reason = body.reason || "";

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

      return c.json({ success: true, message: isBan ? "User banned" : "User unbanned" });
    }

    return c.json({ success: false, error: `Unknown moderation action: ${action}` }, 400);
  } catch (error: any) {
    console.error("POST /moderation error:", error);
    return c.json({ success: false, error: error?.message || "Internal server error" }, 500);
  }
});
