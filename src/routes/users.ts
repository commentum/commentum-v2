import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { isAdminOrHigher, isModeratorOrHigher } from "../shared/roles";
import { createDb } from "../db";
import { commentumUsers, userPoints, customizationsCatalog, comments, userPointSpends } from "../db/schema";
import { eq, and, sql, like, inArray, desc } from "drizzle-orm";
import { verifyClientToken } from "../shared/clientAuth";
import { formatLinkedAccounts } from "./auth";
import { computeUserPoints, refreshUserPoints } from "../shared/pointsEngine";

export const usersRoutes = new Hono<AppContext>();

/**
 * GET /users
 * Public profile lookup, user search, and batch customizations
 */
usersRoutes.get("/", optionalAuth, async (c) => {
  try {
    const db = createDb(c.env.DB);
    const action = (c.req.query("action") || "get_profile").toLowerCase();

    // 1. BATCH CUSTOMIZATIONS
    if (action === "get_batch_customizations") {
      const userIdsParam = c.req.query("user_ids") || "";
      const clientType = (c.req.query("client_type") || "anilist").toLowerCase();
      const userIds = userIdsParam.split(",").map((s) => s.trim()).filter(Boolean);

      if (userIds.length === 0) {
        return c.json({ success: true, customizations: {} });
      }

      const rows = await db
        .select({
          userId: commentumUsers.commentumUserId,
          avatarDecoration: commentumUsers.avatarDecoration,
          bannerUrl: commentumUsers.bannerUrl,
          bannerTheme: commentumUsers.bannerTheme,
          nameplateTheme: commentumUsers.nameplateTheme,
          profileEffectUrl: commentumUsers.profileEffectUrl,
        })
        .from(commentumUsers)
        .where(
          and(
            eq(commentumUsers.commentumClientType, clientType),
            inArray(commentumUsers.commentumUserId, userIds.slice(0, 100))
          )
        );

      const map: Record<string, any> = {};
      for (const r of rows) {
        map[r.userId] = {
          avatar_decoration: r.avatarDecoration,
          banner_url: r.bannerUrl,
          banner_theme: r.bannerTheme,
          nameplate_theme: r.nameplateTheme,
          profile_effect_url: r.profileEffectUrl,
        };
      }

      return c.json({ success: true, customizations: map });
    }

    // 2. SEARCH USERS
    if (action === "search_users" || action === "search") {
      const query = (c.req.query("q") || c.req.query("query") || "").trim();
      const page = parseInt(c.req.query("page") || "1", 10);
      const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);
      const offset = (page - 1) * limit;

      if (!query) {
        return c.json({ success: true, users: [], total: 0 });
      }

      const results = await db
        .select({
          id: commentumUsers.id,
          user_id: commentumUsers.commentumUserId,
          client_type: commentumUsers.commentumClientType,
          username: commentumUsers.commentumUsername,
          avatar: commentumUsers.commentumUserAvatar,
          role: commentumUsers.commentumUserRole,
          avatar_decoration: commentumUsers.avatarDecoration,
          banner_url: commentumUsers.bannerUrl,
        })
        .from(commentumUsers)
        .where(like(commentumUsers.commentumUsername, `%${query}%`))
        .limit(limit)
        .offset(offset);

      return c.json({
        success: true,
        page,
        limit,
        users: results,
      });
    }

    // 3. GET PROFILE
    const targetUserId = c.req.query("user_id") || c.get("user")?.uid;
    const clientType = (c.req.query("client_type") || c.get("user")?.provider || "anilist").toLowerCase();

    if (!targetUserId) {
      return c.json({ success: false, error: "user_id query parameter is required" }, 400);
    }

    const rows = await db
      .select()
      .from(commentumUsers)
      .where(
        and(
          eq(commentumUsers.commentumClientType, clientType),
          eq(commentumUsers.commentumUserId, targetUserId)
        )
      )
      .limit(1);

    const targetUser = rows[0];
    if (!targetUser) {
      return c.json({ success: false, error: "User not found" }, 404);
    }

    // Compute user points and streaks
    const pointsData = await computeUserPoints(c.env.DB, clientType, targetUserId);

    return c.json({
      success: true,
      user: {
        id: targetUser.id,
        user_id: targetUser.commentumUserId,
        client_type: targetUser.commentumClientType,
        username: targetUser.commentumUsername,
        avatar: targetUser.commentumUserAvatar,
        role: targetUser.commentumUserRole,
        is_banned: targetUser.commentumUserBanned,
        is_muted: targetUser.commentumUserMuted,
        avatar_decoration: targetUser.avatarDecoration,
        banner_url: targetUser.bannerUrl,
        banner_theme: targetUser.bannerTheme,
        nameplate_theme: targetUser.nameplateTheme,
        profile_effect_url: targetUser.profileEffectUrl,
        stats: {
          comment_count: targetUser.commentumUserCommentCount,
          vote_count: targetUser.commentumUserVoteCount,
          first_comment_at: targetUser.commentumUserFirstCommentAt,
          last_comment_at: targetUser.commentumUserLastCommentAt,
        },
        points: {
          total_points: pointsData.points,
          display_points: pointsData.display_points,
          is_infinite: pointsData.is_infinite,
          tier: pointsData.tier,
          current_streak: pointsData.current_streak,
          longest_streak: pointsData.longest_streak,
        },
        linked_accounts: formatLinkedAccounts(targetUser),
      },
    });
  } catch (error: any) {
    console.error("GET /users error:", error);
    return c.json({ success: false, error: error?.message || "Internal server error" }, 500);
  }
});

