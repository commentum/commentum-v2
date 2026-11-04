import { Hono } from "hono";
import { AppContext } from "../types/env";
import { optionalAuth, requireAuth } from "../middleware/auth";
import { isAdminOrHigher } from "../shared/roles";
import { createDb } from "../db";
import { announcements, announcementReads, announcementViews, notifications, commentumUsers } from "../db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { queueDiscordNotification } from "../shared/discord";
import { renderAnnouncementDashboard } from "../shared/dashboardHtml";
import {
  getDashboardUsers,
  getDashboardUserByUsername,
  saveDashboardUser,
  deleteDashboardUser,
  createSession,
  getSession,
  revokeSession,
  hashPassword,
  verifyPassword,
  syncCommentumRole,
  checkStaffAuth,
  extractStaffToken,
  DashboardUser,
} from "../shared/staffAuth";
import { queueFcmNotification } from "../shared/fcm";

export const announcementsRoutes = new Hono<AppContext>();

// ==========================================
// 1. WEB DASHBOARD (HTML UI)
// ==========================================

announcementsRoutes.get("/dashboard", (c) => {
  return c.html(renderAnnouncementDashboard(), 200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
});

announcementsRoutes.get("/admin", (c) => {
  return c.html(renderAnnouncementDashboard(), 200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  });
});

// ==========================================
// 2. AUTH ROUTES (Announcement Studio)
// ==========================================

announcementsRoutes.get("/auth/status", async (c) => {
  const users = await getDashboardUsers(c.env.DB);
  const needsSetup = users.length === 0;

  const token = extractStaffToken(c);
  let session = null;
  if (token) {
    session = await getSession(c.env.DB, token);
  }

  return c.json({
    needs_setup: needsSetup,
    authenticated: !!session,
    user: session ? {
      id: session.user_id,
      username: session.username,
      role: session.role,
      display_name: session.display_name,
      avatar_url: session.avatar_url,
      linked_client_type: session.linked_client_type,
      linked_user_id: session.linked_user_id,
    } : null,
  });
});

announcementsRoutes.post("/auth/setup", async (c) => {
  const users = await getDashboardUsers(c.env.DB);
  if (users.length > 0) {
    return c.json({ error: "Master account has already been initialized" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const {
    username = "Sheby",
    password,
    display_name = "Sheby",
    linked_client_type = "anilist",
    linked_user_id = "5724017",
  } = body;

  if (!password || password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400);
  }

  const { hash, salt } = await hashPassword(password);
  const masterUser = await saveDashboardUser(c.env.DB, {
    username: username.trim(),
    password_hash: hash,
    salt,
    role: "owner",
    display_name: display_name.trim(),
    linked_client_type,
    linked_user_id: String(linked_user_id),
    linked_username: display_name.trim(),
    is_active: true,
  });

  if (linked_user_id) {
    await syncCommentumRole(c.env.DB, "owner", String(linked_user_id));
  }

  const token = await createSession(c.env.DB, masterUser);

  return c.json({
    success: true,
    message: "Master Owner account initialized successfully",
    token,
    user: {
      id: masterUser.id,
      username: masterUser.username,
      role: masterUser.role,
      display_name: masterUser.display_name,
      avatar_url: masterUser.avatar_url,
      linked_client_type: masterUser.linked_client_type,
      linked_user_id: masterUser.linked_user_id,
    },
  }, 201);
});

announcementsRoutes.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, password } = body;

  if (!username || !password) {
    return c.json({ error: "Username and password are required" }, 400);
  }

  const user = await getDashboardUserByUsername(c.env.DB, username);
  if (!user || !user.is_active) {
    return c.json({ error: "Invalid username or password" }, 401);
  }

  const matches = await verifyPassword(password, user.password_hash, user.salt);
  if (!matches) {
    return c.json({ error: "Invalid username or password" }, 401);
  }

  await saveDashboardUser(c.env.DB, { id: user.id, last_login_at: new Date().toISOString() });
  const token = await createSession(c.env.DB, user);

  return c.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name || user.username,
      avatar_url: user.avatar_url,
      linked_client_type: user.linked_client_type,
      linked_user_id: user.linked_user_id,
    },
  });
});

