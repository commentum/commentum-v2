import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifyAdminAccess, getUserRole, canModerate } from '../shared/auth.ts'

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

    const { action, moderator_info, target_user_id, client_type, reason, notes } = await req.json()

    // All user management actions require authentication
    if (!moderator_info) {
      return new Response(
        JSON.stringify({ error: 'moderator_info is required for user management actions' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const moderator_id = moderator_info?.user_id
    if (!moderator_id) {
      return new Response(
        JSON.stringify({ error: 'moderator_info.user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
        return await handleGetUserInfo(supabase, { target_user_id, client_type })
      
      case 'get_user_stats':
        return await handleGetUserStats(supabase, { client_type })
      
      case 'warn_user':
        return await handleWarnUser(supabase, { target_user_id, client_type, moderator_id, reason, moderatorRole })
      
      case 'ban_user':
        return await handleBanUser(supabase, { target_user_id, client_type, moderator_id, reason, moderatorRole })
      
      case 'unban_user':
        return await handleUnbanUser(supabase, { target_user_id, client_type, moderator_id, reason, moderatorRole })
      
      case 'mute_user':
        return await handleMuteUser(supabase, { target_user_id, client_type, moderator_id, reason, moderatorRole })
      
      case 'unmute_user':
        return await handleUnmuteUser(supabase, { target_user_id, client_type, moderator_id, reason, moderatorRole })
      
      case 'add_user_notes':
        return await handleAddUserNotes(supabase, { target_user_id, client_type, notes, moderator_id, moderatorRole })
      
      case 'get_user_history':
        return await handleGetUserHistory(supabase, { target_user_id, client_type })
      
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
  const { target_user_id, client_type } = params

  let query = supabase
    .from('commentum_users')
    .select('*')

  if (target_user_id) {
    query = query.eq('commentum_user_id', target_user_id)
  }
  
  if (client_type) {
    query = query.eq('commentum_client_type', client_type)
  }

  const { data, error } = await query

  if (error) throw error

  return new Response(
    JSON.stringify({ success: true, users: data }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleGetUserStats(supabase: any, params: any) {
  const { client_type } = params

  const { data, error } = await supabase
    .rpc('get_user_statistics', { 
      p_client_type: client_type || null,
      p_days: 30 
    })

  if (error) throw error

  return new Response(
    JSON.stringify({ success: true, stats: data }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleWarnUser(supabase: any, params: any) {
  const { target_user_id, client_type, moderator_id, reason, moderatorRole } = params

  if (!target_user_id || !reason) {
    return new Response(
      JSON.stringify({ error: 'target_user_id and reason are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user to check permissions
  const { data: targetUser } = await supabase
    .from('commentum_users')
    .select('commentum_user_role')
    .eq('commentum_user_id', target_user_id)
    .eq('commentum_client_type', client_type)
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
      p_client_type: client_type,
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
      clientType: client_type,
      reason,
      warningCount
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleBanUser(supabase: any, params: any) {
  const { target_user_id, client_type, moderator_id, reason, moderatorRole } = params

  if (!target_user_id || !reason) {
    return new Response(
      JSON.stringify({ error: 'target_user_id and reason are required' }),
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
    .eq('commentum_client_type', client_type)
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
      p_client_type: client_type,
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
      clientType: client_type,
      reason
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUnbanUser(supabase: any, params: any) {
  const { target_user_id, client_type, moderator_id, reason, moderatorRole } = params

  if (!target_user_id) {
    return new Response(
      JSON.stringify({ error: 'target_user_id is required' }),
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
    .eq('commentum_client_type', client_type)
    .eq('commentum_user_id', target_user_id)

  if (error) throw error

  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'unbanned',
      targetUserId: target_user_id,
      clientType: client_type,
      reason: reason || 'Manual unban'
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleMuteUser(supabase: any, params: any) {
  const { target_user_id, client_type, moderator_id, reason, moderatorRole } = params

  if (!target_user_id || !reason) {
    return new Response(
      JSON.stringify({ error: 'target_user_id and reason are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user to check permissions
  const { data: targetUser } = await supabase
    .from('commentum_users')
    .select('commentum_user_role')
    .eq('commentum_user_id', target_user_id)
    .eq('commentum_client_type', client_type)
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

  // Get default mute duration
  const { data: muteConfig } = await supabase
    .from('config')
    .select('value')
    .eq('key', 'user_default_mute_duration_hours')
    .single()

  const muteDuration = muteConfig ? parseInt(muteConfig.value) : 24

  // Mute user using helper function
  const { data, error } = await supabase
    .rpc('mute_commentum_user', {
      p_client_type: client_type,
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
      clientType: client_type,
      reason,
      duration: muteDuration
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUnmuteUser(supabase: any, params: any) {
  const { target_user_id, client_type, moderator_id, reason, moderatorRole } = params

  if (!target_user_id) {
    return new Response(
      JSON.stringify({ error: 'target_user_id is required' }),
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
    .eq('commentum_client_type', client_type)
    .eq('commentum_user_id', target_user_id)

  if (error) throw error

  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'unmuted',
      targetUserId: target_user_id,
      clientType: client_type,
      reason: reason || 'Manual unmute'
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleAddUserNotes(supabase: any, params: any) {
  const { target_user_id, client_type, notes, moderator_id, moderatorRole } = params

  if (!target_user_id || !notes) {
    return new Response(
      JSON.stringify({ error: 'target_user_id and notes are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Add notes to user
  const { error } = await supabase
    .from('commentum_users')
    .update({
      commentum_user_notes: notes,
      updated_at: new Date().toISOString()
    })
    .eq('commentum_client_type', client_type)
    .eq('commentum_user_id', target_user_id)

  if (error) throw error

  return new Response(
    JSON.stringify({ 
      success: true, 
      action: 'notes_added',
      targetUserId: target_user_id,
      clientType: client_type
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleGetUserHistory(supabase: any, params: any) {
  const { target_user_id, client_type } = params

  if (!target_user_id || !client_type) {
    return new Response(
      JSON.stringify({ error: 'target_user_id and client_type are required' }),
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
    .eq('commentum_client_type', client_type)
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({ success: true, user: data }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}