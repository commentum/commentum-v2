import { D1Database } from "@cloudflare/workers-types";
import { commentumUsers } from "../db/schema";
import { eq } from "drizzle-orm";
import { createDb } from "../db";

export interface Restriction {
  type: "banned" | "shadow_banned" | "muted";
  until: string | null;
  reason: string | null;
}

const isActive = (flag: boolean | null, until: string | null, now: Date) =>
  !!flag && (until === null || new Date(until) > now);

/**
 * Single source of truth for "is this user currently banned / shadow-banned / muted?"
 * Looks up ALL rows for this user ID across any client_type so platform aliases
 * or typos (MAL vs myanimelist) cannot be used to bypass moderation.
 */
export async function getActiveRestriction(
  d1: D1Database,
  userId: string | number
): Promise<Restriction | null> {
  try {
    const db = createDb(d1);
    const rows = await db
      .select({
        banned: commentumUsers.commentumUserBanned,
        bannedUntil: commentumUsers.commentumUserBannedUntil,
        bannedReason: commentumUsers.commentumUserBannedReason,
        shadowBanned: commentumUsers.commentumUserShadowBanned,
        shadowBannedUntil: commentumUsers.commentumUserShadowBannedUntil,
        shadowBannedReason: commentumUsers.commentumUserShadowBannedReason,
        muted: commentumUsers.commentumUserMuted,
        mutedUntil: commentumUsers.commentumUserMutedUntil,
        mutedReason: commentumUsers.commentumUserMutedReason,
      })
      .from(commentumUsers)
      .where(eq(commentumUsers.commentumUserId, String(userId)));

    const now = new Date();
    let mute: Restriction | null = null;

    for (const r of rows) {
      if (isActive(r.banned, r.bannedUntil, now)) {
        return { type: "banned", until: r.bannedUntil, reason: r.bannedReason };
      }
      if (isActive(r.shadowBanned, r.shadowBannedUntil, now)) {
        return { type: "shadow_banned", until: r.shadowBannedUntil, reason: r.shadowBannedReason };
      }
      if (!mute && isActive(r.muted, r.mutedUntil, now)) {
        mute = { type: "muted", until: r.mutedUntil, reason: r.mutedReason };
      }
    }

    return mute;
  } catch (err: any) {
    console.error("[restrictions] Error checking user restrictions:", err?.message || err);
    return null;
  }
}

export function restrictionResponse(r: Restriction) {
  const message = r.type === "muted" ? "Your account is temporarily muted" : "Your account is permanently banned";
  return Response.json(
    {
      success: false,
      error: message,
      restriction: r.type,
      until: r.type === "shadow_banned" ? null : r.until,
      reason: r.reason,
    },
    { status: 403 }
  );
}

