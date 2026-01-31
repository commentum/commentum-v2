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
  
  if (!entry) {
    console.log('No mapping found for:', { mediaId, clientType, mediaType })
    return results
  }
  
  console.log('Found mapping entry:', entry)
  
  // Add the other platform if it exists
  if (clientType === 'mal' && entry.anilist_id) {
    results.push({ media_id: entry.anilist_id.toString(), client_type: 'anilist' })
  } else if (clientType === 'anilist' && entry.mal_id) {
    results.push({ media_id: entry.mal_id.toString(), client_type: 'mal' })
  }
  
  console.log('Platform IDs found:', results)
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

    console.log('Request params:', { media_id, client_type, page, limit, sort })

    // Get media type from first query (we'll determine it from existing comments or default to 'anime')
    const { data: sampleComment } = await supabase
      .from('comments')
      .select('media_type')
      .eq('media_id', media_id)
      .eq('client_type', client_type)
      .limit(1)
      .single()
    
    const mediaType = sampleComment?.media_type || 'anime'
    console.log('Media type:', mediaType)
    
    // Get mapping data and find all platform IDs
    const mappingData = await getMapping(mediaType)
    console.log('Mapping data loaded, entries:', mappingData.length)
    
    const platformIds = findAllPlatformIds(media_id, client_type, mediaType, mappingData)
    console.log('Querying for platform IDs:', platformIds)
    
    const offset = (page - 1) * limit

    // Query each platform separately and combine results
    let allComments: any[] = []
    
    for (const platform of platformIds) {
      const { data: platformComments, error: platformError } = await supabase
        .from('comments')
        .select('*')
        .eq('media_id', platform.media_id)
        .eq('client_type', platform.client_type)
        .eq('deleted', false)
        .eq('user_banned', false)
        .eq('user_shadow_banned', false)
      
      if (platformError) {
        console.error(`Error fetching comments for ${platform.client_type} ${platform.media_id}:`, platformError)
      } else if (platformComments) {
        console.log(`Found ${platformComments.length} comments for ${platform.client_type} ${platform.media_id}`)
        allComments = [...allComments, ...platformComments]
      }
    }

    console.log('Total comments across all platforms:', allComments.length)

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
    const paginatedComments = allComments.slice(offset, offset + limit)
    const totalCount = allComments.length

    // Build nested structure
    const nestedComments = buildNestedStructure(paginatedComments)

    // Get media statistics across all platforms
    const totalUpvotes = allComments.reduce((sum, comment) => sum + comment.upvotes, 0)
    const totalDownvotes = allComments.reduce((sum, comment) => sum + comment.downvotes, 0)

    // Get media info from first comment
    const mediaInfo = allComments.length > 0 ? {
      mediaId: allComments[0].media_id,
      mediaType: allComments[0].media_type,
      mediaTitle: allComments[0].media_title,
      mediaYear: allComments[0].media_year,
      mediaPoster: allComments[0].media_poster,
      platforms: platformIds // Include all platform IDs for reference
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
        },
        debug: {
          platformIds,
          totalCommentsFound: allComments.length
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
