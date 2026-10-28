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

  // 1. REGISTER FCM DEVICE TOKEN
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

  // 2. GET UNREAD COUNT
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

  // 3. GET HISTORY
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

  // 4. MARK ONE READ
  if (action === "mark_read") {
    const notificationId = parseInt(data.notification_id || data.id, 10);
    if (!notificationId) {
      return c.json({ success: false, error: "notification_id is required" }, 400);
    }

    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, user.uid)
        )
      );

    return c.json({ success: true, message: "Notification marked as read" });
  }

  // 5. MARK ALL READ
  if (action === "mark_all_read") {
    await db
      .update(notifications)
      .set({ isRead: true })
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
