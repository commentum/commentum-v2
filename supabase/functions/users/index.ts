import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifyAdminAccess, canModerate } from '../shared/auth.ts'
import { verifyClientToken } from '../shared/clientAuth.ts'

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

    const { action, client_type, access_token, target_user_id, target_client_type, reason, notes, duration } = await req.json()

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

    // Verify admin access
    const adminVerification = await verifyAdminAccess(supabase, moderator_id)
    if (!adminVerification.valid) {
      return new Response(
        JSON.stringify({ error: adminVerification.reason || 'Insufficient permissions' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const moderatorRole = adminVerification.role

    switch (action) {
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

  return new Response(
    JSON.stringify({ 
      success: true, 
      users: data,
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: moderatorRole
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
        role: moderatorRole
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
        role: moderatorRole
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
        role: moderatorRole
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
        role: moderatorRole
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
        role: moderatorRole
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
        role: moderatorRole
      }
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

  // Get user information with history
  const { data, error } = await supabase
    .from('commentum_users')
    .select(`
      *,
      comments:comments(
        id, content, created_at, updated_at, deleted, pinned, locked, 
        upvotes, downvotes, report_count, moderated, moderation_reason
      )
    `)
    .eq('commentum_user_id', target_user_id)
    .eq('commentum_client_type', target_client_type)
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({ 
      success: true, 
      user: data,
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: moderatorRole
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
