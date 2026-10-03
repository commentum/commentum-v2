const ANILIST_GRAPHQL = 'https://graphql.anilist.co'

/**
 * Helper to normalize media type into either 'anime' or 'manga'
 */
export function normalizeMediaType(mediaType?: string | null): 'anime' | 'manga' | 'movie' | 'tv' {
  const norm = (mediaType || '').toLowerCase().trim()
  if (['manga', 'novel', 'light_novel', 'manhwa', 'manhua', 'comic'].includes(norm)) {
    return 'manga'
  }
  if (['movie', 'movies'].includes(norm)) {
    return 'movie'
  }
  if (['tv', 'shows', 'show', 'series'].includes(norm)) {
    return 'tv'
  }
  return 'anime'
}

/**
 * Resolves the equivalent AniList Media ID for any client_type (anilist, mal, simkl).
 * 1. If client_type is already 'anilist', returns the numeric ID directly.
 * 2. Checks `media_id_map` in database.
 * 3. If missing:
 *    - For 'mal': queries AniList GraphQL API (or mal-backup) for ANIME or MANGA.
 *    - For 'simkl': queries SIMKL API for cross-linked IDs (anime, tv, movies).
 * 4. Auto-saves the newly discovered mapping into `media_id_map` so future lookups are instant.
 */
export async function resolveAnilistMediaId(
  supabase: any,
  clientType: string,
  mediaId: string | number,
  mediaType?: string | null
): Promise<number | null> {
  const normClient = (clientType || '').toLowerCase().trim()
  const rawIdStr = String(mediaId).trim()

  // Detect SIMKL composite prefix if present (e.g. "anime*38636" or "movie*123")
  let detectedType = mediaType
  let cleanId = rawIdStr
  if (rawIdStr.includes('*')) {
    const parts = rawIdStr.split('*')
    detectedType = parts[0]
    cleanId = parts[1] || rawIdStr
  }

  const normalizedType = normalizeMediaType(detectedType)

  // 1. If it's already an AniList ID, return it
  if (normClient === 'anilist') {
    const num = parseInt(cleanId, 10)
    return isNaN(num) ? null : num
  }

  // 2. Check local `media_id_map`
  if (supabase) {
    try {
      const { data: selfMap } = await supabase
        .from('media_id_map')
        .select('map_key')
        .eq('client_type', normClient)
        .eq('media_id', cleanId)
        .maybeSingle()

      if (selfMap?.map_key) {
        const { data: anilistEquiv } = await supabase
          .from('media_id_map')
          .select('media_id')
          .eq('map_key', selfMap.map_key)
          .eq('client_type', 'anilist')
          .maybeSingle()

        if (anilistEquiv?.media_id) {
          const num = parseInt(anilistEquiv.media_id, 10)
          if (!isNaN(num) && num > 0) return num
        }
      }
    } catch (err) {
      console.warn('[mediaMapping] Error checking media_id_map:', err)
    }
  }

  // 3. Fallback: On-the-fly resolution via APIs
  let resolvedAnilistId: number | null = null
  let resolvedType: 'anime' | 'manga' = normalizedType === 'manga' ? 'manga' : 'anime'
  let malId: number | null = null
  let simklId: string | null = null

  if (normClient === 'mal' || normClient === 'myanimelist') {
    malId = parseInt(cleanId, 10)
    if (!isNaN(malId) && malId > 0) {
      // If caller specifically said manga/novel, query MANGA first; otherwise try ANIME then MANGA
      if (normalizedType === 'manga') {
        resolvedAnilistId = await fetchAnilistIdFromMalId(malId, 'MANGA')
        resolvedType = 'manga'
      } else {
        // Try anime first
        resolvedAnilistId = await fetchAnilistIdFromMalId(malId, 'ANIME')
        resolvedType = 'anime'
        // If not found as anime, check if it's a manga/novel ID
        if (!resolvedAnilistId && !mediaType) {
          resolvedAnilistId = await fetchAnilistIdFromMalId(malId, 'MANGA')
          if (resolvedAnilistId) resolvedType = 'manga'
        }
      }

      // Secondary fallback: check bal-mackup/mal-backup
      if (!resolvedAnilistId) {
        resolvedAnilistId = await fetchFromMalBackup(malId, resolvedType)
      }
    }
  } else if (normClient === 'simkl') {
    simklId = cleanId
    const simklIds = await fetchIdsFromSimkl(cleanId, normalizedType)
    if (simklIds?.anilist) {
      resolvedAnilistId = simklIds.anilist
    }
    if (simklIds?.mal) {
      malId = simklIds.mal
    }
  }

  // 4. Auto-cache into `media_id_map` so it never needs to be looked up again
  if (supabase && resolvedAnilistId) {
    try {
      const canonicalKey = malId
        ? `${resolvedType}:mal:${malId}`
        : `${resolvedType}:anilist:${resolvedAnilistId}`

      const rowsToUpsert: any[] = [
        {
          client_type: 'anilist',
          media_id: String(resolvedAnilistId),
          map_key: canonicalKey,
          media_type: resolvedType,
        },
      ]

      if ((normClient === 'mal' || normClient === 'myanimelist') && malId) {
        rowsToUpsert.push({
          client_type: 'mal',
          media_id: String(malId),
          map_key: canonicalKey,
          media_type: resolvedType,
        })
      } else if (normClient === 'simkl' && simklId) {
        rowsToUpsert.push({
          client_type: 'simkl',
          media_id: String(simklId),
          map_key: canonicalKey,
          media_type: resolvedType,
        })
        if (malId) {
          rowsToUpsert.push({
            client_type: 'mal',
            media_id: String(malId),
            map_key: canonicalKey,
            media_type: resolvedType,
          })
        }
      }

      await supabase.from('media_id_map').upsert(rowsToUpsert, { onConflict: 'client_type,media_id' })
      console.log(`[mediaMapping] Auto-cached mapping for ${normClient} ${cleanId} -> AniList ${resolvedAnilistId} (${resolvedType})`)
    } catch (cacheErr) {
      console.warn('[mediaMapping] Error auto-caching media mapping:', cacheErr)
    }
  }

  return resolvedAnilistId
}

