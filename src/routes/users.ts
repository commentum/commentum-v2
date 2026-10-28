import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { createDb } from "../db";
import { commentumUsers, userPoints, customizationsCatalog, comments } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { verifyClientToken } from "../shared/clientAuth";
import { formatLinkedAccounts } from "./auth";

export const usersRoutes = new Hono<AppContext>();

/**
 * POST /users
 * User profile customizations, unlocking items with points, and GDPR data export
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

      // Check points balance
      const pointsRows = await db
        .select()
        .from(userPoints)
        .where(
          and(
            eq(userPoints.userId, user.uid),
            eq(userPoints.clientType, user.provider)
          )
        )
        .limit(1);

      const userPointRec = pointsRows[0];
      const currentPoints = userPointRec?.totalPoints || 0;

      if (currentPoints < item.pointsRequired) {
        return c.json({
          success: false,
          error: `Insufficient points. Required: ${item.pointsRequired}, Available: ${currentPoints}`,
        }, 400);
      }

      // Deduct points
      if (item.pointsRequired > 0) {
        await db
          .update(userPoints)
          .set({
            totalPoints: sql`total_points - ${item.pointsRequired}`,
            pointsSpent: sql`points_spent + ${item.pointsRequired}`,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(
            and(
              eq(userPoints.userId, user.uid),
              eq(userPoints.clientType, user.provider)
            )
          );
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
    // ACTION: LINK ACCOUNT (AniList, MAL, Simkl)
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

      // Verify target provider OAuth token
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
