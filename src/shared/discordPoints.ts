import { D1Database } from "@cloudflare/workers-types";
import { commentumUsers, comments, userPointAdjustments } from "../db/schema";
import { eq, and, sql, desc, or } from "drizzle-orm";
import { createDb } from "../db";
import { refreshUserPoints, computeUserPoints } from "./pointsEngine";

const ADMIN_ROLES = ["admin", "super_admin", "app_owner", "owner"];
const STAFF_ROLES = ["moderator", ...ADMIN_ROLES];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normClient = (c: string) => {
  const v = String(c || "").toLowerCase().trim();
  return v === "myanimelist" ? "mal" : v;
};

interface Target {
  userId: string;
  clientType: string;
  username: string;
  role: string;
}

export async function resolveTarget(
  d1: D1Database,
  input: string,
  platform?: string
): Promise<Target | { error: string }> {
  const db = createDb(d1);
  const raw = String(input).trim();
  const normalizedPlatform = platform ? normClient(platform) : undefined;

  // 1. Try finding by user ID
  let userQuery = db
    .select({
      userId: commentumUsers.commentumUserId,
      clientType: commentumUsers.commentumClientType,
      username: commentumUsers.commentumUsername,
      role: commentumUsers.commentumUserRole,
    })
    .from(commentumUsers)
    .where(eq(commentumUsers.commentumUserId, raw));

  const byIdRows = await userQuery;
  let rows = normalizedPlatform
    ? byIdRows.filter((r) => normClient(r.clientType) === normalizedPlatform)
    : byIdRows;

  // 2. Fallback: try comments table
  if (rows.length === 0) {
    const comRows = await db
      .select({
        userId: comments.userId,
        clientType: comments.clientType,
        username: comments.username,
        role: comments.userRole,
      })
      .from(comments)
      .where(eq(comments.userId, raw))
      .limit(10);

    rows = normalizedPlatform
      ? comRows.filter((r) => normClient(r.clientType) === normalizedPlatform)
      : comRows;
  }

  // 3. Not an ID: try exact username (case-insensitive)
  if (rows.length === 0) {
    const namedRows = await db
      .select({
        userId: commentumUsers.commentumUserId,
        clientType: commentumUsers.commentumClientType,
        username: commentumUsers.commentumUsername,
        role: commentumUsers.commentumUserRole,
      })
      .from(commentumUsers)
      .where(sql`lower(${commentumUsers.commentumUsername}) = ${raw.toLowerCase()}`)
      .limit(10);

    rows = normalizedPlatform
      ? namedRows.filter((r) => normClient(r.clientType) === normalizedPlatform)
      : namedRows;

    const uniqueIds = Array.from(new Set(rows.map((r) => `${r.userId}:${normClient(r.clientType)}`)));
    if (uniqueIds.length > 1) {
      return {
        error: `Several users are named "${raw}" (${uniqueIds.join(", ")}). Use their numeric ID or pass the platform option.`,
      };
    }
  }

  const clients = Array.from(new Set(rows.map((r) => normClient(r.clientType))));
  if (clients.length === 0) {
    return {
      error: `User not found: "${raw}"${platform ? ` on ${platform}` : ""}. Pick the user from autocomplete or paste their ID.`,
    };
  }
  if (clients.length > 1) {
    return {
      error: `ID ${raw} exists on multiple platforms (${clients.join(", ")}). Re-run with the platform option specified.`,
    };
  }

  const row = rows[0];
  return {
    userId: row.userId,
    clientType: normClient(row.clientType),
    username: row.username || "Unknown",
    role: row.role || "user",
  };
}

