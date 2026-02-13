import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifyAdminAccess, getUserRole, canModerate } from '../shared/auth.ts'
import { verifyClientToken, VerifiedUser } from '../shared/clientAuth.ts'
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

    const { action, client_type, access_token, target_user_id, comment_id, reason, severity, duration, shadow_ban } = await req.json()

    // All moderation actions require client authentication
    if (!client_type || !access_token) {
      return new Response(
        JSON.stringify({ error: 'client_type and access_token are required for moderation actions' }),
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

    // Use provider_user_id as the moderator_id
    const moderator_id = verifiedUser.provider_user_id

    // Validate comment_id if provided (must be integer)
    if (comment_id && (!Number.isInteger(comment_id) || comment_id <= 0)) {
      return new Response(
        JSON.stringify({ error: 'comment_id must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify admin access with verified user_id
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
        return await handlePinComment(supabase, { comment_id, moderator_id, reason, moderatorRole, verifiedUser })
      
      case 'unpin_comment':
        return await handleUnpinComment(supabase, { comment_id, moderator_id, reason, verifiedUser })
      
      case 'lock_thread':
        return await handleLockThread(supabase, { comment_id, moderator_id, reason, moderatorRole, verifiedUser })
      
      case 'unlock_thread':
        return await handleUnlockThread(supabase, { comment_id, moderator_id, reason, verifiedUser })
      
      case 'warn_user':
        return await handleWarnUser(supabase, { target_user_id, moderator_id, reason, severity, duration, moderatorRole, verifiedUser })
      
      case 'ban_user':
        return await handleBanUser(supabase, { target_user_id, moderator_id, reason, shadow_ban, moderatorRole, verifiedUser })
      
      case 'unban_user':
        return await handleUnbanUser(supabase, { target_user_id, moderator_id, reason, moderatorRole, verifiedUser })
      
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
  const { comment_id, moderator_id, reason, moderatorRole, verifiedUser } = params

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
      username: verifiedUser.username
    },
    media: {
      id: updatedComment.media_id,
      title: updatedComment.media_title,
      type: updatedComment.media_type,
      year: updatedComment.media_year,
      poster: updatedComment.media_poster
    },
    reason
  })

  return new Response(
    JSON.stringify({
      success: true,
      comment: updatedComment,
      action: 'pinned',
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: moderatorRole
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUnpinComment(supabase: any, params: any) {
  const { comment_id, moderator_id, reason, verifiedUser } = params

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
      action: 'unpinned',
      moderator: {
        id: moderator_id,
        username: verifiedUser.username
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleLockThread(supabase: any, params: any) {
  const { comment_id, moderator_id, reason, moderatorRole, verifiedUser } = params

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
      username: verifiedUser.username
    },
    media: {
      id: updatedComment.media_id,
      title: updatedComment.media_title,
      type: updatedComment.media_type,
      year: updatedComment.media_year,
      poster: updatedComment.media_poster
    },
    reason
  })

  return new Response(
    JSON.stringify({
      success: true,
      comment: updatedComment,
      action: 'locked',
      moderator: {
        id: moderator_id,
        username: verifiedUser.username,
        role: moderatorRole
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUnlockThread(supabase: any, params: any) {
  const { comment_id, moderator_id, reason, verifiedUser } = params

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
      action: 'unlocked',
      moderator: {
        id: moderator_id,
        username: verifiedUser.username
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleWarnUser(supabase: any, params: any) {
  const { target_user_id, moderator_id, reason, severity, duration, moderatorRole, verifiedUser } = params

  // Need client_type to identify user in commentum_users table
  // For now, we'll update all platforms - this could be enhanced to accept client_type parameter
  const { data: targetUsers } = await supabase
    .from('commentum_users')
    .select('commentum_client_type, commentum_user_role, commentum_user_warnings')
    .eq('commentum_user_id', target_user_id)

  // Get target user's username from comments table
  const { data: targetUserComment } = await supabase
    .from('comments')
    .select('username')
    .eq('user_id', target_user_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  
  const targetUsername = targetUserComment?.username || target_user_id

  if (!targetUsers || targetUsers.length === 0) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check permissions across all platforms (can't moderate users with equal or higher role)
  for (const user of targetUsers) {
    if (!canModerate(moderatorRole, user.commentum_user_role)) {
      return new Response(
        JSON.stringify({ error: 'Cannot moderate user with equal or higher role' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  // Use the helper function to add warning to user table
  let warningCount = 0
  for (const user of targetUsers) {
    const { data: newCount } = await supabase
      .rpc('add_user_warning', {
        p_client_type: user.commentum_client_type,
        p_user_id: target_user_id,
        p_warning_reason: reason,
        p_warned_by: moderator_id
      })
    
    if (newCount) {
      warningCount = Math.max(warningCount, newCount)
    }
  }

  // Check for auto-mute/ban thresholds
  const { data: autoMuteThreshold } = await supabase
    .from('config')
    .select('value')
    .eq('key', 'user_max_warnings_before_auto_mute')
    .single()

  const { data: autoBanThreshold } = await supabase
    .from('config')
    .select('value')
    .eq('key', 'user_max_warnings_before_auto_ban')
    .single()

  const muteThreshold = autoMuteThreshold ? parseInt(autoMuteThreshold.value) : 5
  const banThreshold = autoBanThreshold ? parseInt(autoBanThreshold.value) : 10

  let autoAction = ''
  if (warningCount >= banThreshold) {
    // Auto-ban across all platforms
    for (const user of targetUsers) {
      await supabase
        .rpc('ban_commentum_user', {
          p_client_type: user.commentum_client_type,
          p_user_id: target_user_id,
          p_ban_reason: `Auto-ban after ${warningCount} warnings: ${reason}`,
          p_banned_by: moderator_id,
          p_shadow_ban: false
        })
    }
    autoAction = `AUTO-BANNED - User exceeded ${banThreshold} warnings`
  } else if (warningCount >= muteThreshold) {
    // Auto-mute for default duration
    const { data: defaultMuteDuration } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'user_default_mute_duration_hours')
      .single()

    const muteDuration = defaultMuteDuration ? parseInt(defaultMuteDuration.value) : 24
    
    for (const user of targetUsers) {
      await supabase
        .rpc('mute_commentum_user', {
          p_client_type: user.commentum_client_type,
          p_user_id: target_user_id,
          p_mute_duration_hours: muteDuration,
          p_mute_reason: `Auto-mute after ${warningCount} warnings: ${reason}`,
          p_muted_by: moderator_id
        })
    }
    autoAction = `AUTO-MUTED - User exceeded ${muteThreshold} warnings (${muteDuration} hours)`
  }

  // Queue Discord notification for user warning in background - NON-BLOCKING
  queueDiscordNotification({
    type: 'user_warned',
    user: {
      id: target_user_id,
      username: targetUsername
    },
    comment: {
      client_type: targetUsers[0]?.commentum_client_type
    },
    moderator: {
      id: moderator_id,
      username: verifiedUser.username
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
      duration: duration || null,
      warningCount,
      autoAction,
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
  const { target_user_id, moderator_id, reason, shadow_ban, moderatorRole, verifiedUser } = params

  // Only admin and super_admin can ban
  if (!['admin', 'super_admin', 'owner'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Admin permissions required to ban users' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user's current status from commentum_users table
  const { data: targetUsers } = await supabase
    .from('commentum_users')
    .select('commentum_client_type, commentum_user_role')
    .eq('commentum_user_id', target_user_id)

  // Get target user's username from comments table
  const { data: targetUserComment } = await supabase
    .from('comments')
    .select('username')
    .eq('user_id', target_user_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  
  const targetUsername = targetUserComment?.username || target_user_id

  if (!targetUsers || targetUsers.length === 0) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check permissions across all platforms
  for (const user of targetUsers) {
    if (!canModerate(moderatorRole, user.commentum_user_role)) {
      return new Response(
        JSON.stringify({ error: 'Cannot ban user with equal or higher role' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  // Ban user across all platforms using helper function
  for (const user of targetUsers) {
    await supabase
      .rpc('ban_commentum_user', {
        p_client_type: user.commentum_client_type,
        p_user_id: target_user_id,
        p_ban_reason: reason,
        p_banned_by: moderator_id,
        p_shadow_ban: shadow_ban || false
      })
  }

  // Queue Discord notification for user ban in background - NON-BLOCKING
  queueDiscordNotification({
    type: shadow_ban ? 'user_shadow_banned' : 'user_banned',
    user: {
      id: target_user_id,
      username: targetUsername
    },
    comment: {
      client_type: targetUsers[0]?.commentum_client_type
    },
    moderator: {
      id: moderator_id,
      username: verifiedUser.username
    },
    reason
  })

  return new Response(
    JSON.stringify({
      success: true,
      action: shadow_ban ? 'shadow_banned' : 'banned',
      targetUserId: target_user_id,
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
  const { target_user_id, moderator_id, reason, moderatorRole, verifiedUser } = params

  // Only admin and super_admin can unban
  if (!['admin', 'super_admin', 'owner'].includes(moderatorRole)) {
    return new Response(
      JSON.stringify({ error: 'Admin permissions required to unban users' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target users from commentum_users table
  const { data: targetUsers } = await supabase
    .from('commentum_users')
    .select('commentum_client_type')
    .eq('commentum_user_id', target_user_id)

  if (!targetUsers || targetUsers.length === 0) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Unban user across all platforms by updating the user table
  for (const user of targetUsers) {
    await supabase
      .from('commentum_users')
      .update({
        commentum_user_banned: false,
        commentum_user_shadow_banned: false,
        commentum_user_muted: false,
        commentum_user_muted_until: null,
        updated_at: new Date().toISOString()
      })
      .eq('commentum_client_type', user.commentum_client_type)
      .eq('commentum_user_id', target_user_id)
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: 'unbanned',
      targetUserId: target_user_id,
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
