import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { isModeratorOrHigher } from "../shared/roles";
import { createDb } from "../db";
import { comments, commentumUsers, notifications } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { queueDiscordNotification } from "../shared/discord";
import { resolveMediaById, isUnknownMediaTitle } from "../shared/mediaResolver";

export const commentsRoutes = new Hono<AppContext>();

/**
 * POST /comments
 * Handles create, edit, delete actions
 */
commentsRoutes.post("/", requireAuth, async (c) => {
  try {
    const user = c.get("user")!;
    const body = await c.req.json();
    const action = (body.action || "create").toLowerCase();
    const db = createDb(c.env.DB);

    // Fetch author user record to verify bans, mutes, and active customizations
    const userRows = await db
      .select()
      .from(commentumUsers)
      .where(
        and(
          eq(commentumUsers.commentumClientType, user.provider),
          eq(commentumUsers.commentumUserId, user.uid)
        )
      )
      .limit(1);

    const author = userRows[0];
    if (author?.commentumUserBanned) {
      return c.json({ success: false, error: "Your account is banned from posting" }, 403);
    }
    if (author?.commentumUserMuted) {
      return c.json({ success: false, error: "Your account is temporarily muted" }, 403);
    }

    // ==========================================
    // ACTION: CREATE
    // ==========================================
    if (action === "create") {
      const content = (body.content || "").trim();
      if (!content) {
        return c.json({ success: false, error: "Comment content cannot be empty" }, 400);
      }
      if (content.length > 10000) {
        return c.json({ success: false, error: "Comment exceeds maximum limit of 10000 characters" }, 400);
      }

      const mediaId = String(body.media_id || body.media_info?.media_id || "");
      if (!mediaId) {
        return c.json({ success: false, error: "media_id is required" }, 400);
      }

      let mediaType = body.media_type || body.media_info?.type || "anime";
      let mediaTitle = body.media_title || body.media_info?.title || "";
      let mediaPoster = body.media_poster || body.media_info?.poster || null;
      let mediaYear = body.media_year || null;

      // Automatically resolve media info from AniList if missing or 'Unknown Media'
      if (isUnknownMediaTitle(mediaTitle)) {
        const resolved = await resolveMediaById(c.env.DB, mediaId, mediaType);
        if (resolved) {
          mediaTitle = resolved.media_title;
          mediaPoster = resolved.media_poster || mediaPoster;
          mediaType = resolved.media_type;
          mediaYear = resolved.media_year;
        }
      }
      const episode = body.episode ? String(body.episode) : null;
      const chapter = body.chapter ? String(body.chapter) : null;
      const parentId = body.parent_id ? parseInt(body.parent_id, 10) : null;
      const tags = Array.isArray(body.tags) ? JSON.stringify(body.tags) : "[]";
      const tag = body.tag ? parseInt(body.tag, 10) : null;

      // If this is a reply, check if parent exists and is not locked
      let parentComment: typeof comments.$inferSelect | undefined;
      if (parentId) {
        const parents = await db.select().from(comments).where(eq(comments.id, parentId)).limit(1);
        parentComment = parents[0];
        if (!parentComment) {
          return c.json({ success: false, error: "Parent comment not found" }, 404);
        }
        if (parentComment.locked) {
          return c.json({ success: false, error: "This thread is locked against new replies" }, 403);
        }
      }

      // Insert new comment
      const inserted = await db
        .insert(comments)
        .values({
          clientType: user.provider,
          userId: user.uid,
          username: author?.commentumUsername || user.username,
          userAvatar: author?.commentumUserAvatar || user.avatar,
          userRole: author?.commentumUserRole || user.role,
          avatarDecoration: author?.avatarDecoration,
          bannerUrl: author?.bannerUrl,
          mediaId,
          mediaType,
          mediaTitle,
          mediaPoster,
          episode,
          chapter,
          content,
          parentId,
          tags,
          tag,
        })
        .returning();

      const newComment = inserted[0];

      // Update author's comment count
      if (author) {
        await db
          .update(commentumUsers)
          .set({
            commentumUserCommentCount: author.commentumUserCommentCount + 1,
            commentumUserLastCommentAt: sql`(datetime('now'))`,
            commentumUserLastCommentId: newComment.id,
          })
          .where(eq(commentumUsers.id, author.id));
      }

      // If reply, send notification to parent comment author
      if (parentComment && parentComment.userId !== user.uid) {
        await db.insert(notifications).values({
          userId: parentComment.userId,
          clientType: parentComment.clientType,
          actorId: user.uid,
          actorUsername: user.username,
          actorAvatar: user.avatar,
          type: "reply",
          commentId: newComment.id,
          mediaId,
          mediaTitle,
          content: content.slice(0, 150),
        });
      }

      // Queue Discord webhook notification in background
      queueDiscordNotification(
        {
          type: "comment_created",
          comment: {
            id: newComment.id,
            user_id: user.uid,
            username: newComment.username,
            client_type: user.provider,
            media_id: mediaId,
            media_title: mediaTitle,
            content,
            episode: episode || undefined,
            chapter: chapter || undefined,
          },
        },
        c.env
      ).catch(() => {});

      return c.json({
        success: true,
        comment: {
          id: newComment.id,
          comment_id: newComment.id,
          content: newComment.content,
          media_id: newComment.mediaId,
          parent_id: newComment.parentId,
          created_at: newComment.createdAt,
          user_id: newComment.userId,
          username: newComment.username,
          user_role: newComment.userRole,
          avatar_decoration: newComment.avatarDecoration,
          banner_url: newComment.bannerUrl,
          upvotes: 0,
          downvotes: 0,
          vote_score: 0,
        },
      });
    }

    // ==========================================
    // ACTION: EDIT
    // ==========================================
    if (action === "edit") {
      const commentId = parseInt(body.comment_id, 10);
      const newContent = (body.content || "").trim();

      if (!commentId || !newContent) {
        return c.json({ success: false, error: "comment_id and content are required for edit" }, 400);
      }

      const existing = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      const comment = existing[0];
      if (!comment) {
        return c.json({ success: false, error: "Comment not found" }, 404);
      }

      // Must be comment author or moderator
      if (comment.userId !== user.uid && !isModeratorOrHigher(user.role)) {
        return c.json({ success: false, error: "You can only edit your own comments" }, 403);
      }

      const history = JSON.parse(comment.editHistory || "[]");
      history.push({
        content: comment.content,
        edited_at: new Date().toISOString(),
      });

      const updated = await db
        .update(comments)
        .set({
          content: newContent,
          edited: true,
          editedAt: sql`(datetime('now'))`,
          editCount: comment.editCount + 1,
          editHistory: JSON.stringify(history),
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(comments.id, commentId))
        .returning();

      return c.json({
        success: true,
        comment: updated[0],
      });
    }

    // ==========================================
    // ACTION: DELETE
    // ==========================================
    if (action === "delete") {
      const commentId = parseInt(body.comment_id, 10);
      if (!commentId) {
        return c.json({ success: false, error: "comment_id is required for delete" }, 400);
      }

      const existing = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      const comment = existing[0];
      if (!comment) {
        return c.json({ success: false, error: "Comment not found" }, 404);
      }

      const isAuthor = comment.userId === user.uid;
      const isMod = isModeratorOrHigher(user.role);

      if (!isAuthor && !isMod) {
        return c.json({ success: false, error: "Permission denied to delete this comment" }, 403);
      }

      // Soft delete
      await db
        .update(comments)
        .set({
          deleted: true,
          deletedAt: sql`(datetime('now'))`,
          deletedBy: user.uid,
          content: "[deleted]",
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(comments.id, commentId));

      return c.json({
        success: true,
        message: "Comment deleted successfully",
      });
    }

    return c.json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (error: any) {
    console.error("POST /comments error:", error);
    return c.json({ success: false, error: error?.message || "Internal server error" }, 500);
  }
});
