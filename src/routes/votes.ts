import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { createDb } from "../db";
import { comments, commentumUsers } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";

export const votesRoutes = new Hono<AppContext>();

/**
 * POST /votes
 * Cast or toggle upvote/downvote on a comment
 */
votesRoutes.post("/", requireAuth, async (c) => {
  try {
    const user = c.get("user")!;
    const body = await c.req.json();
    const commentId = parseInt(body.comment_id, 10);
    let voteType = body.vote_type;

    if (!commentId) {
      return c.json({ success: false, error: "comment_id is required" }, 400);
    }

    // Normalize vote type
    let numVote = 0;
    if (voteType === 1 || voteType === "1" || voteType === "upvote") numVote = 1;
    else if (voteType === -1 || voteType === "-1" || voteType === "downvote") numVote = -1;
    else if (voteType === 0 || voteType === "0" || voteType === "remove") numVote = 0;

    const db = createDb(c.env.DB);

    const existing = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
    const comment = existing[0];
    if (!comment) {
      return c.json({ success: false, error: "Comment not found" }, 404);
    }

    // Parse user_votes JSON
    let userVotesMap: Record<string, number> = {};
    try {
      userVotesMap = JSON.parse(comment.userVotes || "{}");
    } catch {}

    const oldVote = userVotesMap[user.uid] || 0;

    // Toggle behavior: if clicking same vote again, remove it
    let newVote = numVote;
    if (oldVote === numVote && numVote !== 0) {
      newVote = 0;
    }

    if (newVote === 0) {
      delete userVotesMap[user.uid];
    } else {
      userVotesMap[user.uid] = newVote;
    }

    // Calculate score changes
    let upDelta = 0;
    let downDelta = 0;

    if (oldVote === 1) upDelta -= 1;
    if (oldVote === -1) downDelta -= 1;

    if (newVote === 1) upDelta += 1;
    if (newVote === -1) downDelta += 1;

    const newUpvotes = Math.max(0, comment.upvotes + upDelta);
    const newDownvotes = Math.max(0, comment.downvotes + downDelta);
    const newVoteScore = newUpvotes - newDownvotes;

    // Update comment
    await db
      .update(comments)
      .set({
        upvotes: newUpvotes,
        downvotes: newDownvotes,
        voteScore: newVoteScore,
        userVotes: JSON.stringify(userVotesMap),
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(comments.id, commentId));

    // Update user vote count
    await db
      .update(commentumUsers)
      .set({
        commentumUserVoteCount: sql`commentum_user_vote_count + 1`,
        commentumUserLastVoteAt: sql`(datetime('now'))`,
      })
      .where(
        and(
          eq(commentumUsers.commentumClientType, user.provider),
          eq(commentumUsers.commentumUserId, user.uid)
        )
      );

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
