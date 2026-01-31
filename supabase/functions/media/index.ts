import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}

const ANIME_JSON_URL = 'https://raw.githubusercontent.com/anime-and-manga/lists/refs/heads/main/anime-full.json'
const MANGA_JSON_URL = 'https://raw.githubusercontent.com/anime-and-manga/lists/refs/heads/main/manga-full.json'

// Cache for mapping data (in-memory cache for the function instance)
let animeCache: any[] | null = null
let mangaCache: any[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 3600000 // 1 hour in milliseconds

async function getMapping(mediaType: string): Promise<any[]> {
  const now = Date.now()
  
  // Check if cache is still valid
  if (now - cacheTimestamp < CACHE_TTL) {
    if (mediaType === 'anime' && animeCache) return animeCache
    if (mediaType === 'manga' && mangaCache) return mangaCache
  }
  
  // Fetch fresh data
  const url = mediaType === 'anime' ? ANIME_JSON_URL : MANGA_JSON_URL
  const response = await fetch(url)
  const data = await response.json()
  
  // Update cache
  if (mediaType === 'anime') {
    animeCache = data
  } else {
    mangaCache = data
  }
  cacheTimestamp = now
  
  return data
}

function findAllPlatformIds(mediaId: string, clientType: string, mediaType: string, mappingData: any[]): { media_id: string, client_type: string }[] {
  const results: { media_id: string, client_type: string }[] = []
  
  // Always include the original
  results.push({ media_id: mediaId, client_type: clientType })
  
  // Find the entry in mapping data
  const entry = mappingData.find((item: any) => {
    if (clientType === 'mal') {
      return item.mal_id?.toString() === mediaId
    } else if (clientType === 'anilist') {
      return item.anilist_id?.toString() === mediaId
    }
    return false
  })
  
  if (!entry) return results
  
  // Add the other platform if it exists
  if (clientType === 'mal' && entry.anilist_id) {
    results.push({ media_id: entry.anilist_id.toString(), client_type: 'anilist' })
  } else if (clientType === 'anilist' && entry.mal_id) {
    results.push({ media_id: entry.mal_id.toString(), client_type: 'mal' })
  }
  
  return results
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const url = new URL(req.url)
    const media_id = url.searchParams.get('media_id')
    const client_type = url.searchParams.get('client_type')
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const sort = url.searchParams.get('sort') || 'newest'

    // Validate required parameters
    if (!media_id || !client_type) {
      return new Response(
        JSON.stringify({ error: 'media_id and client_type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get media type from first query (we'll determine it from existing comments or default to 'anime')
    const { data: sampleComment } = await supabase
      .from('comments')
      .select('media_type')
      .eq('media_id', media_id)
      .eq('client_type', client_type)
      .limit(1)
      .single()
    
    const mediaType = sampleComment?.media_type || 'anime'
    
    // Get mapping data and find all platform IDs
    const mappingData = await getMapping(mediaType)
    const platformIds = findAllPlatformIds(media_id, client_type, mediaType, mappingData)
    
    const offset = (page - 1) * limit

    // Build query for all platforms
    let query = supabase
      .from('comments')
      .select('*')
      .eq('deleted', false)
      .eq('user_banned', false)
      .eq('user_shadow_banned', false)

    // Add OR condition for all platform IDs
    const orConditions = platformIds.map(p => 
      `and(media_id.eq.${p.media_id},client_type.eq.${p.client_type})`
    ).join(',')
    
    query = query.or(orConditions)
    
    // Apply sorting
    query = query.order('created_at', { ascending: sort === 'oldest' })
    query = query.range(offset, offset + limit - 1)

    const { data: comments, error } = await query

    if (error) throw error

    // Get total count across all platforms
    let countQuery = supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('deleted', false)
      .eq('user_banned', false)
      .eq('user_shadow_banned', false)
      .or(orConditions)

    const { count } = await countQuery

    // Build nested structure
    const nestedComments = buildNestedStructure(comments || [])

    // Get media statistics across all platforms
    let statsQuery = supabase
      .from('comments')
      .select('upvotes, downvotes')
      .eq('deleted', false)
      .or(orConditions)

    const { data: stats } = await statsQuery

    const totalUpvotes = stats?.reduce((sum, comment) => sum + comment.upvotes, 0) || 0
    const totalDownvotes = stats?.reduce((sum, comment) => sum + comment.downvotes, 0) || 0

    // Get media info from first comment
    const mediaInfo = comments && comments.length > 0 ? {
      mediaId: comments[0].media_id,
      mediaType: comments[0].media_type,
      mediaTitle: comments[0].media_title,
      mediaYear: comments[0].media_year,
      mediaPoster: comments[0].media_poster,
      platforms: platformIds // Include all platform IDs for reference
    } : null

    return new Response(
      JSON.stringify({
        media: mediaInfo,
        comments: nestedComments,
        stats: {
          commentCount: count || 0,
          totalUpvotes,
          totalDownvotes,
          netScore: totalUpvotes - totalDownvotes
        },
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Media API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function buildNestedStructure(comments: any[]) {
  const commentMap: { [key: number]: any } = {}
  const roots: any[] = []
  
  // Create map of all comments
  comments.forEach(comment => {
    commentMap[comment.id] = { 
      ...comment, 
      replies: [],
      // Parse JSON fields
      user_votes: comment.user_votes ? JSON.parse(comment.user_votes) : {},
      reports: comment.reports ? JSON.parse(comment.reports) : [],
      tags: comment.tags ? JSON.parse(comment.tags) : []
    }
  })
  
  // Build nested structure
  comments.forEach(comment => {
    if (comment.parent_id) {
      const parent = commentMap[comment.parent_id]
      if (parent) {
        parent.replies.push(commentMap[comment.id])
      }
    } else {
      roots.push(commentMap[comment.id])
    }
  })
  
  return roots
}