/**
 * Query AniList GraphQL API using `idMal` to find the AniList ID for ANIME or MANGA
 */
async function fetchAnilistIdFromMalId(malId: number, anilistType: 'ANIME' | 'MANGA'): Promise<number | null> {
  const query = `
    query ($malId: Int, $type: MediaType) {
      Media(idMal: $malId, type: $type) {
        id
      }
    }
  `

  try {
    const res = await fetch(ANILIST_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'AnymeX-Commentum/2.0',
      },
      body: JSON.stringify({
        query,
        variables: { malId, type: anilistType },
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return null
    const data = await res.json()
    const alId = data?.data?.Media?.id
    return typeof alId === 'number' ? alId : null
  } catch (err) {
    console.error(`[fetchAnilistIdFromMalId] Error querying AniList for MAL ID ${malId} (${anilistType}):`, err)
    return null
  }
}

/**
 * Fast zero-rate-limit fallback using bal-mackup (same as AnymeX app's MediaSyncer)
 */
async function fetchFromMalBackup(malId: number, type: 'anime' | 'manga'): Promise<number | null> {
  try {
    const url = `https://raw.githubusercontent.com/bal-mackup/mal-backup/refs/heads/master/mal/${type}/${malId}.json`
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (res.ok) {
      const data = await res.json()
      const aniId = data?.aniId
      if (typeof aniId === 'number') return aniId
      if (typeof aniId === 'string') {
        const parsed = parseInt(aniId, 10)
        if (!isNaN(parsed)) return parsed
      }
    }
  } catch (_) {}
  return null
}

/**
 * Query SIMKL API to find cross-linked AniList and MAL IDs
 * Handles anime, tv/shows, and movies
 */
async function fetchIdsFromSimkl(
  simklId: string | number,
  category: 'anime' | 'manga' | 'movie' | 'tv'
): Promise<{ anilist?: number; mal?: number } | null> {
  const simklKey = Deno.env.get('SIMKL_CLIENT_ID') || 'c2049d5c1813f8bbbe21b4a9f2a96934c919799ee51011689ea5b8aa9d91f2e4'
  
  let endpoint = 'anime'
  if (category === 'movie') endpoint = 'movies'
  else if (category === 'tv') endpoint = 'tv'

  const url = `https://api.simkl.com/${endpoint}/${simklId}?client_id=${simklKey}`

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return null
    const data = await res.json()
    const ids = data?.ids
    if (!ids) return null

    const result: { anilist?: number; mal?: number } = {}
    if (ids.anilist) {
      const n = parseInt(ids.anilist, 10)
      if (!isNaN(n)) result.anilist = n
    }
    if (ids.mal) {
      const n = parseInt(ids.mal, 10)
      if (!isNaN(n)) result.mal = n
    }
    return result
  } catch (err) {
    console.error(`[fetchIdsFromSimkl] Error querying SIMKL for ID ${simklId}:`, err)
    return null
  }
}
