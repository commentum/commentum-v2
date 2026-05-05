import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifyAdminAccess, getUserRole, canModerate, getDisplayRole } from '../shared/auth.ts'
import { verifyClientToken } from '../shared/clientAuth.ts'
import { queueDiscordNotification } from '../shared/discordNotifications.ts'

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

    const { action, client_type, access_token, target_user_id, target_client_type, reason, notes, duration, role, banned, muted, shadow_banned, page, limit, username } = await req.json()

    // All user management actions require token authentication
    if (!client_type || !access_token) {
      return new Response(
        JSON.stringify({ error: 'client_type and access_token are required for user management actions' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify the client token with the provider API
    const verifiedUser = await verifyClientToken(client_type, access_token)
    if (!verifiedUser) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired access token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const moderator_id = verifiedUser.provider_user_id

    // These actions are available to all authenticated users
    // get_user_history: anyone can view other users' public comments
    // get_role: anyone can check their own role
    const publicActions = ['get_user_history', 'get_role', 'search_users_public']

    let moderatorRole: string
    if (publicActions.includes(action)) {
      moderatorRole = await getUserRole(supabase, moderator_id)
    } else {
      // Moderation actions require admin/moderator access
      const adminVerification = await verifyAdminAccess(supabase, moderator_id)
      if (!adminVerification.valid) {
        return new Response(
          JSON.stringify({ error: adminVerification.reason || 'Insufficient permissions' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      moderatorRole = adminVerification.role
    }

    switch (action) {
      case 'get_role':
        return new Response(
          JSON.stringify({
            success: true,
            role: getDisplayRole(moderatorRole),
            user: {
              id: moderator_id,
              username: verifiedUser.username
            },
            moderator: {
              id: moderator_id,
              username: verifiedUser.username,
              role: getDisplayRole(moderatorRole)
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      case 'get_user_info':
        return await handleGetUserInfo(supabase, { target_user_id, target_client_type, moderator_id, moderatorRole, verifiedUser })
      
      case 'get_user_stats':
        return await handleGetUserStats(supabase, { target_client_type, moderator_id, moderatorRole, verifiedUser })
      
      case 'warn_user':
        return await handleWarnUser(supabase, { target_user_id, target_client_type, moderator_id, reason, moderatorRole, verifiedUser })
      
      case 'ban_user':
        return await handleBanUser(supabase, { target_user_id, target_client_type, moderator_id, reason, moderatorRole, verifiedUser })
      
      case 'unban_user':
        return await handleUnbanUser(supabase, { target_user_id, target_client_type, moderator_id, reason, moderatorRole, verifiedUser })
      
      case 'mute_user':
        return await handleMuteUser(supabase, { target_user_id, target_client_type, moderator_id, reason, duration, moderatorRole, verifiedUser })
      
      case 'unmute_user':
        return await handleUnmuteUser(supabase, { target_user_id, target_client_type, moderator_id, reason, moderatorRole, verifiedUser })
      
      case 'get_user_history':
        return await handleGetUserHistory(supabase, { target_user_id, target_client_type, moderator_id, moderatorRole, verifiedUser })
      
      case 'list_users':
        return await handleListUsers(supabase, { target_client_type, moderator_id, moderatorRole, verifiedUser, role, banned, muted, shadow_banned, page, limit })
      
      case 'search_users':
        return await handleSearchUsers(supabase, { username, target_client_type, moderator_id, moderatorRole, verifiedUser })

      case 'search_users_public':
        return await handleSearchUsersPublic(supabase, { username, target_client_type, moderator_id, verifiedUser })

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('User management API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function handleGetUserInfo(supabase: any, params: any) {
  const { target_user_id, target_client_type, moderator_id, moderatorRole, verifiedUser } = params

  let query = supabase
    .from('commentum_users')
    .select('*')

  if (target_user_id) {
    query = query.eq('commentum_user_id', target_user_id)
  }
  
  if (target_client_type) {
    query = query.eq('commentum_client_type', target_client_type)
  }

  const { data, error } = await query

  if (error) throw error

  // Enrich user data with readable field names
  const enrichedUsers = (data || []).map((u: any) => ({
    id: u.commentum_user_id,
    username: u.commentum_username,
    avatar: u.commentum_user_avatar,
    role: getDisplayRole(u.commentum_user_role),
    banned: u.commentum_user_banned,
    muted: u.commentum_user_muted,
    muted_until: u.commentum_user_muted_until,
    shadow_banned: u.commentum_user_shadow_banned,
    warnings: u.commentum_user_warnings,
    notes: u.commentum_user_notes,
    client_type: u.commentum_client_type,
    created_at: u.commentum_created_at || u.created_at,
    updated_at: u.commentum_updated_at || u.updated_at,
    // Keep original fields for backwards compatibility
    commentum_user_id: u.commentum_user_id,
    commentum_username: u.commentum_username,
    commentum_user_avatar: u.commentum_user_avatar,
    commentum_user_role: getDisplayRole(u.commentum_user_role),
    commentum_user_banned: u.commentum_user_banned,
    commentum_user_muted: u.commentum_user_muted,
    commentum_user_muted_until: u.commentum_user_muted_until,
    commentum_user_shadow_banned: u.commentum_user_shadow_banned,
    commentum_user_warnings: u.commentum_user_warnings,
    commentum_user_notes: u.commentum_user_notes,
    commentum_client_type: u.commentum_client_type,
  }))

  return new Response(
    JSON.stringify({ 
      success: true, 
      users: enrichedUsers,
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: getDisplayRole(moderatorRole)
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleGetUserStats(supabase: any, params: any) {
  const { target_client_type, moderator_id, moderatorRole, verifiedUser } = params

  const { data, error } = await supabase
    .rpc('get_user_statistics', { 
      p_client_type: target_client_type || null,
      p_days: 30 
    })

  if (error) throw error

  return new Response(
    JSON.stringify({ 
      success: true, 
      stats: data,
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: getDisplayRole(moderatorRole)
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleWarnUser(supabase: any, params: any) {
  const { target_user_id, target_client_type, moderator_id, reason, moderatorRole, verifiedUser } = params

  if (!target_user_id || !reason) {
    return new Response(
      JSON.stringify({ error: 'target_user_id and reason are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!target_client_type) {
    return new Response(
      JSON.stringify({ error: 'target_client_type is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user to check permissions
  const { data: targetUser } = await supabase
    .from('commentum_users')
    .select('commentum_user_role')
    .eq('commentum_user_id', target_user_id)
    .eq('commentum_client_type', target_client_type)
    .single()

  if (!targetUser) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!canModerate(moderatorRole, targetUser.commentum_user_role)) {
    return new Response(
      JSON.stringify({ error: 'Cannot moderate user with equal or higher role' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Add warning using helper function
  const { data: warningCount, error } = await supabase
    .rpc('add_user_warning', {
      p_client_type: target_client_type,
      p_user_id: target_user_id,
      p_warning_reason: reason,
      p_warned_by: moderator_id
    })

  if (error) throw error

  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'warned',
      targetUserId: target_user_id,
      clientType: target_client_type,
      reason,
      warningCount,
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: getDisplayRole(moderatorRole)
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleBanUser(supabase: any, params: any) {
  const { target_user_id, target_client_type, moderator_id, reason, moderatorRole, verifiedUser } = params

  if (!target_user_id || !reason) {
    return new Response(
      JSON.stringify({ error: 'target_user_id and reason are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!target_client_type) {
    return new Response(
      JSON.stringify({ error: 'target_client_type is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Only admin and super_admin can ban
  if (!['admin', 'super_admin', 'owner'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Admin permissions required to ban users' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user to check permissions
  const { data: targetUser } = await supabase
    .from('commentum_users')
    .select('commentum_user_role')
    .eq('commentum_user_id', target_user_id)
    .eq('commentum_client_type', target_client_type)
    .single()

  if (!targetUser) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!canModerate(moderatorRole, targetUser.commentum_user_role)) {
    return new Response(
      JSON.stringify({ error: 'Cannot ban user with equal or higher role' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Ban user using helper function
  const { data, error } = await supabase
    .rpc('ban_commentum_user', {
      p_client_type: target_client_type,
      p_user_id: target_user_id,
      p_ban_reason: reason,
      p_banned_by: moderator_id,
      p_shadow_ban: false
    })

  if (error) throw error

  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'banned',
      targetUserId: target_user_id,
      clientType: target_client_type,
      reason,
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: getDisplayRole(moderatorRole)
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUnbanUser(supabase: any, params: any) {
  const { target_user_id, target_client_type, moderator_id, reason, moderatorRole, verifiedUser } = params

  if (!target_user_id) {
    return new Response(
      JSON.stringify({ error: 'target_user_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!target_client_type) {
    return new Response(
      JSON.stringify({ error: 'target_client_type is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Only admin and super_admin can unban
  if (!['admin', 'super_admin', 'owner'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Admin permissions required to unban users' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Unban user by updating the user table
  const { error } = await supabase
    .from('commentum_users')
    .update({
      commentum_user_banned: false,
      commentum_user_shadow_banned: false,
      updated_at: new Date().toISOString()
    })
    .eq('commentum_client_type', target_client_type)
    .eq('commentum_user_id', target_user_id)

  if (error) throw error

  // Queue Discord notification for user unbanned in background
  queueDiscordNotification({
    type: 'user_unbanned',
    user: {
      id: target_user_id,
      username: verifiedUser.username
    },
    comment: {
      client_type: target_client_type
    },
    moderator: {
      id: moderator_id,
      username: verifiedUser.username
    }
  })

  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'unbanned',
      targetUserId: target_user_id,
      clientType: target_client_type,
      reason: reason || 'Manual unban',
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: getDisplayRole(moderatorRole)
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleMuteUser(supabase: any, params: any) {
  const { target_user_id, target_client_type, moderator_id, reason, duration, moderatorRole, verifiedUser } = params

  if (!target_user_id || !reason) {
    return new Response(
      JSON.stringify({ error: 'target_user_id and reason are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!target_client_type) {
    return new Response(
      JSON.stringify({ error: 'target_client_type is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user to check permissions and notes
  const { data: targetUser } = await supabase
    .from('commentum_users')
    .select('commentum_user_role, commentum_user_notes')
    .eq('commentum_user_id', target_user_id)
    .eq('commentum_client_type', target_client_type)
    .single()

  if (!targetUser) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const userNotes = targetUser.commentum_user_notes || ''

  if (!canModerate(moderatorRole, targetUser.commentum_user_role)) {
    return new Response(
      JSON.stringify({ error: 'Cannot moderate user with equal or higher role' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get default mute duration if not provided
  let muteDuration = duration
  if (!muteDuration) {
    const { data: muteConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'user_default_mute_duration_hours')
      .single()

    muteDuration = muteConfig ? parseInt(muteConfig.value) : 24
  }

  // Mute user using helper function
  const { data, error } = await supabase
    .rpc('mute_commentum_user', {
      p_client_type: target_client_type,
      p_user_id: target_user_id,
      p_mute_duration_hours: muteDuration,
      p_mute_reason: reason,
      p_muted_by: moderator_id
    })

  if (error) throw error

  // Queue Discord notification for user mute in background
  queueDiscordNotification({
    type: 'user_muted',
    user: {
      id: target_user_id,
      username: verifiedUser.username,
      notes: userNotes
    },
    comment: {
      client_type: target_client_type,
      id: '',  // No specific comment tied to mute action
      content: ''
    },
    moderator: {
      id: moderator_id,
      username: verifiedUser.username
    },
    reason,
    notes: userNotes,
    metadata: {
      duration: `${muteDuration} hours`
    }
  })

  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'muted',
      targetUserId: target_user_id,
      clientType: target_client_type,
      reason,
      duration: muteDuration,
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: getDisplayRole(moderatorRole)
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUnmuteUser(supabase: any, params: any) {
  const { target_user_id, target_client_type, moderator_id, reason, moderatorRole, verifiedUser } = params

  if (!target_user_id) {
    return new Response(
      JSON.stringify({ error: 'target_user_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!target_client_type) {
    return new Response(
      JSON.stringify({ error: 'target_client_type is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Unmute user by updating the user table
  const { error } = await supabase
    .from('commentum_users')
    .update({
      commentum_user_muted: false,
      commentum_user_muted_until: null,
      updated_at: new Date().toISOString()
    })
    .eq('commentum_client_type', target_client_type)
    .eq('commentum_user_id', target_user_id)

  if (error) throw error

  // Queue Discord notification for user unmute in background
  queueDiscordNotification({
    type: 'user_unmuted',
    user: {
      id: target_user_id,
      username: verifiedUser.username
    },
    comment: {
      client_type: target_client_type
    },
    moderator: {
      id: moderator_id,
      username: verifiedUser.username
    }
  })

  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'unmuted',
      targetUserId: target_user_id,
      clientType: target_client_type,
      reason: reason || 'Manual unmute',
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: getDisplayRole(moderatorRole)
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleListUsers(supabase: any, params: any) {
  const { target_client_type, moderator_id, moderatorRole, verifiedUser, role, banned, muted, shadow_banned, page = 1, limit = 50 } = params

  const effectiveLimit = Math.min(Math.max(limit, 1), 100)

  let query = supabase
    .from('commentum_users')
    .select('*', { count: 'exact' })
    .range((page - 1) * effectiveLimit, page * effectiveLimit - 1)
    .order('created_at', { ascending: false })

  if (target_client_type) query = query.eq('commentum_client_type', target_client_type)
  if (role) query = query.eq('commentum_user_role', role)
  if (banned !== undefined) query = query.eq('commentum_user_banned', banned)
  if (muted !== undefined) query = query.eq('commentum_user_muted', muted)
  if (shadow_banned !== undefined) query = query.eq('commentum_user_shadow_banned', shadow_banned)

  const { data, error, count } = await query
  if (error) throw error

  const enrichedUsers = (data || []).map((u: any) => ({
    id: u.commentum_user_id,
    username: u.commentum_username,
    avatar: u.commentum_user_avatar,
    role: getDisplayRole(u.commentum_user_role),
    banned: u.commentum_user_banned,
    muted: u.commentum_user_muted,
    muted_until: u.commentum_user_muted_until,
    shadow_banned: u.commentum_user_shadow_banned,
    warnings: u.commentum_user_warnings,
    client_type: u.commentum_client_type,
    created_at: u.commentum_created_at || u.created_at,
  }))

  return new Response(
    JSON.stringify({ success: true, users: enrichedUsers, total: count, page, limit: effectiveLimit,
      moderator: { id: moderator_id, username: verifiedUser.username, role: getDisplayRole(moderatorRole) }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleSearchUsers(supabase: any, params: any) {
  const { username, target_client_type, moderator_id, moderatorRole, verifiedUser } = params

  if (!username || username.trim().length < 2) {
    return new Response(
      JSON.stringify({ error: 'Username search requires at least 2 characters' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let query = supabase
    .from('commentum_users')
    .select('*')
    .ilike('commentum_username', `%${username.trim()}%`)
    .limit(25)

  if (target_client_type) {
    query = query.eq('commentum_client_type', target_client_type)
  }

  const { data, error } = await query
  if (error) throw error

  const enrichedUsers = (data || []).map((u: any) => ({
    id: u.commentum_user_id,
    username: u.commentum_username,
    avatar: u.commentum_user_avatar,
    role: getDisplayRole(u.commentum_user_role),
    banned: u.commentum_user_banned,
    muted: u.commentum_user_muted,
    muted_until: u.commentum_user_muted_until,
    shadow_banned: u.commentum_user_shadow_banned,
    warnings: u.commentum_user_warnings,
    client_type: u.commentum_client_type,
    created_at: u.commentum_created_at || u.created_at,
  }))

  return new Response(
    JSON.stringify({
      success: true,
      users: enrichedUsers,
      total: enrichedUsers.length,
      moderator: { id: moderator_id, username: verifiedUser.username, role: getDisplayRole(moderatorRole) }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleGetUserHistory(supabase: any, params: any) {
  const { target_user_id, target_client_type, moderator_id, moderatorRole, verifiedUser } = params

  if (!target_user_id || !target_client_type) {
    return new Response(
      JSON.stringify({ error: 'target_user_id and target_client_type are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const isMod = ['moderator', 'admin', 'super_admin', 'owner'].includes(moderatorRole)

  // Fetch user info and comments separately (no FK relationship between tables)
  const [userResult, commentsResult] = await Promise.all([
    supabase
      .from('commentum_users')
      .select('*')
      .eq('commentum_user_id', target_user_id)
      .eq('commentum_client_type', target_client_type)
      .single(),
    supabase
      .from('comments')
      .select('id, content, created_at, updated_at, deleted, pinned, locked, upvotes, downvotes, report_count, moderated, moderation_reason, media_id, media_title, media_type, tags')
      .eq('user_id', target_user_id)
      .eq('client_type', target_client_type)
      .order('created_at', { ascending: false })
  ])

  const data = userResult.data
  const userComments = commentsResult.data || []

  if (!data) {
    // User doesn't exist in commentum_users yet, but they might still have comments
    if (userComments.length === 0) {
      return new Response(
        JSON.stringify({ success: true, user: null, history: [], commentCount: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }
  // Non-mod users should not see deleted comments
  const visibleComments = isMod ? userComments : userComments.filter((c: any) => !c.deleted)
  const commentHistory = visibleComments.map((c: any) => ({
    id: c.id,
    action: 'comment',
    content: c.content,
    created_at: c.created_at,
    updated_at: c.updated_at,
    deleted: c.deleted,
    media_title: c.media_title,
    media_type: c.media_type,
    tags: c.tags,
    ...(isMod ? {
      pinned: c.pinned,
      locked: c.locked,
      upvotes: c.upvotes,
      downvotes: c.downvotes,
      report_count: c.report_count,
      moderated: c.moderated,
      moderation_reason: c.moderation_reason,
      moderator_username: c.moderation_reason ? 'System' : ''
    } : {})
  }))

  let allHistory = commentHistory

  // Only include moderation history for moderator+ users
  if (isMod) {
    // Add moderated entries
    const moderatedEntries = userComments
      .filter((c: any) => c.moderated)
      .map((c: any) => ({
        id: c.id,
        action: 'moderated',
        content: c.content,
        reason: c.moderation_reason || '',
        created_at: c.created_at,
        deleted: c.deleted,
        media_title: c.media_title,
        moderator_username: 'System'
      }))

    // Also extract moderation history from user notes if available
    const userNotes = data.commentum_user_notes || ''
    let moderationHistory: any[] = []
    if (userNotes) {
      try {
        moderationHistory = JSON.parse(userNotes)
        if (!Array.isArray(moderationHistory)) moderationHistory = []
      } catch {
        moderationHistory = []
      }
    }

    allHistory = [...moderationHistory, ...commentHistory]
  }

  // Build user info (limited for non-mod users)
  const userInfo: any = data ? {
    id: data.commentum_user_id,
    username: data.commentum_username,
    avatar: data.commentum_user_avatar,
    created_at: data.commentum_created_at || data.created_at,
    client_type: data.commentum_client_type
  } : {
    id: target_user_id,
    username: '',
    avatar: null,
    created_at: null,
    client_type: target_client_type
  }

  // Include moderation-specific fields only for mod+ users (and only if user data exists)
  if (isMod && data) {
    userInfo.role = getDisplayRole(data.commentum_user_role)
    userInfo.banned = data.commentum_user_banned
    userInfo.muted = data.commentum_user_muted
    userInfo.muted_until = data.commentum_user_muted_until
    userInfo.shadow_banned = data.commentum_user_shadow_banned
    userInfo.warnings = data.commentum_user_warnings
    userInfo.notes = data.commentum_user_notes
    userInfo.updated_at = data.commentum_updated_at || data.updated_at
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      user: userInfo,
      history: allHistory,
      commentCount: isMod ? userComments.length : visibleComments.length,
      ...(isMod ? {
        moderator: {
          id: moderator_id,
          username: verifiedUser.username,
          role: getDisplayRole(moderatorRole)
        }
      } : {})
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleSearchUsersPublic(supabase: any, params: any) {
  const { username, target_client_type, moderator_id, verifiedUser } = params

  if (!username || username.trim().length < 2) {
    return new Response(
      JSON.stringify({ error: 'Username search requires at least 2 characters' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (username.trim().length > 50) {
    return new Response(
      JSON.stringify({ error: 'Username search query too long' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let query = supabase
    .from('commentum_users')
    .select('commentum_user_id, commentum_username, commentum_user_avatar, commentum_client_type')
    .ilike('commentum_username', `%${username.trim()}%`)
    .eq('commentum_user_banned', false)
    .eq('commentum_user_active', true)
    .limit(15)

  if (target_client_type) {
    query = query.eq('commentum_client_type', target_client_type)
  }

  const { data, error } = await query
  if (error) throw error

  const users = (data || []).map((u: any) => ({
    id: u.commentum_user_id,
    username: u.commentum_username,
    avatar: u.commentum_user_avatar,
    client_type: u.commentum_client_type,
  }))

  return new Response(
    JSON.stringify({
      success: true,
      users,
      total: users.length,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
