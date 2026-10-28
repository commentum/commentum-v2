// Cross-client media mapping & resolver for Commentum v2
// Handles cross-client ID equivalence (AniList ↔ MAL ↔ SIMKL) via media_id_map
// and ensures media metadata is auto-resolved via client APIs and stored in the media table.

import { createDb } from "../db/index.js";
import { media as mediaTable, mediaIdMap } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";

export interface ResolvedMediaInfo {
  mediaId: string;
  clientType: string;
  mapKey?: string | null;
  title: string;
  type: string;
  year?: number | null;
  poster?: string | null;
  anilistId?: string | null;
  malId?: string | null;
  simklId?: string | null;
}

const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const resolveCooldown = new Map<string, number>();
const RESOLVE_COOLDOWN_MS = 60_000;

export function normalizeMediaType(type?: string | null): "anime" | "manga" | "movie" | "tv" {
  if (!type) return "anime";
  const t = type.toLowerCase().trim();
  if (t === "manga" || t === "novel" || t === "manhwa" || t === "manhua") return "manga";
  if (t === "movie" || t === "film") return "movie";
  if (t === "tv" || t === "tv-shows" || t === "series" || t === "shows") return "tv";
  return "anime";
}

/**
 * Resolves the equivalent AniList Media ID for any client_type (anilist, mal, simkl).
 * 1. If client_type is 'anilist', returns the numeric ID directly.
 * 2. Checks `media_id_map` in D1 database.
 * 3. Fallback:
 *    - For 'mal': queries AniList GraphQL API (or mal-backup).
 *    - For 'simkl': queries SIMKL API for cross-linked IDs.
 * 4. Auto-saves the newly discovered mapping into `media_id_map`.
 */
