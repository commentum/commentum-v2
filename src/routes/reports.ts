import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { isModeratorOrHigher } from "../shared/roles";
import { createDb } from "../db";
import { comments } from "../db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { getActiveRestriction, restrictionResponse } from "../shared/restrictions";
import { checkRateLimits, rateLimitedResponse } from "../shared/rateLimit";
import { queueDiscordNotification } from "../shared/discord";

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
      // 1. Restriction check
      const restriction = await getActiveRestriction(c.env.DB, user.uid);
      if (restriction) {
        return restrictionResponse(restriction);
      }

      // 2. Rate limit reports (3/min)
      const rateCheck = await checkRateLimits(c.env.DB, [
        { key: `report:${user.uid}`, limit: 3, windowSec: 60 },
      ]);
      if (!rateCheck.allowed) {
        return rateLimitedResponse("Report submission limit reached. Please wait a moment.", rateCheck.retryAfter);
      }

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

      // Prevent duplicate report by same user
      const alreadyReported = reportsList.some(
        (r: any) => r.reporter_id === user.uid && r.reporter_client === user.provider
      );
      if (alreadyReported) {
        return c.json({ success: false, error: "You have already reported this comment", duplicate: true }, 400);
      }

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

      // Dispatch Discord notification to moderation channel
      queueDiscordNotification(
        {
          type: "report_filed",
          comment: {
            id: commentId,
            content: comment.content,
            user_id: comment.userId,
            username: comment.username,
          },
          report: {
            reason,
            notes,
            reporter_id: user.uid,
            reporter_username: user.username,
          },
        },
        c.env
      );

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
      const status = (body.status || "pending").toLowerCase();

      let queueFilter = eq(comments.reported, true);
      if (status !== "all") {
        queueFilter = and(eq(comments.reported, true), eq(comments.reportStatus, status))!;
      }

      const queue = await db
        .select()
        .from(comments)
        .where(queueFilter)
        .orderBy(desc(comments.reportCount), desc(comments.createdAt))
        .limit(limit)
        .offset(offset);

      return c.json({
        success: true,
        page,
        limit,
        queue: queue.map((q) => ({
          ...q,
          reports: JSON.parse(q.reports || "[]"),
          edit_history: JSON.parse(q.editHistory || "[]"),
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

      queueDiscordNotification(
        {
          type: resolution === "dismissed" ? "report_dismissed" : "report_resolved",
          comment: { id: commentId },
          moderator: { id: user.uid, username: user.username },
        },
        c.env
      );

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
