import { D1Database } from "@cloudflare/workers-types";
import { rateLimits } from "../db/schema";
import { sql } from "drizzle-orm";
import { createDb } from "../db";

export interface RateRule {
  /** Unique bucket, e.g. `vote:min:<user_id>` */
  key: string;
  limit: number;
  windowSec: number;
}

export interface RateResult {
  allowed: boolean;
  retryAfter: number;
}

/**
 * Atomic fixed-window rate limiter powered by Cloudflare D1.
 * Fail-open design: if DB check fails, allows the request and logs the error.
 */
export async function checkRateLimits(d1: D1Database, rules: RateRule[]): Promise<RateResult> {
  const db = createDb(d1);
  const now = Date.now();

  for (const rule of rules) {
    if (!rule.limit || rule.limit <= 0) continue; // 0 or unset = disabled

    try {
      const windowSec = rule.windowSec;
      const windowMs = windowSec * 1000;
      const windowStartMs = Math.floor(now / windowMs) * windowMs;
      const windowStart = new Date(windowStartMs).toISOString();

      // Atomic insert or increment
      const result = await db
        .insert(rateLimits)
        .values({
          key: rule.key,
          windowStart,
          count: 1,
        })
        .onConflictDoUpdate({
          target: [rateLimits.key, rateLimits.windowStart],
          set: {
            count: sql`rate_limits.count + 1`,
          },
        })
        .returning({ count: rateLimits.count });

      const count = result[0]?.count ?? 1;

      // Opportunistic cleanup (~1% of calls)
      if (Math.random() < 0.01) {
        const twoDaysAgo = new Date(now - 2 * 86400 * 1000).toISOString();
        db.delete(rateLimits)
          .where(sql`window_start < ${twoDaysAgo}`)
          .catch(() => {});
      }

      if (count > rule.limit) {
        const retryAfter = Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000));
        return { allowed: false, retryAfter };
      }
    } catch (err: any) {
      console.error("[rateLimit] DB error (allowing request):", err?.message || err);
      return { allowed: true, retryAfter: 0 };
    }
  }

  return { allowed: true, retryAfter: 0 };
}

export function rateLimitedResponse(message: string, retryAfter: number) {
  return Response.json(
    { success: false, error: message, retry_after: retryAfter },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
      },
    }
  );
}

