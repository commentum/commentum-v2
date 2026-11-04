import { eq, desc, inArray, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  dantotsuModTokens,
  dantotsuIdMappings,
  dantotsuSyncMeta,
  dantotsuMediaCache,
  comments,
} from "../db/schema";

const DANTOTSU_API = "https://api.dantotsu.app";
const APP_AUTH_KEY = "6*45Qp%W2RS@t38jkXoSKY588Ynj%n";

export interface DanAuthResult {
  authToken: string;
  userId: string;
  username: string;
  isMod: boolean;
  isAdmin: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DanFetchOpts {
  label: string;
  timeoutMs: number;
  retries?: number;
  idempotent?: boolean;
  deadline?: number;
  respectCooldown?: boolean;
}

let danRateLimitedUntil = 0;
export function isDantotsuRateLimited(): boolean {
  return Date.now() < danRateLimitedUntil;
}

async function danFetch(url: string, init: RequestInit, opts: DanFetchOpts): Promise<Response | null> {
  const { label, timeoutMs, retries = 2, idempotent = true, deadline, respectCooldown = false } = opts;
  const maxAttempts = retries + 1;
  const retryStatus = idempotent
    ? new Set([408, 425, 500, 502, 503, 504, ...(respectCooldown ? [] : [429])])
    : new Set([503, ...(respectCooldown ? [] : [429])]);

  if (respectCooldown && isDantotsuRateLimited()) {
    console.log(`[${label}] skipped: Dantotsu rate-limited for another ${Math.ceil((danRateLimitedUntil - Date.now()) / 1000)}s`);
    return null;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 250);
    const remaining = deadline ? deadline - Date.now() : Infinity;
    if (remaining <= 250) {
      console.warn(`[${label}] time budget exhausted, giving up`);
      return null;
    }
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)) });

      if (res.status === 429) {
        const ra = parseInt(res.headers.get("retry-after") || "", 10);
        const cool = !isNaN(ra) ? Math.min(ra * 1000, 300_000) : 60_000;
        danRateLimitedUntil = Math.max(danRateLimitedUntil, Date.now() + cool);
        console.warn(`[${label}] HTTP 429 - Dantotsu cooldown ${Math.round(cool / 1000)}s`);
      }

      if (res.ok || !retryStatus.has(res.status) || attempt === maxAttempts) return res;

      const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
      const wait = !isNaN(retryAfter) ? Math.min(retryAfter * 1000, 10_000) : backoff;
      if (deadline && Date.now() + wait >= deadline) return res;
      await res.body?.cancel().catch(() => {});
      await sleep(wait);
    } catch (err: any) {
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      if (timedOut && !idempotent) {
        return null;
      }
      if (attempt === maxAttempts) {
        return null;
      }
      await sleep(backoff);
    }
  }
  return null;
}

const tokenCache = new Map<string, { data: DanAuthResult; expiresAt: number }>();

export async function danAuthenticate(
  anilistToken: string,
  d1?: D1Database
): Promise<DanAuthResult | null> {
  if (!anilistToken) return null;

  const cached = tokenCache.get(anilistToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  try {
    const res = await danFetch(`${DANTOTSU_API}/authenticate`, {
      method: "POST",
      headers: {
        appauth: APP_AUTH_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: anilistToken }),
    }, { label: "danAuth", timeoutMs: 15_000 });

    if (!res || !res.ok) return null;

    const data: any = await res.json();
    if (!data?.authToken || !data?.user) return null;

    let rawMod = data.user.is_mod;
    let rawAdmin = data.user.is_admin;

    try {
      const userRes = await danFetch(`${DANTOTSU_API}/user`, {
        headers: {
          appauth: APP_AUTH_KEY,
          Authorization: data.authToken,
        },
      }, { label: "danAuth:/user", timeoutMs: 10_000 });
      if (userRes?.ok) {
        const userData: any = await userRes.json();
        if (userData?.user) {
          rawMod = userData.user.is_mod ?? rawMod;
          rawAdmin = userData.user.is_admin ?? rawAdmin;
        }
      }
    } catch (_) {}

    const isMod = rawMod === true || rawMod === 1 || rawMod === "1" || rawAdmin === true || rawAdmin === 1 || rawAdmin === "1";
    const isAdmin = rawAdmin === true || rawAdmin === 1 || rawAdmin === "1" || rawMod === true || rawMod === 1 || rawMod === "1";

    const result: DanAuthResult = {
      authToken: data.authToken,
      userId: String(data.user.user_id || data.user.id),
      username: data.user.username || "",
      isMod,
      isAdmin,
    };

    tokenCache.set(anilistToken, {
      data: result,
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    });

    if (d1) {
      try {
        const db = drizzle(d1);
        const now = new Date().toISOString();
        await db.insert(dantotsuModTokens).values({
          userId: result.userId,
          username: result.username,
          anilistToken,
          dantotsuAuthToken: result.authToken,
          isMod: result.isMod,
          isAdmin: result.isAdmin,
          lastVerifiedAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: dantotsuModTokens.userId,
          set: {
            username: result.username,
            anilistToken,
            dantotsuAuthToken: result.authToken,
            isMod: result.isMod,
            isAdmin: result.isAdmin,
            lastVerifiedAt: now,
            updatedAt: now,
          },
        });
      } catch (err) {
        console.error("[danAuth] Error saving mod token to D1:", err);
      }
    }

    return result;
  } catch (err) {
    console.error("[danAuth] Error authenticating with Dantotsu:", err);
    return null;
  }
}

