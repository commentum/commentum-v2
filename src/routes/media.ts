import { Hono } from "hono";
import { AppContext } from "../types/env";
import { optionalAuth, requireAuth } from "../middleware/auth";
import { createDb } from "../db";
import { comments, mediaIdMap, commentumUsers } from "../db/schema";
import { eq, and, desc, asc, or, inArray, isNull } from "drizzle-orm";

export const mediaRoutes = new Hono<AppContext>();

/**
 * GET /media
 * Fetch comments for a media item with cross-client merging and user votes
 */
mediaRoutes.get("/", optionalAuth, async (c) => {
  try {
    const mediaId = c.req.query("media_id");
    const clientType = c.req.query("client_type") || "anilist";
    const mediaType = c.req.query("media_type") || c.req.query("type") || "anime";
    const episode = c.req.query("episode");
    const chapter = c.req.query("chapter");
    const sort = c.req.query("sort") || "newest";
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = Math.min(parseInt(c.req.query("limit") || "30", 10), 100);
    const offset = (page - 1) * limit;
    const mergeParam = c.req.query("merge");

    if (!mediaId) {
      return c.json({ success: false, error: "media_id query parameter is required" }, 400);
    }

    const db = createDb(c.env.DB);
    const currentUser = c.get("user");
    const currentUserId = currentUser?.uid;

    // 1. Cross-client mapping lookup (unless merge=false)
    let targetPairs: { clientType: string; mediaId: string }[] = [{ clientType, mediaId }];

    if (mergeParam !== "false") {
      const mapping = await db
        .select({ mapKey: mediaIdMap.mapKey })
        .from(mediaIdMap)
        .where(and(eq(mediaIdMap.clientType, clientType), eq(mediaIdMap.mediaId, mediaId)))
        .limit(1);

      if (mapping.length > 0 && mapping[0].mapKey) {
        const equivs = await db
          .select({ clientType: mediaIdMap.clientType, mediaId: mediaIdMap.mediaId })
          .from(mediaIdMap)
          .where(eq(mediaIdMap.mapKey, mapping[0].mapKey));

        if (equivs.length > 1) {
          targetPairs = equivs;
        }
      }
    }

    // 2. Build media match conditions
    const matchConditions = targetPairs.map((p) =>
      and(eq(comments.clientType, p.clientType), eq(comments.mediaId, p.mediaId))
    );
    const mediaOrClause = matchConditions.length === 1 ? matchConditions[0] : or(...matchConditions);

    // 3. Optional episode/chapter filters
    const extraFilters = [eq(comments.deleted, false), isNull(comments.parentId)];
    if (episode) {
      extraFilters.push(eq(comments.episode, episode));
    }
    if (chapter) {
      extraFilters.push(eq(comments.chapter, chapter));
    }

    // 4. Fetch top-level comments
    let orderByClause = desc(comments.createdAt);
    if (sort === "best" || sort === "top") {
      orderByClause = desc(comments.voteScore);
    } else if (sort === "oldest") {
      orderByClause = asc(comments.createdAt);
    }

    const topComments = await db
      .select()
      .from(comments)
      .where(and(mediaOrClause, ...extraFilters))
      .orderBy(desc(comments.pinned), orderByClause)
      .limit(limit)
      .offset(offset);

    // 5. Fetch thread replies for all top-level comments
    const topIds = topComments.map((tc) => tc.id);
    let repliesMap: Record<number, typeof comments.$inferSelect[]> = {};

    if (topIds.length > 0) {
      const allReplies = await db
        .select()
        .from(comments)
        .where(and(inArray(comments.parentId, topIds), eq(comments.deleted, false)))
        .orderBy(asc(comments.createdAt));

      for (const rep of allReplies) {
        if (rep.parentId) {
          if (!repliesMap[rep.parentId]) repliesMap[rep.parentId] = [];
          repliesMap[rep.parentId].push(rep);
        }
      }
    }

    // 6. Enrich comments with author's active customizations & personal user_vote
    const enrichComment = (com: typeof comments.$inferSelect) => {
      let userVote = 0;
      if (currentUserId && com.userVotes) {
        try {
          const votesObj = JSON.parse(com.userVotes);
          userVote = votesObj[currentUserId] || 0;
        } catch {}
      }

      const commentReplies = (repliesMap[com.id] || []).map((rep) => ({
        id: rep.id,
        comment_id: rep.id,
        user_id: rep.userId,
        username: rep.username,
        user_avatar: rep.userAvatar,
        user_role: rep.userRole,
        avatar_decoration: rep.avatarDecoration,
        banner_url: rep.bannerUrl,
        content: rep.content,
        parent_id: rep.parentId,
        created_at: rep.createdAt,
        updated_at: rep.updatedAt,
        upvotes: rep.upvotes,
        downvotes: rep.downvotes,
        vote_score: rep.voteScore,
        user_vote: currentUserId && rep.userVotes ? (JSON.parse(rep.userVotes || "{}")[currentUserId] || 0) : 0,
        tags: JSON.parse(rep.tags || "[]"),
        tag: rep.tag,
        is_edited: rep.edited,
      }));

      return {
        id: com.id,
        comment_id: com.id,
        client_type: com.clientType,
        user_id: com.userId,
        username: com.username,
        user_avatar: com.userAvatar,
        user_role: com.userRole,
        avatar_decoration: com.avatarDecoration,
        banner_url: com.bannerUrl,
        media_id: com.mediaId,
        media_type: com.mediaType,
        media_title: com.mediaTitle,
        episode: com.episode,
        chapter: com.chapter,
        content: com.content,
        created_at: com.createdAt,
        updated_at: com.updatedAt,
        pinned: com.pinned,
        locked: com.locked,
        upvotes: com.upvotes,
        downvotes: com.downvotes,
        vote_score: com.voteScore,
        user_vote: userVote,
        tags: JSON.parse(com.tags || "[]"),
        tag: com.tag,
        is_edited: com.edited,
        replies_count: commentReplies.length,
        replies: commentReplies,
      };
    };

    const formattedComments = topComments.map(enrichComment);

    return c.json({
      success: true,
      media_id: mediaId,
      client_type: clientType,
      page,
      limit,
      total_count: formattedComments.length,
      comments: formattedComments,
    });
  } catch (error: any) {
    console.error("GET /media error:", error);
    return c.json({ success: false, error: error?.message || "Failed to fetch media comments" }, 500);
  }
});
