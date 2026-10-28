import { Hono } from "hono";
import { AppContext } from "../types/env";
import { optionalAuth, requireAuth } from "../middleware/auth";
import { isOwner, isAdminOrHigher } from "../shared/roles";
import { createDb } from "../db";
import { announcements, announcementReads } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export const announcementsRoutes = new Hono<AppContext>();

/**
 * GET /announcements
 * Public announcement feed with read status
 */
announcementsRoutes.get("/", optionalAuth, async (c) => {
  try {
    const appId = c.req.query("app_id") || "anymex";
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);
    const offset = (page - 1) * limit;

    const db = createDb(c.env.DB);
    const user = c.get("user");

    const items = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.appId, appId), eq(announcements.status, "published")))
      .orderBy(desc(announcements.pinned), desc(announcements.priority), desc(announcements.publishedAt))
      .limit(limit)
      .offset(offset);

    // If user is authenticated, check read status
    let readIds = new Set<number>();
    if (user && items.length > 0) {
      const reads = await db
        .select({ announcementId: announcementReads.announcementId })
        .from(announcementReads)
        .where(
          and(
            eq(announcementReads.appId, appId),
            eq(announcementReads.userId, user.uid)
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

/**
 * POST /announcements
 * Staff announcement creation & publish (Admin / Owner)
 */
announcementsRoutes.post("/", requireAuth, async (c) => {
  try {
    const user = c.get("user")!;
    if (!isAdminOrHigher(user.role)) {
      return c.json({ success: false, error: "Admin permissions required" }, 403);
    }

    const body = await c.req.json();
    const title = (body.title || "").trim();
    const fullContent = (body.full_content || body.content || "").trim();
    const appId = body.app_id || "anymex";
    const category = body.category || "general";
    const priority = parseInt(body.priority || "0", 10);
    const pinned = !!body.pinned;
    const status = body.status || "published";

    if (!title || !fullContent) {
      return c.json({ success: false, error: "Title and content are required" }, 400);
    }

    const db = createDb(c.env.DB);

    const inserted = await db
      .insert(announcements)
      .values({
        appId,
        title,
        shortDescription: body.short_description || title,
        fullContent,
        authorId: user.uid,
        authorName: user.username,
        authorAvatar: user.avatar,
        category,
        priority,
        pinned,
        status,
        publishedAt: status === "published" ? sql`(datetime('now'))` : null,
      })
      .returning();

    return c.json({
      success: true,
      announcement: inserted[0],
    });
  } catch (error: any) {
    console.error("POST /announcements error:", error);
    return c.json({ success: false, error: error?.message || "Internal server error" }, 500);
  }
});
