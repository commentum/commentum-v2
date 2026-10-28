// Resolves media metadata across AniList, MyAnimeList (MAL), and Simkl
// Checks dantotsu_media_cache first, then client APIs; successful lookups
// are cached in D1 so future comments inherit them and titles are never "Unknown Media".

import { createDb } from "../db/index.js";
import { dantotsuMediaCache } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";

export interface ResolvedMedia {
  media_type: string;
  media_title: string;
  media_year: number | null;
  media_poster: string | null;
}

export function isUnknownMediaTitle(title?: string | null): boolean {
  return !title || title === "Unknown Media" || title === "Unknown";
}

const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const resolveCooldown = new Map<string, number>();
const RESOLVE_COOLDOWN_MS = 60_000;

function anilistTypeHint(hint?: string | null): "ANIME" | "MANGA" | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  if (h === "anime") return "ANIME";
  if (h === "manga") return "MANGA";
  return null;
}

/**
 * Resolve AniList Media via GraphQL
 */
async function fetchAniListMedia(
  mediaId: number,
  mediaTypeHint?: string | null
): Promise<ResolvedMedia | null> {
  const typeVar = anilistTypeHint(mediaTypeHint);
  const query = `query ($id: Int${typeVar ? ", $type: MediaType" : ""}) {
    Media(id: $id${typeVar ? ", type: $type" : ""}) {
      type
      title { romaji english userPreferred }
      coverImage { large }
      startDate { year }
    }
  }`;

  const res = await fetch(ANILIST_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "AnymeX-Commentum/2.0",
    },
    body: JSON.stringify({
      query,
      variables: { id: mediaId, ...(typeVar ? { type: typeVar } : {}) },
    }),
  });

  if (!res.ok) return null;
  const json = (await res.json()) as any;
  const m = json?.data?.Media;
  const title = m?.title?.userPreferred || m?.title?.english || m?.title?.romaji;
  if (!m || !title) return null;

  return {
    media_type: typeof m.type === "string" ? m.type.toLowerCase() : "anime",
    media_title: String(title).slice(0, 200),
    media_year: m.startDate?.year ?? null,
    media_poster: m.coverImage?.large ?? null,
  };
}

/**
 * Resolve MyAnimeList Media via Jikan v4 API
 */
async function fetchMalMedia(
  mediaId: number,
  mediaTypeHint?: string | null
): Promise<ResolvedMedia | null> {
  const endpoint = (mediaTypeHint?.toLowerCase() === "manga") ? "manga" : "anime";
  const url = `https://api.jikan.moe/v4/${endpoint}/${mediaId}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AnymeX-Commentum/2.0",
    },
  });

  if (!res.ok) return null;
  const json = (await res.json()) as any;
  const d = json?.data;
  if (!d) return null;

  const title = d.title_english || d.title || d.title_japanese;
  if (!title) return null;

  return {
    media_type: endpoint,
    media_title: String(title).slice(0, 200),
    media_year: d.year || (d.aired?.from ? new Date(d.aired.from).getFullYear() : null),
    media_poster: d.images?.jpg?.large_image_url || d.images?.jpg?.image_url || null,
  };
}

/**
 * Resolve Simkl Media via Simkl API
 */
async function fetchSimklMedia(
  mediaId: number | string,
  simklClientId?: string
): Promise<ResolvedMedia | null> {
  const apiKey = simklClientId || "99f38c64bb7ecae2c20f1a60cfb939fa76a26df16e256bfa09e3e3b794f31c5d";
  const url = `https://api.simkl.com/anime/${mediaId}?client_id=${apiKey}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AnymeX-Commentum/2.0",
    },
  });

  if (!res.ok) return null;
  const d = (await res.json()) as any;
  if (!d || !d.title) return null;

  return {
    media_type: d.anime_type || "anime",
    media_title: String(d.title).slice(0, 200),
    media_year: d.year ? Number(d.year) : null,
    media_poster: d.poster ? `https://simkl.in/posters/${d.poster}_m.jpg` : null,
  };
}

/**
 * Unified Media Resolver across client providers (AniList, MAL, Simkl)
 */
export async function resolveMediaById(
  d1: D1Database,
  mediaIdStr: string | number,
  mediaTypeHint?: string | null,
  clientType: string = "anilist",
  simklClientId?: string
): Promise<ResolvedMedia | null> {
  const mediaIdNum = typeof mediaIdStr === "string" ? parseInt(mediaIdStr, 10) : mediaIdStr;
  const db = createDb(d1);

  // 1. Cache lookup
  if (Number.isInteger(mediaIdNum) && mediaIdNum > 0) {
    try {
      const cached = await db
        .select()
        .from(dantotsuMediaCache)
        .where(eq(dantotsuMediaCache.mediaId, mediaIdNum))
        .limit(1);

      if (cached.length > 0 && !isUnknownMediaTitle(cached[0].mediaTitle)) {
        return {
          media_type: cached[0].mediaType,
          media_title: cached[0].mediaTitle,
          media_year: cached[0].mediaYear,
          media_poster: cached[0].mediaPoster,
        };
      }
    } catch {}
  }

  // Rate-limiting cooldown key
  const cooldownKey = `${clientType}:${mediaIdStr}`;
  const lastAttempt = resolveCooldown.get(cooldownKey);
  if (lastAttempt && Date.now() - lastAttempt < RESOLVE_COOLDOWN_MS) return null;
  resolveCooldown.set(cooldownKey, Date.now());

  // 2. Provider API dispatch
  let resolved: ResolvedMedia | null = null;
  const provider = (clientType || "anilist").toLowerCase();

  try {
    if (provider === "myanimelist" || provider === "mal") {
      if (Number.isInteger(mediaIdNum)) {
        resolved = await fetchMalMedia(mediaIdNum, mediaTypeHint);
      }
    } else if (provider === "simkl") {
      resolved = await fetchSimklMedia(mediaIdStr, simklClientId);
    } else {
      // Default to AniList
      if (Number.isInteger(mediaIdNum)) {
        resolved = await fetchAniListMedia(mediaIdNum, mediaTypeHint);
      }
    }

    // 3. Persist to cache
    if (resolved && Number.isInteger(mediaIdNum) && mediaIdNum > 0) {
      try {
        await db
          .insert(dantotsuMediaCache)
          .values({
            mediaId: mediaIdNum,
            mediaType: resolved.media_type,
            mediaTitle: resolved.media_title,
            mediaYear: resolved.media_year,
            mediaPoster: resolved.media_poster,
            fetchedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: dantotsuMediaCache.mediaId,
            set: {
              mediaType: resolved.media_type,
              mediaTitle: resolved.media_title,
              mediaYear: resolved.media_year,
              mediaPoster: resolved.media_poster,
              fetchedAt: new Date().toISOString(),
            },
          });
      } catch (err) {
        console.warn("[mediaResolver] Cache write failed:", err);
      }
    }

    return resolved;
  } catch (err) {
    console.warn(`[mediaResolver] Resolution failed for ${clientType}:${mediaIdStr}:`, err);
    return null;
  }
}
