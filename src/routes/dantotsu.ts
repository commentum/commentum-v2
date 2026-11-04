import { Hono } from "hono";
import { AppContext } from "../types/env";
import { createDb } from "../db";
import { comments, dantotsuIdMappings, dantotsuMediaCache, media } from "../db/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { syncMediaFromDantotsu } from "../shared/dantotsuClient";

export const dantotsuRoutes = new Hono<AppContext>();

const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAniListBatch(ids: number[]): Promise<Map<number, any>> {
  const r = new Map<number, any>();
  if (!ids.length) return r;
  try {
    const res = await fetch(ANILIST_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "AnymeX-Commentum/2.0",
      },
      body: JSON.stringify({
        query: "query($ids:[Int],$perPage:Int){Page(page:1,perPage:$perPage){media(id_in:$ids){id type title{english romaji userPreferred}coverImage{medium}startDate{year}}}}",
        variables: { ids, perPage: ids.length },
      }),
    });

    if (!res.ok) {
      if (res.status === 429) {
        const reset = res.headers.get("retry-after") || "5";
        await sleep(Math.min(parseInt(reset, 10) * 1000, 10000));
      }
      return r;
    }

    const data: any = await res.json();
    for (const m of data?.data?.Page?.media || []) {
      const title = m.title?.english || m.title?.romaji || m.title?.userPreferred || null;
      if (title) {
        r.set(m.id, {
          media_type: (m.type || "ANIME").toLowerCase(),
          media_title: title,
          media_year: m.startDate?.year || null,
          media_poster: m.coverImage?.medium || null,
        });
      }
    }
  } catch (e) {
    console.error("[al] err:", e);
  }
  return r;
}

dantotsuRoutes.get("/status", async (c) => {
  const db = createDb(c.env.DB);
  const cmCount = await db.select({ count: sql<number>`count(*)` }).from(dantotsuIdMappings);
  const mdCount = await db.select({ count: sql<number>`count(*)` }).from(dantotsuMediaCache);

  return c.json({
    synced_comments: cmCount[0]?.count || 0,
    cached_media: mdCount[0]?.count || 0,
  });
});

dantotsuRoutes.post("/resolve-media", async (c) => {
  const db = createDb(c.env.DB);
  const t0 = Date.now();
  const deadline = t0 + 25_000;

  // 1. Purge corrupt placeholders
  await db.delete(dantotsuMediaCache).where(eq(dantotsuMediaCache.mediaTitle, "Unknown Media"));

  // 2. Query distinct media IDs from comments
  const unknownRows = await db
    .select({ mediaId: comments.mediaId })
    .from(comments)
    .limit(500);

  const rawIds = [...new Set(unknownRows.map((r) => parseInt(r.mediaId, 10)).filter((id) => !isNaN(id) && id > 0))];
  if (rawIds.length === 0) {
    return c.json({
      success: true,
      resolved: 0,
      remaining_comments: 0,
      message: "No numeric media IDs found in batch.",
    });
  }

  // 3. Check cached media in dantotsu_media_cache
  const cachedRows = await db
    .select()
    .from(dantotsuMediaCache)
    .where(inArray(dantotsuMediaCache.mediaId, rawIds));

  let resolvedFromCache = 0;
  const cachedMap = new Map<number, any>();

  for (const row of cachedRows) {
    if (row.mediaTitle && row.mediaTitle !== "Unknown Media") {
      cachedMap.set(row.mediaId, row);
      resolvedFromCache++;
    }
  }

  // 4. Query AniList for uncached IDs
  const toFetch = rawIds.filter((id) => !cachedMap.has(id));
  let resolvedFromAniList = 0;
  let fetchIdx = 0;
  const batchSize = 25;

  while (fetchIdx < toFetch.length && Date.now() < deadline) {
    const batch = toFetch.slice(fetchIdx, fetchIdx + batchSize);
    const fresh = await fetchAniListBatch(batch);

    for (const [id, m] of fresh.entries()) {
      if (m.media_title && m.media_title !== "Unknown Media") {
        await db.insert(dantotsuMediaCache).values({
          mediaId: id,
          mediaType: m.media_type,
          mediaTitle: m.media_title,
          mediaYear: m.media_year,
          mediaPoster: m.media_poster,
        }).onConflictDoUpdate({
          target: dantotsuMediaCache.mediaId,
          set: {
            mediaType: m.media_type,
            mediaTitle: m.media_title,
            mediaYear: m.media_year,
            mediaPoster: m.media_poster,
          },
        });

        // Also update canonical media table
        await db.insert(media).values({
          mediaId: String(id),
          clientType: "anilist",
          title: m.media_title,
          type: m.media_type || "anime",
          year: m.media_year,
          poster: m.media_poster,
        }).onConflictDoUpdate({
          target: [media.clientType, media.mediaId],
          set: {
            title: m.media_title,
            type: m.media_type || "anime",
            year: m.media_year,
            poster: m.media_poster,
          },
        });

        resolvedFromAniList++;
      }
    }

    fetchIdx += batchSize;
    if (fetchIdx < toFetch.length && Date.now() < deadline) {
      await sleep(600);
    }
  }

  const totalResolved = resolvedFromCache + resolvedFromAniList;
  return c.json({
    success: true,
    resolved_media_ids: totalResolved,
    resolved_from_cache: resolvedFromCache,
    resolved_from_anilist: resolvedFromAniList,
    duration_ms: Date.now() - t0,
    message: `Resolved ${totalResolved} media`,
  });
});

dantotsuRoutes.post("/sync-media", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const mediaId = parseInt(body.media_id, 10);
  if (!mediaId) return c.json({ error: "media_id is required" }, 400);

  const res = await syncMediaFromDantotsu(c.env.DB, mediaId, body.media_type, body.media_title);
  return c.json(res);
});
