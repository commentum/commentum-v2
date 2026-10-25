import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const ANILIST_GRAPHQL = 'https://graphql.anilist.co'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// === ANILIST ===

async function fetchAniListBatch(ids: number[]): Promise<Map<number, any>> {
  const r = new Map<number, any>()
  if (!ids.length) return r
  try {
    const res = await fetch(ANILIST_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'AnymeX-Commentum/2.0',
      },
      body: JSON.stringify({
        query: 'query($ids:[Int],$perPage:Int){Page(page:1,perPage:$perPage){media(id_in:$ids){id type title{english romaji userPreferred}coverImage{medium}startDate{year}}}}',
        variables: { ids, perPage: ids.length }
      })
    })

    if (!res.ok) {
      console.warn(`[al] HTTP ${res.status}: ${res.statusText}`)
      if (res.status === 429) {
        const reset = res.headers.get('retry-after') || '5'
        await sleep(Math.min(parseInt(reset, 10) * 1000, 10000))
      }
      return r
    }

    const data = await res.json()
    for (const m of (data?.data?.Page?.media || [])) {
      const title = m.title?.english || m.title?.romaji || m.title?.userPreferred || null
      if (title) {
        r.set(m.id, {
          media_type: (m.type || 'ANIME').toLowerCase(),
          media_title: title,
          media_year: m.startDate?.year || null,
          media_poster: m.coverImage?.medium || null
        })
      }
    }
  } catch (e) {
    console.error('[al] err:', e)
  }
  return r
}

// === RESOLVE MEDIA (separate step) ===

async function resolveMedia(db: any) {
  const t0 = Date.now()
  const deadline = t0 + 40_000 // 40s edge function execution budget

  // 1. Purge corrupt placeholder cache entries so they get re-resolved
  await db.from('dantotsu_media_cache').delete().eq('media_title', 'Unknown Media')

  // 2. Count total remaining comments with 'Unknown Media'
  const { count: totalUnknownComments } = await db
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('media_title', 'Unknown Media')

  if (totalUnknownComments === 0) {
    return {
      success: true,
      resolved: 0,
      remaining_comments: 0,
      message: 'All media titles in comments are already resolved!'
    }
  }

  // 3. Fetch comments that currently have 'Unknown Media'
  const { data: unknownRows, error: findErr } = await db
    .from('comments')
    .select('media_id')
    .eq('media_title', 'Unknown Media')
    .limit(1000)

  if (findErr) {
    console.error('[media] error querying comments:', findErr)
    return { success: false, error: findErr.message }
  }

  if (!unknownRows || unknownRows.length === 0) {
    return {
      success: true,
      resolved: 0,
      remaining_comments: 0,
      message: 'No unknown media comments found in batch.'
    }
  }

  // Extract distinct numeric media IDs
  const rawIds = [...new Set(unknownRows.map((r: any) => parseInt(r.media_id, 10)).filter((id: number) => !isNaN(id) && id > 0))]

  // 4. Check which of these are already in dantotsu_media_cache with valid titles
  const { data: cachedRows } = await db
    .from('dantotsu_media_cache')
    .select('media_id, media_type, media_title, media_year, media_poster')
    .in('media_id', rawIds)

  const cachedMap = new Map<number, any>()
  let resolvedFromCache = 0

  if (cachedRows) {
    for (const c of cachedRows) {
      if (c.media_title && c.media_title !== 'Unknown Media') {
        cachedMap.set(c.media_id, c)
        // Immediately apply to comments
        await db.from('comments')
          .update({
            media_type: c.media_type,
            media_title: c.media_title,
            media_year: c.media_year,
            media_poster: c.media_poster
          })
          .eq('media_id', String(c.media_id))
          .eq('media_title', 'Unknown Media')

        // Also update notification_history if present
        await db.from('notification_history')
          .update({ media_title: c.media_title })
          .eq('media_id', String(c.media_id))
          .eq('media_title', 'Unknown Media')

        resolvedFromCache++
      }
    }
  }

  // 5. IDs that need to be fetched from AniList
  const toFetch = rawIds.filter((id: number) => !cachedMap.has(id))
  console.log(`[media] ${rawIds.length} unique unknown media IDs (${resolvedFromCache} resolved from cache, ${toFetch.length} need AniList fetch)...`)

  let resolvedFromAniList = 0
  let fetchIdx = 0
  const batchSize = 25

  while (fetchIdx < toFetch.length && Date.now() < deadline) {
    const batch = toFetch.slice(fetchIdx, fetchIdx + batchSize)
    const fresh = await fetchAniListBatch(batch)

    const toUpsertCache: any[] = []
    for (const [id, m] of fresh.entries()) {
      if (m.media_title && m.media_title !== 'Unknown Media') {
        toUpsertCache.push({ media_id: id, ...m })
      }
    }

    if (toUpsertCache.length) {
      await db.from('dantotsu_media_cache').upsert(toUpsertCache, { onConflict: 'media_id' })
    }

    // Update comments and notifications in DB
    for (const [id, m] of fresh.entries()) {
      if (m.media_title && m.media_title !== 'Unknown Media') {
        await db.from('comments')
          .update({
            media_type: m.media_type,
            media_title: m.media_title,
            media_year: m.media_year,
            media_poster: m.media_poster
          })
          .eq('media_id', String(id))
          .eq('media_title', 'Unknown Media')

        await db.from('notification_history')
          .update({ media_title: m.media_title })
          .eq('media_id', String(id))
          .eq('media_title', 'Unknown Media')

        resolvedFromAniList++
      }
    }

    fetchIdx += batchSize
    if (fetchIdx < toFetch.length && Date.now() < deadline) {
      await sleep(600) // Respect AniList rate limit (90 req/min)
    }
  }

  // Re-check remaining count
  const { count: newRemaining } = await db
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('media_title', 'Unknown Media')

  const totalResolvedThisCall = resolvedFromCache + resolvedFromAniList
  return {
    success: true,
    resolved_media_ids: totalResolvedThisCall,
    resolved_from_cache: resolvedFromCache,
    resolved_from_anilist: resolvedFromAniList,
    remaining_comments: newRemaining ?? (totalUnknownComments ? Math.max(0, totalUnknownComments - totalResolvedThisCall) : 0),
    duration_ms: Date.now() - t0,
    message: `Resolved ${totalResolvedThisCall} media (${newRemaining ?? 'unknown'} comments left)`
  }
}

// === MAIN ===

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const action = new URL(req.url).searchParams.get('action') || 'status'

  try {
    switch (action) {
      case 'status': {
        const { count: cm } = await db.from('dantotsu_id_mappings').select('*', { count: 'exact', head: true })
        const { count: md } = await db.from('dantotsu_media_cache').select('*', { count: 'exact', head: true })
        return new Response(JSON.stringify({ synced_comments: cm || 0, cached_media: md || 0 }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      case 'resolve-media': {
        console.log('=== RESOLVE MEDIA ===')
        const r = await resolveMedia(db)
        return new Response(JSON.stringify(r, null, 2), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      default:
        return new Response(JSON.stringify({ error: 'Use: status, resolve-media' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
  } catch (e) {
    console.error('err:', e)
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
