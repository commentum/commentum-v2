import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifyClientToken } from '../shared/clientAuth.ts'
import { getUserRole, getDisplayRole } from '../shared/auth.ts'
import { signJwt } from '../shared/jwt.ts'
import { getAuthUser, extractBearerToken } from '../shared/authMiddleware.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeDbClientType(provider: string): string {
  const p = (provider || '').toLowerCase()
  if (p === 'mal') return 'myanimelist'
  return p
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
    const rawSegments = url.pathname.split('/').filter(Boolean)
    // Supports both /functions/v1/auth/login and /auth/login and direct /login
    const authIdx = rawSegments.indexOf('auth')
    const pathSegments = authIdx !== -1 ? rawSegments.slice(authIdx + 1) : rawSegments
    const subRoute = (pathSegments[0] || '').toLowerCase()

    let body: any = {}
    if (req.method === 'POST') {
      try {
        body = await req.json()
      } catch (_) {
        body = {}
      }
    }

    const action = (subRoute || body.action || '').toLowerCase()

    // Route: POST /auth/login or action === 'login'
    if (action === 'login' || (req.method === 'POST' && (subRoute === '' || subRoute === 'login'))) {
      return await handleLogin(supabase, body)
    }

    // Route: GET /auth/me or action === 'me'
    if (action === 'me' || (req.method === 'GET' && subRoute === 'me')) {
      return await handleGetMe(supabase, req)
    }

    // Route: POST /auth/refresh or action === 'refresh'
    if (action === 'refresh' || (req.method === 'POST' && subRoute === 'refresh')) {
      return await handleRefresh(supabase, req)
    }

    return jsonResponse(
      {
        error: `Unknown auth route: ${subRoute || action}. Available routes: POST /login, GET /me, POST /refresh`,
      },
      404
    )
  } catch (error: any) {
    console.error('Auth endpoint error:', error)
    return jsonResponse(
      { error: error?.message || 'Internal server error in auth function' },
      500
    )
  }
})

/**
 * Handle POST /auth/login
 * Exchanges provider OAuth token for Commentum session token
 */
