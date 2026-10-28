import { Hono } from "hono";
import { AppContext } from "../types/env";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { createDb } from "../db";
import { userPoints, userAdRewards, commentumUsers } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export const pointsRoutes = new Hono<AppContext>();

/**
 * GET /points or POST /points
 * Points, streaks, leaderboard, and AdMob reward claims
 */
async function handlePointsRequest(c: any, action: string, data: any) {
  const user = c.get("user");
  const db = createDb(c.env.DB);

  // 1. GET LEADERBOARD
  if (action === "get_leaderboard") {
    const limit = Math.min(parseInt(data.limit || "50", 10), 100);

    const leaders = await db
      .select({
        user_id: userPoints.userId,
        client_type: userPoints.clientType,
        total_points: userPoints.totalPoints,
        tier: userPoints.tier,
        current_streak: userPoints.currentStreak,
        longest_streak: userPoints.longestStreak,
        username: commentumUsers.commentumUsername,
        avatar: commentumUsers.commentumUserAvatar,
        role: commentumUsers.commentumUserRole,
        avatar_decoration: commentumUsers.avatarDecoration,
        banner_url: commentumUsers.bannerUrl,
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
    }));

    return c.json({
      success: true,
      leaderboard: ranked,
    });
  }

  // Authentication required for personal points & ad claims
  if (!user) {
    return c.json({ success: false, error: "Authentication required" }, 401);
  }

  // 2. CLAIM AD POINTS (AdMob / voluntary rewarded ads)
  if (action === "claim_ad_points") {
    const adId = String(data.ad_id || data.refer_id || "").trim();
    const pointsReward = parseInt(data.points || data.points_reward || "10", 10);

    if (!adId) {
      return c.json({ success: false, error: "ad_id is required" }, 400);
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

    // Record ad reward transaction
    await db.insert(userAdRewards).values({
      id: claimId,
      userId: user.uid,
      clientType: user.provider,
      adId,
      points: pointsReward,
    });

    // Update user points atomically
    await db
      .insert(userPoints)
      .values({
        userId: user.uid,
        clientType: user.provider,
        totalPoints: pointsReward,
        realPoints: 0,
        pointsBonus: pointsReward,
        pointsSpent: 0,
        tier: "newcomer",
      })
      .onConflictDoUpdate({
        target: [userPoints.userId, userPoints.clientType],
        set: {
          totalPoints: sql`total_points + ${pointsReward}`,
          pointsBonus: sql`points_bonus + ${pointsReward}`,
          updatedAt: sql`(datetime('now'))`,
        },
      });

    return c.json({
      success: true,
      claimed: true,
      points_added: pointsReward,
      ad_id: adId,
    });
  }

  // 3. GET POINTS (Default)
  const rows = await db
    .select()
    .from(userPoints)
    .where(
      and(
        eq(userPoints.userId, user.uid),
        eq(userPoints.clientType, user.provider)
      )
    )
    .limit(1);

  const pt = rows[0] || {
    totalPoints: 0,
    realPoints: 0,
    pointsBonus: 0,
    pointsSpent: 0,
    tier: "newcomer",
    currentStreak: 0,
    longestStreak: 0,
  };

  return c.json({
    success: true,
    points: {
      total_points: pt.totalPoints,
      real_points: pt.realPoints,
      points_bonus: pt.pointsBonus,
      points_spent: pt.pointsSpent,
      tier: pt.tier,
      current_streak: pt.currentStreak,
      longest_streak: pt.longestStreak,
      streak: pt.currentStreak,
    },
  });
}

pointsRoutes.get("/", optionalAuth, async (c) => {
  const action = (c.req.query("action") || "get_points").toLowerCase();
  return handlePointsRequest(c, action, { limit: c.req.query("limit") });
});

pointsRoutes.post("/", optionalAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const action = (body.action || c.req.query("action") || "get_points").toLowerCase();
  return handlePointsRequest(c, action, body);
});
