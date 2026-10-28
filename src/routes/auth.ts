import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth } from "../middleware/auth";
import { verifyClientToken } from "../shared/clientAuth";
import { signJwt } from "../shared/jwt";
import { createDb } from "../db";
import { commentumUsers, userPoints } from "../db/schema";
import { eq, and } from "drizzle-orm";

export const authRoutes = new Hono<AppContext>();

export function formatLinkedAccounts(user: typeof commentumUsers.$inferSelect) {
  const isAnilist = user.commentumClientType === "anilist";
  const isMal = user.commentumClientType === "mal" || user.commentumClientType === "myanimelist";
  const isSimkl = user.commentumClientType === "simkl";

  return {
    anilist: user.linkedAnilistId
      ? { id: user.linkedAnilistId, username: user.linkedAnilistUsername }
      : isAnilist
      ? { id: user.commentumUserId, username: user.commentumUsername }
      : null,
    mal: user.linkedMalId
      ? { id: user.linkedMalId, username: user.linkedMalUsername }
      : isMal
      ? { id: user.commentumUserId, username: user.commentumUsername }
      : null,
    simkl: user.linkedSimklId
      ? { id: user.linkedSimklId, username: user.linkedSimklUsername }
      : isSimkl
      ? { id: user.commentumUserId, username: user.commentumUsername }
      : null,
  };
}

/**
 * POST /auth/login
 * Exchange provider OAuth token for a signed Commentum Session JWT
 */
authRoutes.post("/login", async (c) => {
  try {
    const body = await c.req.json();
    const provider = (body.provider || body.client_type || "anilist").toLowerCase().trim();
    const token = body.access_token || body.token;

    if (!token) {
      return c.json({ success: false, error: "Missing access token" }, 400);
    }

    // 1. Verify token with provider
    const verified = await verifyClientToken(provider, token);
    if (!verified) {
      return c.json({ success: false, error: "Invalid or expired provider token" }, 401);
    }

    const db = createDb(c.env.DB);
    const unifiedSub = `${verified.provider}:${verified.provider_user_id}`;

    // 2. Lookup or upsert user in commentum_users
    const existingUsers = await db
      .select()
      .from(commentumUsers)
      .where(
        and(
          eq(commentumUsers.commentumClientType, verified.provider),
          eq(commentumUsers.commentumUserId, verified.provider_user_id)
        )
      )
      .limit(1);

    let user = existingUsers[0];

    if (!user) {
      // First-time user creation
      const inserted = await db
        .insert(commentumUsers)
        .values({
          commentumClientType: verified.provider,
          commentumUserId: verified.provider_user_id,
          commentumUsername: verified.username,
          commentumUserAvatar: verified.avatar_url,
          commentumUserRole: "user",
        })
        .returning();
      user = inserted[0];

      // Initialize user_points row
      await db.insert(userPoints).values({
        userId: verified.provider_user_id,
        clientType: verified.provider,
        totalPoints: 0,
        realPoints: 0,
        tier: "newcomer",
      }).onConflictDoNothing();
    } else {
      // Update username/avatar if changed
      const updateData: Partial<typeof commentumUsers.$inferInsert> = {};
      if (verified.username && verified.username !== user.commentumUsername) {
        updateData.commentumUsername = verified.username;
      }
      if (verified.avatar_url && verified.avatar_url !== user.commentumUserAvatar) {
        updateData.commentumUserAvatar = verified.avatar_url;
      }

      if (Object.keys(updateData).length > 0) {
        const updated = await db
          .update(commentumUsers)
          .set(updateData)
          .where(eq(commentumUsers.id, user.id))
          .returning();
        user = updated[0];
      }
    }

    // Check ban status
    if (user.commentumUserBanned) {
      return c.json({
        success: false,
        error: "Your account is permanently banned",
        banned: true,
        reason: user.commentumUserBannedReason,
      }, 403);
    }

    // 3. Fetch point totals from user_points
    const pointsRows = await db
      .select()
      .from(userPoints)
      .where(
        and(
          eq(userPoints.userId, verified.provider_user_id),
          eq(userPoints.clientType, verified.provider)
        )
      )
      .limit(1);

    const userPointRecord = pointsRows[0];

    // 4. Sign session JWT
    const { token: sessionJwt, expires_at } = await signJwt(
      {
        sub: unifiedSub,
        uid: verified.provider_user_id,
        provider: verified.provider,
        username: user.commentumUsername,
        role: user.commentumUserRole,
        avatar: user.commentumUserAvatar || undefined,
      },
      c.env.JWT_SECRET,
      7 * 24 * 60 * 60 // 7 days
    );

    return c.json({
      success: true,
      token: sessionJwt,
      session_token: sessionJwt, // backward compatibility
      token_type: "Bearer",
      expires_in: 7 * 24 * 60 * 60,
      expires_at,
      user: {
        id: user.id,
        user_id: user.commentumUserId,
        commentum_user_id: user.commentumUserId,
        client_type: user.commentumClientType,
        provider: user.commentumClientType,
        username: user.commentumUsername,
        avatar: user.commentumUserAvatar,
        role: user.commentumUserRole,
        is_muted: user.commentumUserMuted,
        total_points: userPointRecord?.totalPoints || 0,
        current_streak: userPointRecord?.currentStreak || 0,
        longest_streak: userPointRecord?.longestStreak || 0,
        avatar_decoration: user.avatarDecoration,
        banner_url: user.bannerUrl,
        banner_theme: user.bannerTheme,
        nameplate_theme: user.nameplateTheme,
        profile_effect_url: user.profileEffectUrl,
        linked_accounts: formatLinkedAccounts(user),
      },
    });
  } catch (error: any) {
    console.error("Auth login error:", error);
    return c.json({ success: false, error: error?.message || "Internal server error during login" }, 500);
  }
});

