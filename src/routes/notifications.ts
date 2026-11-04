import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { createDb } from "../db";
import { notifications, fcmTokens, notificationPreferences } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export const notificationsRoutes = new Hono<AppContext>();

/**
 * Handle notifications actions (GET or POST)
 */
async function handleNotificationRequest(c: any, action: string, data: any) {
  const user = c.get("user")!;
  const db = createDb(c.env.DB);

  // ==========================================
  // 1. REGISTER FCM DEVICE TOKEN
  // ==========================================
  if (action === "register_token") {
    const fcmToken = data.fcm_token || data.token;
    const platform = data.platform || "android";
    const appVersion = data.app_version || "";

    if (!fcmToken) {
      return c.json({ success: false, error: "fcm_token is required" }, 400);
    }

    await db
      .insert(fcmTokens)
      .values({
        clientType: user.provider,
        userId: user.uid,
        fcmToken,
        platform,
        appVersion,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [fcmTokens.clientType, fcmTokens.userId, fcmTokens.fcmToken],
        set: {
          platform,
          appVersion,
          isActive: true,
          lastUsedAt: sql`(datetime('now'))`,
        },
      });

    return c.json({ success: true, message: "FCM token registered" });
  }

  // ==========================================
  // 2. UNREGISTER FCM DEVICE TOKEN (On logout)
  // ==========================================
  if (action === "unregister_token") {
    const fcmToken = data.fcm_token || data.token;
    if (!fcmToken) {
      return c.json({ success: false, error: "fcm_token is required" }, 400);
    }

    await db
      .update(fcmTokens)
      .set({ isActive: false })
      .where(
        and(
          eq(fcmTokens.clientType, user.provider),
          eq(fcmTokens.userId, user.uid),
          eq(fcmTokens.fcmToken, fcmToken)
        )
      );

    return c.json({ success: true, message: "FCM token unregistered" });
  }

  // ==========================================
  // 3. GET NOTIFICATION PREFERENCES
  // ==========================================
  if (action === "get_preferences") {
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.clientType, user.provider),
          eq(notificationPreferences.userId, user.uid)
        )
      )
      .limit(1);

    const prefs = rows[0] || {
      notifyOnReply: true,
      notifyOnVote: true,
      notifyOnMention: true,
      notifyOnCommentDelete: false,
      notifyOnModAction: true,
      notifyOnAnnouncement: true,
    };

    return c.json({
      success: true,
      preferences: {
        notify_on_reply: prefs.notifyOnReply,
        notify_on_vote: prefs.notifyOnVote,
        notify_on_mention: prefs.notifyOnMention,
        notify_on_comment_delete: prefs.notifyOnCommentDelete,
        notify_on_mod_action: prefs.notifyOnModAction,
        notify_on_announcement: prefs.notifyOnAnnouncement,
      },
    });
  }

  // ==========================================
  // 4. UPDATE NOTIFICATION PREFERENCES
  // ==========================================
  if (action === "update_preferences") {
    const updates: Partial<typeof notificationPreferences.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };

    if (data.notify_on_reply !== undefined) updates.notifyOnReply = Boolean(data.notify_on_reply);
    if (data.notify_on_vote !== undefined) updates.notifyOnVote = Boolean(data.notify_on_vote);
    if (data.notify_on_mention !== undefined) updates.notifyOnMention = Boolean(data.notify_on_mention);
    if (data.notify_on_comment_delete !== undefined) updates.notifyOnCommentDelete = Boolean(data.notify_on_comment_delete);
    if (data.notify_on_mod_action !== undefined) updates.notifyOnModAction = Boolean(data.notify_on_mod_action);
    if (data.notify_on_announcement !== undefined) updates.notifyOnAnnouncement = Boolean(data.notify_on_announcement);

    await db
      .insert(notificationPreferences)
      .values({
        clientType: user.provider,
        userId: user.uid,
        ...updates,
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.clientType, notificationPreferences.userId],
        set: updates,
      });

    return c.json({
      success: true,
      message: "Notification preferences updated",
      preferences: updates,
    });
  }

  // ==========================================
  // 5. GET UNREAD COUNT
  // ==========================================
  if (action === "get_unread_count") {
    const unread = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.clientType, user.provider),
          eq(notifications.userId, user.uid),
          eq(notifications.isRead, false)
        )
      );

    return c.json({
      success: true,
      unread_count: unread[0]?.count || 0,
    });
  }

  // ==========================================
  // 6. GET HISTORY
  // ==========================================
  if (action === "get_history" || !action) {
    const page = parseInt(data.page || "1", 10);
    const limit = Math.min(parseInt(data.limit || "30", 10), 50);
    const offset = (page - 1) * limit;

    const list = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.clientType, user.provider),
          eq(notifications.userId, user.uid)
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      success: true,
      page,
      limit,
      notifications: list,
    });
  }

  // ==========================================
  // 7. MARK ONE READ
  // ==========================================
  if (action === "mark_read") {
    const notificationId = parseInt(data.notification_id || data.id, 10);
    if (!notificationId) {
      return c.json({ success: false, error: "notification_id is required" }, 400);
    }

    await db
      .update(notifications)
      .set({ isRead: true, readAt: sql`(datetime('now'))` })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, user.uid)
        )
      );

    return c.json({ success: true, message: "Notification marked as read" });
  }

  // ==========================================
  // 8. MARK ALL READ
  // ==========================================
  if (action === "mark_all_read") {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: sql`(datetime('now'))` })
      .where(
        and(
          eq(notifications.clientType, user.provider),
          eq(notifications.userId, user.uid)
        )
      );

    return c.json({ success: true, message: "All notifications marked as read" });
  }

  return c.json({ success: false, error: `Unknown notifications action: ${action}` }, 400);
}

notificationsRoutes.get("/", requireAuth, async (c) => {
  const action = (c.req.query("action") || "get_history").toLowerCase();
  const queryData = {
    page: c.req.query("page"),
    limit: c.req.query("limit"),
  };
  return handleNotificationRequest(c, action, queryData);
});

notificationsRoutes.post("/", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const action = (body.action || c.req.query("action") || "get_history").toLowerCase();
  return handleNotificationRequest(c, action, body);
});
