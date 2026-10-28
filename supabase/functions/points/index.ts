import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { getUserRole } from '../shared/auth.ts'
import { resolveUserBadges } from '../shared/badges.ts'
import { getConfig } from '../shared/configCache.ts'

import { getAuthUser } from '../shared/authMiddleware.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-session-token, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

    const auth = await getAuthUser(req, { requireAuth: false })
    const isTokenAuth = auth.valid && !!auth.user

    const url = new URL(req.url)
    const body = await req.json().catch(() => ({}))
    const action = (body.action || url.searchParams.get('action') || (req.method === 'GET' ? 'get_user_points' : '')).toLowerCase()
    const { user_info, client_type, target_user_id, target_client_type, requester_user_id, requester_client_type, user_ids, page, limit } = body

    switch (action) {
      case 'get_user_points':
        return await handleGetUserPoints(supabase, {
          user_info,
          client_type,
          target_user_id: target_user_id || url.searchParams.get('target_user_id'),
          target_client_type: target_client_type || url.searchParams.get('target_client_type'),
          requester_user_id: isTokenAuth ? auth.user!.uid : requester_user_id,
          requester_client_type: isTokenAuth ? auth.user!.provider : requester_client_type,
          authUser: isTokenAuth ? auth.user : null,
          body
        })

      case 'get_leaderboard':
        return await handleGetLeaderboard(supabase, { 
          client_type: target_client_type || url.searchParams.get('client_type'), 
          page: page || (url.searchParams.get('page') ? parseInt(url.searchParams.get('page')!) : 1), 
          limit: limit || (url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : 50) 
        })

      case 'get_points_config':
        return await handleGetPointsConfig(supabase)

      case 'get_batch_user_points':
        return await handleGetBatchUserPoints(supabase, { client_type, user_ids })

      case 'refresh_user':
        return await handleRefreshUser(supabase, { 
          target_user_id: target_user_id || (isTokenAuth ? auth.user!.uid : undefined), 
          target_client_type: target_client_type || (isTokenAuth ? auth.user!.provider : undefined), 
          client_type 
        })

      case 'refresh_all':
        return await handleRefreshAll(supabase, { client_type: target_client_type })

      case 'claim_ad_points':
        return await handleClaimAdPoints(supabase, auth.user, body)

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Must be get_user_points, get_leaderboard, get_points_config, get_batch_user_points, refresh_user, refresh_all, or claim_ad_points' }),
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

interface BonusTag {
  text: string
  color: string
  label: string
}

function resolveBonusTag(role?: string, roleBonus?: number, isInfinite?: boolean): BonusTag | null {
  if (isInfinite || role === 'owner' || role === 'app_owner') {
    return {
      text: '∞',
      color: '#FFD700',
      label: role === 'app_owner' ? 'App Creator' : 'Commentum Owner'
    }
  }

  if (roleBonus && roleBonus > 0) {
    let color = '#5865F2'
    let label = 'Bonus'
    if (role === 'super_admin') {
      color = '#ED4245'
      label = 'SuperAdmin'
    } else if (role === 'admin') {
      color = '#E67E22'
      label = 'Admin'
    } else if (role === 'moderator') {
      color = '#5865F2'
      label = 'Mod'
    }

    return {
      text: `+${roleBonus}`,
      color,
      label
    }
  }

  return null
}

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
  const { user_info, client_type, target_user_id, target_client_type, requester_user_id, requester_client_type, authUser, body } = params

  let query_client_type: string
  let query_user_id: string

  if (target_user_id && target_client_type) {
    query_client_type = target_client_type
    query_user_id = target_user_id
  } else if (authUser) {
    query_client_type = authUser.provider
    query_user_id = authUser.uid
  } else if (body?.user_id && (body?.client_type || body?.provider)) {
    query_client_type = body.client_type || body.provider
    query_user_id = String(body.user_id)
  } else if (user_info?.user_id && client_type) {
    query_client_type = client_type
    query_user_id = String(user_info.user_id)
  } else {
    return new Response(
      JSON.stringify({ error: 'Provide Bearer token or (user_info + client_type) or (target_user_id + target_client_type)' }),
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

  const isOwnerType = responseData.role === 'owner' || responseData.role === 'app_owner' || responseData.is_infinite === true
  if (isOwnerType) {
    responseData.is_infinite = true
    responseData.display_points = '∞'
  }

  const bonusTag = resolveBonusTag(responseData.role, responseData.role_bonus, isOwnerType)

  const badges = resolveUserBadges({
    role: responseData.role,
    tier: responseData.tier,
    points: responseData.total_points ?? responseData.points
  })

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        user_id: query_user_id,
        client_type: query_client_type,
        badges,
        bonus_tag: bonusTag,
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
 * Returns top users ranked by real points.
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

  // Global decorations kill-switch (Discord /config decorations_enabled).
  const _decoFlag = await getConfig(supabase, 'decorations_enabled')
  const decorationsEnabled = _decoFlag !== false && _decoFlag !== 'false'

  const enrichedLeaderboard = (data?.leaderboard || []).map((entry: any) => {
    const isInf = entry.is_infinite === true || entry.role === 'owner' || entry.role === 'app_owner'
    return {
      ...entry,
      // Global decorations kill-switch: strip frames for everyone when off.
      avatar_decoration: decorationsEnabled ? (entry.avatar_decoration ?? null) : null,
      is_infinite: isInf,
      display_points: isInf ? '∞' : String(entry.real_points ?? entry.points),
      bonus_tag: resolveBonusTag(entry.role, entry.role_bonus, isInf),
      badges: resolveUserBadges({
        role: entry.role,
        tier: entry.tier,
        points: entry.total_points ?? entry.points ?? entry.real_points
      })
    }
  })

  return new Response(
    JSON.stringify({
      success: true,
      ...data,
      leaderboard: enrichedLeaderboard,
      decorations_enabled: decorationsEnabled
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

/**
 * claim_ad_points
 * Reward points for watching a voluntary ad.
 */
async function handleClaimAdPoints(supabase: any, user: any, body: any) {
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Authentication required' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const client_type = user.provider
  const user_id = user.uid
  const ad_id = body.ad_id || body.refer_id
  const points = body.points ?? body.points_reward ?? body.reward_points

  if (!ad_id || typeof ad_id !== 'string' || ad_id.trim() === '') {
    return new Response(
      JSON.stringify({ success: false, error: 'ad_id_required', message: 'ad_id (or refer_id) is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const parsedPoints = points !== undefined && points !== null && !isNaN(Number(points)) && Number(points) > 0
    ? Math.floor(Number(points))
    : null

  const { data, error } = await supabase.rpc('claim_ad_points', {
    p_client_type: client_type,
    p_user_id: String(user_id),
    p_ad_id: ad_id.trim(),
    p_points: parsedPoints
  })

  if (error) {
    console.error('claim_ad_points RPC error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to claim ad points', details: error.message || error }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const statusCode = data?.success === true ? 200 : 400
  return new Response(
    JSON.stringify(data),
    { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