export async function getDanModAuth(d1?: D1Database, envToken?: string): Promise<DanAuthResult | null> {
  if (d1) {
    try {
      const db = drizzle(d1);
      const rows = await db
        .select()
        .from(dantotsuModTokens)
        .orderBy(desc(dantotsuModTokens.isMod), desc(dantotsuModTokens.isAdmin), desc(dantotsuModTokens.updatedAt))
        .limit(1);

      if (rows[0]?.anilistToken) {
        const freshAuth = await danAuthenticate(rows[0].anilistToken, d1);
        if (freshAuth) return freshAuth;

        if (rows[0].dantotsuAuthToken) {
          return {
            authToken: rows[0].dantotsuAuthToken,
            userId: rows[0].userId,
            username: rows[0].username || "",
            isMod: rows[0].isMod ?? false,
            isAdmin: rows[0].isAdmin ?? false,
          };
        }
      }
    } catch (err) {
      console.warn("[getDanModAuth] Error querying dantotsu_mod_tokens:", err);
    }
  }

  if (envToken) {
    return await danAuthenticate(envToken, d1);
  }

  return null;
}

export function toDantotsuTag(tag: unknown): number | null {
  if (typeof tag === "number") {
    return Number.isFinite(tag) && tag >= 0 ? Math.floor(tag) : null;
  }
  if (Array.isArray(tag)) {
    for (const t of tag) {
      const n = toDantotsuTag(t);
      if (n != null) return n;
    }
    return null;
  }
  if (typeof tag !== "string") return null;
  const s = tag.trim();
  if (!s) return null;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Math.floor(parseFloat(s));
  const m = s.match(/(?:episode|chapter|ep|chap|ch)\b\D*?(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

export async function danPostComment(params: {
  authToken: string;
  userId: string;
  mediaId: number;
  content: string;
  tag?: number | null;
  parentCommentId?: number | null;
}): Promise<number | null> {
  const { authToken, userId, mediaId, content, tag, parentCommentId } = params;
  try {
    const body = new URLSearchParams();
    body.append("user_id", String(userId));
    body.append("media_id", String(mediaId));
    body.append("content", content);
    if (tag != null && !isNaN(tag)) {
      body.append("tag", String(tag));
    }
    if (parentCommentId != null && parentCommentId > 0) {
      body.append("parent_comment_id", String(parentCommentId));
    }

    const res = await danFetch(`${DANTOTSU_API}/comments`, {
      method: "POST",
      headers: {
        appauth: APP_AUTH_KEY,
        Authorization: authToken,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }, { label: "danPostComment", timeoutMs: 20_000, idempotent: false });

    if (!res || !res.ok) return null;

    const data: any = await res.json();
    const danId = data?.id || data?.comment_id;
    return typeof danId === "number" ? danId : parseInt(danId, 10) || null;
  } catch (err) {
    console.error("[danPostComment] Exception posting to Dantotsu:", err);
    return null;
  }
}

export async function danEditComment(params: {
  authToken: string;
  danCommentId: number;
  content: string;
}): Promise<boolean> {
  const { authToken, danCommentId, content } = params;
  try {
    const body = new URLSearchParams();
    body.append("content", content);

    const res = await danFetch(`${DANTOTSU_API}/comments/${danCommentId}`, {
      method: "PUT",
      headers: {
        appauth: APP_AUTH_KEY,
        Authorization: authToken,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }, { label: "danEditComment", timeoutMs: 20_000 });

    return !!res?.ok;
  } catch (err) {
    console.error("[danEditComment] Exception editing on Dantotsu:", err);
    return false;
  }
}

export async function danDeleteComment(params: {
  authToken: string;
  danCommentId: number;
}): Promise<boolean> {
  const { authToken, danCommentId } = params;
  try {
    const res = await danFetch(`${DANTOTSU_API}/comments/${danCommentId}`, {
      method: "DELETE",
      headers: {
        appauth: APP_AUTH_KEY,
        Authorization: authToken,
      },
    }, { label: "danDeleteComment", timeoutMs: 20_000 });

    return !!res?.ok;
  } catch (err) {
    console.error("[danDeleteComment] Exception deleting on Dantotsu:", err);
    return false;
  }
}

export async function danVoteComment(params: {
  authToken: string;
  danCommentId: number;
  voteType: number;
}): Promise<boolean> {
  const { authToken, danCommentId, voteType } = params;
  try {
    const res = await danFetch(`${DANTOTSU_API}/comments/vote/${danCommentId}/${voteType}`, {
      method: "POST",
      headers: {
        appauth: APP_AUTH_KEY,
        Authorization: authToken,
      },
    }, { label: "danVoteComment", timeoutMs: 15_000 });

    return !!res?.ok;
  } catch (err) {
    console.error("[danVoteComment] Exception voting on Dantotsu:", err);
    return false;
  }
}

export async function danFetchComments(
  mediaId: number,
  page = 1,
  tag?: number,
  sort?: string,
  authToken?: string,
  deadline?: number
): Promise<any | null> {
  try {
    let url = `${DANTOTSU_API}/comments/${mediaId}/${page}`;
    const params = new URLSearchParams();
    if (tag != null) params.append("tag", String(tag));
    if (sort) params.append("sort", sort);
    const qs = params.toString();
    if (qs) url += `?${qs}`;

    const headers: Record<string, string> = { appauth: APP_AUTH_KEY };
    if (authToken) headers["Authorization"] = authToken;

    const res = await danFetch(url, { headers }, { label: "danFetchComments", timeoutMs: 10_000, retries: 1, deadline, respectCooldown: true });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("[danFetchComments] Exception fetching comments:", err);
    return null;
  }
}

export async function danFetchReplies(
  parentCommentId: number,
  page = 1,
  authToken?: string,
  deadline?: number
): Promise<any | null> {
  try {
    const headers: Record<string, string> = { appauth: APP_AUTH_KEY };
    if (authToken) headers["Authorization"] = authToken;

    const res = await danFetch(`${DANTOTSU_API}/comments/parent/${parentCommentId}/${page}`, { headers }, { label: "danFetchReplies", timeoutMs: 10_000, retries: 1, deadline, respectCooldown: true });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`[danFetchReplies] Exception fetching replies for ${parentCommentId}:`, err);
    return null;
  }
}

export async function syncMediaFromDantotsu(
  d1: D1Database,
  mediaId: number,
  mediaType = "anime",
  mediaTitle?: string,
  opts?: {
    deadlineMs?: number;
    maxPages?: number;
    authToken?: string;
  }
): Promise<{ success: boolean; syncedCount: number; message?: string }> {
  const db = drizzle(d1);
  const deadline = Date.now() + (opts?.deadlineMs || 25_000);
  const maxPages = opts?.maxPages || 5;
  let syncedCount = 0;

  try {
    let currentPage = 1;
    while (currentPage <= maxPages && Date.now() < deadline) {
      const data = await danFetchComments(mediaId, currentPage, undefined, undefined, opts?.authToken, deadline);
      if (!data || !Array.isArray(data.comments) || data.comments.length === 0) break;

      const danIds = data.comments.map((c: any) => c.comment_id).filter(Boolean);
      const existingMappings = await db
        .select()
        .from(dantotsuIdMappings)
        .where(inArray(dantotsuIdMappings.dantotsuCommentId, danIds));

      const mappedDanIds = new Set(existingMappings.map((m) => m.dantotsuCommentId));

      for (const c of data.comments) {
        if (!c.comment_id) continue;
        if (!mappedDanIds.has(c.comment_id)) {
          const inserted = await db.insert(comments).values({
            clientType: "anilist",
            userId: String(c.user_id),
            mediaId: String(mediaId),
            content: c.deleted ? "[deleted]" : (c.content || ""),
            username: (c.username || "unknown").slice(0, 50),
            userAvatar: c.profile_picture_url || null,
            userRole: (c.is_admin || c.is_mod) ? "moderator" : "user",
            deleted: !!c.deleted,
            upvotes: c.upvotes || 0,
            downvotes: c.downvotes || 0,
            voteScore: (c.upvotes || 0) - (c.downvotes || 0),
            createdAt: c.timestamp || new Date().toISOString(),
          }).returning();

          if (inserted[0]) {
            await db.insert(dantotsuIdMappings).values({
              dantotsuCommentId: c.comment_id,
              commentumId: inserted[0].id,
              mediaId,
              origin: "dantotsu",
            });
            syncedCount++;
          }
        }
      }

      currentPage++;
    }

    // Update dantotsu_sync_meta
    const syncPayload = JSON.stringify({
      mediaId,
      mediaType,
      mediaTitle: mediaTitle || null,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: "success",
    });
    await db.insert(dantotsuSyncMeta).values({
      key: `media_${mediaId}`,
      value: syncPayload,
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: dantotsuSyncMeta.key,
      set: {
        value: syncPayload,
        updatedAt: new Date().toISOString(),
      },
    });

    return { success: true, syncedCount };
  } catch (err: any) {
    console.error(`[syncMediaFromDantotsu] Error syncing media ${mediaId}:`, err);
    return { success: false, syncedCount, message: err?.message };
  }
}
