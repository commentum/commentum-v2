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
    
    // No default values for page and limit
    const pageParam = url.searchParams.get('page')
    const limitParam = url.searchParams.get('limit')
    const sort = url.searchParams.get('sort') || 'newest'

    // Validate required parameters
    if (!media_id || !client_type) {
      return new Response(
        JSON.stringify({ error: 'media_id and client_type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Determine if pagination is requested
    const usePagination = pageParam !== null || limitParam !== null
    const page = parseInt(pageParam || '1')
    const limit = parseInt(limitParam || '50')

    // First, get all comments for this media (we need all to build proper nesting)
    const { data: allComments, error: allError } = await supabase
      .from('comments')
      .select('*')
      .eq('media_id', media_id)
      .eq('client_type', client_type)
      .eq('deleted', false)
      .eq('user_banned', false)
      .eq('user_shadow_banned', false)
      .order('created_at', { ascending: sort === 'oldest' })

    if (allError) throw allError

    // Get top-level comments (parent_id is null)
    const topLevelComments = (allComments || []).filter(c => c.parent_id === null)

    // Get total count of top-level comments for pagination
    const totalTopLevel = topLevelComments.length

    // Apply pagination to top-level comments only
    let paginatedTopLevel = topLevelComments
    if (usePagination) {
      const offset = (page - 1) * limit
      paginatedTopLevel = topLevelComments.slice(offset, offset + limit)
    }

    // Get IDs of paginated top-level comments
    const topLevelIds = new Set(paginatedTopLevel.map(c => c.id))

    // Get all replies that belong to these top-level comments (recursively)
    const allReplies = (allComments || []).filter(c => c.parent_id !== null)
    
    // Find all descendant replies for the paginated top-level comments
    const replyMap = new Map<number, any[]>()
    allReplies.forEach(reply => {
      // Check if this reply's ancestor is in our paginated top-level set
      let currentId: number | null = reply.parent_id
      while (currentId !== null) {
        if (topLevelIds.has(currentId)) {
          if (!replyMap.has(currentId)) {
            replyMap.set(currentId, [])
          }
          replyMap.get(currentId)!.push(reply)
          break
        }
        const parent = allComments?.find(c => c.id === currentId)
        currentId = parent?.parent_id || null
      }
    })

    // Combine paginated top-level comments with their replies
    const commentsToShow = [...paginatedTopLevel]
    replyMap.forEach(replies => {
      commentsToShow.push(...replies)
    })

    // Build nested structure
    const nestedComments = buildNestedStructure(commentsToShow)

    // Stats: count all top-level comments
    const count = totalTopLevel

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

    // Build response - only include pagination if it was requested
    const response: any = {
      media: mediaInfo,
      comments: nestedComments,
      stats: {
        commentCount: count || 0,
        totalUpvotes,
        totalDownvotes,
        netScore: totalUpvotes - totalDownvotes
      }
    }

    if (usePagination) {
      response.pagination = {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    }

    return new Response(
      JSON.stringify(response),
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