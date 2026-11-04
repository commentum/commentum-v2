import { D1Database } from "@cloudflare/workers-types";
import { comments, commentumUsers, userPoints, userAdRewards, userPointAdjustments, userPointSpends, config } from "../db/schema";
import { eq, and, sql, desc, or, inArray } from "drizzle-orm";
import { createDb } from "../db";

export interface PointsBreakdown {
  from_comments: number;
  from_upvotes_received: number;
  from_downvotes_received: number;
  from_votes_cast: number;
  from_pinned: number;
  from_streak_bonus: number;
  from_role_bonus: number;
  from_ads: number;
  adjustments: number;
  points_spent: number;
}

export interface ComputedPoints {
  points: number;
  real_points: number;
  points_spent: number;
  points_bonus: number;
  tier: "newcomer" | "regular" | "active" | "veteran" | "elite";
  current_streak: number;
  longest_streak: number;
  is_infinite: boolean;
  display_points: string;
  next_tier_at: number | null;
  points_to_next_tier: number | null;
  breakdown: PointsBreakdown;
  role: string;
}

function getTier(totalPoints: number, isInfinite: boolean): "newcomer" | "regular" | "active" | "veteran" | "elite" {
  if (isInfinite) return "elite";
  if (totalPoints >= 5000) return "elite";
  if (totalPoints >= 1500) return "veteran";
  if (totalPoints >= 500) return "active";
  if (totalPoints >= 100) return "regular";
  return "newcomer";
}

function getNextTierAt(totalPoints: number, isInfinite: boolean): number | null {
  if (isInfinite) return null;
  if (totalPoints < 100) return 100;
  if (totalPoints < 500) return 500;
  if (totalPoints < 1500) return 1500;
  if (totalPoints < 5000) return 5000;
  return null;
}

const normClient = (c: string) => {
  const v = String(c || "").toLowerCase().trim();
  return v === "myanimelist" ? "mal" : v;
};

/**
 * Calculates current consecutive comment streak and all-time longest streak
 */
export async function calculateStreaks(
  d1: D1Database,
  targetPairs: { clientType: string; userId: string }[]
): Promise<{ currentStreak: number; longestStreak: number }> {
  const db = createDb(d1);
  const conditions = targetPairs.map((p) =>
    and(
      eq(comments.clientType, p.clientType),
      eq(comments.userId, p.userId),
      eq(comments.deleted, false)
    )
  );

  const orClause = conditions.length === 1 ? conditions[0] : or(...conditions);

  // Fetch unique comment dates
  const rows = await db
    .select({
      dateStr: sql<string>`DISTINCT date(created_at)`,
    })
    .from(comments)
    .where(orClause)
    .orderBy(desc(sql`date(created_at)`));

  if (!rows || rows.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const dateList = rows.map((r) => r.dateStr).filter(Boolean);
  if (dateList.length === 0) return { currentStreak: 0, longestStreak: 0 };

  const parsedDates = dateList.map((d) => new Date(d + "T00:00:00Z").getTime());

  // Gaps-and-islands streak calculation
  let longestStreak = 1;
  let currentRun = 1;
  const ONE_DAY_MS = 86400 * 1000;

  for (let i = 0; i < parsedDates.length - 1; i++) {
    const diff = (parsedDates[i] - parsedDates[i + 1]) / ONE_DAY_MS;
    if (Math.round(diff) === 1) {
      currentRun++;
      if (currentRun > longestStreak) longestStreak = currentRun;
    } else {
      currentRun = 1;
    }
  }

  // Check if current streak is active (activity today or yesterday)
  const todayMs = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const mostRecentMs = parsedDates[0];
  const daysSinceRecent = (todayMs - mostRecentMs) / ONE_DAY_MS;

  let currentStreak = 0;
  if (daysSinceRecent <= 1) {
    let run = 1;
    for (let i = 0; i < parsedDates.length - 1; i++) {
      const diff = (parsedDates[i] - parsedDates[i + 1]) / ONE_DAY_MS;
      if (Math.round(diff) === 1) {
        run++;
      } else {
        break;
      }
    }
    currentStreak = run;
  }

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
  };
}

