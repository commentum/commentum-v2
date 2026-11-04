import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { createDb } from "../db";
import { comments, commentumUsers, notifications, notificationPreferences, dantotsuIdMappings } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getActiveRestriction, restrictionResponse } from "../shared/restrictions";
import { checkRateLimits, rateLimitedResponse } from "../shared/rateLimit";
import { refreshUserPoints } from "../shared/pointsEngine";
import { isModeratorOrHigher } from "../shared/roles";
import { queueFcmNotification } from "../shared/fcm";
import { getDanModAuth, danVoteComment } from "../shared/dantotsuClient";

export const votesRoutes = new Hono<AppContext>();

/**
 * POST /votes
 * Cast or change vote on a comment: 1 (upvote), -1 (downvote), 0 (remove vote)
 */
votesRoutes.post("/", requireAuth, async (c) => {
  try {
    const user = c.get("user")!;
    const body = await c.req.json();
    const commentId = parseInt(body.comment_id, 10);
    const voteType = parseInt(body.vote_type, 10);

    if (!commentId || isNaN(voteType) || ![-1, 0, 1].includes(voteType)) {
      return c.json({ success: false, error: "comment_id and valid vote_type (-1, 0, 1) are required" }, 400);
    }

    // Restriction check (Banned or Muted cannot vote)
    const isStaff = isModeratorOrHigher(user.role);
    if (!isStaff) {
      const restriction = await getActiveRestriction(c.env.DB, user.uid);
      if (restriction && restriction.type !== "shadow_banned") {
        return restrictionResponse(restriction);
      }

      // Rate limit votes: 20 votes/min
      const rateCheck = await checkRateLimits(c.env.DB, [
        { key: `vote:${user.uid}`, limit: 20, windowSec: 60 },
      ]);
      if (!rateCheck.allowed) {
        return rateLimitedResponse("Voting rate limit reached. Please slow down.", rateCheck.retryAfter);
      }
    }

    const db = createDb(c.env.DB);
    const existing = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
    const comment = existing[0];
    if (!comment) {
      return c.json({ success: false, error: "Comment not found" }, 404);
    }

    if (comment.deleted) {
      return c.json({ success: false, error: "Cannot vote on deleted comment" }, 400);
    }

    // Parse current user votes object: { "userId": 1 | -1 }
    let userVotes: Record<string, number> = {};
    if (comment.userVotes) {
      try {
        userVotes = typeof comment.userVotes === "string" ? JSON.parse(comment.userVotes) : comment.userVotes;
      } catch (_) {
        userVotes = {};
      }
    }

    const currentVote = userVotes[user.uid] || 0;
    const newVote = voteType;

    if (currentVote === newVote) {
      // No change
      return c.json({
        success: true,
        comment_id: commentId,
        vote_type: newVote,
        upvotes: comment.upvotes,
        downvotes: comment.downvotes,
        vote_score: comment.voteScore,
      });
    }

    let upDelta = 0;
    let downDelta = 0;

    // Undo current vote
    if (currentVote === 1) upDelta -= 1;
    if (currentVote === -1) downDelta -= 1;

    // Apply new vote
    if (newVote === 1) upDelta += 1;
    if (newVote === -1) downDelta += 1;

    if (newVote === 0) {
      delete userVotes[user.uid];
    } else {
      userVotes[user.uid] = newVote;
    }

    const newUpvotes = Math.max(0, comment.upvotes + upDelta);
    const newDownvotes = Math.max(0, comment.downvotes + downDelta);
    const newVoteScore = newUpvotes - newDownvotes;

    await db
      .update(comments)
      .set({
        upvotes: newUpvotes,
        downvotes: newDownvotes,
        voteScore: newVoteScore,
        userVotes: JSON.stringify(userVotes),
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(comments.id, commentId));

    // Refresh points for author if upvotes changed
    if (upDelta !== 0 || downDelta !== 0) {
      refreshUserPoints(c.env.DB, comment.clientType, comment.userId).catch(() => {});
    }

    // Send vote notification if upvoted by someone else
    if (newVote === 1 && comment.userId !== user.uid) {
      // Check preferences
      const prefs = await db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.clientType, comment.clientType),
            eq(notificationPreferences.userId, comment.userId)
          )
        )
        .limit(1);

      const notifyEnabled = prefs.length === 0 || prefs[0].notifyOnVote;
      if (notifyEnabled) {
        await db.insert(notifications).values({
          userId: comment.userId,
          clientType: comment.clientType,
          actorId: user.uid,
          actorUsername: user.username,
          actorAvatar: user.avatar,
          type: "vote",
          title: "New Upvote",
          body: `${user.username} upvoted your comment`,
          commentId: comment.id,
          mediaId: comment.mediaId,
          content: comment.content.slice(0, 100),
        });

        queueFcmNotification(c, {
          type: "vote_cast",
          targetUserId: comment.userId,
          targetClientType: comment.clientType,
          voteType: "upvote",
          voteScore: newVoteScore,
          comment: {
            id: comment.id,
            media_id: comment.mediaId,
            content: comment.content,
          },
          actor: { id: user.uid, username: user.username, avatar: user.avatar },
        });
      }
    }

    // Dantotsu vote sync if mapped
    const syncVoteTask = async () => {
      try {
        const mapRows = await db
          .select()
          .from(dantotsuIdMappings)
          .where(eq(dantotsuIdMappings.commentumId, commentId))
          .limit(1);

        if (mapRows[0]) {
          const auth = await getDanModAuth(c.env.DB);
          if (auth) {
            await danVoteComment({
              authToken: auth.authToken,
              danCommentId: mapRows[0].dantotsuCommentId,
              voteType: newVote,
            });
          }
        }
      } catch (err) {
        console.error("[DantotsuSync] Error syncing vote to Dantotsu:", err);
      }
    };

    if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
      c.executionCtx.waitUntil(syncVoteTask());
    } else {
      syncVoteTask();
    }

    return c.json({
      success: true,
      comment_id: commentId,
      vote_type: newVote,
      upvotes: newUpvotes,
      downvotes: newDownvotes,
      vote_score: newVoteScore,
    });
  } catch (error: any) {
    console.error("POST /votes error:", error);
    return c.json({ success: false, error: error?.message || "Internal server error" }, 500);
  }
});
