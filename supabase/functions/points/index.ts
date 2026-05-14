import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { getUserRole } from '../shared/auth.ts'

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

    // Check if points system is enabled
    const { data: pointsConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'points_enabled')
      .single()

    if (pointsConfig && JSON.parse(pointsConfig.value) === false) {
      return new Response(
        JSON.stringify({ error: 'Points system is disabled' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()
    const { action, user_info, client_type, target_user_id, target_client_type, requester_user_id, requester_client_type, user_ids, page, limit } = body

    switch (action) {
      case 'get_user_points':
        return await handleGetUserPoints(supabase, { user_info, client_type, target_user_id, target_client_type, requester_user_id, requester_client_type })

      case 'get_leaderboard':
        return await handleGetLeaderboard(supabase, { client_type: target_client_type, page, limit })

      case 'get_points_config':
        return await handleGetPointsConfig(supabase)

      case 'get_batch_user_points':
        return await handleGetBatchUserPoints(supabase, { client_type, user_ids })

      case 'refresh_user':
        return await handleRefreshUser(supabase, { target_user_id, target_client_type, client_type })

      case 'refresh_all':
        return await handleRefreshAll(supabase, { client_type: target_client_type })

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Must be get_user_points, get_leaderboard, get_points_config, get_batch_user_points, refresh_user, or refresh_all' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Points API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * get_user_points
 * 
 * Get points for a user. Two modes:
 * 1. Own points: pass user_info (no token needed)
 * 2. Other user's points: pass target_user_id + target_client_type (no token needed)
 * 
 * Privacy: Negative breakdown (warnings, mod_deletions, banned) is only shown if:
 * - The requester is viewing their own points (requester_user_id matches target)
 * - The requester is mod+ role
 * Otherwise, negative breakdown is stripped from the response.
 */
async function handleGetUserPoints(supabase: any, params: any) {
  const { user_info, client_type, target_user_id, target_client_type, requester_user_id, requester_client_type } = params

  let query_client_type: string
  let query_user_id: string

  // If target_user_id provided, look up that user
  if (target_user_id && target_client_type) {
    query_client_type = target_client_type
    query_user_id = target_user_id
  } else if (user_info?.user_id && client_type) {
    // Otherwise, look up the requesting user
    query_client_type = client_type
    query_user_id = user_info.user_id
  } else {
    return new Response(
      JSON.stringify({ error: 'Provide either (user_info + client_type) or (target_user_id + target_client_type)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Call the SQL function
  const { data, error } = await supabase
    .rpc('get_user_points', {
      p_client_type: query_client_type,
      p_user_id: query_user_id
    })

  if (error) {
    console.error('get_user_points RPC error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to calculate points' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Determine if requester can see full breakdown (including negatives)
  const effectiveRequesterId = requester_user_id || user_info?.user_id
  const effectiveRequesterClient = requester_client_type || client_type
  const isSelf = effectiveRequesterId && String(effectiveRequesterId) === String(query_user_id) && effectiveRequesterClient === query_client_type
  
  let isModPlus = false
  if (!isSelf && effectiveRequesterId && effectiveRequesterClient) {
    const requesterRole = await getUserRole(supabase, effectiveRequesterId)
    isModPlus = ['moderator', 'admin', 'super_admin', 'owner'].includes(requesterRole)
  }

  const canSeeFullBreakdown = isSelf || isModPlus

  // Strip negative breakdown if requester can't see it
  let responseData = { ...data }
  if (!canSeeFullBreakdown && responseData.breakdown) {
    const breakdown = { ...responseData.breakdown }
    delete breakdown.from_downvotes_received
    delete breakdown.penalty_warnings
    delete breakdown.penalty_mod_deletes
    delete breakdown.penalty_ban
    responseData.breakdown = breakdown
  }

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        user_id: query_user_id,
        client_type: query_client_type,
        ...responseData
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

/**
 * get_leaderboard
 * 
 * Public endpoint — no auth needed.
 * Returns top users ranked by points.
 */
async function handleGetLeaderboard(supabase: any, params: any) {
  const { client_type, page = 1, limit = 50 } = params

  const { data, error } = await supabase
    .rpc('get_points_leaderboard', {
      p_client_type: client_type || null,
      p_page: page,
      p_limit: limit
    })

  if (error) {
    console.error('get_points_leaderboard RPC error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch leaderboard' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      success: true,
      ...data
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

/**
 * get_points_config
 * 
 * Public endpoint — no auth needed.
 * Returns tier definitions and point values (for client UI).
 */
async function handleGetPointsConfig(supabase: any) {
  const { data, error } = await supabase
    .rpc('get_points_config')

  if (error) {
    console.error('get_points_config RPC error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch points config' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      success: true,
      config: data
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

/**
 * get_batch_user_points
 * 
 * Get tier info for multiple users at once.
 * Used for embedding badges in comment lists.
 * Only returns public info (tier, username, avatar) — no breakdown.
 * 
 * Request:
 * {
 *   "action": "get_batch_user_points",
 *   "client_type": "anilist",
 *   "user_ids": ["12345", "67890", "11111"]
 * }
 */
async function handleGetBatchUserPoints(supabase: any, params: any) {
  const { client_type, user_ids } = params

  if (!client_type) {
    return new Response(
      JSON.stringify({ error: 'client_type is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
    return new Response(
      JSON.stringify({ error: 'user_ids must be a non-empty array' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Cap at 100 users per request
  if (user_ids.length > 100) {
    return new Response(
      JSON.stringify({ error: 'Maximum 100 user_ids per request' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data, error } = await supabase
    .rpc('get_batch_user_points', {
      p_client_type: client_type,
      p_user_ids: user_ids
    })

  if (error) {
    console.error('get_batch_user_points RPC error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch batch user points' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      success: true,
      users: data
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

/**
 * refresh_user
 * Force recalculate and store points for a single user
 */
async function handleRefreshUser(supabase: any, params: any) {
  const { target_user_id, target_client_type, client_type } = params

  const queryClientType = target_client_type || client_type
  const queryUserId = target_user_id

  if (!queryUserId || !queryClientType) {
    return new Response(
      JSON.stringify({ error: 'target_user_id and client_type (or target_client_type) are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { error } = await supabase
    .rpc('refresh_user_points', {
      p_client_type: queryClientType,
      p_user_id: queryUserId
    })

  if (error) {
    console.error('refresh_user_points RPC error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to refresh user points' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, message: `Points refreshed for user ${queryUserId}` }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

/**
 * refresh_all
 * Recalculate and store points for all users (maintenance)
 */
async function handleRefreshAll(supabase: any, params: any) {
  const { client_type } = params

  const { data, error } = await supabase
    .rpc('refresh_all_user_points', {
      p_client_type: client_type || null
    })

  if (error) {
    console.error('refresh_all_user_points RPC error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to refresh all user points' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, refreshed_count: data }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