async function handleLogin(supabase: any, body: any) {
  const provider = (body.provider || body.client_type || '').toLowerCase().trim()
  const accessToken = (body.access_token || body.token || '').trim()

  if (!provider || !accessToken) {
    return jsonResponse(
      { error: 'provider and access_token are required' },
      400
    )
  }

  if (!['anilist', 'mal', 'simkl'].includes(provider)) {
    return jsonResponse(
      { error: `Unsupported provider: ${provider}. Must be anilist, mal, or simkl` },
      400
    )
  }

  // 1. Verify token with provider API (AniList, MAL, Simkl)
  const verifiedUser = await verifyClientToken(provider, accessToken)
  if (!verifiedUser || !verifiedUser.provider_user_id) {
    return jsonResponse(
      { error: 'Invalid or expired access token from provider' },
      401
    )
  }

  const userId = verifiedUser.provider_user_id
  const dbClientType = normalizeDbClientType(provider)

  // 2. Lookup existing user record
  const { data: existingUser } = await supabase
    .from('commentum_users')
    .select('*')
    .eq('commentum_client_type', dbClientType)
    .eq('commentum_user_id', userId)
    .maybeSingle()

  // Check if banned
  if (existingUser?.commentum_user_banned) {
    return jsonResponse(
      {
        error: 'Your account is banned from Commentum',
        reason: existingUser.commentum_user_banned_reason || 'Rule violation',
        banned_at: existingUser.commentum_user_banned_at,
      },
      403
    )
  }

  // 3. Upsert user in commentum_users table
  if (existingUser) {
    await supabase
      .from('commentum_users')
      .update({
        commentum_username: verifiedUser.username,
        commentum_user_avatar: verifiedUser.avatar_url || existingUser.commentum_user_avatar,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingUser.id)
  } else {
    await supabase.from('commentum_users').insert({
      commentum_client_type: dbClientType,
      commentum_user_id: userId,
      commentum_username: verifiedUser.username,
      commentum_user_avatar: verifiedUser.avatar_url || null,
      commentum_user_role: 'user',
    })
  }

  // 4. Resolve latest role
  const resolvedRole = await getUserRole(supabase, userId)

  // 5. Fetch customizations & linked accounts from user row
  const { data: freshUser } = await supabase
    .from('commentum_users')
    .select(
      'commentum_user_muted, commentum_user_muted_until, avatar_decoration, nameplate_theme, banner_url, banner_theme, linked_anilist_id, linked_anilist_username, linked_mal_id, linked_mal_username, linked_simkl_id, linked_simkl_username'
    )
    .eq('commentum_client_type', dbClientType)
    .eq('commentum_user_id', userId)
    .maybeSingle()

  // Check mute expiration
  let isMuted = freshUser?.commentum_user_muted || false
  if (isMuted && freshUser?.commentum_user_muted_until) {
    const muteUntil = new Date(freshUser.commentum_user_muted_until).getTime()
    if (Date.now() > muteUntil) {
      isMuted = false
    }
  }

  // 6. Fetch points & streaks
  let points = 0
  let currentStreak = 0
  let longestStreak = 0

  try {
    const { data: pointsData } = await supabase.rpc('get_user_points', {
      p_client_type: dbClientType,
      p_user_id: userId,
    })
    if (pointsData) {
      points = pointsData.total_points || 0
      currentStreak = pointsData.current_streak || 0
      longestStreak = pointsData.longest_streak || 0
    }
  } catch (_) {
    // Points system optional fallback
  }

  // 7. Format linked accounts
  const linkedAccounts: any[] = []
  if (freshUser?.linked_anilist_id) {
    linkedAccounts.push({
      provider: 'anilist',
      user_id: freshUser.linked_anilist_id,
      username: freshUser.linked_anilist_username,
    })
  }
  if (freshUser?.linked_mal_id) {
    linkedAccounts.push({
      provider: 'mal',
      user_id: freshUser.linked_mal_id,
      username: freshUser.linked_mal_username,
    })
  }
  if (freshUser?.linked_simkl_id) {
    linkedAccounts.push({
      provider: 'simkl',
      user_id: freshUser.linked_simkl_id,
      username: freshUser.linked_simkl_username,
    })
  }

  // 8. Sign JWT token (valid for 7 days)
  const tokenPayload = {
    sub: `${provider}:${userId}`,
    uid: userId,
    provider,
    username: verifiedUser.username,
    role: resolvedRole,
  }

  const { token, expires_at } = await signJwt(tokenPayload)

  // 9. Return session & user profile
  return jsonResponse(
    {
      success: true,
      token,
      expires_at,
      user: {
        user_id: userId,
        commentum_user_id: `${provider}:${userId}`,
        provider,
        username: verifiedUser.username,
        avatar_url: verifiedUser.avatar_url || null,
        role: resolvedRole,
        display_role: getDisplayRole(resolvedRole),
        is_banned: false,
        is_muted: isMuted,
        total_points: points,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        customizations: {
          avatar_decoration: freshUser?.avatar_decoration || null,
          nameplate_theme: freshUser?.nameplate_theme || null,
          banner_url: freshUser?.banner_url || null,
          banner_theme: freshUser?.banner_theme || null,
        },
        linked_accounts: linkedAccounts,
      },
    },
    200
  )
}

/**
 * Handle GET /auth/me
 * Returns current authenticated user profile
 */
async function handleGetMe(supabase: any, req: Request) {
  const auth = await getAuthUser(req, { requireAuth: true, supabase, checkDb: true })
  if (!auth.valid || !auth.user) {
    return jsonResponse({ error: auth.error || 'Unauthorized' }, auth.status || 401)
  }

  const user = auth.user
  const dbClientType = normalizeDbClientType(user.provider)

  // Fetch fresh profile from database
  const { data: dbUser } = await supabase
    .from('commentum_users')
    .select(
      'commentum_username, commentum_user_avatar, commentum_user_role, commentum_user_banned, commentum_user_muted, commentum_user_muted_until, avatar_decoration, nameplate_theme, banner_url, banner_theme, linked_anilist_id, linked_anilist_username, linked_mal_id, linked_mal_username, linked_simkl_id, linked_simkl_username'
    )
    .eq('commentum_client_type', dbClientType)
    .eq('commentum_user_id', user.uid)
    .maybeSingle()

  if (!dbUser) {
    return jsonResponse({ error: 'User record not found' }, 404)
  }

  if (dbUser.commentum_user_banned) {
    return jsonResponse({ error: 'Your account is banned' }, 403)
  }

  let points = 0
  let currentStreak = 0
  let longestStreak = 0

  try {
    const { data: pointsData } = await supabase.rpc('get_user_points', {
      p_client_type: dbClientType,
      p_user_id: user.uid,
    })
    if (pointsData) {
      points = pointsData.total_points || 0
      currentStreak = pointsData.current_streak || 0
      longestStreak = pointsData.longest_streak || 0
    }
  } catch (_) {
    // fallback
  }

  const linkedAccounts: any[] = []
  if (dbUser.linked_anilist_id) {
    linkedAccounts.push({
      provider: 'anilist',
      user_id: dbUser.linked_anilist_id,
      username: dbUser.linked_anilist_username,
    })
  }
  if (dbUser.linked_mal_id) {
    linkedAccounts.push({
      provider: 'mal',
      user_id: dbUser.linked_mal_id,
      username: dbUser.linked_mal_username,
    })
  }
  if (dbUser.linked_simkl_id) {
    linkedAccounts.push({
      provider: 'simkl',
      user_id: dbUser.linked_simkl_id,
      username: dbUser.linked_simkl_username,
    })
  }

  const role = dbUser.commentum_user_role || user.role || 'user'

  return jsonResponse({
    success: true,
    user: {
      user_id: user.uid,
      commentum_user_id: `${user.provider}:${user.uid}`,
      provider: user.provider,
      username: dbUser.commentum_username || user.username,
      avatar_url: dbUser.commentum_user_avatar || null,
      role,
      display_role: getDisplayRole(role),
      is_banned: false,
      is_muted: dbUser.commentum_user_muted || false,
      total_points: points,
      current_streak: currentStreak,
      longest_streak: longestStreak,
      customizations: {
        avatar_decoration: dbUser.avatar_decoration || null,
        nameplate_theme: dbUser.nameplate_theme || null,
        banner_url: dbUser.banner_url || null,
        banner_theme: dbUser.banner_theme || null,
      },
      linked_accounts: linkedAccounts,
    },
  })
}

/**
 * Handle POST /auth/refresh
 * Refreshes an active JWT token for 7 more days
 */
async function handleRefresh(supabase: any, req: Request) {
  const auth = await getAuthUser(req, { requireAuth: true, supabase, checkDb: true })
  if (!auth.valid || !auth.user) {
    return jsonResponse({ error: auth.error || 'Unauthorized' }, auth.status || 401)
  }

  const user = auth.user

  // Mint fresh token
  const { token, expires_at } = await signJwt({
    sub: user.sub,
    uid: user.uid,
    provider: user.provider,
    username: user.username,
    role: user.role,
  })

  return jsonResponse({
    success: true,
    token,
    expires_at,
  })
}