/**
 * Full computation of user points including linked accounts unification (048),
 * streaks (019), ad rewards (047), manual adjustments (052), and idempotent spends (049).
 */
export async function computeUserPoints(
  d1: D1Database,
  clientType: string,
  userId: string
): Promise<ComputedPoints> {
  const db = createDb(d1);
  const normalizedClient = normClient(clientType);

  // 1. Resolve master record & all linked account pairs
  const userRows = await db
    .select()
    .from(commentumUsers)
    .where(
      and(
        eq(commentumUsers.commentumClientType, normalizedClient),
        eq(commentumUsers.commentumUserId, userId)
      )
    )
    .limit(1);

  const primaryUser = userRows[0];
  const pairs: { clientType: string; userId: string }[] = [{ clientType: normalizedClient, userId }];

  if (primaryUser) {
    if (primaryUser.linkedAnilistId) {
      pairs.push({ clientType: "anilist", userId: primaryUser.linkedAnilistId });
    }
    if (primaryUser.linkedMalId) {
      pairs.push({ clientType: "mal", userId: primaryUser.linkedMalId });
    }
    if (primaryUser.linkedSimklId) {
      pairs.push({ clientType: "simkl", userId: primaryUser.linkedSimklId });
    }
  }

  // 2. Streaks calculation
  const { currentStreak, longestStreak } = await calculateStreaks(d1, pairs);

  // 3. Comment statistics across accounts
  const matchConds = pairs.map((p) =>
    and(
      eq(comments.clientType, p.clientType),
      eq(comments.userId, p.userId),
      eq(comments.deleted, false)
    )
  );
  const commentFilter = matchConds.length === 1 ? matchConds[0] : or(...matchConds);

  const userComments = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      pinned: comments.pinned,
      upvotes: comments.upvotes,
      downvotes: comments.downvotes,
    })
    .from(comments)
    .where(commentFilter);

  let topLevelCount = 0;
  let replyCount = 0;
  let pinnedCount = 0;
  let upvotesReceived = 0;
  let downvotesReceived = 0;

  for (const c of userComments) {
    if (c.parentId) replyCount++;
    else topLevelCount++;
    if (c.pinned) pinnedCount++;
    upvotesReceived += c.upvotes || 0;
    downvotesReceived += c.downvotes || 0;
  }

  const votesCast = primaryUser?.commentumUserVoteCount || 0;
  const userRole = primaryUser?.commentumUserRole || "user";
  const isInfinite = userRole === "owner" || userRole === "app_owner";

  // Point weights (from config / default)
  const ptsFromComments = topLevelCount * 5 + replyCount * 3;
  const ptsFromUpvotes = upvotesReceived * 2;
  const ptsFromDownvotes = downvotesReceived * 1;
  const ptsFromVotesCast = votesCast * 1;
  const ptsFromPinned = pinnedCount * 15;

  let streakBonus = 0;
  if (currentStreak >= 30) streakBonus = 25;
  else if (currentStreak >= 7) streakBonus = 10;

  let roleBonus = 0;
  if (userRole === "moderator") roleBonus = 100;
  else if (userRole === "admin") roleBonus = 250;
  else if (userRole === "super_admin") roleBonus = 500;

  // 4. Sum AdMob reward claims
  const adConditions = pairs.map((p) =>
    and(eq(userAdRewards.clientType, p.clientType), eq(userAdRewards.userId, p.userId))
  );
  const adFilter = adConditions.length === 1 ? adConditions[0] : or(...adConditions);
  const adRows = await db
    .select({ points: userAdRewards.points })
    .from(userAdRewards)
    .where(adFilter);

  const fromAds = adRows.reduce((acc, r) => acc + (r.points || 0), 0);

  // 5. Sum manual point adjustments (052)
  const adjConditions = pairs.map((p) =>
    and(eq(userPointAdjustments.clientType, p.clientType), eq(userPointAdjustments.userId, p.userId))
  );
  const adjFilter = adjConditions.length === 1 ? adjConditions[0] : or(...adjConditions);
  const adjRows = await db
    .select({ points: userPointAdjustments.points })
    .from(userPointAdjustments)
    .where(adjFilter);

  const adjustments = adjRows.reduce((acc, r) => acc + (r.points || 0), 0);

  // 6. Sum permanent spends (049)
  const spendConditions = pairs.map((p) =>
    and(eq(userPointSpends.clientType, p.clientType), eq(userPointSpends.userId, p.userId))
  );
  const spendFilter = spendConditions.length === 1 ? spendConditions[0] : or(...spendConditions);
  const spendRows = await db
    .select({ points: userPointSpends.points })
    .from(userPointSpends)
    .where(spendFilter);

  const pointsSpent = spendRows.reduce((acc, r) => acc + (r.points || 0), 0);

  // Base earned points (floored at 0)
  const baseEarned = Math.max(
    0,
    ptsFromComments +
      ptsFromUpvotes +
      ptsFromVotesCast +
      ptsFromPinned +
      streakBonus +
      roleBonus +
      fromAds -
      ptsFromDownvotes
  );

  // Adjustments are layered on top without 0-floor (can be negative), minus spent points
  const totalPoints = baseEarned + adjustments - pointsSpent;
  const realPoints = baseEarned + adjustments;
  const tier = getTier(totalPoints, isInfinite);
  const nextTierAt = getNextTierAt(totalPoints, isInfinite);
  const pointsToNextTier = nextTierAt !== null ? Math.max(0, nextTierAt - totalPoints) : null;

  return {
    points: totalPoints,
    real_points: realPoints,
    points_spent: pointsSpent,
    points_bonus: fromAds,
    tier,
    current_streak: currentStreak,
    longest_streak: longestStreak,
    is_infinite: isInfinite,
    display_points: isInfinite ? "∞" : String(totalPoints),
    next_tier_at: nextTierAt,
    points_to_next_tier: pointsToNextTier,
    breakdown: {
      from_comments: ptsFromComments,
      from_upvotes_received: ptsFromUpvotes,
      from_downvotes_received: -ptsFromDownvotes,
      from_votes_cast: ptsFromVotesCast,
      from_pinned: ptsFromPinned,
      from_streak_bonus: streakBonus,
      from_role_bonus: roleBonus,
      from_ads: fromAds,
      adjustments,
      points_spent: pointsSpent,
    },
    role: userRole,
  };
}

