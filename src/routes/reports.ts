import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { isModeratorOrHigher } from "../shared/roles";
import { createDb } from "../db";
import { comments } from "../db/schema";
import { eq, sql } from "drizzle-orm";

export const reportsRoutes = new Hono<AppContext>();

/**
 * POST /reports
 * File a report or manage reports queue (mod+)
 */
reportsRoutes.post("/", requireAuth, async (c) => {
  try {
    const user = c.get("user")!;
    const body = await c.req.json();
    const action = (body.action || "report").toLowerCase();
    const db = createDb(c.env.DB);

    // ==========================================
    // ACTION: REPORT
    // ==========================================
    if (action === "report") {
      const commentId = parseInt(body.comment_id, 10);
      const reason = body.reason || "other";
      const notes = body.notes || "";

      if (!commentId) {
        return c.json({ success: false, error: "comment_id is required" }, 400);
      }

      const existing = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      const comment = existing[0];
      if (!comment) {
        return c.json({ success: false, error: "Comment not found" }, 404);
      }

      const reportsList = JSON.parse(comment.reports || "[]");
      reportsList.push({
        reporter_id: user.uid,
        reporter_client: user.provider,
        reason,
        notes,
        created_at: new Date().toISOString(),
      });

      await db
        .update(comments)
        .set({
          reported: true,
          reportCount: comment.reportCount + 1,
          reports: JSON.stringify(reportsList),
          reportStatus: "pending",
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(comments.id, commentId));

      return c.json({
        success: true,
        message: "Report filed successfully",
        comment_id: commentId,
      });
    }

    // ==========================================
    // ACTION: GET_QUEUE (Staff only)
    // ==========================================
    if (action === "get_queue") {
      if (!isModeratorOrHigher(user.role)) {
        return c.json({ success: false, error: "Moderator permissions required" }, 403);
      }

      const page = parseInt(body.page || "1", 10);
      const limit = Math.min(parseInt(body.limit || "20", 10), 50);
      const offset = (page - 1) * limit;

      const queue = await db
        .select()
        .from(comments)
        .where(eq(comments.reported, true))
        .limit(limit)
        .offset(offset);

      return c.json({
        success: true,
        page,
        limit,
        queue: queue.map((q) => ({
          ...q,
          reports: JSON.parse(q.reports || "[]"),
        })),
      });
    }

    // ==========================================
    // ACTION: RESOLVE (Staff only)
    // ==========================================
    if (action === "resolve") {
      if (!isModeratorOrHigher(user.role)) {
        return c.json({ success: false, error: "Moderator permissions required" }, 403);
      }

      const commentId = parseInt(body.comment_id, 10);
      const resolution = body.resolution || "resolved"; // resolved or dismissed

      await db
        .update(comments)
        .set({
          reportStatus: resolution,
          reported: resolution === "dismissed" ? false : true,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(comments.id, commentId));

      return c.json({
        success: true,
        message: `Report ${resolution}`,
        comment_id: commentId,
      });
    }

    return c.json({ success: false, error: `Unknown reports action: ${action}` }, 400);
  } catch (error: any) {
    console.error("POST /reports error:", error);
    return c.json({ success: false, error: error?.message || "Internal server error" }, 500);
  }
});
