// Resolves a numeric AniList media id to { type, title, year, poster }.
// Checks dantotsu_media_cache first, then AniList GraphQL; successful
// lookups are written back to the cache so future comments and page
// loads inherit them. This exists so comments never get persisted with
// 'Unknown Media' when the id alone is enough to know the title.

export interface ResolvedMedia {
  media_type: string
  media_title: string
  media_year: number | null
  media_poster: string | null
}

export function isUnknownMediaTitle(title?: string | null): boolean {
  return !title || title === 'Unknown Media' || title === 'Unknown'
}

const ANILIST_GRAPHQL = 'https://graphql.anilist.co'

// An id that fails to resolve is not retried for 60s, so page loads and
// comment ingestion never hammer AniList for dead/missing ids.
const resolveCooldown = new Map<number, number>()
const RESOLVE_COOLDOWN_MS = 60_000

// AniList anime and manga ids are independent namespaces that can share
// numbers, so pass the media type hint whenever the caller knows it.
function anilistTypeHint(hint?: string | null): 'ANIME' | 'MANGA' | null {
  if (!hint) return null
  const h = hint.toLowerCase()
  if (h === 'anime') return 'ANIME'
  if (h === 'manga') return 'MANGA'
  return null
}

export async function resolveMediaById(
  db: any,
  mediaId: number,
  mediaTypeHint?: string | null
): Promise<ResolvedMedia | null> {
  if (!Number.isInteger(mediaId) || mediaId <= 0) return null

  // 1. Cache lookup
  try {
    const { data: cached } = await db
      .from('dantotsu_media_cache')
      .select('media_type, media_title, media_year, media_poster')
      .eq('media_id', mediaId)
      .maybeSingle()
    if (cached && !isUnknownMediaTitle(cached.media_title)) {
      return cached as ResolvedMedia
    }
  } catch (_) {
    // cache read failure is not fatal — fall through to AniList
  }

  // 2. AniList fetch, rate-limited per id
  const lastAttempt = resolveCooldown.get(mediaId)
  if (lastAttempt && Date.now() - lastAttempt < RESOLVE_COOLDOWN_MS) return null
  resolveCooldown.set(mediaId, Date.now())

  const typeVar = anilistTypeHint(mediaTypeHint)
  try {
    const query = `query ($id: Int${typeVar ? ', $type: MediaType' : ''}) {
      Media(id: $id${typeVar ? ', type: $type' : ''}) {
        type
        title { romaji english userPreferred }
        coverImage { large }
        startDate { year }
      }
    }`
    const res = await fetch(ANILIST_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'AnymeX-Commentum/2.0',
      },
      body: JSON.stringify({
        query,
        variables: { id: mediaId, ...(typeVar ? { type: typeVar } : {}) },
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.warn(`[mediaResolver] AniList HTTP ${res.status} for media ${mediaId}`)
      return null
    }
    const json = await res.json()
    const m = json?.data?.Media
    const title = m?.title?.userPreferred || m?.title?.english || m?.title?.romaji
    if (!m || !title) return null

    const resolved: ResolvedMedia = {
      media_type: typeof m.type === 'string' ? m.type.toLowerCase() : 'anime',
      media_title: String(title).slice(0, 200),
      media_year: m.startDate?.year ?? null,
      media_poster: m.coverImage?.large ?? null,
    }

    // 3. Persist so ingested comments, reports and the media header can use it
    try {
      await db.from('dantotsu_media_cache').upsert(
        { media_id: mediaId, ...resolved, fetched_at: new Date().toISOString() },
        { onConflict: 'media_id' }
      )
    } catch (err) {
      console.warn('[mediaResolver] Cache upsert failed:', err)
    }

    return resolved
  } catch (err) {
    console.warn(`[mediaResolver] AniList fetch failed for media ${mediaId}:`, err)
    return null
  }
}
