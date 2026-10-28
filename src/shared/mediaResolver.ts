// Resolves a numeric AniList media id to { type, title, year, poster }.
// Checks dantotsu_media_cache table first, then AniList GraphQL API; successful
// lookups are written back to the cache so future comments inherit them.

import { createDb } from "../db";
import { dantotsuMediaCache } from "../db/schema";
import { eq } from "drizzle-orm";

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
const resolveCooldown = new Map<number, number>();
const RESOLVE_COOLDOWN_MS = 60_000;

function anilistTypeHint(hint?: string | null): "ANIME" | "MANGA" | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  if (h === "anime") return "ANIME";
  if (h === "manga") return "MANGA";
  return null;
}

export async function resolveMediaById(
  d1: D1Database,
  mediaIdStr: string | number,
  mediaTypeHint?: string | null
): Promise<ResolvedMedia | null> {
  const mediaId = typeof mediaIdStr === "string" ? parseInt(mediaIdStr, 10) : mediaIdStr;
  if (!Number.isInteger(mediaId) || mediaId <= 0) return null;

  const db = createDb(d1);

  // 1. Cache lookup
  try {
    const cached = await db
      .select()
      .from(dantotsuMediaCache)
      .where(eq(dantotsuMediaCache.mediaId, mediaId))
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

  // 2. AniList fetch (rate-limited per id cooldown)
  const lastAttempt = resolveCooldown.get(mediaId);
  if (lastAttempt && Date.now() - lastAttempt < RESOLVE_COOLDOWN_MS) return null;
  resolveCooldown.set(mediaId, Date.now());

  const typeVar = anilistTypeHint(mediaTypeHint);
  try {
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

    const resolved: ResolvedMedia = {
      media_type: typeof m.type === "string" ? m.type.toLowerCase() : "anime",
      media_title: String(title).slice(0, 200),
      media_year: m.startDate?.year ?? null,
      media_poster: m.coverImage?.large ?? null,
    };

    // 3. Write to cache
    await db
      .insert(dantotsuMediaCache)
      .values({
        mediaId,
        mediaType: resolved.media_type,
        mediaTitle: resolved.media_title,
        mediaYear: resolved.media_year,
        mediaPoster: resolved.media_poster,
      })
      .onConflictDoUpdate({
        target: dantotsuMediaCache.mediaId,
        set: {
          mediaTitle: resolved.media_title,
          mediaPoster: resolved.media_poster,
          mediaYear: resolved.media_year,
        },
      });

    return resolved;
  } catch (err) {
    console.warn(`AniList fetch failed for media ${mediaId}:`, err);
    return null;
  }
}