announcementsRoutes.post("/auth/logout", async (c) => {
  const token = extractStaffToken(c);
  if (token) {
    await revokeSession(c.env.DB, token);
  }
  return c.json({ success: true, message: "Logged out successfully" });
});

announcementsRoutes.get("/auth/me", async (c) => {
  const token = extractStaffToken(c);
  if (!token) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  const session = await getSession(c.env.DB, token);
  if (!session) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
  return c.json({ success: true, user: session });
});

announcementsRoutes.post("/auth/change-password", async (c) => {
  const token = extractStaffToken(c);
  if (!token) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  const session = await getSession(c.env.DB, token);
  if (!session) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const { current_password, new_password } = body;

  if (!current_password || !new_password) {
    return c.json({ error: "Current password and new password are required" }, 400);
  }
  if (new_password.length < 6) {
    return c.json({ error: "New password must be at least 6 characters" }, 400);
  }

  const users = await getDashboardUsers(c.env.DB);
  const user = users.find((u) => u.id === session.user_id);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const matches = await verifyPassword(current_password, user.password_hash, user.salt);
  if (!matches) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }

  const { hash, salt } = await hashPassword(new_password);
  await saveDashboardUser(c.env.DB, {
    id: user.id,
    password_hash: hash,
    salt,
  });

  return c.json({ success: true, message: "Password changed successfully" });
});

announcementsRoutes.patch("/auth/profile", async (c) => {
  const token = extractStaffToken(c);
  if (!token) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  const session = await getSession(c.env.DB, token);
  if (!session) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const { display_name, avatar_url } = body;

  const updatePayload: Partial<DashboardUser> = { id: session.user_id };
  if (display_name !== undefined) updatePayload.display_name = display_name.trim();
  if (avatar_url !== undefined) updatePayload.avatar_url = avatar_url.trim();

  const updated = await saveDashboardUser(c.env.DB, updatePayload);
  return c.json({
    success: true,
    user: {
      id: updated.id,
      username: updated.username,
      display_name: updated.display_name,
      avatar_url: updated.avatar_url,
      role: updated.role,
    },
  });
});

// ==========================================
// 3. STAFF MANAGEMENT ROUTES
// ==========================================

announcementsRoutes.get("/staff", async (c) => {
  const auth = await checkStaffAuth(c, "super_admin");
  if (!auth.success) {
    return c.json({ error: auth.error || "Super Admin or Owner permissions required" }, 403);
  }

  const users = await getDashboardUsers(c.env.DB);
  const safeStaff = users.map(({ password_hash: _1, salt: _2, ...rest }) => rest);
  return c.json({ success: true, staff: safeStaff });
});

