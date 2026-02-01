import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifyAdminAccess, getUserRole, canModerate } from '../shared/auth.ts'
import { queueDiscordNotification } from '../shared/discordNotifications.ts'
import { getUserDetails, applyUserModeration, updateUserStats } from '../shared/userUtils.ts'

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

    const { action, moderator_info, target_user_id, comment_id, reason, severity, duration, shadow_ban } = await req.json()

    // All moderation actions require authentication (no token needed)
    if (!moderator_info) {
      return new Response(
        JSON.stringify({ error: 'moderator_info is required for moderation actions' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract moderator_id from moderator_info
    const moderator_id = moderator_info?.user_id
    if (!moderator_id) {
      return new Response(
        JSON.stringify({ error: 'moderator_info.user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate comment_id if provided (must be integer)
    if (comment_id && (!Number.isInteger(comment_id) || comment_id <= 0)) {
      return new Response(
        JSON.stringify({ error: 'comment_id must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify admin access with user_id only
    const adminVerification = await verifyAdminAccess(supabase, moderator_id)
    if (!adminVerification.valid) {
      return new Response(
        JSON.stringify({ error: adminVerification.reason || 'Insufficient permissions' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const moderatorRole = adminVerification.role

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

  // Update user statistics in users table (increment pinned comments)
  await updateUserStats(supabase, updatedComment.user_id, updatedComment.client_type, 'pin', 1, 0)

  // Queue Discord notification for pinned comment in background - NON-BLOCKING
  queueDiscordNotification({
    type: 'comment_pinned',
    comment: {
      id: updatedComment.id,
      username: updatedComment.username,
      user_id: updatedComment.user_id,
      content: updatedComment.content,
      client_type: updatedComment.client_type,
      media_id: updatedComment.media_id
    },
    moderator: {
      id: moderator_id,
      username: `Moderator ${moderator_id}`
    },
    media: {
      id: updatedComment.media_id,
      title: updatedComment.media_title,
      year: updatedComment.media_year,
      poster: updatedComment.media_poster
    },
    reason
  })

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

  // Queue Discord notification for locked thread in background - NON-BLOCKING
  queueDiscordNotification({
    type: 'comment_locked',
    comment: {
      id: updatedComment.id,
      username: updatedComment.username,
      user_id: updatedComment.user_id,
      content: updatedComment.content,
      client_type: updatedComment.client_type,
      media_id: updatedComment.media_id
    },
    moderator: {
      id: moderator_id,
      username: `Moderator ${moderator_id}`
    },
    media: {
      id: updatedComment.media_id,
      title: updatedComment.media_title,
      year: updatedComment.media_year,
      poster: updatedComment.media_poster
    },
    reason
  })

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

  // We need client_type to get user details, so we'll check all client types
  const { data: userRecords } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', target_user_id)

  if (!userRecords || userRecords.length === 0) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check permissions (can't moderate users with equal or higher role)
  const targetUserRole = userRecords[0].user_role
  if (!canModerate(moderatorRole, targetUserRole)) {
    return new Response(
      JSON.stringify({ error: 'Cannot moderate user with equal or higher role' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Apply moderation action to all client types for this user
  const moderationPromises = userRecords.map(userRecord => {
    let action = 'warn'
    let durationHours = duration
    
    if (severity === 'mute' && duration) {
      action = 'mute'
    } else if (severity === 'ban') {
      action = 'ban'
    }
    
    return applyUserModeration(
      supabase, 
      target_user_id, 
      userRecord.client_type, 
      action as any, 
      durationHours, 
      reason, 
      moderator_id
    )
  })

  await Promise.all(moderationPromises)

  // Queue Discord notification for user warning in background - NON-BLOCKING
  queueDiscordNotification({
    type: 'user_warned',
    user: {
      id: target_user_id,
      username: `User ${target_user_id}`
    },
    moderator: {
      id: moderator_id,
      username: `Moderator ${moderator_id}`
    },
    reason,
    severity
  })

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
  if (!['admin', 'super_admin', 'owner'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Admin permissions required to ban users' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user's records across all client types
  const { data: userRecords } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', target_user_id)

  if (!userRecords || userRecords.length === 0) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check permissions
  const targetUserRole = userRecords[0].user_role
  if (!canModerate(moderatorRole, targetUserRole)) {
    return new Response(
      JSON.stringify({ error: 'Cannot ban user with equal or higher role' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Apply ban to all client types for this user
  const banAction = shadow_ban ? 'shadow_ban' : 'ban'
  const moderationPromises = userRecords.map(userRecord => 
    applyUserModeration(
      supabase, 
      target_user_id, 
      userRecord.client_type, 
      banAction, 
      undefined, 
      reason, 
      moderator_id
    )
  )

  await Promise.all(moderationPromises)

  // Queue Discord notification for user ban in background - NON-BLOCKING
  queueDiscordNotification({
    type: 'user_banned',
    user: {
      id: target_user_id,
      username: `User ${target_user_id}`
    },
    moderator: {
      id: moderator_id,
      username: `Moderator ${moderator_id}`
    },
    reason
  })

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
  if (!['admin', 'super_admin', 'owner'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Admin permissions required to unban users' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user's records across all client types
  const { data: userRecords } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', target_user_id)

  if (!userRecords || userRecords.length === 0) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Apply unban to all client types for this user
  const moderationPromises = userRecords.map(userRecord => 
    applyUserModeration(
      supabase, 
      target_user_id, 
      userRecord.client_type, 
      'unban', 
      undefined, 
      reason, 
      moderator_id
    )
  )

  await Promise.all(moderationPromises)

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