export async function handleDiscordPointsAdjust(
  d1: D1Database,
  kind: "give" | "deduct",
  targetInput: string,
  amount: number,
  reason: string,
  platform: string | undefined,
  moderatorId: string,
  moderatorName: string,
  staffRole: string
) {
  if (!ADMIN_ROLES.includes(staffRole)) {
    return { error: "Only admins can adjust points." };
  }

  if (isNaN(amount) || amount <= 0 || amount > 10000000) {
    return { error: "Amount must be between 1 and 10,000,000." };
  }

  const target = await resolveTarget(d1, targetInput, platform);
  if ("error" in target) return target;

  const db = createDb(d1);
  const delta = kind === "give" ? amount : -amount;
  const adjId = crypto.randomUUID();

  // Insert audit record
  await db.insert(userPointAdjustments).values({
    id: adjId,
    clientType: target.clientType,
    userId: target.userId,
    points: delta,
    reason: reason || (kind === "give" ? "Manual grant" : "Manual deduction"),
    createdBy: `${moderatorName} (${moderatorId})`,
  });

  // Recompute & refresh user points
  const updated = await refreshUserPoints(d1, target.clientType, target.userId);

  return {
    success: true,
    target,
    adjustment_id: adjId,
    delta,
    amount,
    points: updated.points,
    tier: updated.tier,
    reason,
  };
}

export async function handleDiscordPointsCheck(
  d1: D1Database,
  targetInput: string,
  platform: string | undefined,
  staffRole: string
) {
  if (!STAFF_ROLES.includes(staffRole)) {
    return { error: "Only staff can check user points." };
  }

  const target = await resolveTarget(d1, targetInput, platform);
  if ("error" in target) return target;

  const db = createDb(d1);
  const pts = await computeUserPoints(d1, target.clientType, target.userId);

  // Fetch recent adjustments
  const adjustments = await db
    .select({
      id: userPointAdjustments.id,
      points: userPointAdjustments.points,
      reason: userPointAdjustments.reason,
      createdBy: userPointAdjustments.createdBy,
      createdAt: userPointAdjustments.createdAt,
    })
    .from(userPointAdjustments)
    .where(
      and(
        eq(userPointAdjustments.clientType, target.clientType),
        eq(userPointAdjustments.userId, target.userId)
      )
    )
    .orderBy(desc(userPointAdjustments.createdAt))
    .limit(5);

  return {
    success: true,
    target,
    points: pts.points,
    display_points: pts.display_points,
    tier: pts.tier,
    current_streak: pts.current_streak,
    longest_streak: pts.longest_streak,
    adjustments_total: pts.breakdown.adjustments,
    recent_adjustments: adjustments,
  };
}

export async function handleDiscordPointsUndo(
  d1: D1Database,
  adjustmentId: string,
  moderatorId: string,
  moderatorName: string,
  staffRole: string
) {
  if (!ADMIN_ROLES.includes(staffRole)) {
    return { error: "Only admins can undo point adjustments." };
  }

  if (!UUID_RE.test(adjustmentId)) {
    return { error: "adjustment_id must be a valid UUID from /points_check." };
  }

  const db = createDb(d1);
  const rows = await db
    .select()
    .from(userPointAdjustments)
    .where(eq(userPointAdjustments.id, adjustmentId))
    .limit(1);

  const row = rows[0];
  if (!row) return { error: "Adjustment not found." };
  if (row.reason.startsWith("undo:")) return { error: "That entry is already an undo." };

  const already = await db
    .select()
    .from(userPointAdjustments)
    .where(eq(userPointAdjustments.reason, `undo:${adjustmentId}`))
    .limit(1);

  if (already.length > 0) return { error: "That adjustment was already undone." };

  const undoId = crypto.randomUUID();
  const reversedPoints = -row.points;

  await db.insert(userPointAdjustments).values({
    id: undoId,
    clientType: row.clientType,
    userId: row.userId,
    points: reversedPoints,
    reason: `undo:${adjustmentId}`,
    createdBy: `${moderatorName} (${moderatorId})`,
  });

  const updated = await refreshUserPoints(d1, row.clientType, row.userId);

  return {
    success: true,
    undo_id: undoId,
    original_id: adjustmentId,
    reversed_points: reversedPoints,
    points: updated.points,
    target: {
      userId: row.userId,
      clientType: row.clientType,
    },
  };
}

