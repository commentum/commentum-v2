import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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

    const { action, client_type, moderator_id, target_user_id, comment_id, reason, severity, duration, shadow_ban, token } = await req.json()

    // All moderation actions require authentication
    if (!moderator_id || !token || !client_type) {
      return new Response(
        JSON.stringify({ error: 'moderator_id, token, and client_type are required for moderation actions' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate comment_id if provided (must be integer)
    if (comment_id && (!Number.isInteger(comment_id) || comment_id <= 0)) {
      return new Response(
        JSON.stringify({ error: 'comment_id must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify admin access with token
    const tokenVerification = await verifyAdminAccess(supabase, client_type, moderator_id, token)
    if (!tokenVerification.valid) {
      return new Response(
        JSON.stringify({ error: tokenVerification.reason || 'Authentication failed' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const moderatorRole = tokenVerification.role

    switch (action) {
      case 'pin_comment':
        return await handlePinComment(supabase, { comment_id, moderator_id, reason, moderatorRole })
      
      case 'unpin_comment':
        return await handleUnpinComment(supabase, { comment_id, moderator_id, reason })
      
      case 'lock_thread':
        return await handleLockThread(supabase, { comment_id, moderator_id, reason })
      
      case 'unlock_thread':
        return await handleUnlockThread(supabase, { comment_id, moderator_id, reason })
      
      case 'warn_user':
        return await handleWarnUser(supabase, { target_user_id, moderator_id, reason, severity, duration, moderatorRole })
      
      case 'ban_user':
        return await handleBanUser(supabase, { target_user_id, moderator_id, reason, shadow_ban, moderatorRole })
      
      case 'unban_user':
        return await handleUnbanUser(supabase, { target_user_id, moderator_id, reason, moderatorRole })
      
      case 'get_queue':
        return await handleGetModerationQueue(supabase)
      
      case 'promote_user':
        return await handlePromoteUser(supabase, { target_user_id, moderator_id, reason, moderatorRole })
      
      case 'demote_user':
        return await handleDemoteUser(supabase, { target_user_id, moderator_id, reason, moderatorRole })
      
      case 'get_user_roles':
        return await handleGetUserRoles(supabase)
      
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Moderation API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function handlePinComment(supabase: any, params: any) {
  const { comment_id, moderator_id, reason, moderatorRole } = params

  const { data: comment } = await supabase
    .from('comments')
    .select('*')
    .eq('id', comment_id)
    .single()

  if (!comment) {
    return new Response(
      JSON.stringify({ error: 'Comment not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (comment.deleted) {
    return new Response(
      JSON.stringify({ error: 'Cannot pin deleted comment' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (comment.pinned) {
    return new Response(
      JSON.stringify({ error: 'Comment already pinned' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Update comment
  const { data: updatedComment, error } = await supabase
    .from('comments')
    .update({
      pinned: true,
      pinned_at: new Date().toISOString(),
      pinned_by: moderator_id,
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_reason: reason,
      moderation_action: 'pin'
    })
    .eq('id', comment_id)
    .select()
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      comment: updatedComment,
      action: 'pinned'
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUnpinComment(supabase: any, params: any) {
  const { comment_id, moderator_id, reason } = params

  const { data: comment } = await supabase
    .from('comments')
    .select('*')
    .eq('id', comment_id)
    .single()

  if (!comment) {
    return new Response(
      JSON.stringify({ error: 'Comment not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!comment.pinned) {
    return new Response(
      JSON.stringify({ error: 'Comment is not pinned' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Update comment
  const { data: updatedComment, error } = await supabase
    .from('comments')
    .update({
      pinned: false,
      pinned_at: null,
      pinned_by: null,
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_reason: reason,
      moderation_action: 'unpin'
    })
    .eq('id', comment_id)
    .select()
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      comment: updatedComment,
      action: 'unpinned'
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleLockThread(supabase: any, params: any) {
  const { comment_id, moderator_id, reason } = params

  const { data: comment } = await supabase
    .from('comments')
    .select('*')
    .eq('id', comment_id)
    .single()

  if (!comment) {
    return new Response(
      JSON.stringify({ error: 'Comment not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (comment.locked) {
    return new Response(
      JSON.stringify({ error: 'Comment thread already locked' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Update comment
  const { data: updatedComment, error } = await supabase
    .from('comments')
    .update({
      locked: true,
      locked_at: new Date().toISOString(),
      locked_by: moderator_id,
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_reason: reason,
      moderation_action: 'lock'
    })
    .eq('id', comment_id)
    .select()
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      comment: updatedComment,
      action: 'locked'
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUnlockThread(supabase: any, params: any) {
  const { comment_id, moderator_id, reason } = params

  const { data: comment } = await supabase
    .from('comments')
    .select('*')
    .eq('id', comment_id)
    .single()

  if (!comment) {
    return new Response(
      JSON.stringify({ error: 'Comment not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!comment.locked) {
    return new Response(
      JSON.stringify({ error: 'Comment thread is not locked' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Update comment
  const { data: updatedComment, error } = await supabase
    .from('comments')
    .update({
      locked: false,
      locked_at: null,
      locked_by: null,
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_reason: reason,
      moderation_action: 'unlock'
    })
    .eq('id', comment_id)
    .select()
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      comment: updatedComment,
      action: 'unlocked'
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleWarnUser(supabase: any, params: any) {
  const { target_user_id, moderator_id, reason, severity, duration, moderatorRole } = params

  // Get target user's current status
  const { data: targetUserComment } = await supabase
    .from('comments')
    .select('user_role, user_warnings')
    .eq('user_id', target_user_id)
    .single()

  if (!targetUserComment) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check permissions (can't moderate users with equal or higher role)
  if (!canModerate(moderatorRole, targetUserComment.user_role)) {
    return new Response(
      JSON.stringify({ error: 'Cannot moderate user with equal or higher role' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let updateData: any = {
    moderated: true,
    moderated_at: new Date().toISOString(),
    moderated_by: moderator_id,
    moderation_reason: reason,
    moderation_action: severity
  }

  if (severity === 'mute' && duration) {
    updateData.user_muted_until = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString() // duration in hours
  } else if (severity === 'ban') {
    updateData.user_banned = true
  }

  // Update all user's comments with new status
  const { error } = await supabase
    .from('comments')
    .update({
      user_warnings: targetUserComment.user_warnings + 1,
      ...updateData
    })
    .eq('user_id', target_user_id)

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      action: severity,
      targetUserId: target_user_id,
      reason,
      duration: duration || null
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleBanUser(supabase: any, params: any) {
  const { target_user_id, moderator_id, reason, shadow_ban, moderatorRole } = params

  // Only admin and super_admin can ban
  if (!['admin', 'super_admin'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Admin permissions required to ban users' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user's current status
  const { data: targetUserComment } = await supabase
    .from('comments')
    .select('user_role')
    .eq('user_id', target_user_id)
    .single()

  if (!targetUserComment) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check permissions
  if (!canModerate(moderatorRole, targetUserComment.user_role)) {
    return new Response(
      JSON.stringify({ error: 'Cannot ban user with equal or higher role' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Update all user's comments
  const { error } = await supabase
    .from('comments')
    .update({
      user_banned: true,
      user_shadow_banned: shadow_ban || false,
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_reason: reason,
      moderation_action: shadow_ban ? 'shadow_ban' : 'ban'
    })
    .eq('user_id', target_user_id)

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      action: shadow_ban ? 'shadow_banned' : 'banned',
      targetUserId: target_user_id,
      reason
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUnbanUser(supabase: any, params: any) {
  const { target_user_id, moderator_id, reason, moderatorRole } = params

  // Only admin and super_admin can unban
  if (!['admin', 'super_admin'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Admin permissions required to unban users' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Update all user's comments
  const { error } = await supabase
    .from('comments')
    .update({
      user_banned: false,
      user_shadow_banned: false,
      user_muted_until: null,
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_reason: reason,
      moderation_action: 'unban'
    })
    .eq('user_id', target_user_id)

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      action: 'unbanned',
      targetUserId: target_user_id,
      reason
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleGetModerationQueue(supabase: any) {
  // Get comments that need moderation
  const { data: comments, error } = await supabase
    .from('comments')
    .select('*')
    .or('reported.eq.true,moderated.eq.true')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error

  return new Response(
    JSON.stringify({
      comments,
      total: comments.length
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handlePromoteUser(supabase: any, params: any) {
  const { target_user_id, moderator_id, reason, moderatorRole } = params

  // Only admin and super_admin can promote users
  if (!['admin', 'super_admin'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Admin permissions required to promote users' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user's current role
  const targetUserRole = await getUserRole(supabase, target_user_id)
  
  // Check permissions (can't promote users with equal or higher role)
  if (!canModerate(moderatorRole, targetUserRole)) {
    return new Response(
      JSON.stringify({ error: 'Cannot promote user with equal or higher role' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Define promotion hierarchy
  const roleHierarchy = ['user', 'moderator', 'admin', 'super_admin']
  const currentRoleIndex = roleHierarchy.indexOf(targetUserRole)
  
  if (currentRoleIndex === -1 || currentRoleIndex >= roleHierarchy.length - 1) {
    return new Response(
      JSON.stringify({ error: 'User is already at the highest role or has invalid role' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const newRole = roleHierarchy[currentRoleIndex + 1]

  // Remove user from current role list
  await removeFromRoleList(supabase, target_user_id, targetUserRole)
  
  // Add user to new role list
  await addToRoleList(supabase, target_user_id, newRole)

  // Update all user's comments to reflect new role
  const { error } = await supabase
    .from('comments')
    .update({
      user_role: newRole,
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_reason: reason,
      moderation_action: `promoted_to_${newRole}`
    })
    .eq('user_id', target_user_id)

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      action: 'promoted',
      targetUserId: target_user_id,
      previousRole: targetUserRole,
      newRole: newRole,
      reason
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleDemoteUser(supabase: any, params: any) {
  const { target_user_id, moderator_id, reason, moderatorRole } = params

  // Only admin and super_admin can demote users
  if (!['admin', 'super_admin'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Admin permissions required to demote users' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user's current role
  const targetUserRole = await getUserRole(supabase, target_user_id)
  
  // Check permissions (can't demote users with equal or higher role, except super_admin can demote admin)
  if (moderatorRole !== 'super_admin' && !canModerate(moderatorRole, targetUserRole)) {
    return new Response(
      JSON.stringify({ error: 'Cannot demote user with equal or higher role' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Special rule: Only super_admin can demote admins
  if (targetUserRole === 'admin' && moderatorRole !== 'super_admin') {
    return new Response(
      JSON.stringify({ error: 'Only super admins can demote admins' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Define demotion hierarchy
  const roleHierarchy = ['user', 'moderator', 'admin', 'super_admin']
  const currentRoleIndex = roleHierarchy.indexOf(targetUserRole)
  
  if (currentRoleIndex <= 0) {
    return new Response(
      JSON.stringify({ error: 'User is already at the lowest role or has invalid role' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const newRole = roleHierarchy[currentRoleIndex - 1]

  // Remove user from current role list
  await removeFromRoleList(supabase, target_user_id, targetUserRole)
  
  // Add user to new role list
  await addToRoleList(supabase, target_user_id, newRole)

  // Update all user's comments to reflect new role
  const { error } = await supabase
    .from('comments')
    .update({
      user_role: newRole,
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: moderator_id,
      moderation_reason: reason,
      moderation_action: `demoted_to_${newRole}`
    })
    .eq('user_id', target_user_id)

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      action: 'demoted',
      targetUserId: target_user_id,
      previousRole: targetUserRole,
      newRole: newRole,
      reason
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleGetUserRoles(supabase: any) {
  try {
    const { data: superAdmins } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'super_admin_users')
      .single()

    const { data: admins } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'admin_users')
      .single()

    const { data: moderators } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'moderator_users')
      .single()

    const superAdminList = superAdmins ? JSON.parse(superAdmins.value) : []
    const adminList = admins ? JSON.parse(admins.value) : []
    const moderatorList = moderators ? JSON.parse(moderators.value) : []

    return new Response(
      JSON.stringify({
        super_admins: superAdminList,
        admins: adminList,
        moderators: moderatorList,
        total_users: superAdminList.length + adminList.length + moderatorList.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Get user roles error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch user roles' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Helper functions for role management
async function removeFromRoleList(supabase: any, userId: string, role: string) {
  const roleKeyMap = {
    'super_admin': 'super_admin_users',
    'admin': 'admin_users',
    'moderator': 'moderator_users'
  }

  const configKey = roleKeyMap[role]
  if (!configKey) return

  const { data: currentConfig } = await supabase
    .from('config')
    .select('value')
    .eq('key', configKey)
    .single()

  if (currentConfig) {
    const userList = JSON.parse(currentConfig.value)
    const updatedList = userList.filter((id: string) => id !== userId)
    
    await supabase
      .from('config')
      .update({ value: JSON.stringify(updatedList) })
      .eq('key', configKey)
  }
}

async function addToRoleList(supabase: any, userId: string, role: string) {
  const roleKeyMap = {
    'super_admin': 'super_admin_users',
    'admin': 'admin_users',
    'moderator': 'moderator_users'
  }

  const configKey = roleKeyMap[role]
  if (!configKey) return

  const { data: currentConfig } = await supabase
    .from('config')
    .select('value')
    .eq('key', configKey)
    .single()

  if (currentConfig) {
    const userList = JSON.parse(currentConfig.value)
    if (!userList.includes(userId)) {
      userList.push(userId)
      
      await supabase
        .from('config')
        .update({ value: JSON.stringify(userList) })
        .eq('key', configKey)
    }
  }
}