export async function resolveAnilistMediaId(
  d1: D1Database,
  clientType: string,
  mediaId: string | number,
  mediaType?: string | null
): Promise<number | null> {
  const normClient = (clientType || "").toLowerCase().trim();
  const rawIdStr = String(mediaId).trim();

  let detectedType = mediaType;
  let cleanId = rawIdStr;
  if (rawIdStr.includes("*")) {
    const parts = rawIdStr.split("*");
    detectedType = parts[0];
    cleanId = parts[1] || rawIdStr;
  }

  const normalizedType = normalizeMediaType(detectedType);

  if (normClient === "anilist") {
    const num = parseInt(cleanId, 10);
    return isNaN(num) ? null : num;
  }

  const db = createDb(d1);

  // 1. Check local media_id_map in D1
  try {
    const selfMap = await db
      .select({ mapKey: mediaIdMap.mapKey })
      .from(mediaIdMap)
      .where(and(eq(mediaIdMap.clientType, normClient), eq(mediaIdMap.mediaId, cleanId)))
      .limit(1);

    if (selfMap.length > 0 && selfMap[0].mapKey) {
      const anilistEquiv = await db
        .select({ mediaId: mediaIdMap.mediaId })
        .from(mediaIdMap)
        .where(and(eq(mediaIdMap.mapKey, selfMap[0].mapKey), eq(mediaIdMap.clientType, "anilist")))
        .limit(1);

      if (anilistEquiv.length > 0 && anilistEquiv[0].mediaId) {
        const num = parseInt(anilistEquiv[0].mediaId, 10);
        if (!isNaN(num) && num > 0) return num;
      }
    }
  } catch (err) {
    console.warn("[mediaMapping] Error checking media_id_map:", err);
  }

  // 2. On-the-fly resolution via external APIs
  let resolvedAnilistId: number | null = null;
  let resolvedType: "anime" | "manga" = normalizedType === "manga" ? "manga" : "anime";
  let malId: number | null = null;
  let simklId: string | null = null;

  if (normClient === "mal" || normClient === "myanimelist") {
    malId = parseInt(cleanId, 10);
    if (!isNaN(malId) && malId > 0) {
      if (normalizedType === "manga") {
        resolvedAnilistId = await fetchAnilistIdFromMalId(malId, "MANGA");
        resolvedType = "manga";
      } else {
        resolvedAnilistId = await fetchAnilistIdFromMalId(malId, "ANIME");
        resolvedType = "anime";
        if (!resolvedAnilistId && !mediaType) {
          resolvedAnilistId = await fetchAnilistIdFromMalId(malId, "MANGA");
          if (resolvedAnilistId) resolvedType = "manga";
        }
      }

      if (!resolvedAnilistId) {
        resolvedAnilistId = await fetchFromMalBackup(malId, resolvedType);
      }
    }
  } else if (normClient === "simkl") {
    simklId = cleanId;
    const simklIds = await fetchIdsFromSimkl(cleanId, normalizedType);
    if (simklIds?.anilist) {
      resolvedAnilistId = simklIds.anilist;
    }
    if (simklIds?.mal) {
      malId = simklIds.mal;
    }
  }

  // 3. Auto-cache into media_id_map table
  if (resolvedAnilistId) {
    try {
      const canonicalKey = malId
        ? `${resolvedType}:mal:${malId}`
        : `${resolvedType}:anilist:${resolvedAnilistId}`;

      const rowsToInsert = [
        {
          clientType: "anilist",
          mediaId: String(resolvedAnilistId),
          mapKey: canonicalKey,
          mediaType: resolvedType,
          updatedAt: new Date().toISOString(),
        },
      ];

      if ((normClient === "mal" || normClient === "myanimelist") && malId) {
        rowsToInsert.push({
          clientType: "mal",
          mediaId: String(malId),
          mapKey: canonicalKey,
          mediaType: resolvedType,
          updatedAt: new Date().toISOString(),
        });
      } else if (normClient === "simkl" && simklId) {
        rowsToInsert.push({
          clientType: "simkl",
          mediaId: String(simklId),
          mapKey: canonicalKey,
          mediaType: resolvedType,
          updatedAt: new Date().toISOString(),
        });
        if (malId) {
          rowsToInsert.push({
            clientType: "mal",
            mediaId: String(malId),
            mapKey: canonicalKey,
            mediaType: resolvedType,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      for (const row of rowsToInsert) {
        await db
          .insert(mediaIdMap)
          .values(row)
          .onConflictDoUpdate({
            target: [mediaIdMap.clientType, mediaIdMap.mediaId],
            set: { mapKey: row.mapKey, updatedAt: row.updatedAt },
          });
      }
    } catch (cacheErr) {
      console.warn("[mediaMapping] Error auto-caching media mapping:", cacheErr);
    }
  }

  return resolvedAnilistId;
}

async function fetchAnilistIdFromMalId(malId: number, anilistType: "ANIME" | "MANGA"): Promise<number | null> {
  const query = `
    query ($malId: Int, $type: MediaType) {
      Media(idMal: $malId, type: $type) {
        id
      }
    }
  `;

  try {
    const res = await fetch(ANILIST_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "AnymeX-Commentum/2.0",
      },
      body: JSON.stringify({
        query,
        variables: { malId, type: anilistType },
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const alId = data?.data?.Media?.id;
    return typeof alId === "number" ? alId : null;
  } catch (err) {
    console.error(`[fetchAnilistIdFromMalId] Error querying AniList for MAL ID ${malId}:`, err);
    return null;
  }
}

async function fetchFromMalBackup(malId: number, type: "anime" | "manga"): Promise<number | null> {
  try {
    const url = `https://raw.githubusercontent.com/bal-mackup/mal-backup/refs/heads/master/mal/${type}/${malId}.json`;
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as any;
      const aniId = data?.aniId;
      if (typeof aniId === "number") return aniId;
      if (typeof aniId === "string") {
        const parsed = parseInt(aniId, 10);
        if (!isNaN(parsed)) return parsed;
      }
    }
  } catch (_) {}
  return null;
}

async function fetchIdsFromSimkl(
  simklId: string | number,
  category: "anime" | "manga" | "movie" | "tv"
): Promise<{ anilist?: number; mal?: number } | null> {
  const simklKey = "c2049d5c1813f8bbbe21b4a9f2a96934c919799ee51011689ea5b8aa9d91f2e4";
  let endpoint = "anime";
  if (category === "movie") endpoint = "movies";
  else if (category === "tv") endpoint = "tv";

  const url = `https://api.simkl.com/${endpoint}/${simklId}?client_id=${simklKey}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const ids = data?.ids;
    if (!ids) return null;

    const result: { anilist?: number; mal?: number } = {};
    if (ids.anilist) {
      const n = parseInt(ids.anilist, 10);
      if (!isNaN(n)) result.anilist = n;
    }
    if (ids.mal) {
      const n = parseInt(ids.mal, 10);
      if (!isNaN(n)) result.mal = n;
    }
    return result;
  } catch (err) {
    console.error(`[fetchIdsFromSimkl] Error querying SIMKL for ID ${simklId}:`, err);
    return null;
  }
}

/**
 * Resolves or fetches full media metadata across client APIs
 * and caches it permanently in the D1 `media` table.
 */
export async function getOrResolveMedia(
  d1: D1Database,
  clientType: string,
  mediaIdStr: string,
  mediaTypeHint?: string | null
): Promise<ResolvedMediaInfo> {
  const db = createDb(d1);
  const provider = (clientType || "anilist").toLowerCase();

  // 1. Check local media table
  try {
    const existing = await db
      .select()
      .from(mediaTable)
      .where(and(eq(mediaTable.clientType, provider), eq(mediaTable.mediaId, mediaIdStr)))
      .limit(1);

    if (existing.length > 0) {
      const m = existing[0];
      return {
        mediaId: m.mediaId,
        clientType: m.clientType,
        mapKey: m.mapKey,
        title: m.title,
        type: m.type,
        year: m.year,
        poster: m.poster,
        anilistId: m.anilistId,
        malId: m.malId,
        simklId: m.simklId,
      };
    }
  } catch (err) {
    console.warn("[getOrResolveMedia] Cache read failed:", err);
  }

  // 2. Resolve cross-client IDs
  let anilistId: number | null = null;
  let malId: string | null = null;
  let simklId: string | null = null;

  if (provider === "anilist") {
    anilistId = parseInt(mediaIdStr, 10);
  } else {
    anilistId = await resolveAnilistMediaId(d1, provider, mediaIdStr, mediaTypeHint);
    if (provider === "mal" || provider === "myanimelist") malId = mediaIdStr;
    if (provider === "simkl") simklId = mediaIdStr;
  }

  // 3. Fetch title & details from provider or AniList
  let title = `Media ${mediaIdStr}`;
  let poster: string | null = null;
  let year: number | null = null;
  let type = mediaTypeHint || "anime";

  const targetAniId = anilistId || (provider === "anilist" ? parseInt(mediaIdStr, 10) : null);

  if (targetAniId && !isNaN(targetAniId) && targetAniId > 0) {
    try {
      const query = `
        query ($id: Int) {
          Media(id: $id) {
            type
            title { romaji english userPreferred }
            coverImage { large }
            startDate { year }
            idMal
          }
        }
      `;
      const res = await fetch(ANILIST_GRAPHQL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "AnymeX-Commentum/2.0",
        },
        body: JSON.stringify({ query, variables: { id: targetAniId } }),
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const m = json?.data?.Media;
        if (m) {
          title = m.title?.userPreferred || m.title?.english || m.title?.romaji || title;
          poster = m.coverImage?.large || null;
          year = m.startDate?.year || null;
          type = typeof m.type === "string" ? m.type.toLowerCase() : type;
          if (m.idMal) malId = String(m.idMal);
        }
      }
    } catch (e) {
      console.warn("[getOrResolveMedia] AniList GraphQL fetch error:", e);
    }
  }

  const mapKey = malId
    ? `${type}:mal:${malId}`
    : targetAniId
    ? `${type}:anilist:${targetAniId}`
    : `${type}:${provider}:${mediaIdStr}`;

  const resolvedData: ResolvedMediaInfo = {
    mediaId: mediaIdStr,
    clientType: provider,
    mapKey,
    title,
    type,
    year,
    poster,
    anilistId: targetAniId ? String(targetAniId) : null,
    malId,
    simklId,
  };

  // 4. Save to D1 media table
  try {
    await db
      .insert(mediaTable)
      .values({
        mediaId: mediaIdStr,
        clientType: provider,
        mapKey,
        title,
        type,
        year,
        poster,
        anilistId: resolvedData.anilistId,
        malId: resolvedData.malId,
        simklId: resolvedData.simklId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [mediaTable.clientType, mediaTable.mediaId],
        set: {
          title,
          type,
          year,
          poster,
          mapKey,
          updatedAt: new Date().toISOString(),
        },
      });
  } catch (err) {
    console.warn("[getOrResolveMedia] Failed inserting media row:", err);
  }

  return resolvedData;
}
