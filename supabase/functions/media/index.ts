import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}

const ANIME_JSON_URL = 'https://raw.githubusercontent.com/anime-and-manga/lists/refs/heads/main/anime-full.json'
const MANGA_JSON_URL = 'https://raw.githubusercontent.com/anime-and-manga/lists/refs/heads/main/manga-full.json'

// Cache for mapping data
let animeCache: any[] | null = null
let mangaCache: any[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 3600000 // 1 hour

async function getMapping(mediaType: string): Promise<any[]> {
  const now = Date.now()
  
  if (now - cacheTimestamp < CACHE_TTL) {
    if (mediaType === 'anime' && animeCache) return animeCache
    if (mediaType === 'manga' && mangaCache) return mangaCache
  }
  
  const url = mediaType === 'anime' ? ANIME_JSON_URL : MANGA_JSON_URL
  const response = await fetch(url)
  const data = await response.json()
  
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
  
  results.push({ media_id: mediaId, client_type: clientType })
  
  const entry = mappingData.find((item: any) => {
    if (clientType === 'mal') {
      return item.mal_id?.toString() === mediaId
    } else if (clientType === 'anilist') {
      return item.anilist_id?.toString() === mediaId
    }
    return false
  })
  
  if (!entry) return results
  
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

    if (!media_id || !client_type) {
      return new Response(
        JSON.stringify({ error: 'media_id and client_type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get media type
    const { data: sampleComment } = await supabase
      .from('comments')
      .select('media_type')
      .eq('media_id', media_id)
      .eq('client_type', client_type)
      .limit(1)
      .single()
    
    const mediaType = sampleComment?.media_type || 'anime'
    
    // Get all platform IDs
    const mappingData = await getMapping(mediaType)
    const platformIds = findAllPlatformIds(media_id, client_type, mediaType, mappingData)
    
    // Fetch ALL comments from ALL platforms - NO RANGE/LIMIT
    let allComments: any[] = []
    
    for (const platform of platformIds) {
      const { data: platformComments, error } = await supabase
        .from('comments')
        .select('*')
        .eq('media_id', platform.media_id)
        .eq('client_type', platform.client_type)
        .eq('deleted', false)
        .eq('user_banned', false)
        .eq('user_shadow_banned', false)
      
      if (error) throw error
      
      if (platformComments) {
        allComments = [...allComments, ...platformComments]
      }
    }

    // Sort all comments
    allComments.sort((a, b) => {
      if (sort === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      } else if (sort === 'top') {
        return (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes)
      } else {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
    })

    // Apply pagination
    const offset = (page - 1) * limit
    const paginatedComments = allComments.slice(offset, offset + limit)
    const totalCount = allComments.length

    // Build nested structure
    const nestedComments = buildNestedStructure(paginatedComments)

    // Calculate stats
    const totalUpvotes = allComments.reduce((sum, comment) => sum + comment.upvotes, 0)
    const totalDownvotes = allComments.reduce((sum, comment) => sum + comment.downvotes, 0)

    // Get media info
    const mediaInfo = allComments.length > 0 ? {
      mediaId: allComments[0].media_id,
      mediaType: allComments[0].media_type,
      mediaTitle: allComments[0].media_title,
      mediaYear: allComments[0].media_year,
      mediaPoster: allComments[0].media_poster
    } : null

    return new Response(
      JSON.stringify({
        media: mediaInfo,
        comments: nestedComments,
        stats: {
          commentCount: totalCount,
          totalUpvotes,
          totalDownvotes,
          netScore: totalUpvotes - totalDownvotes
        },
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit)
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Media API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
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