/**
 * POST /users
 * User profile customizations, unlocking items with points, role changes, and GDPR data export
 */
usersRoutes.post("/", requireAuth, async (c) => {
  try {
    const user = c.get("user")!;
    const body = await c.req.json();
    const action = (body.action || "").toLowerCase();
    const db = createDb(c.env.DB);

    // Fetch user profile
    const existingUsers = await db
      .select()
      .from(commentumUsers)
      .where(
        and(
          eq(commentumUsers.commentumClientType, user.provider),
          eq(commentumUsers.commentumUserId, user.uid)
        )
      )
      .limit(1);

    const currentUser = existingUsers[0];
    if (!currentUser) {
      return c.json({ success: false, error: "User not found" }, 404);
    }

    // ==========================================
    // ACTION: CHANGE ROLE (Staff only)
    // ==========================================
    if (action === "change_role") {
      if (!isAdminOrHigher(user.role)) {
        return c.json({ success: false, error: "Admin permissions required to change roles" }, 403);
      }

      const targetUserId = String(body.target_user_id || body.user_id || "");
      const targetClient = (body.client_type || "anilist").toLowerCase();
      const newRole = (body.new_role || body.role || "").toLowerCase();

      const validRoles = ["user", "moderator", "admin", "super_admin", "owner", "app_owner"];
      if (!validRoles.includes(newRole)) {
        return c.json({ success: false, error: `Invalid role: ${newRole}` }, 400);
      }

      // Update role in commentum_users
      await db
        .update(commentumUsers)
        .set({
          commentumUserRole: newRole,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(
          and(
            eq(commentumUsers.commentumClientType, targetClient),
            eq(commentumUsers.commentumUserId, targetUserId)
          )
        );

      // Cascade role update to all user's comments (033)
      await db
        .update(comments)
        .set({
          userRole: newRole,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(
          and(
            eq(comments.clientType, targetClient),
            eq(comments.userId, targetUserId)
          )
        );

      return c.json({
        success: true,
        message: `Role changed to ${newRole} for user ${targetUserId}`,
        role: newRole,
      });
    }

    // ==========================================
    // ACTION: GET USER HISTORY (Moderation / Warnings)
    // ==========================================
    if (action === "get_user_history") {
      const isStaff = isModeratorOrHigher(user.role);
      const targetUserId = String(body.target_user_id || user.uid);
      const targetClient = (body.client_type || user.provider).toLowerCase();

      // Only staff can view other users' history
      if (targetUserId !== user.uid && !isStaff) {
        return c.json({ success: false, error: "Permission denied" }, 403);
      }

      const targetRows = await db
        .select()
        .from(commentumUsers)
        .where(
          and(
            eq(commentumUsers.commentumClientType, targetClient),
            eq(commentumUsers.commentumUserId, targetUserId)
          )
        )
        .limit(1);

      const target = targetRows[0];
      if (!target) {
        return c.json({ success: false, error: "User not found" }, 404);
      }

      return c.json({
        success: true,
        history: {
          warnings_count: target.commentumUserWarnings,
          warning_details: JSON.parse(target.commentumUserWarningDetails || "[]"),
          last_warning_at: target.commentumUserLastWarningAt,
          last_warning_reason: target.commentumUserLastWarningReason,
          is_banned: target.commentumUserBanned,
          banned_until: target.commentumUserBannedUntil,
          banned_reason: target.commentumUserBannedReason,
          is_muted: target.commentumUserMuted,
          muted_until: target.commentumUserMutedUntil,
          muted_reason: target.commentumUserMutedReason,
          moderation_history: JSON.parse(target.commentumUserModerationHistory || "[]"),
        },
      });
    }

    // ==========================================
    // ACTION: UNLOCK CUSTOMIZATION
    // ==========================================
    if (action === "unlock_customization") {
      const customizationId = body.customization_id || body.id;
      if (!customizationId) {
        return c.json({ success: false, error: "customization_id is required" }, 400);
      }

      // Check catalog item
      const itemRows = await db
        .select()
        .from(customizationsCatalog)
        .where(eq(customizationsCatalog.id, customizationId))
        .limit(1);

      const item = itemRows[0];
      if (!item) {
        return c.json({ success: false, error: "Catalog item not found" }, 404);
      }

      const unlocked = JSON.parse(currentUser.unlockedCustomizations || "[]") as string[];
      if (unlocked.includes(customizationId)) {
        return c.json({ success: true, message: "Item is already unlocked", unlocked: true });
      }

      // Check points balance via points engine
      const userPointsData = await computeUserPoints(c.env.DB, user.provider, user.uid);
      if (!userPointsData.is_infinite && userPointsData.points < item.pointsRequired) {
        return c.json({
          success: false,
          error: `Insufficient points. Required: ${item.pointsRequired}, Available: ${userPointsData.points}`,
        }, 400);
      }

      // Record idempotent spend (049)
      if (item.pointsRequired > 0) {
        const spendId = crypto.randomUUID();
        await db.insert(userPointSpends).values({
          id: spendId,
          userId: user.uid,
          clientType: user.provider,
          points: item.pointsRequired,
          refId: `unlock_customization:${customizationId}:${user.provider}:${user.uid}`,
        });

        // Recompute points & sync
        await refreshUserPoints(c.env.DB, user.provider, user.uid);
      }

      // Add to user inventory
      unlocked.push(customizationId);
      await db
        .update(commentumUsers)
        .set({
          unlockedCustomizations: JSON.stringify(unlocked),
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(commentumUsers.id, currentUser.id));

      return c.json({
        success: true,
        message: `Unlocked "${item.title}" successfully`,
        unlocked_customizations: unlocked,
      });
    }

    // ==========================================
    // ACTION: UPDATE CUSTOMIZATIONS (Equip items)
    // ==========================================
    if (action === "update_customizations") {
      const updates: Partial<typeof commentumUsers.$inferInsert> = {
        updatedAt: new Date().toISOString(),
      };

      if (body.avatar_decoration !== undefined) updates.avatarDecoration = body.avatar_decoration;
      if (body.banner_url !== undefined) updates.bannerUrl = body.banner_url;
      if (body.banner_theme !== undefined) updates.bannerTheme = body.banner_theme;
      if (body.nameplate_theme !== undefined) updates.nameplateTheme = body.nameplate_theme;
      if (body.profile_effect_url !== undefined) updates.profileEffectUrl = body.profile_effect_url;

      await db
        .update(commentumUsers)
        .set(updates)
        .where(eq(commentumUsers.id, currentUser.id));

      return c.json({
        success: true,
        message: "Profile customizations updated",
        customizations: {
          avatar_decoration: updates.avatarDecoration ?? currentUser.avatarDecoration,
          banner_url: updates.bannerUrl ?? currentUser.bannerUrl,
          banner_theme: updates.bannerTheme ?? currentUser.bannerTheme,
          nameplate_theme: updates.nameplateTheme ?? currentUser.nameplateTheme,
          profile_effect_url: updates.profileEffectUrl ?? currentUser.profileEffectUrl,
        },
      });
    }

    // ==========================================
    // ACTION: EXPORT MY DATA (GDPR)
    // ==========================================
    if (action === "export_my_data") {
      const userComments = await db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.clientType, user.provider),
            eq(comments.userId, user.uid)
          )
        );

      return c.json({
        success: true,
        export: {
          profile: currentUser,
          comments_count: userComments.length,
          comments: userComments,
          exported_at: new Date().toISOString(),
        },
      });
    }

    // ==========================================
    // ACTION: LINK ACCOUNT
    // ==========================================
    if (action === "link_account") {
      const targetClientType = (body.target_client_type || "").toLowerCase().trim();
      const targetAccessToken = body.target_access_token || body.target_token;

      if (!targetClientType || !targetAccessToken) {
        return c.json({ success: false, error: "target_client_type and target_access_token are required" }, 400);
      }

      const normTarget = targetClientType === "myanimelist" ? "mal" : targetClientType;
      const normPrimary = currentUser.commentumClientType === "myanimelist" ? "mal" : currentUser.commentumClientType;

      if (normTarget === normPrimary) {
        return c.json({ success: false, error: "Cannot link the same service type to itself" }, 400);
      }

      const verified = await verifyClientToken(normTarget, targetAccessToken);
      if (!verified) {
        return c.json({ success: false, error: `Invalid or expired ${targetClientType} access token` }, 401);
      }

      const updateFields: Partial<typeof commentumUsers.$inferInsert> = {
        updatedAt: new Date().toISOString(),
      };

      if (normTarget === "anilist") {
        updateFields.linkedAnilistId = verified.provider_user_id;
        updateFields.linkedAnilistUsername = verified.username;
      } else if (normTarget === "mal") {
        updateFields.linkedMalId = verified.provider_user_id;
        updateFields.linkedMalUsername = verified.username;
      } else if (normTarget === "simkl") {
        updateFields.linkedSimklId = verified.provider_user_id;
        updateFields.linkedSimklUsername = verified.username;
      }

      const updated = await db
        .update(commentumUsers)
        .set(updateFields)
        .where(eq(commentumUsers.id, currentUser.id))
        .returning();

      // Refresh points for unified account balance
      await refreshUserPoints(c.env.DB, user.provider, user.uid);

      return c.json({
        success: true,
        message: `Successfully linked ${targetClientType} account (${verified.username})`,
        linked_accounts: formatLinkedAccounts(updated[0]),
      });
    }

    // ==========================================
    // ACTION: UNLINK ACCOUNT
    // ==========================================
    if (action === "unlink_account") {
      const serviceToUnlink = (body.service_to_unlink || "").toLowerCase().trim();
      if (!serviceToUnlink) {
        return c.json({ success: false, error: "service_to_unlink is required" }, 400);
      }

      const normUnlink = serviceToUnlink === "myanimelist" ? "mal" : serviceToUnlink;
      const normPrimary = currentUser.commentumClientType === "myanimelist" ? "mal" : currentUser.commentumClientType;

      if (normPrimary === normUnlink) {
        return c.json({ success: false, error: "Cannot unlink your primary account" }, 400);
      }

      const updateFields: Partial<typeof commentumUsers.$inferInsert> = {
        updatedAt: new Date().toISOString(),
      };

      if (normUnlink === "anilist") {
        updateFields.linkedAnilistId = null;
        updateFields.linkedAnilistUsername = null;
      } else if (normUnlink === "mal") {
        updateFields.linkedMalId = null;
        updateFields.linkedMalUsername = null;
      } else if (normUnlink === "simkl") {
        updateFields.linkedSimklId = null;
        updateFields.linkedSimklUsername = null;
      }

      const updated = await db
        .update(commentumUsers)
        .set(updateFields)
        .where(eq(commentumUsers.id, currentUser.id))
        .returning();

      await refreshUserPoints(c.env.DB, user.provider, user.uid);

      return c.json({
        success: true,
        message: `Successfully unlinked ${serviceToUnlink}`,
        linked_accounts: formatLinkedAccounts(updated[0]),
      });
    }

    return c.json({ success: false, error: `Unknown users action: ${action}` }, 400);
  } catch (error: any) {
    console.error("POST /users error:", error);
    return c.json({ success: false, error: error?.message || "Internal server error" }, 500);
  }
});