/**
 * GET /auth/me
 * Fetch profile of currently authenticated user
 */
authRoutes.get("/me", requireAuth, async (c) => {
  const jwtUser = c.get("user")!;
  const db = createDb(c.env.DB);

  const users = await db
    .select()
    .from(commentumUsers)
    .where(
      and(
        eq(commentumUsers.commentumClientType, jwtUser.provider),
        eq(commentumUsers.commentumUserId, jwtUser.uid)
      )
    )
    .limit(1);

  const user = users[0];
  if (!user) {
    return c.json({ success: false, error: "User not found" }, 404);
  }

  const pointsRows = await db
    .select()
    .from(userPoints)
    .where(
      and(
        eq(userPoints.userId, jwtUser.uid),
        eq(userPoints.clientType, jwtUser.provider)
      )
    )
    .limit(1);

  const points = pointsRows[0];

  return c.json({
    success: true,
    user: {
      id: user.id,
      user_id: user.commentumUserId,
      client_type: user.commentumClientType,
      provider: user.commentumClientType,
      username: user.commentumUsername,
      avatar: user.commentumUserAvatar,
      role: user.commentumUserRole,
      is_banned: user.commentumUserBanned,
      is_muted: user.commentumUserMuted,
      total_points: points?.totalPoints || 0,
      current_streak: points?.currentStreak || 0,
      longest_streak: points?.longestStreak || 0,
      avatar_decoration: user.avatarDecoration,
      banner_url: user.bannerUrl,
      banner_theme: user.bannerTheme,
      nameplate_theme: user.nameplateTheme,
      profile_effect_url: user.profileEffectUrl,
      unlocked_customizations: JSON.parse(user.unlockedCustomizations || "[]"),
      linked_accounts: formatLinkedAccounts(user),
    },
  });
});

/**
 * POST /auth/refresh
 * Refresh session JWT
 */
authRoutes.post("/refresh", requireAuth, async (c) => {
  const jwtUser = c.get("user")!;
  const { token, expires_at } = await signJwt(
    {
      sub: jwtUser.sub,
      uid: jwtUser.uid,
      provider: jwtUser.provider,
      username: jwtUser.username,
      role: jwtUser.role,
      avatar: jwtUser.avatar,
    },
    c.env.JWT_SECRET,
    7 * 24 * 60 * 60
  );

  return c.json({
    success: true,
    token,
    session_token: token,
    expires_at,
  });
});