/**
 * Recomputes points and synchronizes the cached user_points table row
 */
export async function refreshUserPoints(
  d1: D1Database,
  clientType: string,
  userId: string
): Promise<ComputedPoints> {
  const db = createDb(d1);
  const normalizedClient = normClient(clientType);
  const computed = await computeUserPoints(d1, normalizedClient, userId);

  await db
    .insert(userPoints)
    .values({
      userId,
      clientType: normalizedClient,
      totalPoints: computed.points,
      realPoints: computed.real_points,
      pointsSpent: computed.points_spent,
      pointsBonus: computed.points_bonus,
      tier: computed.tier,
      currentStreak: computed.current_streak,
      longestStreak: computed.longest_streak,
      lastActivityDate: new Date().toISOString().slice(0, 10),
      updatedAt: sql`(datetime('now'))`,
    })
    .onConflictDoUpdate({
      target: [userPoints.userId, userPoints.clientType],
      set: {
        totalPoints: computed.points,
        realPoints: computed.real_points,
        pointsSpent: computed.points_spent,
        pointsBonus: computed.points_bonus,
        tier: computed.tier,
        currentStreak: computed.current_streak,
        longestStreak: sql`max(user_points.longest_streak, ${computed.longest_streak})`,
        lastActivityDate: new Date().toISOString().slice(0, 10),
        updatedAt: sql`(datetime('now'))`,
      },
    });

  return computed;
}

