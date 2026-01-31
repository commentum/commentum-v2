import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { fetchCrossPlatformComments, fetchSinglePlatformComments } from '../shared/mediaMapping.ts'

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

    // Only supported platforms can use cross-platform functionality
    if (!['anilist', 'myanimelist', 'mal', 'simkl'].includes(client_type)) {
      return new Response(
        JSON.stringify({ error: 'client_type must be one of: anilist, myanimelist, mal, simkl' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Determine media type - try to detect from existing comments or default to anime
    let mediaType = 'anime'; // default
    
    // Try to detect media type from existing comments
    // Normalize MAL to myanimelist for database queries
    const normalizedClientType = client_type === 'mal' ? 'myanimelist' : client_type;
    
    const { data: existingComment } = await supabase
      .from('comments')
      .select('media_type')
      .eq('media_id', media_id)
      .eq('client_type', normalizedClientType)
      .eq('deleted', false)
      .limit(1)
      .single();
    
    if (existingComment?.media_type) {
      mediaType = existingComment.media_type === 'manga' ? 'manga' : 'anime';
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

    // Automatically try cross-platform fetching for supported platforms
    // This provides a unified comment experience without requiring users to opt-in
    let commentsResult: {
      comments: any[];
      totalCount: number;
      platforms: string[];
    };

    try {
      // Always attempt cross-platform fetching for supported platforms
      // The system will automatically fall back to single platform if mapping fails
      commentsResult = await fetchCrossPlatformComments(
        supabase,
        media_id,
        mediaType as 'anime' | 'manga',
        client_type as 'anilist' | 'myanimelist' | 'mal' | 'simkl',
        page,
        limit,
        sort
      );
      
      // If we got comments from multiple platforms, it was successful
      if (commentsResult.platforms.length > 1) {
        console.log(`Auto cross-platform fetch for ${client_type} ${media_id}: found comments from ${commentsResult.platforms.join(', ')}`);
      } else {
        console.log(`Single platform fetch for ${client_type} ${media_id}: no cross-platform mapping found`);
      }
    } catch (error) {
      console.error('Cross-platform fetch failed, falling back to single platform:', error);
      // Fallback to single platform fetching
      const singleResult = await fetchSinglePlatformComments(
        supabase,
        media_id,
        normalizedClientType,
        page,
        limit,
        sort
      );
      commentsResult = {
        comments: singleResult.comments,
        totalCount: singleResult.totalCount,
        platforms: [client_type]
      };
    }

    // Build nested structure
    const nestedComments = buildNestedStructure(commentsResult.comments || [])

    // Get media statistics from all fetched platforms
    let totalUpvotes = 0;
    let totalDownvotes = 0;
    
    // Calculate stats from fetched comments
    commentsResult.comments.forEach(comment => {
      totalUpvotes += comment.upvotes || 0;
      totalDownvotes += comment.downvotes || 0;
    });

    // Get media info from first comment (prioritize the source platform for consistency)
    let mediaInfo = null;
    if (commentsResult.comments.length > 0) {
      // Try to find comment from the source platform first for consistent media info
      const sourcePlatformComment = commentsResult.comments.find(c => 
        c.client_type === normalizedClientType || 
        (client_type === 'mal' && c.client_type === 'myanimelist')
      );
      const sourceComment = sourcePlatformComment || commentsResult.comments[0];
      
      mediaInfo = {
        mediaId: sourceComment.media_id,
        mediaType: sourceComment.media_type,
        mediaTitle: sourceComment.media_title,
        mediaYear: sourceComment.media_year,
        mediaPoster: sourceComment.media_poster
      };
    }

    return new Response(
      JSON.stringify({
        media: mediaInfo,
        comments: nestedComments,
        stats: {
          commentCount: commentsResult.totalCount || 0,
          totalUpvotes,
          totalDownvotes,
          netScore: totalUpvotes - totalDownvotes
        },
        pagination: {
          page,
          limit,
          total: commentsResult.totalCount || 0,
          totalPages: Math.ceil((commentsResult.totalCount || 0) / limit)
        },
        cross_platform: {
          enabled: commentsResult.platforms.length > 1,
          platforms: commentsResult.platforms,
          count: commentsResult.platforms.length
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