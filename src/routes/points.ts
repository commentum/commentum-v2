import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { createDb } from "../db";
import { userPoints, userAdRewards, userPointSpends, commentumUsers } from "../db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { computeUserPoints, refreshUserPoints } from "../shared/pointsEngine";
import { checkRateLimits, rateLimitedResponse } from "../shared/rateLimit";

export const pointsRoutes = new Hono<AppContext>();

/**
 * GET /points or POST /points
 * Points, streaks, leaderboard, AdMob claims, and idempotent spending
 */
async function handlePointsRequest(c: any, action: string, data: any) {
  const user = c.get("user");
  const db = createDb(c.env.DB);

  // ==========================================
  // 1. GET LEADERBOARD (Public)
  // ==========================================
  if (action === "get_leaderboard") {
    const limit = Math.min(parseInt(data.limit || "50", 10), 100);

    const leaders = await db
      .select({
        user_id: userPoints.userId,
        client_type: userPoints.clientType,
        total_points: userPoints.totalPoints,
        real_points: userPoints.realPoints,
        tier: userPoints.tier,
        current_streak: userPoints.currentStreak,
        longest_streak: userPoints.longestStreak,
        username: commentumUsers.commentumUsername,
        avatar: commentumUsers.commentumUserAvatar,
        role: commentumUsers.commentumUserRole,
        avatar_decoration: commentumUsers.avatarDecoration,
        banner_url: commentumUsers.bannerUrl,
        banner_theme: commentumUsers.bannerTheme,
        nameplate_theme: commentumUsers.nameplateTheme,
      })
      .from(userPoints)
      .leftJoin(
        commentumUsers,
        and(
          eq(userPoints.userId, commentumUsers.commentumUserId),
          eq(userPoints.clientType, commentumUsers.commentumClientType)
        )
      )
      .orderBy(desc(userPoints.totalPoints))
      .limit(limit);

    const ranked = leaders.map((l, index) => ({
      rank: index + 1,
      ...l,
      display_points: l.role === "owner" || l.role === "app_owner" ? "∞" : String(l.total_points),
    }));

    return c.json({
      success: true,
      leaderboard: ranked,
    });
  }

  // ==========================================
  // 2. GET BATCH USER POINTS (Public)
  // ==========================================
  if (action === "get_batch_user_points") {
    const userIds = Array.isArray(data.user_ids) ? data.user_ids.map(String) : [];
    const clientType = (data.client_type || "anilist").toLowerCase();

    if (userIds.length === 0) {
      return c.json({ success: true, points: {} });
    }

    const rows = await db
      .select({
        userId: userPoints.userId,
        totalPoints: userPoints.totalPoints,
        tier: userPoints.tier,
        currentStreak: userPoints.currentStreak,
      })
      .from(userPoints)
      .where(
        and(
          eq(userPoints.clientType, clientType),
          inArray(userPoints.userId, userIds.slice(0, 100))
        )
      );

    const map: Record<string, any> = {};
    for (const r of rows) {
      map[r.userId] = {
        total_points: r.totalPoints,
        tier: r.tier,
        current_streak: r.currentStreak,
      };
    }

    return c.json({ success: true, points: map });
  }

  // Authentication required for personal points & transactions
  if (!user) {
    return c.json({ success: false, error: "Authentication required" }, 401);
  }

  // ==========================================
  // 3. CLAIM AD POINTS (AdMob / voluntary rewarded ads)
  // ==========================================
  if (action === "claim_ad_points") {
    const adId = String(data.ad_id || data.refer_id || "").trim();
    const pointsReward = Math.min(parseInt(data.points || data.points_reward || "10", 10), 100);

    if (!adId) {
      return c.json({ success: false, error: "ad_id is required" }, 400);
    }

    // Rate limits (5/min, 30/hr)
    const rateCheck = await checkRateLimits(c.env.DB, [
      { key: `ad:burst:${user.uid}`, limit: 5, windowSec: 60 },
      { key: `ad:hourly:${user.uid}`, limit: 30, windowSec: 3600 },
    ]);
    if (!rateCheck.allowed) {
      return rateLimitedResponse("Ad reward limit reached. Please try again later.", rateCheck.retryAfter);
    }

    // Deduplication check
    const existingClaim = await db
      .select()
      .from(userAdRewards)
      .where(eq(userAdRewards.adId, adId))
      .limit(1);

    if (existingClaim.length > 0) {
      return c.json({ success: false, error: "Reward for this ad has already been claimed", duplicate: true }, 400);
    }

    const claimId = crypto.randomUUID();

    // Record ad reward
    await db.insert(userAdRewards).values({
      id: claimId,
      userId: user.uid,
      clientType: user.provider,
      adId,
      points: pointsReward,
    });

    // Recompute points & sync
    const updated = await refreshUserPoints(c.env.DB, user.provider, user.uid);

    return c.json({
      success: true,
      claimed: true,
      points_added: pointsReward,
      ad_id: adId,
      points: updated.points,
      tier: updated.tier,
    });
  }

  // ==========================================
  // 4. SPEND POINTS IDEMPOTENT (049)
  // ==========================================
  if (action === "spend_points" || action === "spend_points_once") {
    const refId = String(data.ref_id || data.reference_id || "").trim();
    const pointsToSpend = parseInt(data.points, 10);

    if (!refId) {
      return c.json({ success: false, error: "ref_id is required for idempotent spend" }, 400);
    }
    if (isNaN(pointsToSpend) || pointsToSpend <= 0) {
      return c.json({ success: false, error: "points must be a positive integer" }, 400);
    }

    // Check if already spent with this ref_id
    const existingSpend = await db
      .select()
      .from(userPointSpends)
      .where(eq(userPointSpends.refId, refId))
      .limit(1);

    if (existingSpend.length > 0) {
      return c.json({
        success: true,
        spent: true,
        duplicate: true,
        message: "Spend transaction previously completed",
        spend_id: existingSpend[0].id,
      });
    }

    // Check available points
    const current = await computeUserPoints(c.env.DB, user.provider, user.uid);
    if (!current.is_infinite && current.points < pointsToSpend) {
      return c.json({
        success: false,
        error: `Insufficient points. Available: ${current.points}, Required: ${pointsToSpend}`,
      }, 400);
    }

    const spendId = crypto.randomUUID();
    await db.insert(userPointSpends).values({
      id: spendId,
      userId: user.uid,
      clientType: user.provider,
      points: pointsToSpend,
      refId,
    });

    const updated = await refreshUserPoints(c.env.DB, user.provider, user.uid);

    return c.json({
      success: true,
      spent: true,
      points_spent: pointsToSpend,
      remaining_points: updated.points,
      spend_id: spendId,
    });
  }

  // ==========================================
  // 5. REFRESH USER POINTS
  // ==========================================
  if (action === "refresh_user") {
    const updated = await refreshUserPoints(c.env.DB, user.provider, user.uid);
    return c.json({ success: true, points: updated });
  }

  // ==========================================
  // 6. GET USER POINTS (Default)
  // ==========================================
  const computed = await computeUserPoints(c.env.DB, user.provider, user.uid);

  // Calculate user's leaderboard rank
  const rankResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(userPoints)
    .where(sql`total_points > ${computed.points}`);

  const leaderboardRank = (rankResult[0]?.count || 0) + 1;

  // Background refresh to keep user_points synchronized
  refreshUserPoints(c.env.DB, user.provider, user.uid).catch(() => {});

  return c.json({
    success: true,
    points: {
      total_points: computed.points,
      points: computed.points,
      real_points: computed.real_points,
      display_points: computed.display_points,
      is_infinite: computed.is_infinite,
      points_spent: computed.points_spent,
      points_bonus: computed.points_bonus,
      tier: computed.tier,
      current_streak: computed.current_streak,
      longest_streak: computed.longest_streak,
      streak: computed.current_streak,
      leaderboard_rank: leaderboardRank,
      next_tier_at: computed.next_tier_at,
      points_to_next_tier: computed.points_to_next_tier,
      breakdown: computed.breakdown,
    },
  });
}

pointsRoutes.get("/", optionalAuth, async (c) => {
  const action = (c.req.query("action") || "get_points").toLowerCase();
  return handlePointsRequest(c, action, {
    limit: c.req.query("limit"),
    client_type: c.req.query("client_type"),
    user_ids: c.req.query("user_ids") ? c.req.query("user_ids")!.split(",") : undefined,
  });
});

pointsRoutes.post("/", optionalAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const action = (body.action || c.req.query("action") || "get_points").toLowerCase();
  return handlePointsRequest(c, action, body);
});
