import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { isModeratorOrHigher } from "../shared/roles";
import { createDb } from "../db";
import { comments, commentumUsers, notifications, dantotsuIdMappings } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { queueDiscordNotification } from "../shared/discord.js";
import { getOrResolveMedia } from "../shared/mediaMapping.js";
import { getActiveRestriction, restrictionResponse } from "../shared/restrictions";
import { checkRateLimits, rateLimitedResponse } from "../shared/rateLimit";
import { translateText } from "../shared/translate";
import { parseMentions, getPlainTextPreview } from "../shared/mentionUtils";
import { refreshUserPoints } from "../shared/pointsEngine";
import { queueFcmNotification } from "../shared/fcm";
import { resolveMediaById, isUnknownMediaTitle } from "../shared/mediaResolver";
import {
  danAuthenticate,
  danPostComment,
  danEditComment,
  danDeleteComment,
  getDanModAuth,
  toDantotsuTag,
} from "../shared/dantotsuClient";

export const commentsRoutes = new Hono<AppContext>();

// True when content is empty or only whitespace / invisible characters
const BLANK_CONTENT_RE = /^[\p{Z}\p{Cc}\p{Cf}\u2800\u3164\u115F\u1160\uFFA0\u034F\u180E]*$/u;
function isBlankContent(content: unknown): boolean {
  return typeof content !== "string" || BLANK_CONTENT_RE.test(content);
}

const normalizeForCompare = (c: string) => c.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * POST /comments
 * Handles create, edit, delete, mod_delete, and translate actions
 */