announcementsRoutes.post("/staff", async (c) => {
  const auth = await checkStaffAuth(c, "super_admin");
  if (!auth.success) {
    return c.json({ error: auth.error || "Super Admin or Owner permissions required" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const {
    username,
    password,
    role = "moderator",
    display_name,
    avatar_url,
    linked_client_type,
    linked_user_id,
    linked_username,
  } = body;

  if (!username || !password) {
    return c.json({ error: "Username and password are required" }, 400);
  }

  if (password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400);
  }

  if ((role === "owner" || role === "super_admin") && auth.user?.role !== "owner") {
    return c.json({ error: "Only the Owner can assign Super Admin or Owner roles" }, 403);
  }

  const existing = await getDashboardUserByUsername(c.env.DB, username);
  if (existing) {
    return c.json({ error: "Username is already taken" }, 400);
  }

  const { hash, salt } = await hashPassword(password);
  const newUser = await saveDashboardUser(c.env.DB, {
    username: username.trim(),
    password_hash: hash,
    salt,
    role,
    display_name: (display_name || username).trim(),
    avatar_url: avatar_url || null,
    linked_client_type: linked_client_type || null,
    linked_user_id: linked_user_id ? String(linked_user_id) : null,
    linked_username: linked_username || null,
    is_active: true,
  });

  if (linked_user_id) {
    await syncCommentumRole(c.env.DB, role, String(linked_user_id));
  }

  const { password_hash: _1, salt: _2, ...safeUser } = newUser;
  return c.json({ success: true, staff: safeUser }, 201);
});

announcementsRoutes.patch("/staff/:id", async (c) => {
  const auth = await checkStaffAuth(c, "super_admin");
  if (!auth.success) {
    return c.json({ error: auth.error || "Super Admin or Owner permissions required" }, 403);
  }

  const staffId = parseInt(c.req.param("id"), 10);
  if (!staffId) return c.json({ error: "Invalid staff id" }, 400);

  const users = await getDashboardUsers(c.env.DB);
  const target = users.find((u) => u.id === staffId);
  if (!target) {
    return c.json({ error: "Staff member not found" }, 404);
  }

  if ((target.role === "owner" || target.role === "super_admin") && auth.user?.role !== "owner") {
    return c.json({ error: "Only the Owner can modify Super Admins or Owners" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const updatePayload: Partial<DashboardUser> = { id: staffId };

  if (body.display_name !== undefined) updatePayload.display_name = body.display_name;
  if (body.avatar_url !== undefined) updatePayload.avatar_url = body.avatar_url;
  if (body.linked_client_type !== undefined) updatePayload.linked_client_type = body.linked_client_type;
  if (body.linked_username !== undefined) updatePayload.linked_username = body.linked_username;
  if (body.is_active !== undefined) updatePayload.is_active = body.is_active;

  if (body.password) {
    if (body.password.length < 6) {
      return c.json({ error: "Password must be at least 6 characters" }, 400);
    }
    const { hash, salt } = await hashPassword(body.password);
    updatePayload.password_hash = hash;
    updatePayload.salt = salt;
  }

  if (body.role && body.role !== target.role) {
    if ((body.role === "owner" || body.role === "super_admin") && auth.user?.role !== "owner") {
      return c.json({ error: "Only the Owner can assign Super Admin or Owner roles" }, 403);
    }
    updatePayload.role = body.role;

    const linkedId = body.linked_user_id !== undefined ? body.linked_user_id : target.linked_user_id;
    if (linkedId) {
      await syncCommentumRole(c.env.DB, body.role, String(linkedId));
    }
  }

  if (body.linked_user_id !== undefined) {
    updatePayload.linked_user_id = body.linked_user_id ? String(body.linked_user_id) : undefined;
    if (body.linked_user_id) {
      const activeRole = updatePayload.role || target.role;
      await syncCommentumRole(c.env.DB, activeRole, String(body.linked_user_id));
    }
  }

  const updated = await saveDashboardUser(c.env.DB, updatePayload);
  const { password_hash: _1, salt: _2, ...safeUser } = updated;

  return c.json({ success: true, staff: safeUser });
});

announcementsRoutes.delete("/staff/:id", async (c) => {
  const auth = await checkStaffAuth(c, "owner");
  if (!auth.success) {
    return c.json({ error: auth.error || "Only the Owner can delete staff members" }, 403);
  }

  const staffId = parseInt(c.req.param("id"), 10);
  if (!staffId) return c.json({ error: "Invalid staff id" }, 400);

  const users = await getDashboardUsers(c.env.DB);
  const target = users.find((u) => u.id === staffId);
  if (!target) {
    return c.json({ error: "Staff member not found" }, 404);
  }

  if (target.role === "owner") {
    const ownerCount = users.filter((u) => u.role === "owner").length;
    if (ownerCount <= 1) {
      return c.json({ error: "Cannot delete the only Master Owner" }, 400);
    }
  }

  if (target.linked_user_id) {
    await syncCommentumRole(c.env.DB, target.role, target.linked_user_id, true);
  }

  await deleteDashboardUser(c.env.DB, staffId);
  return c.json({ success: true, message: "Staff member removed successfully" });
});

// ==========================================
// 4. UNREAD COUNT ROUTE
// ==========================================

announcementsRoutes.get("/unread-count", async (c) => {
  const appId = c.req.query("app_id") || "anymex";
  const userId = c.req.query("user_id");
  const db = createDb(c.env.DB);

  if (!userId) {
    return c.json({ error: "user_id is required" }, 400);
  }

  const published = await db
    .select({ count: sql<number>`count(*)` })
    .from(announcements)
    .where(and(eq(announcements.appId, appId), eq(announcements.status, "published")));

  const totalPublished = published[0]?.count || 0;

  const reads = await db
    .select({ count: sql<number>`count(*)` })
    .from(announcementReads)
    .where(and(eq(announcementReads.appId, appId), eq(announcementReads.userId, userId)));

  const readCount = reads[0]?.count || 0;
  const unreadCount = Math.max(0, totalPublished - readCount);

  return c.json({
    success: true,
    total_published: totalPublished,
    read_count: readCount,
    unread_count: unreadCount,
  });
});

// ==========================================
// 5. PUBLIC ANNOUNCEMENTS FEED (GET /)
// ==========================================

announcementsRoutes.get("/", optionalAuth, async (c) => {
  try {
    const appId = c.req.query("app_id") || "anymex";
    const status = c.req.query("status") || "published";
    const category = c.req.query("category");
    const action = (c.req.query("action") || "list").toLowerCase();
    const db = createDb(c.env.DB);
    const user = c.get("user");
    const queryUserId = c.req.query("user_id") || user?.uid;

    if (action === "analytics") {
      const announcementId = parseInt(c.req.query("id") || c.req.query("announcement_id") || "0", 10);
      if (!announcementId) {
        return c.json({ success: false, error: "announcement_id is required" }, 400);
      }

      const totalViews = await db
        .select({ count: sql<number>`count(*)` })
        .from(announcementViews)
        .where(eq(announcementViews.announcementId, announcementId));

      const totalReads = await db
        .select({ count: sql<number>`count(*)` })
        .from(announcementReads)
        .where(eq(announcementReads.announcementId, announcementId));

      const annRows = await db
        .select()
        .from(announcements)
        .where(eq(announcements.id, announcementId))
        .limit(1);

      return c.json({
        success: true,
        announcement_id: announcementId,
        title: annRows[0]?.title || "",
        views: totalViews[0]?.count || 0,
        reads: totalReads[0]?.count || 0,
        published_at: annRows[0]?.publishedAt,
      });
    }

    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);
    const offset = (page - 1) * limit;

    let items = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.appId, appId), status === "all" ? undefined : eq(announcements.status, status)))
      .orderBy(desc(announcements.pinned), desc(announcements.priority), desc(announcements.publishedAt))
      .limit(limit)
      .offset(offset);

    let readIds = new Set<number>();
    if (queryUserId && items.length > 0) {
      const reads = await db
        .select({ announcementId: announcementReads.announcementId })
        .from(announcementReads)
        .where(
          and(
            eq(announcementReads.appId, appId),
            eq(announcementReads.userId, queryUserId)
          )
        );
      readIds = new Set(reads.map((r) => r.announcementId));
    }

    return c.json({
      success: true,
      app_id: appId,
      page,
      limit,
      announcements: items.map((ann) => ({
        ...ann,
        is_read: readIds.has(ann.id),
      })),
    });
  } catch (error: any) {
    console.error("GET /announcements error:", error);
    return c.json({ success: false, error: error?.message || "Failed to fetch announcements" }, 500);
  }
});

// ==========================================
// 6. SINGLE ANNOUNCEMENT & ACTIONS (GET /:id, PATCH, DELETE, VIEW, READ, ARCHIVE, ANALYTICS)
// ==========================================

announcementsRoutes.get("/:id", async (c) => {
  const announcementId = parseInt(c.req.param("id"), 10);
  if (!announcementId) return c.json({ error: "Invalid announcement ID" }, 400);

  const db = createDb(c.env.DB);
  const rows = await db.select().from(announcements).where(eq(announcements.id, announcementId)).limit(1);
  if (!rows[0]) return c.json({ error: "Announcement not found" }, 404);

  // Increment view count
  await db.update(announcements)
    .set({ viewCount: sql`view_count + 1` })
    .where(eq(announcements.id, announcementId));

  let isRead = false;
  const userId = c.req.query("user_id");
  const appId = c.req.query("app_id") || rows[0].appId;

  if (userId && appId) {
    const reads = await db.select({ id: announcementReads.id })
      .from(announcementReads)
      .where(and(
        eq(announcementReads.announcementId, announcementId),
        eq(announcementReads.userId, userId),
        eq(announcementReads.appId, appId)
      )).limit(1);
    isRead = reads.length > 0;
  }

  return c.json({
    success: true,
    announcement: {
      ...rows[0],
      viewCount: (rows[0].viewCount || 0) + 1,
      is_read: isRead,
    },
  });
});

announcementsRoutes.post("/:id/view", optionalAuth, async (c) => {
  const announcementId = parseInt(c.req.param("id"), 10);
  if (!announcementId) return c.json({ error: "Invalid announcement ID" }, 400);

  const db = createDb(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const user = c.get("user");
  const appId = body.app_id || "anymex";

  await db.insert(announcementViews).values({
    announcementId,
    userId: user?.uid || body.user_id || null,
    appId,
  });

  await db.update(announcements)
    .set({ viewCount: sql`view_count + 1` })
    .where(eq(announcements.id, announcementId));

  return c.json({ success: true, message: "View recorded" });
});

announcementsRoutes.post("/:id/read", optionalAuth, async (c) => {
  const announcementId = parseInt(c.req.param("id"), 10);
  if (!announcementId) return c.json({ error: "Invalid announcement ID" }, 400);

  const db = createDb(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const user = c.get("user");
  const userId = user?.uid || body.user_id;
  const appId = body.app_id || "anymex";

  if (!userId) {
    return c.json({ error: "user_id or authentication required" }, 400);
  }

  await db.insert(announcementReads).values({
    announcementId,
    userId,
    appId,
  }).onConflictDoNothing();

  return c.json({ success: true, message: "Announcement marked read" });
});

announcementsRoutes.post("/:id/archive", async (c) => {
  const auth = await checkStaffAuth(c, "moderator");
  if (!auth.success) return c.json({ error: auth.error }, 403);

  const announcementId = parseInt(c.req.param("id"), 10);
  const db = createDb(c.env.DB);

  await db.update(announcements)
    .set({ status: "archived", updatedAt: sql`(datetime('now'))` })
    .where(eq(announcements.id, announcementId));

  return c.json({ success: true, message: "Announcement archived" });
});

announcementsRoutes.get("/:id/analytics", async (c) => {
  const auth = await checkStaffAuth(c, "moderator");
  if (!auth.success) return c.json({ error: auth.error }, 403);

  const announcementId = parseInt(c.req.param("id"), 10);
  const db = createDb(c.env.DB);

  const annRows = await db.select().from(announcements).where(eq(announcements.id, announcementId)).limit(1);
  if (!annRows[0]) return c.json({ error: "Announcement not found" }, 404);

  const announcement = annRows[0];
  const reads = await db.select().from(announcementReads).where(eq(announcementReads.announcementId, announcementId)).limit(100);

  // Fetch reader profiles if any
  const userIds = reads.map((r) => r.userId);
  let userProfilesMap = new Map<string, any>();
  if (userIds.length > 0) {
    const profiles = await db.select().from(commentumUsers).where(inArray(commentumUsers.commentumUserId, userIds));
    for (const p of profiles) {
      userProfilesMap.set(p.commentumUserId, p);
    }
  }

  const readersList = reads.map((r) => {
    const profile = userProfilesMap.get(r.userId);
    return {
      user_id: r.userId,
      username: profile?.commentumUsername || `User ${r.userId}`,
      avatar: profile?.commentumAvatar || null,
      client_type: profile?.commentumClientType || r.appId,
      role: profile?.commentumUserRole || "user",
      read_at: r.readAt,
    };
  });

  return c.json({
    success: true,
    analytics: {
      announcement_id: announcementId,
      title: announcement.title,
      view_count: announcement.viewCount || 0,
      total_reads: reads.length,
      readers: readersList,
    },
  });
});

announcementsRoutes.patch("/:id", async (c) => {
  const auth = await checkStaffAuth(c, "moderator");
  if (!auth.success) return c.json({ error: auth.error }, 403);

  const announcementId = parseInt(c.req.param("id"), 10);
  const db = createDb(c.env.DB);
  const body = await c.req.json();

  const updatePayload: Record<string, any> = { updatedAt: sql`(datetime('now'))` };
  if (body.title !== undefined) updatePayload.title = body.title;
  if (body.short_description !== undefined) updatePayload.shortDescription = body.short_description;
  if (body.full_content !== undefined) updatePayload.fullContent = body.full_content;
  if (body.category !== undefined) updatePayload.category = body.category;
  if (body.priority !== undefined) updatePayload.priority = parseInt(body.priority, 10);
  if (body.pinned !== undefined) updatePayload.pinned = !!body.pinned;
  if (body.status !== undefined) updatePayload.status = body.status;

  await db.update(announcements).set(updatePayload).where(eq(announcements.id, announcementId));
  const updated = await db.select().from(announcements).where(eq(announcements.id, announcementId)).limit(1);

  return c.json({ success: true, announcement: updated[0] });
});

announcementsRoutes.delete("/:id", async (c) => {
  const auth = await checkStaffAuth(c, "admin");
  if (!auth.success) return c.json({ error: auth.error }, 403);

  const announcementId = parseInt(c.req.param("id"), 10);
  const db = createDb(c.env.DB);

  await db.delete(announcementReads).where(eq(announcementReads.announcementId, announcementId));
  await db.delete(announcementViews).where(eq(announcementViews.announcementId, announcementId));
  await db.delete(announcements).where(eq(announcements.id, announcementId));

  return c.json({ success: true, message: "Announcement deleted successfully" });
});

// ==========================================
// 7. CREATE / PUBLISH ANNOUNCEMENT (POST /)
// ==========================================

announcementsRoutes.post("/", optionalAuth, async (c) => {
  try {
    const body = await c.req.json();
    const action = (body.action || "publish").toLowerCase();
    const db = createDb(c.env.DB);

    if (action === "view") {
      const announcementId = parseInt(body.announcement_id || body.id, 10);
      const appId = body.app_id || "anymex";
      if (!announcementId) return c.json({ success: false, error: "announcement_id is required" }, 400);

      await db.insert(announcementViews).values({ announcementId, userId: body.user_id || null, appId });
      await db.update(announcements).set({ viewCount: sql`view_count + 1` }).where(eq(announcements.id, announcementId));
      return c.json({ success: true, message: "View recorded" });
    }

    if (action === "read") {
      const announcementId = parseInt(body.announcement_id || body.id, 10);
      const appId = body.app_id || "anymex";
      const userId = body.user_id;
      if (!announcementId || !userId) return c.json({ success: false, error: "announcement_id and user_id are required" }, 400);

      await db.insert(announcementReads).values({ announcementId, userId, appId }).onConflictDoNothing();
      return c.json({ success: true, message: "Announcement marked read" });
    }

    // Require staff authorization for creating announcements
    const staffAuth = await checkStaffAuth(c, "moderator");
    const user = c.get("user");
    const isStaff = staffAuth.success || (user && isAdminOrHigher(user.role));

    if (!isStaff) {
      return c.json({ success: false, error: "Staff permissions required" }, 403);
    }

    const authorId = staffAuth.user?.linked_user_id || user?.uid || `staff_${staffAuth.user?.id || 0}`;
    const authorName = staffAuth.user?.display_name || user?.username || "Staff";
    const authorAvatar = staffAuth.user?.avatar_url || user?.avatar || null;

    const title = (body.title || "").trim();
    const fullContent = (body.full_content || body.content || "").trim();
    const appId = body.app_id || "anymex";
    const category = body.category || "general";
    const priority = parseInt(body.priority || "0", 10);
    const pinned = !!body.pinned;
    const status = body.status || (body.publish ? "published" : "draft");

    if (!title || !fullContent) {
      return c.json({ success: false, error: "Title and content are required" }, 400);
    }

    const inserted = await db
      .insert(announcements)
      .values({
        appId,
        title,
        shortDescription: body.short_description || title,
        fullContent,
        authorId,
        authorName,
        authorAvatar,
        category,
        priority,
        pinned,
        status,
        publishedAt: status === "published" ? sql`(datetime('now'))` : null,
      })
      .returning();

    const created = inserted[0];

    if (status === "published") {
      // 1. Discord announcement notification
      queueDiscordNotification(
        {
          type: "announcement_published",
          announcement: {
            id: created.id,
            title: created.title,
            content: created.fullContent,
            category: created.category,
            author: created.authorName || undefined,
          },
        },
        c.env
      );

      // 2. Queue FCM push notification
      queueFcmNotification(c, {
        type: "announcement_published",
        targetUserId: "broadcast",
        targetClientType: appId,
        announcementTitle: created.title,
        announcementContent: created.shortDescription || created.fullContent,
        announcementId: String(created.id),
      });
    }

    return c.json({
      success: true,
      announcement: created,
    });
  } catch (error: any) {
    console.error("POST /announcements error:", error);
    return c.json({ success: false, error: error?.message || "Internal server error" }, 500);
  }
});
