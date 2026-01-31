import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
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

    // Build order by
    let orderBy = { created_at: 'desc' }
    switch (sort) {
      case 'oldest':
        orderBy = { created_at: 'asc' }
        break
      case 'top':
        orderBy = { vote_score: 'desc' }
        break
      case 'controversial':
        orderBy = { upvotes: 'desc' }
        break
    }

    const offset = (page - 1) * limit

    // Get comments for this media
    const { data: comments, error } = await supabase
      .from('comments')
      .select('*')
      .eq('media_id', media_id)
      .eq('client_type', client_type)
      .eq('deleted', false)
      .eq('user_banned', false)
      .eq('user_shadow_banned', false)
      .order('created_at', { ascending: sort === 'oldest' })
      .range(offset, offset + limit - 1)

    if (error) throw error

    // Get total count
    const { count } = await supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('media_id', media_id)
      .eq('client_type', client_type)
      .eq('deleted', false)
      .eq('user_banned', false)
      .eq('user_shadow_banned', false)

    // Build nested structure
    const nestedComments = buildNestedStructure(comments || [])

    // Get media statistics
    const { data: stats } = await supabase
      .from('comments')
      .select('upvotes, downvotes')
      .eq('media_id', media_id)
      .eq('client_type', client_type)
      .eq('deleted', false)

    const totalUpvotes = stats?.reduce((sum, comment) => sum + comment.upvotes, 0) || 0
    const totalDownvotes = stats?.reduce((sum, comment) => sum + comment.downvotes, 0) || 0

    // Get media info from first comment
    const mediaInfo = comments && comments.length > 0 ? {
      mediaId: comments[0].media_id,
      mediaType: comments[0].media_type,
      mediaTitle: comments[0].media_title,
      mediaYear: comments[0].media_year,
      mediaPoster: comments[0].media_poster
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