commentsRoutes.post("/", requireAuth, async (c) => {
  try {
    const user = c.get("user")!;
    const body = await c.req.json();
    const action = (body.action || "create").toLowerCase();
    const db = createDb(c.env.DB);

    // ==========================================
    // ACTION: TRANSLATE (Read-only, no ban check required)
    // ==========================================
    if (action === "translate") {
      const commentId = parseInt(body.comment_id, 10);
      const targetLang = (body.target_lang || "en").toLowerCase();

      if (!commentId) {
        return c.json({ success: false, error: "comment_id is required" }, 400);
      }

      const existing = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      const comment = existing[0];
      if (!comment) {
        return c.json({ success: false, error: "Comment not found" }, 404);
      }

      let cachedMap: Record<string, string> = {};
      try {
        cachedMap = comment.translations ? JSON.parse(comment.translations) : {};
      } catch (_) {}

      if (cachedMap[targetLang]) {
        return c.json({
          success: true,
          translated_content: cachedMap[targetLang],
          cached: true,
        });
      }

      const translation = await translateText(comment.content, targetLang);
      if (!translation || !translation.translatedContent) {
        return c.json({ success: false, error: "Translation service unavailable" }, 502);
      }

      cachedMap[targetLang] = translation.translatedContent;
      await db
        .update(comments)
        .set({
          translatedContent: translation.translatedContent,
          translations: JSON.stringify(cachedMap),
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(comments.id, commentId));

      return c.json({
        success: true,
        translated_content: translation.translatedContent,
        original_language: translation.originalLanguage,
        cached: false,
      });
    }

    // ==========================================
    // RESTRICTION CHECK (Ban / Mute / Shadowban)
    // ==========================================
    const restriction = await getActiveRestriction(c.env.DB, user.uid);
    const isStaff = isModeratorOrHigher(user.role);

    if (!isStaff && restriction && restriction.type !== "shadow_banned") {
      return restrictionResponse(restriction);
    }

    // ==========================================
    // ACTION: CREATE
    // ==========================================
    if (action === "create") {
      const content = (body.content || "").trim();
      const mediaId = body.media_id ? String(body.media_id).trim() : null;
      const parentId = body.parent_id ? parseInt(body.parent_id, 10) : null;
      const tag = body.tag ? String(body.tag).trim() : null;

      if (!content || !mediaId || isBlankContent(content)) {
        return c.json({ success: false, error: "media_id and non-empty content are required" }, 400);
      }

      // Rate limit checks (anti-spam)
      if (!isStaff) {
        const rateCheck = await checkRateLimits(c.env.DB, [
          { key: `cd:${user.uid}`, limit: 1, windowSec: 5 },
          { key: `burst:${user.uid}`, limit: 5, windowSec: 60 },
          { key: `hr:${user.uid}`, limit: 20, windowSec: 3600 },
        ]);

        if (!rateCheck.allowed) {
          return rateLimitedResponse(
            "Comment rate limit reached. Please wait before posting again.",
            rateCheck.retryAfter
          );
        }

        // Duplicate guard (10 min check)
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const recentComments = await db
          .select({ content: comments.content })
          .from(comments)
          .where(and(eq(comments.userId, user.uid), sql`created_at >= ${tenMinsAgo}`))
          .limit(10);

        const normalizedNew = normalizeForCompare(content);
        for (const rc of recentComments) {
          if (normalizeForCompare(rc.content) === normalizedNew) {
            return c.json(
              {
                success: false,
                error: "Duplicate comment detected. You posted identical content recently.",
              },
              429
            );
          }
        }
      }

      // Resolve parent comment if reply
      let parentComment = null;
      if (parentId) {
        const pRows = await db.select().from(comments).where(eq(comments.id, parentId)).limit(1);
        parentComment = pRows[0] || null;
        if (!parentComment) {
          return c.json({ success: false, error: "Parent comment does not exist" }, 404);
        }
        if (parentComment.locked) {
          return c.json({ success: false, error: "This thread is locked by a moderator" }, 403);
        }
      }

      // Fetch or resolve canonical media
      let mediaInfo = await getOrResolveMedia(c.env.DB, mediaId, user.provider, body.media);

      // If media title is unknown, try resolving via Dantotsu media cache / AniList GraphQL
      if (isUnknownMediaTitle(mediaInfo.title)) {
        const numericMediaId = parseInt(mediaId, 10);
        if (!isNaN(numericMediaId) && numericMediaId > 0) {
          const resolved = await resolveMediaById(c.env.DB, numericMediaId, mediaInfo.type);
          if (resolved) {
            mediaInfo.title = resolved.media_title;
            mediaInfo.poster = resolved.media_poster || mediaInfo.poster;
            mediaInfo.year = resolved.media_year || mediaInfo.year;
          }
        }
      }

      // Fetch user profile cosmetics
      const authorProfiles = await db
        .select()
        .from(commentumUsers)
        .where(
          and(
            eq(commentumUsers.commentumClientType, user.provider),
            eq(commentumUsers.commentumUserId, user.uid)
          )
        )
        .limit(1);

      const author = authorProfiles[0];
      const avatarDecoration = author?.avatarDecoration || null;
      const bannerUrl = author?.bannerUrl || null;
      const userRole = author?.commentumUserRole || user.role || "user";

      // Shadowban handling
      const isShadowbanned = restriction?.type === "shadow_banned";

      // Insert new comment
      const inserted = await db
        .insert(comments)
        .values({
          clientType: user.provider,
          userId: user.uid,
          username: user.username,
          userAvatar: user.avatar,
          avatarDecoration,
          bannerUrl,
          userRole,
          mediaId,
          parentId,
          content,
          tags: Array.isArray(body.tags) ? JSON.stringify(body.tags) : tag ? JSON.stringify([tag]) : null,
          tag: tag ? parseInt(tag, 10) : undefined,
          taggedBy: tag ? user.uid : null,
          upvotes: 0,
          downvotes: 0,
          voteScore: 0,
          deleted: false,
          pinned: false,
          locked: false,
          edited: false,
          editCount: 0,
          reported: false,
          reportCount: 0,
          reportStatus: "none",
          moderated: isShadowbanned,
          moderationAction: isShadowbanned ? "shadowban" : null,
        })
        .returning();

      const newComment = inserted[0];

      // Update author statistics
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

      // Award points & update streaks
      refreshUserPoints(c.env.DB, user.provider, user.uid).catch((e) =>
        console.error("Failed to refresh user points:", e)
      );

      // Reply Notification
      if (parentComment && parentComment.userId !== user.uid) {
        await db.insert(notifications).values({
          userId: parentComment.userId,
          clientType: parentComment.clientType,
          actorId: user.uid,
          actorUsername: user.username,
          actorAvatar: user.avatar,
          type: "reply",
          title: "New Reply",
          body: `${user.username} replied to your comment`,
          commentId: newComment.id,
          mediaId,
          mediaTitle: mediaInfo.title,
          content: getPlainTextPreview(content, 120),
        });

        queueFcmNotification(c, {
          type: "comment_reply",
          targetUserId: parentComment.userId,
          targetClientType: parentComment.clientType,
          comment: {
            id: newComment.id,
            content,
            media_id: mediaId,
            media_title: mediaInfo.title,
            user_id: user.uid,
            username: user.username,
          },
          actor: { id: user.uid, username: user.username, avatar: user.avatar },
        });
      }

      // Mention Notifications
      const mentionedUsernames = parseMentions(content);
      if (mentionedUsernames.length > 0) {
        for (const targetName of mentionedUsernames.slice(0, 5)) {
          if (targetName.toLowerCase() === user.username.toLowerCase()) continue;

          const targetUsers = await db
            .select()
            .from(commentumUsers)
            .where(sql`lower(${commentumUsers.commentumUsername}) = ${targetName}`)
            .limit(1);

          const targetUser = targetUsers[0];
          if (targetUser && targetUser.commentumUserId !== user.uid) {
            await db.insert(notifications).values({
              userId: targetUser.commentumUserId,
              clientType: targetUser.commentumClientType,
              actorId: user.uid,
              actorUsername: user.username,
              actorAvatar: user.avatar,
              type: "mention",
              title: "You were mentioned",
              body: `${user.username} mentioned you in a comment`,
              commentId: newComment.id,
              mediaId,
              mediaTitle: mediaInfo.title,
              content: getPlainTextPreview(content, 120),
            });

            queueFcmNotification(c, {
              type: "user_mentioned",
              targetUserId: targetUser.commentumUserId,
              targetClientType: targetUser.commentumClientType,
              comment: {
                id: newComment.id,
                content,
                media_id: mediaId,
                media_title: mediaInfo.title,
                user_id: user.uid,
                username: user.username,
              },
              actor: { id: user.uid, username: user.username, avatar: user.avatar },
            });
          }
        }
      }

      // Queue Discord bot notification
      queueDiscordNotification(
        {
          type: "comment_created",
          comment: {
            id: newComment.id,
            user_id: user.uid,
            username: newComment.username,
            client_type: user.provider,
            media_id: mediaId,
            media_title: mediaInfo.title,
            media_type: mediaInfo.type,
            content,
            tag: tag ? parseInt(tag, 10) : undefined,
            labels: Array.isArray(body.tags) ? body.tags : undefined,
          },
          media: {
            id: mediaId,
            title: mediaInfo.title,
            type: mediaInfo.type,
            poster: mediaInfo.poster || undefined,
            year: mediaInfo.year || undefined,
            client_type: user.provider,
          },
        },
        c.env
      );

      // Dantotsu 2-way sync on create
      const anilistToken = body.anilist_token || c.req.header("x-anilist-token");
      const numericMediaId = parseInt(mediaId, 10);
      if (!isNaN(numericMediaId) && (user.provider === "anilist" || anilistToken)) {
        const syncDanTask = async () => {
          try {
            const auth = await danAuthenticate(anilistToken || "", c.env.DB);
            if (!auth) return;
            const parsedTag = toDantotsuTag(tag || body.tags);
            let danParentId: number | null = null;
            if (parentId) {
              const pMap = await db
                .select({ dantotsuCommentId: dantotsuIdMappings.dantotsuCommentId })
                .from(dantotsuIdMappings)
                .where(eq(dantotsuIdMappings.commentumId, parentId))
                .limit(1);
              if (pMap[0]) danParentId = pMap[0].dantotsuCommentId;
            }
            const danId = await danPostComment({
              authToken: auth.authToken,
              userId: auth.userId,
              mediaId: numericMediaId,
              content,
              tag: parsedTag,
              parentCommentId: danParentId,
            });
            if (danId) {
              await db.insert(dantotsuIdMappings).values({
                dantotsuCommentId: danId,
                commentumId: newComment.id,
                mediaId: numericMediaId,
                origin: "anymex",
              });
            }
          } catch (err) {
            console.error("[DantotsuSync] Error posting comment to Dantotsu:", err);
          }
        };

        if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
          c.executionCtx.waitUntil(syncDanTask());
        } else {
          syncDanTask();
        }
      }

      return c.json({
        success: true,
        comment: {
          id: newComment.id,
          comment_id: newComment.id,
          content: newComment.content,
          translated_content: newComment.translatedContent,
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

      if (!commentId || !newContent || isBlankContent(newContent)) {
        return c.json({ success: false, error: "comment_id and non-empty content are required for edit" }, 400);
      }

      // Rate limit edits (30/hr)
      if (!isStaff) {
        const rateCheck = await checkRateLimits(c.env.DB, [
          { key: `edit:${user.uid}`, limit: 30, windowSec: 3600 },
        ]);
        if (!rateCheck.allowed) {
          return rateLimitedResponse("Edit limit reached. Try again later.", rateCheck.retryAfter);
        }
      }

      const existing = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      const comment = existing[0];
      if (!comment) {
        return c.json({ success: false, error: "Comment not found" }, 404);
      }

      if (comment.userId !== user.uid && !isStaff) {
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

      // Dantotsu edit sync
      const syncEditTask = async () => {
        try {
          const mapRows = await db
            .select()
            .from(dantotsuIdMappings)
            .where(eq(dantotsuIdMappings.commentumId, commentId))
            .limit(1);
          if (mapRows[0]) {
            const auth = await getDanModAuth(c.env.DB);
            if (auth) {
              await danEditComment({
                authToken: auth.authToken,
                danCommentId: mapRows[0].dantotsuCommentId,
                content: newContent,
              });
            }
          }
        } catch (err) {
          console.error("[DantotsuSync] Error editing on Dantotsu:", err);
        }
      };

      if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
        c.executionCtx.waitUntil(syncEditTask());
      } else {
        syncEditTask();
      }

      return c.json({
        success: true,
        comment: updated[0],
      });
    }

    // ==========================================
    // ACTION: DELETE / MOD_DELETE
    // ==========================================
    if (action === "delete" || action === "mod_delete") {
      const commentId = parseInt(body.comment_id, 10);
      if (!commentId) {
        return c.json({ success: false, error: "comment_id is required for delete" }, 400);
      }

      // Rate limit user deletes (30/hr)
      if (!isStaff) {
        const rateCheck = await checkRateLimits(c.env.DB, [
          { key: `delete:${user.uid}`, limit: 30, windowSec: 3600 },
        ]);
        if (!rateCheck.allowed) {
          return rateLimitedResponse("Delete limit reached. Try again later.", rateCheck.retryAfter);
        }
      }

      const existing = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
      const comment = existing[0];
      if (!comment) {
        return c.json({ success: false, error: "Comment not found" }, 404);
      }

      const isAuthor = comment.userId === user.uid;
      const isModAction = action === "mod_delete" || (isStaff && !isAuthor);

      if (!isAuthor && !isStaff) {
        return c.json({ success: false, error: "Permission denied to delete this comment" }, 403);
      }

      const reason = body.reason || (isModAction ? "Deleted by moderator" : "Deleted by author");

      // Soft delete
      await db
        .update(comments)
        .set({
          deleted: true,
          deletedAt: sql`(datetime('now'))`,
          deletedBy: user.uid,
          moderated: isModAction,
          moderatedAt: isModAction ? sql`(datetime('now'))` : null,
          moderatedBy: isModAction ? user.uid : null,
          moderationReason: isModAction ? reason : null,
          moderationAction: isModAction ? "delete" : null,
          content: "[deleted]",
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(comments.id, commentId));

      // Refresh points for author after deletion
      refreshUserPoints(c.env.DB, comment.clientType, comment.userId).catch(() => {});

      // Dispatch Discord mod log if deleted by staff
      if (isModAction) {
        queueDiscordNotification(
          {
            type: "comment_deleted",
            comment: { id: commentId, content: comment.content, user_id: comment.userId },
            moderator: { id: user.uid, username: user.username },
            reason,
          },
          c.env
        );

        queueFcmNotification(c, {
          type: "comment_deleted",
          targetUserId: comment.userId,
          targetClientType: comment.clientType,
          comment: { id: comment.id, media_id: comment.mediaId },
          moderator: { id: user.uid, username: user.username },
          reason,
        });
      }

      // Dantotsu delete sync
      const syncDeleteTask = async () => {
        try {
          const mapRows = await db
            .select()
            .from(dantotsuIdMappings)
            .where(eq(dantotsuIdMappings.commentumId, commentId))
            .limit(1);
          if (mapRows[0]) {
            const auth = await getDanModAuth(c.env.DB);
            if (auth) {
              await danDeleteComment({
                authToken: auth.authToken,
                danCommentId: mapRows[0].dantotsuCommentId,
              });
            }
          }
        } catch (err) {
          console.error("[DantotsuSync] Error deleting on Dantotsu:", err);
        }
      };

      if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
        c.executionCtx.waitUntil(syncDeleteTask());
      } else {
        syncDeleteTask();
      }

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
