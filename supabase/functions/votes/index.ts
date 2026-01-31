import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { queueDiscordNotification } from '../shared/discordNotifications.ts'
import { getOrCreateUser, updateUserStats, canUserAct } from '../shared/userUtils.ts'

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

    const { comment_id, user_info, vote_type, client_type } = await req.json()

    // Validate required fields
    if (!comment_id || !user_info || !vote_type || !client_type) {
      return new Response(
        JSON.stringify({ error: 'comment_id, user_info, vote_type, and client_type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract user_id from user_info
    const user_id = user_info?.user_id
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_info.user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate comment_id (must be integer)
    if (!Number.isInteger(comment_id) || comment_id <= 0) {
      return new Response(
        JSON.stringify({ error: 'comment_id must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate vote_type
    if (!['upvote', 'downvote', 'remove'].includes(vote_type)) {
      return new Response(
        JSON.stringify({ error: 'vote_type must be upvote, downvote, or remove' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if voting is enabled
    const { data: votingConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'voting_enabled')
      .single()

    if (votingConfig && JSON.parse(votingConfig.value) === false) {
      return new Response(
        JSON.stringify({ error: 'Voting system is disabled' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get comment
    const { data: comment, error: commentError } = await supabase
      .from('comments')
      .select('*')
      .eq('id', comment_id)
      .single()

    if (commentError || !comment) {
      return new Response(
        JSON.stringify({ error: 'Comment not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (comment.deleted) {
      return new Response(
        JSON.stringify({ error: 'Cannot vote on deleted comment' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Ensure user record exists and check if user can act
    const userRecord = await getOrCreateUser(supabase, user_id, client_type, user_info.username, user_info.avatar)
    if (!userRecord) {
      return new Response(
        JSON.stringify({ error: 'Failed to create user record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user can still act (in case status changed)
    if (!canUserAct(userRecord)) {
      if (userRecord.user_banned) {
        return new Response(
          JSON.stringify({ error: 'User is banned' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      if (userRecord.user_shadow_banned) {
        return new Response(
          JSON.stringify({ error: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      if (userRecord.user_muted_until && new Date(userRecord.user_muted_until) > new Date()) {
        return new Response(
          JSON.stringify({ error: 'User is muted' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }


    // Parse current votes
    const userVotes = comment.user_votes ? JSON.parse(comment.user_votes) : {}
    const currentVote = userVotes[user_id]

    let newUpvotes = comment.upvotes
    let newDownvotes = comment.downvotes

    // Handle vote logic
    if (vote_type === 'upvote') {
      if (currentVote === 'upvote') {
        // Remove upvote
        delete userVotes[user_id]
        newUpvotes--
      } else if (currentVote === 'downvote') {
        // Change from downvote to upvote
        userVotes[user_id] = 'upvote'
        newDownvotes--
        newUpvotes++
      } else {
        // New upvote
        userVotes[user_id] = 'upvote'
        newUpvotes++
      }
    } else if (vote_type === 'downvote') {
      if (currentVote === 'downvote') {
        // Remove downvote
        delete userVotes[user_id]
        newDownvotes--
      } else if (currentVote === 'upvote') {
        // Change from upvote to downvote
        userVotes[user_id] = 'downvote'
        newUpvotes--
        newDownvotes++
      } else {
        // New downvote
        userVotes[user_id] = 'downvote'
        newDownvotes++
      }
    } else if (vote_type === 'remove') {
      // Remove vote
      if (currentVote === 'upvote') {
        newUpvotes--
      } else if (currentVote === 'downvote') {
        newDownvotes--
      }
      delete userVotes[user_id]
    }

    const newVoteScore = newUpvotes - newDownvotes

    // Update comment
    const { data: updatedComment, error: updateError } = await supabase
      .from('comments')
      .update({
        upvotes: newUpvotes,
        downvotes: newDownvotes,
        vote_score: newVoteScore,
        user_votes: JSON.stringify(userVotes)
      })
      .eq('id', comment_id)
      .select()
      .single()

    if (updateError) throw updateError

  // Update user statistics in users table
  await updateUserStats(supabase, user_id, client_type, 'vote', 1, 0)

  // Queue Discord notification for vote in background (only for new votes, not removals) - NON-BLOCKING
  if (vote_type !== 'remove' && (!currentVote || currentVote !== vote_type)) {
    queueDiscordNotification({
      type: 'vote_cast',
      voteType: vote_type,
      user: {
        id: user_info.user_id,
        username: user_info.username || `User ${user_info.user_id}`
      },
      comment: {
        id: comment.id,
        username: comment.username,
        user_id: comment.user_id,
        content: comment.content,
        client_type: comment.client_type,
        media_id: comment.media_id
      },
      media: {
        id: comment.media_id,
        title: comment.media_title,
        year: comment.media_year,
        poster: comment.media_poster
      }
    })
  }

  return new Response(
    JSON.stringify({
      success: true,
      voteScore: newVoteScore,
      upvotes: newUpvotes,
      downvotes: newDownvotes,
      userVote: userVotes[user_id] || null
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )

  } catch (error) {
    console.error('Voting API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
