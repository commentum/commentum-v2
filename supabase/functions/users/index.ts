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

    const { 
      action, client_type, access_token, target_user_id, target_client_type, 
      reason, notes, duration, role, new_role, banned, muted, shadow_banned, shadow_ban, 
      page, limit, username, delete_comment_id, delete_all_comments,
      avatar_decoration, banner_url, banner_theme, nameplate_theme,
      target_access_token, service_to_unlink 
    } = await req.json()

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
    // update_customizations / link_account / unlink_account: personal profile customization
    const publicActions = [
      'get_user_history', 'get_role', 'search_users_public', 'get_user_info',
      'update_customizations', 'link_account', 'unlink_account', 'get_profile'
    ]

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
        return await handleWarnUser(supabase, { target_user_id, target_client_type, moderator_id, reason, delete_comment_id, moderatorRole, verifiedUser })
      
      case 'ban_user':
        return await handleBanUser(supabase, { target_user_id, target_client_type, moderator_id, reason, duration, shadow_ban, delete_comment_id, delete_all_comments, moderatorRole, verifiedUser })
      
      case 'unban_user':
        return await handleUnbanUser(supabase, { target_user_id, target_client_type, moderator_id, reason, moderatorRole, verifiedUser })
      
      case 'mute_user':
        return await handleMuteUser(supabase, { target_user_id, target_client_type, moderator_id, reason, duration, delete_comment_id, moderatorRole, verifiedUser })
      
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

      case 'change_role':
        return await handleRoleChange(supabase, { target_user_id, target_client_type, moderator_id, moderatorRole, verifiedUser, role: role || new_role, reason })

      case 'update_customizations':
        return await handleUpdateCustomizations(supabase, {
          client_type, moderator_id, verifiedUser,
          avatar_decoration, banner_url, banner_theme, nameplate_theme
        })

      case 'link_account':
        return await handleLinkAccount(supabase, {
          client_type, moderator_id, verifiedUser,
          target_client_type, target_access_token
        })

      case 'unlink_account':
        return await handleUnlinkAccount(supabase, {
          client_type, moderator_id, service_to_unlink
        })

      case 'get_profile':
        return await handleGetProfile(supabase, {
          client_type, moderator_id, verifiedUser
        })

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
  // Respect expiration: a user with banned=true but banned_until in the past is effectively NOT banned
  const now = new Date()
  const enrichedUsers = (data || []).map((u: any) => {
    const isBanned = u.commentum_user_banned && (u.commentum_user_banned_until === null || new Date(u.commentum_user_banned_until) > now)
    const isMuted = u.commentum_user_muted && (u.commentum_user_muted_until === null || new Date(u.commentum_user_muted_until) > now)
    const isShadowBanned = u.commentum_user_shadow_banned && (u.commentum_user_shadow_banned_until === null || new Date(u.commentum_user_shadow_banned_until) > now)

    return {
      id: u.commentum_user_id,
      username: u.commentum_username,
      avatar: u.commentum_user_avatar,
      role: getDisplayRole(u.commentum_user_role),
      banned: isBanned,
      banned_until: u.commentum_user_banned_until,
      muted: isMuted,
      muted_until: u.commentum_user_muted_until,
      shadow_banned: isShadowBanned,
      shadow_banned_until: u.commentum_user_shadow_banned_until,
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
      commentum_user_banned: isBanned,
      commentum_user_banned_until: u.commentum_user_banned_until,
      commentum_user_muted: isMuted,
      commentum_user_muted_until: u.commentum_user_muted_until,
      commentum_user_shadow_banned: isShadowBanned,
      commentum_user_shadow_banned_until: u.commentum_user_shadow_banned_until,
      commentum_user_warnings: u.commentum_user_warnings,
      commentum_user_notes: u.commentum_user_notes,
      commentum_client_type: u.commentum_client_type,
      avatar_decoration: u.avatar_decoration || null,
      banner_url: u.banner_url || null,
      banner_theme: u.banner_theme || null,
      nameplate_theme: u.nameplate_theme || null,
      linked_accounts: {
        anilist: u.linked_anilist_id ? { id: u.linked_anilist_id, username: u.linked_anilist_username } : (u.commentum_client_type === 'anilist' ? { id: u.commentum_user_id, username: u.commentum_username } : null),
        mal: u.linked_mal_id ? { id: u.linked_mal_id, username: u.linked_mal_username } : (['mal', 'myanimelist'].includes(u.commentum_client_type) ? { id: u.commentum_user_id, username: u.commentum_username } : null),
        simkl: u.linked_simkl_id ? { id: u.linked_simkl_id, username: u.linked_simkl_username } : (u.commentum_client_type === 'simkl' ? { id: u.commentum_user_id, username: u.commentum_username } : null),
      }
    }
  })

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
  const { target_user_id, target_client_type, moderator_id, reason, delete_comment_id, moderatorRole, verifiedUser } = params

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

  // If delete_comment_id is specified, delete comment and resolve its reports
  if (delete_comment_id) {
    await supabase.from('comments').update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: moderator_id,
      report_status: 'resolved',
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_action: 'mod_warn_delete'
    }).eq('id', delete_comment_id)
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'warned',
      targetUserId: target_user_id,
      clientType: target_client_type,
      reason,
      warningCount,
      deletedCommentId: delete_comment_id || null,
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
  const { target_user_id, target_client_type, moderator_id, reason, duration, shadow_ban, delete_comment_id, delete_all_comments, moderatorRole, verifiedUser } = params

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

  // Ban user using helper function (supports duration)
  const durationHours = duration || null
  const { data, error } = await supabase
    .rpc('ban_commentum_user', {
      p_client_type: target_client_type,
      p_user_id: target_user_id,
      p_ban_reason: reason,
      p_banned_by: moderator_id,
      p_shadow_ban: shadow_ban || false,
      p_duration_hours: durationHours
    })

  if (error) throw error

  // If delete_comment_id is specified, delete comment and resolve its reports
  if (delete_comment_id) {
    await supabase.from('comments').update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: moderator_id,
      report_status: 'resolved',
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_action: 'mod_ban_delete'
    }).eq('id', delete_comment_id)
  }

  // If delete_all_comments is true, delete all comments from this user
  if (delete_all_comments) {
    await supabase.from('comments').update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: moderator_id,
      report_status: 'resolved',
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_action: 'mod_ban_delete_all'
    }).eq('user_id', String(target_user_id))
  }

  const durationText = durationHours ? `${durationHours} hours` : 'Permanent'

  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'banned',
      targetUserId: target_user_id,
      clientType: target_client_type,
      reason,
      duration: durationText,
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

  // Unban user by updating the user table (clear both ban and shadow ban + until columns)
  const { error } = await supabase
    .from('commentum_users')
    .update({
      commentum_user_banned: false,
      commentum_user_banned_until: null,
      commentum_user_shadow_banned: false,
      commentum_user_shadow_banned_until: null,
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
  const { target_user_id, target_client_type, moderator_id, reason, duration, delete_comment_id, moderatorRole, verifiedUser } = params

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
 
  // If delete_comment_id is specified, delete comment and resolve its reports
  if (delete_comment_id) {
    await supabase.from('comments').update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: moderator_id,
      report_status: 'resolved',
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_action: 'mod_mute_delete'
    }).eq('id', delete_comment_id)
  }

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
  if (banned !== undefined) {
    if (banned === true) {
      query = query.eq('commentum_user_banned', true).or('commentum_user_banned_until.is.null,commentum_user_banned_until.gt.' + new Date().toISOString())
    } else {
      query = query.eq('commentum_user_banned', banned)
    }
  }
  if (muted !== undefined) {
    if (muted === true) {
      query = query.eq('commentum_user_muted', true).or('commentum_user_muted_until.is.null,commentum_user_muted_until.gt.' + new Date().toISOString())
    } else {
      query = query.eq('commentum_user_muted', muted)
    }
  }
  if (shadow_banned !== undefined) {
    if (shadow_banned === true) {
      query = query.eq('commentum_user_shadow_banned', true).or('commentum_user_shadow_banned_until.is.null,commentum_user_shadow_banned_until.gt.' + new Date().toISOString())
    } else {
      query = query.eq('commentum_user_shadow_banned', shadow_banned)
    }
  }

  const { data, error, count } = await query
  if (error) throw error

  // Respect expiration in the response
  const now = new Date()
  const enrichedUsers = (data || []).map((u: any) => ({
    id: u.commentum_user_id,
    username: u.commentum_username,
    avatar: u.commentum_user_avatar,
    role: getDisplayRole(u.commentum_user_role),
    banned: u.commentum_user_banned && (u.commentum_user_banned_until === null || new Date(u.commentum_user_banned_until) > now),
    banned_until: u.commentum_user_banned_until,
    muted: u.commentum_user_muted && (u.commentum_user_muted_until === null || new Date(u.commentum_user_muted_until) > now),
    muted_until: u.commentum_user_muted_until,
    shadow_banned: u.commentum_user_shadow_banned && (u.commentum_user_shadow_banned_until === null || new Date(u.commentum_user_shadow_banned_until) > now),
    shadow_banned_until: u.commentum_user_shadow_banned_until,
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

  // Respect expiration in the response
  const now = new Date()
  const enrichedUsers = (data || []).map((u: any) => ({
    id: u.commentum_user_id,
    username: u.commentum_username,
    avatar: u.commentum_user_avatar,
    role: getDisplayRole(u.commentum_user_role),
    banned: u.commentum_user_banned && (u.commentum_user_banned_until === null || new Date(u.commentum_user_banned_until) > now),
    banned_until: u.commentum_user_banned_until,
    muted: u.commentum_user_muted && (u.commentum_user_muted_until === null || new Date(u.commentum_user_muted_until) > now),
    muted_until: u.commentum_user_muted_until,
    shadow_banned: u.commentum_user_shadow_banned && (u.commentum_user_shadow_banned_until === null || new Date(u.commentum_user_shadow_banned_until) > now),
    shadow_banned_until: u.commentum_user_shadow_banned_until,
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
    // Respect expiration in the user info response
    const now = new Date()
    userInfo.banned = data.commentum_user_banned && (data.commentum_user_banned_until === null || new Date(data.commentum_user_banned_until) > now)
    userInfo.banned_until = data.commentum_user_banned_until
    userInfo.muted = data.commentum_user_muted && (data.commentum_user_muted_until === null || new Date(data.commentum_user_muted_until) > now)
    userInfo.muted_until = data.commentum_user_muted_until
    userInfo.shadow_banned = data.commentum_user_shadow_banned && (data.commentum_user_shadow_banned_until === null || new Date(data.commentum_user_shadow_banned_until) > now)
    userInfo.shadow_banned_until = data.commentum_user_shadow_banned_until
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
    .eq('commentum_user_active', true)
    // Filter out users who are currently banned (respecting expiration)
    .or('commentum_user_banned.eq.false,commentum_user_banned_until.lt.' + new Date().toISOString())
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

async function handleRoleChange(supabase: any, params: any) {
  const { target_user_id, target_client_type, moderator_id, moderatorRole, verifiedUser, role, reason } = params
  const requestedRole = (role || '').toLowerCase().trim()

  const ALLOWED_ROLES = ['user', 'moderator', 'admin', 'super_admin']
  if (!ALLOWED_ROLES.includes(requestedRole)) {
    return new Response(
      JSON.stringify({ error: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(', ')}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Only owner, super_admin, or admin can change roles
  if (!['owner', 'super_admin', 'admin'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Only administrators can change user roles' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Hierarchy check
  if (moderatorRole === 'admin' && (requestedRole === 'admin' || requestedRole === 'super_admin' || requestedRole === 'owner')) {
    return new Response(
      JSON.stringify({ error: 'Admins cannot assign admin or super admin roles' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Keys in config table
  const ROLE_KEYS: Record<string, string> = {
    'moderator': 'moderator_users',
    'admin': 'admin_users',
    'super_admin': 'super_admin_users'
  }

  // Update config lists: remove target_user_id from all role lists
  const { data: configs } = await supabase.from('config').select('key, value').in('key', ['moderator_users', 'admin_users', 'super_admin_users'])
  
  for (const c of (configs || [])) {
    let users: any[] = []
    try { users = JSON.parse(c.value || '[]') } catch { users = [] }
    const filtered = users.filter((u: any) => String(u) !== String(target_user_id))
    if (c.key === ROLE_KEYS[requestedRole]) {
      filtered.push(isNaN(Number(target_user_id)) ? String(target_user_id) : Number(target_user_id))
    }
    await supabase.from('config').update({ value: JSON.stringify(filtered), updated_at: new Date().toISOString() }).eq('key', c.key)
  }

  // Update commentum_users table (updated_at is the real column;
  // commentum_updated_at does not exist and would fail the update)
  await supabase.from('commentum_users').update({
    commentum_user_role: requestedRole,
    updated_at: new Date().toISOString()
  }).eq('commentum_user_id', String(target_user_id))

  // Update all existing comments for this user so their badge reflects the role immediately
  await supabase.from('comments').update({
    user_role: requestedRole
  }).eq('user_id', String(target_user_id))

  return new Response(
    JSON.stringify({
      success: true,
      message: `User role updated to ${requestedRole}`,
      target_user_id,
      role: requestedRole
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

/**
 * Unified user lookup: checks primary credentials first, then linked accounts
 */
async function findUnifiedUser(supabase: any, clientType: string, userId: string) {
  const normClient = clientType.toLowerCase() === 'myanimelist' ? 'mal' : clientType.toLowerCase();

  // 1. Direct match on primary credentials
  const { data: primary } = await supabase
    .from('commentum_users')
    .select('*')
    .or(`and(commentum_client_type.eq.${clientType},commentum_user_id.eq.${userId}),and(commentum_client_type.eq.${normClient},commentum_user_id.eq.${userId})`)
    .maybeSingle();

  if (primary) return primary;

  // 2. Check if this account is linked to another primary record
  let linkedQuery = supabase.from('commentum_users').select('*');
  if (normClient === 'anilist') {
    linkedQuery = linkedQuery.eq('linked_anilist_id', userId);
  } else if (normClient === 'mal') {
    linkedQuery = linkedQuery.eq('linked_mal_id', userId);
  } else if (normClient === 'simkl') {
    linkedQuery = linkedQuery.eq('linked_simkl_id', userId);
  } else {
    return null;
  }

  const { data: linked } = await linkedQuery.maybeSingle();
  return linked;
}

function formatLinkedAccounts(user: any) {
  return {
    anilist: user.linked_anilist_id ? { id: user.linked_anilist_id, username: user.linked_anilist_username } : (user.commentum_client_type === 'anilist' ? { id: user.commentum_user_id, username: user.commentum_username } : null),
    mal: user.linked_mal_id ? { id: user.linked_mal_id, username: user.linked_mal_username } : (['mal', 'myanimelist'].includes(user.commentum_client_type) ? { id: user.commentum_user_id, username: user.commentum_username } : null),
    simkl: user.linked_simkl_id ? { id: user.linked_simkl_id, username: user.linked_simkl_username } : (user.commentum_client_type === 'simkl' ? { id: user.commentum_user_id, username: user.commentum_username } : null),
  };
}

async function handleGetProfile(supabase: any, params: any) {
  const { client_type, moderator_id, verifiedUser } = params;
  const normClient = client_type.toLowerCase() === 'myanimelist' ? 'mal' : client_type.toLowerCase();

  let user = await findUnifiedUser(supabase, normClient, moderator_id);
  if (!user) {
    const { data: created } = await supabase
      .from('commentum_users')
      .insert({
        commentum_client_type: normClient,
        commentum_user_id: moderator_id,
        commentum_username: verifiedUser.username,
        commentum_user_avatar: verifiedUser.avatar_url,
      })
      .select()
      .single();
    user = created;
  }

  return new Response(
    JSON.stringify({
      success: true,
      user: {
        id: user.commentum_user_id,
        username: user.commentum_username,
        avatar: user.commentum_user_avatar,
        role: getDisplayRole(user.commentum_user_role),
        client_type: user.commentum_client_type,
        avatar_decoration: user.avatar_decoration || null,
        banner_url: user.banner_url || null,
        banner_theme: user.banner_theme || null,
        nameplate_theme: user.nameplate_theme || null,
        linked_accounts: formatLinkedAccounts(user),
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleUpdateCustomizations(supabase: any, params: any) {
  const { client_type, moderator_id, verifiedUser, avatar_decoration, banner_url, banner_theme, nameplate_theme } = params;
  const normClient = client_type.toLowerCase() === 'myanimelist' ? 'mal' : client_type.toLowerCase();

  let user = await findUnifiedUser(supabase, normClient, moderator_id);
  if (!user) {
    const { data: created, error } = await supabase
      .from('commentum_users')
      .insert({
        commentum_client_type: normClient,
        commentum_user_id: moderator_id,
        commentum_username: verifiedUser.username,
        commentum_user_avatar: verifiedUser.avatar_url,
        avatar_decoration: avatar_decoration ?? null,
        banner_url: banner_url ?? null,
        banner_theme: banner_theme ?? null,
        nameplate_theme: nameplate_theme ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    user = created;
  } else {
    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (avatar_decoration !== undefined) updatePayload.avatar_decoration = avatar_decoration;
    if (banner_url !== undefined) updatePayload.banner_url = banner_url;
    if (banner_theme !== undefined) updatePayload.banner_theme = banner_theme;
    if (nameplate_theme !== undefined) updatePayload.nameplate_theme = nameplate_theme;

    const { data: updated, error } = await supabase
      .from('commentum_users')
      .update(updatePayload)
      .eq('id', user.id)
      .select()
      .single();
    if (error) throw error;
    user = updated;
  }

  return new Response(
    JSON.stringify({
      success: true,
      customizations: {
        avatar_decoration: user.avatar_decoration,
        banner_url: user.banner_url,
        banner_theme: user.banner_theme,
        nameplate_theme: user.nameplate_theme,
      },
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleLinkAccount(supabase: any, params: any) {
  const { client_type, moderator_id, verifiedUser, target_client_type, target_access_token } = params;
  if (!target_client_type || !target_access_token) {
    return new Response(
      JSON.stringify({ error: 'target_client_type and target_access_token are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const normTarget = target_client_type.toLowerCase() === 'myanimelist' ? 'mal' : target_client_type.toLowerCase();
  const normClient = client_type.toLowerCase() === 'myanimelist' ? 'mal' : client_type.toLowerCase();

  if (normTarget === normClient) {
    return new Response(
      JSON.stringify({ error: 'Cannot link the same service type to itself' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Verify the target token with provider
  const targetVerified = await verifyClientToken(normTarget, target_access_token);
  if (!targetVerified) {
    return new Response(
      JSON.stringify({ error: `Invalid or expired ${target_client_type} access token` }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Find or create primary user
  let user = await findUnifiedUser(supabase, normClient, moderator_id);
  if (!user) {
    const { data: created, error } = await supabase
      .from('commentum_users')
      .insert({
        commentum_client_type: normClient,
        commentum_user_id: moderator_id,
        commentum_username: verifiedUser.username,
        commentum_user_avatar: verifiedUser.avatar_url,
      })
      .select()
      .single();
    if (error) throw error;
    user = created;
  }

  // Set the linked fields
  const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
  if (normTarget === 'anilist') {
    updateFields.linked_anilist_id = targetVerified.provider_user_id;
    updateFields.linked_anilist_username = targetVerified.username;
  } else if (normTarget === 'mal') {
    updateFields.linked_mal_id = targetVerified.provider_user_id;
    updateFields.linked_mal_username = targetVerified.username;
  } else if (normTarget === 'simkl') {
    updateFields.linked_simkl_id = targetVerified.provider_user_id;
    updateFields.linked_simkl_username = targetVerified.username;
  }

  const { data: updated, error } = await supabase
    .from('commentum_users')
    .update(updateFields)
    .eq('id', user.id)
    .select()
    .single();

  if (error) throw error;

  return new Response(
    JSON.stringify({
      success: true,
      message: `Successfully linked ${target_client_type} account (${targetVerified.username})`,
      linked_accounts: formatLinkedAccounts(updated),
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleUnlinkAccount(supabase: any, params: any) {
  const { client_type, moderator_id, service_to_unlink } = params;
  if (!service_to_unlink) {
    return new Response(
      JSON.stringify({ error: 'service_to_unlink is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const normUnlink = service_to_unlink.toLowerCase() === 'myanimelist' ? 'mal' : service_to_unlink.toLowerCase();
  const normClient = client_type.toLowerCase() === 'myanimelist' ? 'mal' : client_type.toLowerCase();

  const user = await findUnifiedUser(supabase, normClient, moderator_id);
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (user.commentum_client_type === normUnlink) {
    return new Response(
      JSON.stringify({ error: 'Cannot unlink your primary account' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
  if (normUnlink === 'anilist') {
    updateFields.linked_anilist_id = null;
    updateFields.linked_anilist_username = null;
  } else if (normUnlink === 'mal') {
    updateFields.linked_mal_id = null;
    updateFields.linked_mal_username = null;
  } else if (normUnlink === 'simkl') {
    updateFields.linked_simkl_id = null;
    updateFields.linked_simkl_username = null;
  }

  const { data: updated, error } = await supabase
    .from('commentum_users')
    .update(updateFields)
    .eq('id', user.id)
    .select()
    .single();

  if (error) throw error;

  return new Response(
    JSON.stringify({
      success: true,
      message: `Successfully unlinked ${service_to_unlink}`,
      linked_accounts: formatLinkedAccounts(updated),
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}


