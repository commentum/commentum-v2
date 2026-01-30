import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { getUserRole } from '../shared/auth.ts'

// All command handlers are defined in this file v2

// Pre-define critical functions to avoid scoping issues
async function handleStatsCommand(supabase: any) {
  // Get comment statistics
  const { data: stats } = await supabase
    .from('comments')
    .select('id, upvotes, downvotes, report_count, created_at')

  const totalComments = stats?.length || 0
  const totalUpvotes = stats?.reduce((sum, comment) => sum + comment.upvotes, 0) || 0
  const totalDownvotes = stats?.reduce((sum, comment) => sum + comment.downvotes, 0) || 0
  const totalReports = stats?.reduce((sum, comment) => sum + comment.report_count, 0) || 0

  // Get registered Discord users
  const { data: discordUsers } = await supabase
    .from('discord_users')
    .select('user_role, is_active')

  const activeUsers = discordUsers?.filter(user => user.is_active).length || 0
  const mods = discordUsers?.filter(user => user.is_active && user.user_role === 'moderator').length || 0
  const admins = discordUsers?.filter(user => user.is_active && user.user_role === 'admin').length || 0
  const superAdmins = discordUsers?.filter(user => user.is_active && user.user_role === 'super_admin').length || 0

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: `📊 **Commentum Statistics**\n\n` +
          `💬 **Comments:** ${totalComments}\n` +
          `👍 **Upvotes:** ${totalUpvotes}\n` +
          `👎 **Downvotes:** ${totalDownvotes}\n` +
          `🚨 **Reports:** ${totalReports}\n\n` +
          `👥 **Discord Users:** ${activeUsers}\n` +
          `🛡️ **Mods:** ${mods}\n` +
          `👑 **Admins:** ${admins}\n` +
          `⚡ **Super Admins:** ${superAdmins}`,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleDeleteCommand(supabase: any, options: any, registration: any) {
  console.log('handleDeleteCommand called')
  const commentId = options.find(opt => opt.name === 'comment_id')?.value

  try {
    // Direct database operation using service role key
    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id, deleted')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Comment **${commentId}** not found`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (comment.deleted) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Comment **${commentId}** is already deleted`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Soft delete the comment
    const { error } = await supabase
      .from('comments')
      .update({
        deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: registration.platform_user_id
      })
      .eq('id', commentId)

    if (error) throw error

    // Send Discord notification for ALL actions
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'comment_deleted',
      comment: { ...comment, deleted: true },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully deleted comment **${commentId}**`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Delete command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to delete comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Add stubs for other critical functions to ensure they're defined
async function handleBanCommand(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can ban users',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value
  const shadow = options.find(opt => opt.name === 'shadow')?.value || false

  try {
    // Direct database operation using service role key
    const { data: targetUserComments } = await supabase
      .from('comments')
      .select('user_id, client_type')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComments || targetUserComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User **${targetUserId}** not found in system`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update all comments by the target user to ban them
    const { error } = await supabase
      .from('comments')
      .update({
        user_banned: true,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: shadow ? 'shadow_ban' : 'ban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // Send Discord notification for ALL actions
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: shadow ? 'user_shadow_banned' : 'user_banned',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully ${shadow ? 'shadow ' : ''}banned user **${targetUserId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Ban command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to ban user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleWarnCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleWarnCommand_impl(supabase, options, registration)
}

async function handlePinCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handlePinCommand_impl(supabase, options, registration)
}

async function handleLockCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleLockCommand_impl(supabase, options, registration)
}

async function handlePromoteCommand(supabase: any, options: any, registration: any) {
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can promote users',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const newRole = options.find(opt => opt.name === 'role')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Promotion'

  if (!['moderator', 'admin', 'super_admin'].includes(newRole)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Invalid role. Must be: moderator, admin, super_admin, or owner',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get current role lists
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

    // Remove from all roles first
    const cleanSuperAdmins = superAdminList.filter((id: string) => id !== targetUserId)
    const cleanAdmins = adminList.filter((id: string) => id !== targetUserId)
    const cleanModerators = moderatorList.filter((id: string) => id !== targetUserId)

    // Add to new role
    let newSuperAdmins = cleanSuperAdmins
    let newAdmins = cleanAdmins
    let newModerators = cleanModerators

    switch (newRole) {
      case 'super_admin':
        newSuperAdmins = [...cleanSuperAdmins, targetUserId]
        break
      case 'admin':
        newAdmins = [...cleanAdmins, targetUserId]
        break
      case 'moderator':
        newModerators = [...cleanModerators, targetUserId]
        break
    }

    // Update all role configurations
    await Promise.all([
      supabase.from('config').update({ value: JSON.stringify(newSuperAdmins) }).eq('key', 'super_admin_users'),
      supabase.from('config').update({ value: JSON.stringify(newAdmins) }).eq('key', 'admin_users'),
      supabase.from('config').update({ value: JSON.stringify(newModerators) }).eq('key', 'moderator_users')
    ])

    // Send Discord notification for ALL actions
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'moderation_action',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason,
      metadata: { action: `promoted to ${newRole}` }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully promoted **${targetUserId}** to **${newRole}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Promote command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to promote user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleDemoteCommand(supabase: any, options: any, registration: any) {
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can demote users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const newRole = options.find(opt => opt.name === 'role')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Demotion'

  if (!['user', 'moderator', 'admin'].includes(newRole)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Invalid role. Must be: user, moderator, or admin',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get current role lists
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

    // Remove from all roles first
    const cleanSuperAdmins = superAdminList.filter((id: string) => id !== targetUserId)
    const cleanAdmins = adminList.filter((id: string) => id !== targetUserId)
    const cleanModerators = moderatorList.filter((id: string) => id !== targetUserId)

    // Add to new role
    let newSuperAdmins = cleanSuperAdmins
    let newAdmins = cleanAdmins
    let newModerators = cleanModerators

    switch (newRole) {
      case 'admin':
        newAdmins = [...cleanAdmins, targetUserId]
        break
      case 'moderator':
        newModerators = [...cleanModerators, targetUserId]
        break
      // 'user' means remove from all roles (already done above)
    }

    // Update all role configurations
    await Promise.all([
      supabase.from('config').update({ value: JSON.stringify(newSuperAdmins) }).eq('key', 'super_admin_users'),
      supabase.from('config').update({ value: JSON.stringify(newAdmins) }).eq('key', 'admin_users'),
      supabase.from('config').update({ value: JSON.stringify(newModerators) }).eq('key', 'moderator_users')
    ])

    // Send Discord notification for ALL actions
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'moderation_action',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason,
      metadata: { action: `demoted to ${newRole}` }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully demoted **${targetUserId}** to **${newRole}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Demote command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to demote user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function handleUnbanCommand(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can unban users',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Ban lifted'

  try {
    // Direct database operation using service role key
    const { data: targetUserComments } = await supabase
      .from('comments')
      .select('user_id, client_type')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComments || targetUserComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User **${targetUserId}** not found in the system`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update all comments for this user to remove ban
    const { error } = await supabase
      .from('comments')
      .update({
        user_banned: false,
        user_muted_until: null,
        user_shadow_banned: false,
        user_warnings: 0,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: 'unban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // Send Discord notification for ALL actions
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'moderation_action',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason,
      metadata: { action: 'unbanned' }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully unbanned **${targetUserId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unban command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unban user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleMuteCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleMuteCommand_impl(supabase, options, registration)
}

async function handleUnmuteCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleUnmuteCommand_impl(supabase, options, registration)
}

async function handleShadowbanCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleShadowbanCommand_impl(supabase, options, registration)
}

async function handleUnshadowbanCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleUnshadowbanCommand_impl(supabase, options, registration)
}

async function handleUnpinCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleUnpinCommand_impl(supabase, options, registration)
}

async function handleUnlockCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleUnlockCommand_impl(supabase, options, registration)
}

async function handleReportCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleReportCommand_impl(supabase, options, registration)
}

async function handleResolveCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleResolveCommand_impl(supabase, options, registration)
}

async function handleQueueCommand(supabase: any, registration?: any) {
  // Implementation will be below
  return await handleQueueCommand_impl(supabase, registration)
}

async function handleUserCommand(supabase: any, options: any) {
  const userId = options.find(opt => opt.name === 'user_id')?.value

  try {
    // Get user information
    const { data: userComments } = await supabase
      .from('comments')
      .select('id, content, upvotes, downvotes, report_count, created_at, moderated, user_muted_until, user_shadow_banned')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!userComments || userComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User **${userId}** not found in system`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const totalComments = userComments.length
    const totalUpvotes = userComments.reduce((sum, comment) => sum + comment.upvotes, 0)
    const totalDownvotes = userComments.reduce((sum, comment) => sum + comment.downvotes, 0)
    const totalReports = userComments.reduce((sum, comment) => sum + comment.report_count, 0)
    const moderatedComments = userComments.filter(comment => comment.moderated).length
    const isMuted = userComments.some(comment => comment.user_muted_until && new Date(comment.user_muted_until) > new Date())
    const isShadowBanned = userComments.some(comment => comment.user_shadow_banned)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `👤 **User Information for ${userId}**\n\n` +
            `💬 **Total Comments:** ${totalComments}\n` +
            `👍 **Total Upvotes:** ${totalUpvotes}\n` +
            `👎 **Total Downvotes:** ${totalDownvotes}\n` +
            `🚨 **Total Reports:** ${totalReports}\n` +
            `🛡️ **Moderated Comments:** ${moderatedComments}\n` +
            `🔇 **Muted:** ${isMuted ? 'Yes' : 'No'}\n` +
            `👻 **Shadow Banned:** ${isShadowBanned ? 'Yes' : 'No'}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('User command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch user information: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleCommentCommand(supabase: any, options: any) {
  const commentId = options.find(opt => opt.name === 'comment_id')?.value

  try {
    // Get comment information
    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id, upvotes, downvotes, report_count, created_at, moderated, pinned, locked, user_muted_until, user_shadow_banned')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Comment **${commentId}** not found`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const status = [
      comment.moderated ? '🛡️ Moderated' : '',
      comment.pinned ? '📌 Pinned' : '',
      comment.locked ? '🔒 Locked' : '',
      comment.user_muted_until && new Date(comment.user_muted_until) > new Date() ? '🔇 User Muted' : '',
      comment.user_shadow_banned ? '👻 Shadow Banned' : ''
    ].filter(Boolean).join(' ') || '✅ Normal'

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `💬 **Comment Information for ${commentId}**\n\n` +
            `👤 **User:** ${comment.username} (${comment.user_id})\n` +
            `📺 **Media ID:** ${comment.media_id}\n` +
            `👍 **Upvotes:** ${comment.upvotes}\n` +
            `👎 **Downvotes:** ${comment.downvotes}\n` +
            `🚨 **Reports:** ${comment.report_count}\n` +
            `📅 **Created:** ${new Date(comment.created_at).toLocaleString()}\n` +
            `🏷️ **Status:** ${status}\n\n` +
            `📝 **Content:**\n${comment.content.substring(0, 200)}${comment.content.length > 200 ? '...' : ''}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Comment command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch comment information: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleConfigCommand(supabase: any, options: any, registration: any) {
  // Implementation will be below
  return await handleConfigCommand_impl(supabase, options, registration)
}

async function handleCleanupCommand(supabase: any, registration: any) {
  // Only Super Admins can cleanup commands
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can cleanup Discord commands',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get Discord config from environment variables
    const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
    const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')

    if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '❌ Discord configuration missing',
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get all guild IDs
    const guildIds = await getAllGuildIds(supababase)
    
    if (guildIds.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '⚠️ No guilds found in server_configs table',
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`🧹 Starting cleanup of ${guildIds.length} guilds...`)

    const cleanupResults = []
    
    for (const guildId of guildIds) {
      try {
        const deleteResponse = await fetch(
          `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/guilds/${guildId}/commands`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        )

        if (deleteResponse.ok) {
          const result = await deleteResponse.json()
          cleanupResults.push({
            guildId,
            success: true,
            deletedCommands: result.length || 0,
            message: `Deleted ${result.length || 0} commands`
          })
          console.log(`✅ Cleaned up guild ${guildId}: ${result.length || 0} commands deleted`)
        } else {
          const errorText = await deleteResponse.text()
          cleanupResults.push({
            guildId,
            success: false,
            error: errorText,
            message: 'Failed to delete commands'
          })
          console.log(`❌ Failed to clean guild ${guildId}: ${errorText}`)
        }
      } catch (error) {
        cleanupResults.push({
          guildId,
          success: false,
          error: error.message,
          message: 'Error during cleanup'
        })
        console.log(`❌ Error cleaning guild ${guildId}:`, error.message)
      }
    }

    const successfulCleanups = cleanupResults.filter(r => r.success)
    const failedCleanups = cleanupResults.filter(r => !r.success)
    const totalDeleted = successfulCleanups.reduce((sum, r) => sum + r.deletedCommands, 0)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `🧹 **Command Cleanup Complete!**\n\n` +
            `📊 **Summary:**\n` +
            `• **Guilds processed:** ${guildIds.length}\n` +
            `• **Successful:** ${successfulCleanups.length}\n` +
            `• **Failed:** ${failedCleanups.length}\n` +
            `• **Total commands deleted:** ${totalDeleted}\n\n` +
            `✅ **All guild commands cleared!** Ready for clean global sync.`,
          flags: 64
        }
      }),
      { status: failedCleanups.length === 0 ? 200 : 207, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Cleanup command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to cleanup commands: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleSyncCommand(supabase: any, registration: any) {
  // Only Super Admins can sync commands
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can sync Discord commands',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Call the existing sync commands function
    return await handleSyncCommands(supabase)
  } catch (error) {
    console.error('Sync command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to sync commands: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleHelpCommand(registration: any) {
  const userRole = registration?.user_role || 'user'
  
  let helpText = `🤖 **Commentum Bot Help**\n\n`
  
  if (userRole === 'user') {
    helpText += `**Available Commands:**\n` +
      `• \`/register\` - Register your Discord account\n` +
      `• \`/report\` - Report a comment\n` +
      `• \`/user <user_id>\` - Get user information\n` +
      `• \`/comment <comment_id>\` - Get comment information\n` +
      `• \`/stats\` - View system statistics\n` +
      `• \`/help\` - Show this help message`
  } else if (userRole === 'moderator') {
    helpText += `**Moderator Commands:**\n` +
      `• \`/warn <user_id> <reason>\` - Warn a user\n` +
      `• \`/mute <user_id> [duration] <reason>\` - Mute a user\n` +
      `• \`/unmute <user_id> [reason]\` - Unmute a user\n` +
      `• \`/pin <comment_id> [reason]\` - Pin a comment\n` +
      `• \`/unpin <comment_id> [reason]\` - Unpin a comment\n` +
      `• \`/lock <comment_id> [reason]\` - Lock a thread\n` +
      `• \`/unlock <comment_id> [reason]\` - Unlock a thread\n` +
      `• \`/resolve <comment_id> <reporter_id> <resolution>\` - Resolve report\n` +
      `• \`/queue\` - View moderation queue\n` +
      `• \`/report\` - Report a comment\n` +
      `• \`/user <user_id>\` - Get user information\n` +
      `• \`/comment <comment_id>\` - Get comment information\n` +
      `• \`/stats\` - View system statistics\n` +
      `• \`/help\` - Show this help message`
  } else if (userRole === 'admin') {
    helpText += `**Admin Commands:**\n` +
      `• All Moderator commands\n` +
      `• \`/ban <user_id> <reason> [shadow]\` - Ban a user\n` +
      `• \`/unban <user_id> [reason]\` - Unban a user\n` +
      `• \`/shadowban <user_id> <reason>\` - Shadow ban a user\n` +
      `• \`/unshadowban <user_id> [reason]\` - Remove shadow ban\n` +
      `• \`/delete <comment_id>\` - Delete any comment\n` +
      `• \`/help\` - Show this help message`
  } else if (userRole === 'super_admin' || userRole === 'owner') {
    helpText += `**Super Admin Commands:**\n` +
      `• All Admin commands\n` +
      `• \`/promote <user_id> <role> [reason]\` - Promote a user\n` +
      `• \`/demote <user_id> <role> [reason]\` - Demote a user\n` +
      `• \`/config <action> [key] [value]\` - Manage system configuration\n` +
      `• \`/help\` - Show this help message`
  }

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: helpText,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleWebhooksCommand(supabase: any, options: any, registration: any) {
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can manage webhooks',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const action = options.find(opt => opt.name === 'action')?.value
  const webhookUrl = options.find(opt => opt.name === 'webhook_url')?.value

  try {
    switch (action) {
      case 'list':
        const { data: webhookConfig } = await supabase
          .from('config')
          .select('value')
          .eq('key', 'discord_webhook_urls')
          .single()

        const { data: singleWebhookConfig } = await supabase
          .from('config')
          .select('value')
          .eq('key', 'discord_webhook_url')
          .single()

        let webhookUrls: string[] = []
        
        if (webhookConfig?.value) {
          try {
            webhookUrls = JSON.parse(webhookConfig.value)
          } catch {
            webhookUrls = webhookConfig.value.split(',').map(url => url.trim()).filter(url => url)
          }
        }
        
        if (webhookUrls.length === 0 && singleWebhookConfig?.value) {
          webhookUrls = [singleWebhookConfig.value]
        }

        const webhookList = webhookUrls.map((url, index) => {
          const shortUrl = url.length > 50 ? url.substring(0, 47) + '...' : url
          return `${index + 1}. ${shortUrl}`
        }).join('\n')

        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: `📡 **Configured Webhooks (${webhookUrls.length})**\n\n${webhookList || 'No webhooks configured'}`,
              flags: 64
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )

      case 'add':
        if (!webhookUrl) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '❌ Webhook URL is required for add action',
                flags: 64
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Get current webhooks
        const { data: currentWebhooks } = await supabase
          .from('config')
          .select('value')
          .eq('key', 'discord_webhook_urls')
          .single()

        let currentUrls: string[] = []
        if (currentWebhooks?.value) {
          try {
            currentUrls = JSON.parse(currentWebhooks.value)
          } catch {
            currentUrls = currentWebhooks.value.split(',').map(url => url.trim()).filter(url => url)
          }
        }

        // Add new webhook if not already exists
        if (!currentUrls.includes(webhookUrl)) {
          currentUrls.push(webhookUrl)
          
          await supabase
            .from('config')
            .update({ value: JSON.stringify(currentUrls) })
            .eq('key', 'discord_webhook_urls')

          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: `✅ Webhook added successfully\nTotal webhooks: ${currentUrls.length}`,
                flags: 64
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        } else {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '⚠️ This webhook is already configured',
                flags: 64
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

      case 'remove':
        if (!webhookUrl) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '❌ Webhook URL is required for remove action',
                flags: 64
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Get current webhooks
        const { data: webhooksToRemove } = await supabase
          .from('config')
          .select('value')
          .eq('key', 'discord_webhook_urls')
          .single()

        let urlsToRemove: string[] = []
        if (webhooksToRemove?.value) {
          try {
            urlsToRemove = JSON.parse(webhooksToRemove.value)
          } catch {
            urlsToRemove = webhooksToRemove.value.split(',').map(url => url.trim()).filter(url => url)
          }
        }

        // Remove webhook
        const initialLength = urlsToRemove.length
        urlsToRemove = urlsToRemove.filter(url => url !== webhookUrl)

        if (urlsToRemove.length < initialLength) {
          await supabase
            .from('config')
            .update({ value: JSON.stringify(urlsToRemove) })
            .eq('key', 'discord_webhook_urls')

          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: `✅ Webhook removed successfully\nRemaining webhooks: ${urlsToRemove.length}`,
                flags: 64
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        } else {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '❌ Webhook not found in configuration',
                flags: 64
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

      case 'test':
        // Test notification to all configured webhooks
        const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
        const testResult = await sendDiscordNotification(supabase, {
          type: 'moderation_action',
          user: { id: 'test', username: 'Test User' },
          moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
          reason: 'Test notification',
          metadata: { action: 'webhook test' }
        })

        if (testResult.success) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: `✅ Test notification sent successfully\nSent to: ${testResult.successful}/${testResult.totalWebhooks} webhooks`,
                flags: 64
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        } else {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: `❌ Test notification failed\nSent to: ${testResult.successful}/${testResult.totalWebhooks} webhooks\nErrors: ${testResult.failed} failed`,
                flags: 64
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

      default:
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: '❌ Unknown action. Use: list, add, remove, or test',
              flags: 64
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    }
  } catch (error) {
    console.error('Webhooks command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to manage webhooks: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function handleAddCommand(supabase: any, options: any, registration: any, guild_id: string) {
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can add server configurations',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const subCommand = options.find(opt => opt.name === 'subcommand')?.value || 'app'
  const guildName = options.find(opt => opt.name === 'guild_name')?.value
  const appGuildId = options.find(opt => opt.name === 'guild_id')?.value
  const webhookUrl = options.find(opt => opt.name === 'webhook_url')?.value
  const roleId = options.find(opt => opt.name === 'role_id')?.value

  try {
    switch (subCommand) {
      case 'app':
        if (!guildName || !appGuildId) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '❌ Guild name and Guild ID are required\nUsage: `/add app <guild_name> <guild_id> [webhook_url] [role_id]`',
                flags: 64
              }
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check if server already exists
        let existingServer = null
        try {
          const { data: server } = await supabase
            .from('server_configs')
            .select('server_name, guild_id')
            .or(`server_name.eq.${guildName},guild_id.eq.${appGuildId}`)
            .single()
          existingServer = server
        } catch (error) {
          // Table might not exist, continue with creation
          console.log('Server config table check (will create if needed):', error.message)
        }

        if (existingServer) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: `❌ Server already exists: ${existingServer.server_name} (Guild: ${existingServer.guild_id})`,
                flags: 64
              }
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Insert new server configuration
        let newServer = null
        let insertError = null
        
        try {
          const result = await supabase
            .from('server_configs')
            .insert({
              server_name: guildName,
              guild_id: appGuildId,
              webhook_url: webhookUrl || null,
              role_id: roleId || null,
              is_active: true
            })
            .select()
            .single()
          newServer = result.data
          insertError = result.error
        } catch (error) {
          insertError = error
        }

        if (insertError) throw insertError

        // Update guild IDs in config for bot sync
        const { data: guildConfig } = await supabase
          .from('config')
          .select('value')
          .eq('key', 'discord_guild_ids')
          .single()

        let guildIds: string[] = []
        if (guildConfig?.value) {
          guildIds = JSON.parse(guildConfig.value)
        }

        if (!guildIds.includes(appGuildId)) {
          guildIds.push(appGuildId)
          await supabase
            .from('config')
            .update({ value: JSON.stringify(guildIds) })
            .eq('key', 'discord_guild_ids')
        }

        // Update webhook URLs if provided
        if (webhookUrl) {
          const { data: webhookConfig } = await supabase
            .from('config')
            .select('value')
            .eq('key', 'discord_webhook_urls')
            .single()

          let webhookUrls: string[] = []
          if (webhookConfig?.value) {
            webhookUrls = JSON.parse(webhookConfig.value)
          }

          if (!webhookUrls.includes(webhookUrl)) {
            webhookUrls.push(webhookUrl)
            await supabase
              .from('config')
              .update({ value: JSON.stringify(webhookUrls) })
              .eq('key', 'discord_webhook_urls')
          }
        }

        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: `✅ Successfully added server: **${guildName}**\n\n` +
                `🏷️ **Name:** ${newServer.server_name}\n` +
                `🆔 **Guild ID:** ${newServer.guild_id}\n` +
                `🔗 **Webhook:** ${newServer.webhook_url || 'Not set'}\n` +
                `🛡️ **Role ID:** ${newServer.role_id || 'Not set'}\n\n` +
                `Bot will now sync commands to this server!`,
              flags: 64
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      case 'list':
        const { data: servers } = await supabase
          .from('server_configs')
          .select('*')
          .eq('is_active', true)
          .order('server_name')

        if (!servers || servers.length === 0) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '📋 **No servers configured**\nUse `/add app <guild_name> <guild_id>` to add a server',
                flags: 64
              }
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const serverList = servers.map((server, index) => {
          return `${index + 1}. **${server.server_name}**\n` +
            `   🆔 Guild: \`${server.guild_id}\`\n` +
            `   🔗 Webhook: ${server.webhook_url ? '✅ Configured' : '❌ Not set'}\n` +
            `   🛡️ Role ID: ${server.role_id || '❌ Not set'}`
        }).join('\n\n')

        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: `📋 **Configured Servers (${servers.length})**\n\n${serverList}`,
              flags: 64
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      case 'remove':
        const serverToRemove = options.find(opt => opt.name === 'server_name')?.value
        
        if (!serverToRemove) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '❌ Server name is required\nUsage: `/add remove <server_name>`',
                flags: 64
              }
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Get server to remove
        const { data: serverConfig } = await supabase
          .from('server_configs')
          .select('*')
          .eq('server_name', serverToRemove)
          .single()

        if (!serverConfig) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: `❌ Server "${serverToRemove}" not found`,
                flags: 64
              }
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Deactivate server
        const { error: deactivateError } = await supabase
          .from('server_configs')
          .update({ is_active: false })
          .eq('server_name', serverToRemove)

        if (deactivateError) throw deactivateError

        // Remove from guild IDs config
        const { data: currentGuildConfig } = await supabase
          .from('config')
          .select('value')
          .eq('key', 'discord_guild_ids')
          .single()

        if (currentGuildConfig?.value) {
          let guildIds = JSON.parse(currentGuildConfig.value)
          guildIds = guildIds.filter((id: string) => id !== serverConfig.guild_id)
          
          await supabase
            .from('config')
            .update({ value: JSON.stringify(guildIds) })
            .eq('key', 'discord_guild_ids')
        }

        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: `✅ Server "${serverToRemove}" has been deactivated\nBot will no longer sync commands to this server`,
              flags: 64
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      default:
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: '❌ Unknown subcommand. Use: `app`, `list`, or `remove`',
              flags: 64
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
  } catch (error) {
    console.error('Add command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to manage server configuration: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleGlobalSyncCommands(supabase: any) {
  // Get Discord config from environment variables
  const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
  const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')

  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ **Discord configuration missing in environment variables**\n\n` +
            `Required environment variables:\n` +
            `• \`DISCORD_BOT_TOKEN\`: ${DISCORD_BOT_TOKEN ? '✅ Set' : '❌ Missing'}\n` +
            `• \`DISCORD_CLIENT_ID\`: ${DISCORD_CLIENT_ID ? '✅ Set' : '❌ Missing'}\n\n` +
            `Please set these environment variables in your Supabase Edge Function settings.`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log('Global sync config check:', {
    bot_token_length: DISCORD_BOT_TOKEN.length,
    client_id_length: DISCORD_CLIENT_ID.length,
    bot_token_prefix: DISCORD_BOT_TOKEN.substring(0, 10) + '...',
    client_id_prefix: DISCORD_CLIENT_ID.substring(0, 10) + '...'
  })

  console.log('Syncing commands globally to application')

  // First, delete all existing commands from all guilds to avoid conflicts
  const guildIds = await getAllGuildIds(supabase)
  if (guildIds.length > 0) {
    console.log(`🧹 Cleaning up existing commands from ${guildIds.length} guilds...`)
    
    for (const guildId of guildIds) {
      try {
        const deleteResponse = await fetch(
          `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/guilds/${guildId}/commands`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        )
        
        if (deleteResponse.ok) {
          console.log(`✅ Cleared commands from guild ${guildId}`)
        } else {
          const errorText = await deleteResponse.text()
          console.log(`⚠️ Failed to clear commands from guild ${guildId}: ${errorText}`)
        }
      } catch (error) {
        console.log(`❌ Error clearing guild ${guildId}:`, error.message)
      }
    }
  }

  // Define slash commands
  const commands = [
    {
      name: 'register',
      description: 'Register your Discord account with Commentum',
      options: [
        {
          name: 'platform',
          description: 'Your platform (anilist, myanimelist, simkl, other)',
          type: 3,
          required: true,
          choices: [
            { name: 'AniList', value: 'anilist' },
            { name: 'MyAnimeList', value: 'myanimelist' },
            { name: 'SIMKL', value: 'simkl' },
            { name: 'Other', value: 'other' }
          ]
        },
        {
          name: 'user_id',
          description: 'Your platform user ID',
          type: 3,
          required: true
        },
        {
          name: 'guild_name',
          description: 'Server name to register for',
          type: 3,
          required: false,
          choices: [] // Will be populated dynamically
        }
      ]
    },
    {
      name: 'help',
      description: 'Show help and available commands'
    },
    {
      name: 'stats',
      description: 'View system statistics'
    },
    {
      name: 'user',
      description: 'Get user information',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to lookup',
          type: 3,
          required: true
        }
      ]
    },
    {
      name: 'comment',
      description: 'Get comment information',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to lookup',
          type: 3,
          required: true
        }
      ]
    },
    {
      name: 'report',
      description: 'Report a comment (requires registration)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to report',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for reporting',
          type: 3,
          required: true,
          choices: [
            { name: 'Spam', value: 'spam' },
            { name: 'Inappropriate Content', value: 'inappropriate' },
            { name: 'Harassment', value: 'harassment' },
            { name: 'Misinformation', value: 'misinformation' },
            { name: 'Other', value: 'other' }
          ]
        }
      ]
    },
    {
      name: 'queue',
      description: 'View moderation queue (Mod+ only)'
    },
    {
      name: 'ban',
      description: 'Ban a user (Admin/Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to ban',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for banning',
          type: 3,
          required: true
        },
        {
          name: 'shadow',
          description: 'Shadow ban (invisible to user)',
          type: 5,
          required: false
        }
      ]
    },
    {
      name: 'unban',
      description: 'Unban a user (Admin/Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to unban',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unbanning',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'warn',
      description: 'Warn a user (Mod+ only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to warn',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for warning',
          type: 3,
          required: true
        }
      ]
    },
    {
      name: 'mute',
      description: 'Mute a user (Mod+ only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to mute',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for muting',
          type: 3,
          required: true
        },
        {
          name: 'duration',
          description: 'Duration in hours (default: 24)',
          type: 4,
          required: false
        }
      ]
    },
    {
      name: 'unmute',
      description: 'Unmute a user (Mod+ only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to unmute',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unmuting',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'shadowban',
      description: 'Shadow ban a user (Admin/Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to shadow ban',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for shadow banning',
          type: 3,
          required: true
        }
      ]
    },
    {
      name: 'unshadowban',
      description: 'Remove shadow ban (Admin/Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to unshadow ban',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for removing shadow ban',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'pin',
      description: 'Pin a comment (Mod+ only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to pin',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for pinning',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'unpin',
      description: 'Unpin a comment (Mod+ only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to unpin',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unpinning',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'lock',
      description: 'Lock a comment thread (Mod+ only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to lock',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for locking',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'unlock',
      description: 'Unlock a comment thread (Mod+ only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to unlock',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unlocking',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'delete',
      description: 'Delete a comment (Admin/Super Admin only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to delete',
          type: 3,
          required: true
        }
      ]
    },
    {
      name: 'resolve',
      description: 'Resolve a report (Mod+ only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID with report',
          type: 3,
          required: true
        },
        {
          name: 'reporter_id',
          description: 'Reporter user ID',
          type: 3,
          required: true
        },
        {
          name: 'resolution',
          description: 'Resolution action',
          type: 3,
          required: true,
          choices: [
            { name: 'Valid Report', value: 'valid' },
            { name: 'Invalid Report', value: 'invalid' },
            { name: 'Already Handled', value: 'handled' }
          ]
        }
      ]
    },
    {
      name: 'promote',
      description: 'Promote a user to higher role (Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to promote',
          type: 3,
          required: true
        },
        {
          name: 'role',
          description: 'New role to assign',
          type: 3,
          required: true,
          choices: [
            { name: 'Moderator', value: 'moderator' },
            { name: 'Admin', value: 'admin' },
            { name: 'Super Admin', value: 'super_admin' }
          ]
        },
        {
          name: 'reason',
          description: 'Reason for promotion',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'demote',
      description: 'Demote a user to lower role (Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to demote',
          type: 3,
          required: true
        },
        {
          name: 'role',
          description: 'New role to assign',
          type: 3,
          required: true,
          choices: [
            { name: 'User', value: 'user' },
            { name: 'Moderator', value: 'moderator' },
            { name: 'Admin', value: 'admin' }
          ]
        },
        {
          name: 'reason',
          description: 'Reason for demotion',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'config',
      description: 'Manage system configuration (Super Admin only)',
      options: [
        {
          name: 'action',
          description: 'Configuration action',
          type: 3,
          required: true,
          choices: [
            { name: 'Get Value', value: 'get' },
            { name: 'Set Value', value: 'set' },
            { name: 'List All', value: 'list' }
          ]
        },
        {
          name: 'key',
          description: 'Configuration key',
          type: 3,
          required: false
        },
        {
          name: 'value',
          description: 'Configuration value',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'add',
      description: 'Manage server configurations (Super Admin only)',
      options: [
        {
          name: 'subcommand',
          description: 'Add subcommand',
          type: 3,
          required: true,
          choices: [
            { name: 'Add Server', value: 'app' },
            { name: 'List Servers', value: 'list' },
            { name: 'Remove Server', value: 'remove' }
          ]
        },
        {
          name: 'guild_name',
          description: 'Server name',
          type: 3,
          required: false
        },
        {
          name: 'guild_id',
          description: 'Discord server ID',
          type: 3,
          required: false
        },
        {
          name: 'webhook_url',
          description: 'Discord webhook URL',
          type: 3,
          required: false
        },
        {
          name: 'role_id',
          description: 'Discord role ID for moderators',
          type: 3,
          required: false
        },
        {
          name: 'server_name',
          description: 'Server name to remove',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'webhooks',
      description: 'Manage webhook configurations (Super Admin only)',
      options: [
        {
          name: 'action',
          description: 'Webhook action',
          type: 3,
          required: true,
          choices: [
            { name: 'List Webhooks', value: 'list' },
            { name: 'Add Webhook', value: 'add' },
            { name: 'Remove Webhook', value: 'remove' },
            { name: 'Test Webhook', value: 'test' }
          ]
        },
        {
          name: 'webhook_url',
          description: 'Discord webhook URL',
          type: 3,
          required: false
        }
      ]
    }
  ]

  try {
    // Sync to application globally (no guild-specific endpoint)
    console.log('Sending bulk overwrite request to Discord:')
    console.log('- URL:', `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands`)
    console.log('- Method: PUT')
    console.log('- Commands count:', commands.length)
    console.log('- Bot token length:', DISCORD_BOT_TOKEN.length)
    console.log('- Client ID:', DISCORD_CLIENT_ID)

    const response = await fetch(
      `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(commands)
      }
    )

    console.log('Discord API response status:', response.status)
    console.log('Discord API response headers:', Object.fromEntries(response.headers.entries()))

    if (response.ok) {
      const syncedCommands = await response.json()
      console.log('Successfully synced commands:', syncedCommands.length)
      
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `✅ **Global bot sync successful!**\n\n` +
              `🧹 **Cleanup:** Cleared commands from ${guildIds.length} guild(s)\n` +
              `🤖 **Commands synced:** ${syncedCommands.length}\n` +
              `🌐 **Scope:** Application-wide (available in all servers)\n` +
              `📋 **Server-specific data:** Will use server_configs table\n\n` +
              `**Bot is now available globally!**\n` +
              `Servers can invite the bot without needing admin permissions.`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      const errorText = await response.text()
      console.error('Global sync error response:', errorText)
      
      let errorData
      try {
        errorData = JSON.parse(errorText)
      } catch {
        errorData = { message: errorText, details: 'Raw error response' }
      }
      
      console.error('Global sync error:', response.status, errorData)
      
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ **Global sync failed**\n\n` +
              `Status: ${response.status}\n` +
              `Error: ${errorData.message || response.statusText}\n` +
              `${errorData.details ? `Details: ${errorData.details}` : ''}\n\n` +
              `Please check:\n` +
              `• Bot token is valid\n` +
              `• Client ID is correct\n` +
              `• Bot has applications.commands scope\n` +
              `• Bot is properly invited to servers`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  } catch (error) {
    console.error('Global sync error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ **Global sync failed**\n\nError: ${error.message}\n\nPlease check bot configuration.`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature-ed25519, x-signature-timestamp',
}

// Discord bot configuration
const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')
const DISCORD_GUILD_ID = Deno.env.get('DISCORD_GUILD_ID')
const DISCORD_WEBHOOK_URL = Deno.env.get('DISCORD_WEBHOOK_URL')
const DISCORD_PUBLIC_KEY = Deno.env.get('DISCORD_PUBLIC_KEY')

// Discord API endpoints
const DISCORD_API_BASE = 'https://discord.com/api/v10'

// Function to assign Discord role to user
async function assignDiscordRole(
  guildId: string, 
  userId: string, 
  roleId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (response.ok) {
      return { success: true }
    } else {
      const errorData = await response.json().catch(() => ({}))
      return { 
        success: false, 
        error: `Discord API Error: ${response.status} - ${errorData.message || response.statusText}` 
      }
    }
  } catch (error) {
    return { 
      success: false, 
      error: `Network Error: ${error.message}` 
    }
  }
}

// Function to get server configuration
async function getServerConfig(supabase: any, guildId: string) {
  try {
    const { data: serverConfig } = await supabase
      .from('server_configs')
      .select('*')
      .eq('guild_id', guildId)
      .eq('is_active', true)
      .single()

    return serverConfig
  } catch (error) {
    // Table might not exist yet, return null
    console.log('Server config table not found or error:', error.message)
    return null
  }
}

// Function to get all active server configurations
async function getAllServerConfigs(supabase: any) {
  try {
    const { data: serverConfigs } = await supabase
      .from('server_configs')
      .select('*')
      .eq('is_active', true)
      .order('server_name')

    return serverConfigs || []
  } catch (error) {
    console.log('Error fetching all server configs:', error.message)
    return []
  }
}

// Function to get all guild IDs for bot sync
async function getAllGuildIds(supabase: any) {
  try {
    const serverConfigs = await getAllServerConfigs(supabase)
    return serverConfigs.map(server => server.guild_id)
  } catch (error) {
    console.log('Error fetching guild IDs:', error.message)
    return []
  }
}

// Function to get all webhook URLs for notifications
async function getAllWebhookUrls(supabase: any) {
  try {
    const serverConfigs = await getAllServerConfigs(supabase)
    return serverConfigs
      .filter(server => server.webhook_url)
      .map(server => server.webhook_url)
  } catch (error) {
    console.log('Error fetching webhook URLs:', error.message)
    return []
  }
}

// Log on startup
console.log('DISCORD_PUBLIC_KEY exists:', !!DISCORD_PUBLIC_KEY)
console.log('DISCORD_PUBLIC_KEY length:', DISCORD_PUBLIC_KEY?.length)

// Verify Discord request signature using Web Crypto API
async function verifyDiscordSignature(
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  if (!DISCORD_PUBLIC_KEY) {
    console.error('DISCORD_PUBLIC_KEY not set')
    return false
  }

  try {
    const publicKey = await crypto.subtle.importKey(
      'raw',
      hexToUint8Array(DISCORD_PUBLIC_KEY),
      {
        name: 'Ed25519',
        namedCurve: 'Ed25519',
      },
      false,
      ['verify']
    )

    const isVerified = await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      hexToUint8Array(signature),
      new TextEncoder().encode(timestamp + body)
    )
    
    console.log('Signature verification result:', isVerified)
    return isVerified
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g)
  if (!matches) return new Uint8Array()
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)))
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

    // Get signature headers for Discord verification
    const signature = req.headers.get('x-signature-ed25519')
    const timestamp = req.headers.get('x-signature-timestamp')
    
    console.log('Request received')
    console.log('Method:', req.method)
    console.log('URL:', req.url)
    console.log('Signature header:', signature)
    console.log('Timestamp header:', timestamp)
    console.log('Content-Type:', req.headers.get('content-type'))
    
    const rawBody = await req.text()
    console.log('Body:', rawBody)
    console.log('Body length:', rawBody.length)

    // Check if body is empty
    if (!rawBody || rawBody.trim() === '') {
      console.error('Empty body received')
      // If it's a PING request without body, respond anyway
      return new Response(
        JSON.stringify({ type: 1 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let body
    try {
      body = JSON.parse(rawBody)
      console.log('Parsed body type:', body.type)
    } catch (parseError) {
      console.error('JSON parse error:', parseError)
      console.error('Raw body that failed to parse:', rawBody)
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Handle Discord PING verification FIRST (before signature check)
    // Discord sends PING during endpoint setup verification
    if (body.type === 1) {
      console.log('Responding to Discord PING')
      
      // Verify signature even for PING
      if (signature && timestamp) {
        console.log('Verifying PING signature...')
        const isValid = await verifyDiscordSignature(signature, timestamp, rawBody)
        
        if (!isValid) {
          console.error('PING signature verification FAILED')
          return new Response(
            JSON.stringify({ error: 'Invalid request signature' }),
            { 
              status: 401, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          )
        }
        console.log('PING signature verification PASSED')
      }
      
      return new Response(
        JSON.stringify({ type: 1 }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }
    
    // Verify signature for all other requests (actual interactions)
    if (signature && timestamp) {
      console.log('Verifying Discord signature...')
      const isValid = await verifyDiscordSignature(signature, timestamp, rawBody)
      
      if (!isValid) {
        console.error('Signature verification FAILED')
        return new Response(
          JSON.stringify({ error: 'Invalid request signature' }),
          { 
            status: 401, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }
      console.log('Signature verification PASSED')
    }

    // Handle Discord interactions (slash commands)
    if (body.type === 2) {
      return await handleDiscordInteraction(supabase, { command_data: body })
    }

    const { action, discord_user_id, discord_username, platform_user_id, platform_type, command_data } = body

    switch (action) {
      case 'register':
        return await handleDiscordRegistration(supabase, {
          discord_user_id,
          discord_username,
          platform_user_id,
          platform_type
        })
      
      case 'verify':
        return await handleDiscordVerification(supabase, {
          discord_user_id
        })
      
      case 'get_user_role':
        return await handleGetUserRole(supabase, {
          discord_user_id
        })
      
      case 'cleanup_all':
        return await handleCleanupAllCommands(supabase)
      
      case 'sync_commands':
        return await handleSyncCommands(supabase)
      
      case 'sync_global':
        return await handleGlobalSyncCommands(supabase)
      
      case 'interact':
        return await handleDiscordInteraction(supabase, {
          command_data
        })
      
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Discord bot API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function handleDiscordRegistration(supabase: any, params: any) {
  const { discord_user_id, discord_username, platform_user_id, platform_type } = params

  // Validate required fields (token removed - not used anymore)
  if (!discord_user_id || !discord_username || !platform_user_id || !platform_type) {
    return new Response(
      JSON.stringify({ error: 'All fields are required for registration' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // No token verification needed - tokens are not used anymore

  // Check if Discord user is already registered
  const { data: existingRegistration } = await supabase
    .from('discord_users')
    .select('*')
    .eq('discord_user_id', discord_user_id)
    .single()

  if (existingRegistration) {
    return new Response(
      JSON.stringify({ error: 'Discord user already registered' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get user role from platform
  const userRole = await getUserRoleFromPlatform(supabase, platform_user_id)

  // Register Discord user
  const { data: registration, error } = await supabase
    .from('discord_users')
    .insert({
      discord_user_id,
      discord_username,
      platform_user_id,
      platform_type,
      user_role: userRole,
      registered_at: new Date().toISOString(),
      is_active: true
    })
    .select()
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      registration,
      message: `Successfully registered ${discord_username} as ${userRole}`
    }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleDiscordVerification(supabase: any, params: any) {
  const { discord_user_id } = params

  // No token verification needed - tokens are not used anymore
  // Auto-verify Discord users since token system is deprecated

  // Update verification status
  const { data: registration, error } = await supabase
    .from('discord_users')
    .update({
      is_verified: true,
      verified_at: new Date().toISOString()
    })
    .eq('discord_user_id', discord_user_id)
    .select()
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({
      success: true,
      registration,
      message: 'Discord user verified successfully'
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleGetUserRole(supabase: any, params: any) {
  const { discord_user_id } = params

  const { data: registration, error } = await supabase
    .from('discord_users')
    .select('user_role, is_active, is_verified')
    .eq('discord_user_id', discord_user_id)
    .eq('is_active', true)
    .single()

  if (error || !registration) {
    return new Response(
      JSON.stringify({ error: 'Discord user not found or inactive' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      success: true,
      role: registration.user_role,
      is_verified: registration.is_verified
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleCleanupAllCommands(supabase: any) {
  // Get Discord config from environment variables
  const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
  const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')

  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
    return new Response(
      JSON.stringify({ 
        error: 'Discord configuration missing',
        details: {
          bot_token: !!DISCORD_BOT_TOKEN,
          client_id: !!DISCORD_CLIENT_ID
        }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log('🧹 Starting complete cleanup of all Discord commands...')

  const cleanupResults = []

  // 1. Clean up global commands first - need to get them first, then delete individually
  try {
    // Get all global commands first
    const getGlobalResponse = await fetch(
      `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
    
    if (getGlobalResponse.ok) {
      const globalCommands = await getGlobalResponse.json()
      console.log(`Found ${globalCommands.length} global commands to delete`)
      
      // Delete each global command individually
      for (const command of globalCommands) {
        const deleteResponse = await fetch(
          `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands/${command.id}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        )
        
        if (deleteResponse.ok) {
          console.log(`✅ Deleted global command: ${command.name}`)
        } else {
          const errorText = await deleteResponse.text()
          console.log(`⚠️ Failed to delete global command ${command.name}: ${errorText}`)
        }
      }
      
      cleanupResults.push({
        type: 'global',
        success: true,
        message: `Deleted ${globalCommands.length} global commands`
      })
    } else {
      const errorText = await getGlobalResponse.text()
      console.log(`⚠️ Failed to get global commands: ${errorText}`)
      cleanupResults.push({
        type: 'global',
        success: false,
        error: errorText
      })
    }
  } catch (error) {
    console.log(`❌ Error clearing global commands:`, error.message)
    cleanupResults.push({
      type: 'global',
      success: false,
      error: error.message
    })
  }

  // 2. Clean up guild commands
  const guildIds = await getAllGuildIds(supabase)
  if (guildIds.length > 0) {
    console.log(`🧹 Cleaning up commands from ${guildIds.length} guilds...`)
    
    for (const guildId of guildIds) {
      try {
        // Get all guild commands first
        const getGuildResponse = await fetch(
          `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/guilds/${guildId}/commands`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        )
        
        if (getGuildResponse.ok) {
          const guildCommands = await getGuildResponse.json()
          console.log(`Found ${guildCommands.length} guild commands to delete for guild ${guildId}`)
          
          // Delete each guild command individually
          for (const command of guildCommands) {
            const deleteResponse = await fetch(
              `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/guilds/${guildId}/commands/${command.id}`,
              {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                  'Content-Type': 'application/json'
                }
              }
            )
            
            if (deleteResponse.ok) {
              console.log(`✅ Deleted guild command: ${command.name} from guild ${guildId}`)
            } else {
              const errorText = await deleteResponse.text()
              console.log(`⚠️ Failed to delete guild command ${command.name} from guild ${guildId}: ${errorText}`)
            }
          }
          
          cleanupResults.push({
            type: 'guild',
            guildId,
            success: true,
            message: `Deleted ${guildCommands.length} guild commands`
          })
        } else {
          const errorText = await getGuildResponse.text()
          console.log(`⚠️ Failed to get guild commands for guild ${guildId}: ${errorText}`)
          cleanupResults.push({
            type: 'guild',
            guildId,
            success: false,
            error: errorText
          })
        }
      } catch (error) {
        console.log(`❌ Error clearing guild ${guildId}:`, error.message)
        cleanupResults.push({
          type: 'guild',
          guildId,
          success: false,
          error: error.message
        })
      }
    }
  }

  const successfulCleanups = cleanupResults.filter(r => r.success)
  const failedCleanups = cleanupResults.filter(r => !r.success)

  return new Response(
    JSON.stringify({
      success: failedCleanups.length === 0,
      totalOperations: cleanupResults.length,
      successful: successfulCleanups.length,
      failed: failedCleanups.length,
      results: cleanupResults,
      message: `Cleaned up ${successfulCleanups.length}/${cleanupResults.length} command sets${failedCleanups.length > 0 ? ` (${failedCleanups.length} failed)` : ''}`
    }),
    { status: failedCleanups.length === 0 ? 200 : 207, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleSyncCommands(supabase: any, guildIds?: string[]) {
  // Get Discord config from environment variables
  const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
  const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')

  // Get guild IDs from server_configs table - use provided ones, or fetch from table
  let targetGuildIds: string[] = []
  if (guildIds && guildIds.length > 0) {
    targetGuildIds = guildIds
  } else {
    // Fetch all active guild IDs from server_configs table
    targetGuildIds = await getAllGuildIds(supabase)
  }

  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID || !targetGuildIds.length) {
    return new Response(
      JSON.stringify({ 
        error: 'Discord configuration missing or no servers configured',
        details: {
          bot_token: !!DISCORD_BOT_TOKEN,
          client_id: !!DISCORD_CLIENT_ID,
          guild_ids_count: targetGuildIds.length
        }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log(`Syncing commands to ${targetGuildIds.length} guilds:`, targetGuildIds)

  // First, delete all existing commands from all target guilds to avoid conflicts with global commands
  console.log(`🧹 Cleaning up existing commands from ${targetGuildIds.length} guilds...`)
  
  for (const guildId of targetGuildIds) {
    try {
      const deleteResponse = await fetch(
        `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/guilds/${guildId}/commands`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      )
      
      if (deleteResponse.ok) {
        console.log(`✅ Cleared commands from guild ${guildId}`)
      } else {
        const errorText = await deleteResponse.text()
        console.log(`⚠️ Failed to clear commands from guild ${guildId}: ${errorText}`)
      }
    } catch (error) {
      console.log(`❌ Error clearing guild ${guildId}:`, error.message)
    }
  }

  // Define slash commands
  const commands = [
    {
      name: 'register',
      description: 'Register your Discord account with Commentum',
      options: [
        {
          name: 'platform',
          description: 'Choose your platform',
          type: 3,
          required: true,
          choices: [
            { name: 'AniList', value: 'anilist' },
            { name: 'MyAnimeList', value: 'myanimelist' },
            { name: 'SIMKL', value: 'simkl' }
          ]
        },
        {
          name: 'user_id',
          description: 'Your platform user ID',
          type: 3,
          required: true
        }
      ]
    },
    {
      name: 'ban',
      description: 'Ban a user (Admin/Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to ban',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for ban',
          type: 3,
          required: true
        },
        {
          name: 'shadow',
          description: 'Shadow ban (true/false)',
          type: 5,
          required: false
        }
      ]
    },
    {
      name: 'unban',
      description: 'Unban a user (Admin/Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to unban',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unban',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'promote',
      description: 'Promote a user to higher role (Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to promote',
          type: 3,
          required: true
        },
        {
          name: 'role',
          description: 'New role to assign',
          type: 3,
          required: true,
          choices: [
            { name: 'Moderator', value: 'moderator' },
            { name: 'Admin', value: 'admin' },
            { name: 'Super Admin', value: 'super_admin' }
          ]
        },
        {
          name: 'reason',
          description: 'Reason for promotion',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'demote',
      description: 'Demote a user to lower role (Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to demote',
          type: 3,
          required: true
        },
        {
          name: 'role',
          description: 'New role to assign',
          type: 3,
          required: true,
          choices: [
            { name: 'User', value: 'user' },
            { name: 'Moderator', value: 'moderator' },
            { name: 'Admin', value: 'admin' }
          ]
        },
        {
          name: 'reason',
          description: 'Reason for demotion',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'warn',
      description: 'Warn a user (Mod+ only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to warn',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for warning',
          type: 3,
          required: true
        }
      ]
    },
    {
      name: 'mute',
      description: 'Mute a user (Mod+ only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to mute',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for muting',
          type: 3,
          required: true
        },
        {
          name: 'duration',
          description: 'Duration in hours (default: 24)',
          type: 4,
          required: false
        }
      ]
    },
    {
      name: 'unmute',
      description: 'Unmute a user (Mod+ only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to unmute',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unmuting',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'shadowban',
      description: 'Shadow ban a user (Admin/Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to shadow ban',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for shadow ban',
          type: 3,
          required: true
        }
      ]
    },
    {
      name: 'unshadowban',
      description: 'Remove shadow ban from user (Admin/Super Admin only)',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to unshadow ban',
          type: 3,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for removing shadow ban',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'pin',
      description: 'Pin a comment (Mod+ only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to pin',
          type: 4,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for pinning',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'unpin',
      description: 'Unpin a comment (Mod+ only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to unpin',
          type: 4,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unpinning',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'lock',
      description: 'Lock a comment thread (Mod+ only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to lock',
          type: 4,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for locking',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'unlock',
      description: 'Unlock a comment thread (Mod+ only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to unlock',
          type: 4,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unlocking',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'delete',
      description: 'Delete a comment',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to delete',
          type: 4,
          required: true
        }
      ]
    },
    {
      name: 'report',
      description: 'Report a comment',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to report',
          type: 4,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for report',
          type: 3,
          required: true,
          choices: [
            { name: 'Spam', value: 'spam' },
            { name: 'Offensive', value: 'offensive' },
            { name: 'Harassment', value: 'harassment' },
            { name: 'Spoiler', value: 'spoiler' },
            { name: 'NSFW', value: 'nsfw' },
            { name: 'Off Topic', value: 'off_topic' },
            { name: 'Other', value: 'other' }
          ]
        },
        {
          name: 'notes',
          description: 'Additional notes',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'resolve',
      description: 'Resolve a report (Mod+ only)',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID with report',
          type: 4,
          required: true
        },
        {
          name: 'reporter_id',
          description: 'Reporter user ID',
          type: 3,
          required: true
        },
        {
          name: 'resolution',
          description: 'Resolution type',
          type: 3,
          required: true,
          choices: [
            { name: 'Resolved', value: 'resolved' },
            { name: 'Dismissed', value: 'dismissed' }
          ]
        },
        {
          name: 'notes',
          description: 'Review notes',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'queue',
      description: 'View moderation queue (Mod+ only)'
    },
    {
      name: 'user',
      description: 'Get user information',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to lookup',
          type: 3,
          required: true
        }
      ]
    },
    {
      name: 'comment',
      description: 'Get comment information',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to lookup',
          type: 4,
          required: true
        }
      ]
    },
    {
      name: 'config',
      description: 'View or update system configuration (Super Admin only)',
      options: [
        {
          name: 'action',
          description: 'Action to perform',
          type: 3,
          required: true,
          choices: [
            { name: 'View Config', value: 'view' },
            { name: 'Update Config', value: 'update' }
          ]
        },
        {
          name: 'key',
          description: 'Configuration key',
          type: 3,
          required: false
        },
        {
          name: 'value',
          description: 'New configuration value',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'add',
      description: 'Manage server configurations (Super Admin only)',
      options: [
        {
          name: 'subcommand',
          description: 'Add subcommand',
          type: 3,
          required: true,
          choices: [
            { name: 'Add Server', value: 'app' },
            { name: 'List Servers', value: 'list' },
            { name: 'Remove Server', value: 'remove' }
          ]
        },
        {
          name: 'guild_name',
          description: 'Server name',
          type: 3,
          required: false
        },
        {
          name: 'guild_id',
          description: 'Discord server ID',
          type: 3,
          required: false
        },
        {
          name: 'webhook_url',
          description: 'Discord webhook URL',
          type: 3,
          required: false
        },
        {
          name: 'role_id',
          description: 'Discord role ID for moderators',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'stats',
      description: 'View comment system statistics'
    },
    {
      name: 'help',
      description: 'Show help information'
    },
    {
      name: 'cleanup',
      description: 'Delete all commands from all guilds (Super Admin only)'
    },
    {
      name: 'sync',
      description: 'Sync Discord commands globally (Super Admin only)'
    },
    {
      name: 'webhooks',
      description: 'Manage Discord notification webhooks (Super Admin only)',
      options: [
        {
          name: 'action',
          description: 'Action to perform',
          type: 3,
          required: true,
          choices: [
            { name: 'list', value: 'list' },
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' },
            { name: 'test', value: 'test' }
          ]
        },
        {
          name: 'webhook_url',
          description: 'Webhook URL to add/remove',
          type: 3,
          required: false
        }
      ]
    }
  ]

  // Sync commands to all target guilds
  const syncResults = []
  
  try {
    for (const guildId of targetGuildIds) {
      try {
      const response = await fetch(
        `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/guilds/${guildId}/commands`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(commands)
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Discord API error for guild ${guildId}:`, errorText)
        syncResults.push({
          guildId,
          success: false,
          error: `${response.status} - ${errorText}`
        })
        continue
      }

      const result = await response.json()
      syncResults.push({
        guildId,
        success: true,
        commands: result,
        message: `Synced ${result.length} commands`
      })
      
    } catch (error) {
      console.error(`Failed to sync to guild ${guildId}:`, error)
      syncResults.push({
        guildId,
        success: false,
        error: error.message
      })
    }
  }

  const successfulSyncs = syncResults.filter(r => r.success);
  const failedSyncs = syncResults.filter(r => !r.success);

  return new Response(
    JSON.stringify({
      success: failedSyncs.length === 0,
      totalGuilds: targetGuildIds.length,
      successful: successfulSyncs.length,
      failed: failedSyncs.length,
      results: syncResults,
      message: `Synced commands to ${successfulSyncs.length}/${targetGuildIds.length} guilds${failedSyncs.length > 0 ? ` (${failedSyncs.length} failed)` : ''}`
    }),
    { status: failedSyncs.length === 0 ? 200 : 207, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )

  } catch (error) {
    console.error('Error syncing Discord commands:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to sync Discord commands',
        message: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleDiscordInteraction(supabase: any, params: any) {
  const { command_data } = params

  if (!command_data) {
    return new Response(
      JSON.stringify({ error: 'Command data required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Extract data from Discord interaction payload
  const commandName = command_data.data?.name
  const options = command_data.data?.options || []
  const member = command_data.member
  const guild_id = command_data.guild_id
  const channel_id = command_data.channel_id
  const discordUserId = member?.user?.id

  if (!discordUserId) {
    return new Response(
      JSON.stringify({ error: 'Discord user ID not found' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Special handling for register command - doesn't require existing registration
  if (commandName === 'register') {
    return await handleRegisterCommand(supabase, options, member, guild_id)
  }

  // For all other commands, check if user is registered
  const { data: registration } = await supabase
    .from('discord_users')
    .select('user_role, platform_user_id, platform_type')
    .eq('discord_user_id', discordUserId)
    .eq('is_active', true)
    .single()

  if (!registration) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ You need to register first using `/register`',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Handle different commands
  try {
    switch (commandName) {
      case 'register':
        return await handleRegisterCommand(supabase, options, member, guild_id)
      
      case 'ban':
        return await handleBanCommand(supabase, options, registration)
      
      case 'unban':
        return await handleUnbanCommand(supabase, options, registration)
      
      case 'promote':
        return await handlePromoteCommand(supabase, options, registration)
      
      case 'demote':
        return await handleDemoteCommand(supabase, options, registration)
      
      case 'warn':
        return await handleWarnCommand(supabase, options, registration)
      
      case 'mute':
        return await handleMuteCommand(supabase, options, registration)
      
      case 'unmute':
        return await handleUnmuteCommand(supabase, options, registration)
      
      case 'shadowban':
        return await handleShadowbanCommand(supabase, options, registration)
      
      case 'unshadowban':
        return await handleUnshadowbanCommand(supabase, options, registration)
      
      case 'pin':
        return await handlePinCommand(supabase, options, registration)
      
      case 'unpin':
        return await handleUnpinCommand(supabase, options, registration)
      
      case 'lock':
        return await handleLockCommand(supabase, options, registration)
      
      case 'unlock':
        return await handleUnlockCommand(supabase, options, registration)
      
      case 'delete':
        return await handleDeleteCommand(supabase, options, registration)
      
      case 'report':
        return await handleReportCommand(supabase, options, registration)
      
      case 'resolve':
        return await handleResolveCommand(supabase, options, registration)
      
      case 'queue':
        return await handleQueueCommand(supabase, registration)
      
      case 'user':
        return await handleUserCommand(supabase, options)
      
      case 'comment':
        return await handleCommentCommand(supabase, options)
      
      case 'config':
        return await handleConfigCommand(supabase, options, registration)
      
      case 'stats':
        return await handleStatsCommand(supabase)
      
      case 'help':
        return await handleHelpCommand(registration)
      
      case 'sync':
        return await handleSyncCommand(supabase, registration)
      
      case 'cleanup':
        return await handleCleanupCommand(supabase, registration)
      
      case 'webhooks':
        return await handleWebhooksCommand(supabase, options, registration)
      
      case 'add':
        return await handleAddCommand(supabase, options, registration, guild_id)
      
      default:
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: '❌ Unknown command',
              flags: 64
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
  } catch (error) {
    console.error('Error handling Discord command:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ An error occurred while executing the command',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Command handlers
async function handleRegisterCommand(supabase: any, options: any, member: any, guild_id: string) {
  const guildName = options.find(opt => opt.name === 'guild_name')?.value
  const platform = options.find(opt => opt.name === 'platform')?.value
  const userId = options.find(opt => opt.name === 'user_id')?.value

  // If no guild name provided, show available guilds
  if (!guildName) {
    try {
      const { data: servers } = await supabase
        .from('server_configs')
        .select('server_name, guild_id')
        .eq('is_active', true)
        .order('server_name')

      if (!servers || servers.length === 0) {
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: '❌ No servers configured. Please contact an admin to add servers.',
              flags: 64
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const guildList = servers.map((server, index) => {
        return `${index + 1}. **${server.server_name}**`
      }).join('\n')

      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `🏷️ **Available Guilds**\n\n${guildList}\n\n` +
              `Usage: \`/register <guild_name> <platform> <user_id>\`\n` +
              `Platforms: anilist, myanimelist, simkl, other`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (error) {
      console.error('Error fetching servers:', error)
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '❌ Failed to fetch available guilds. Please try again later.',
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  // Validate required parameters
  if (!platform || !userId) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Platform and User ID are required\nUsage: `/register <guild_name> <platform> <user_id>`',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get server configuration for the selected guild
  const serverConfig = await getServerConfig(supabase, guild_id)
  let targetServerConfig = null

  // Find the server by name (since user provided guild_name, not guild_id)
  try {
    const { data: servers } = await supabase
      .from('server_configs')
      .select('*')
      .eq('server_name', guildName)
      .eq('is_active', true)
      .single()
    targetServerConfig = servers
  } catch (error) {
    console.log('Server config lookup error:', error.message)
  }

  if (!targetServerConfig) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Server "${guildName}" not found or not active.\nUse \`/register\` to see available guilds.`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get user role from config
  const userRole = await getUserRole(supabase, userId)

  // Register or update user
  const { data: registration, error } = await supabase
    .from('discord_users')
    .upsert({
      discord_user_id: member.user.id,
      discord_username: member.user.username,
      platform_user_id: userId,
      platform_type: platform,
      user_role: userRole,
      is_verified: true,
      verified_at: new Date().toISOString(),
      is_active: true,
      registered_at: new Date().toISOString()
    }, {
      onConflict: 'discord_user_id'
    })
    .select()
    .single()

  if (error) throw error

  // Assign Discord role if user is moderator+ and server has role configured
  let roleAssignmentResult = null
  if (userRole !== 'user' && targetServerConfig.role_id) {
    try {
      roleAssignmentResult = await assignDiscordRole(
        targetServerConfig.guild_id,
        member.user.id,
        targetServerConfig.role_id
      )
    } catch (roleError) {
      console.error('Role assignment error:', roleError)
      roleAssignmentResult = { success: false, error: roleError.message }
    }
  }

  // Build response message
  let responseMessage = `✅ Successfully registered as **${userRole}**!\n` +
    `Guild: **${guildName}**\n` +
    `Platform: ${platform}\n` +
    `User ID: ${userId}`
  
  if (userRole !== 'user' && targetServerConfig.role_id) {
    if (roleAssignmentResult?.success) {
      responseMessage += `\n\n🎉 **Role assigned successfully!**`
    } else {
      responseMessage += `\n\n⚠️ **Role assignment failed:** ${roleAssignmentResult?.error || 'Unknown error'}`
    }
  } else if (userRole === 'user') {
    responseMessage += `\n\nℹ️ **Registered as regular user** (no special role assigned)`
  } else {
    responseMessage += `\n\n⚠️ **Role not configured for this server**`
  }

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: responseMessage,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleBanCommand_impl(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can ban users',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value
  const shadow = options.find(opt => opt.name === 'shadow')?.value || false

  try {
    // Direct database operation using service role key
    const { data: targetUserComments } = await supabase
      .from('comments')
      .select('user_id, client_type')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComments || targetUserComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User **${targetUserId}** not found in system`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update all comments by the target user to ban them
    const { error } = await supabase
      .from('comments')
      .update({
        user_banned: true,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: shadow ? 'shadow_ban' : 'ban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // Send Discord notification for ALL actions
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: shadow ? 'user_shadow_banned' : 'user_banned',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully ${shadow ? 'shadow ' : ''}banned user **${targetUserId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Ban command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to ban user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleWarnCommand_impl(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can warn users',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value

  try {
    // Direct database operation using service role key
    const { data: targetUserComments } = await supabase
      .from('comments')
      .select('user_id, user_warnings')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComments || targetUserComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User **${targetUserId}** not found in system`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Increment warning count for the user
    const newWarningCount = (targetUserComments[0].user_warnings || 0) + 1
    const { error } = await supabase
      .from('comments')
      .update({
        user_warnings: newWarningCount,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: 'warning'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // Send Discord notification for ALL actions
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'user_warned',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason,
      metadata: { warningCount: newWarningCount }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully warned user **${targetUserId}** (Warning #${newWarningCount})\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Warn command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to warn user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handlePinCommand_impl(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can pin comments',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Pinned by moderator'

  try {
    // Direct database operation using service role key
    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Comment **${commentId}** not found`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Pin the comment
    const { error } = await supabase
      .from('comments')
      .update({
        pinned: true,
        pinned_at: new Date().toISOString(),
        pinned_by: registration.platform_user_id
      })
      .eq('id', commentId)

    if (error) throw error

    // Send Discord notification for ALL actions
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'comment_pinned',
      comment: comment,
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully pinned comment **${commentId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Pin command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to pin comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleLockCommand_impl(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can lock comments',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Thread locked by moderator'

  try {
    // Direct database operation using service role key
    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Comment **${commentId}** not found`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Lock the comment thread
    const { error } = await supabase
      .from('comments')
      .update({
        locked: true,
        locked_at: new Date().toISOString(),
        locked_by: registration.platform_user_id
      })
      .eq('id', commentId)

    if (error) throw error

    // Send Discord notification for ALL actions
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'comment_locked',
      comment: comment,
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully locked comment **${commentId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Lock command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to lock comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

async function handleHelpCommand_impl(registration: any) {
  const userRole = registration?.user_role || 'user'
  
  let helpText = `🤖 **Commentum Bot Help**\n\n`
  
  if (userRole === 'user') {
    helpText += `**Available Commands:**\n` +
      `• \`/register\` - Register your Discord account\n` +
      `• \`/report\` - Report a comment\n` +
      `• \`/user <user_id>\` - Get user information\n` +
      `• \`/comment <comment_id>\` - Get comment information\n` +
      `• \`/stats\` - View system statistics\n` +
      `• \`/help\` - Show this help message`
  } else if (userRole === 'moderator') {
    helpText += `**Moderator Commands:**\n` +
      `• \`/warn <user_id> <reason>\` - Warn a user\n` +
      `• \`/mute <user_id> [duration] <reason>\` - Mute a user\n` +
      `• \`/unmute <user_id> [reason]\` - Unmute a user\n` +
      `• \`/pin <comment_id> [reason]\` - Pin a comment\n` +
      `• \`/unpin <comment_id> [reason]\` - Unpin a comment\n` +
      `• \`/lock <comment_id> [reason]\` - Lock a thread\n` +
      `• \`/unlock <comment_id> [reason]\` - Unlock a thread\n` +
      `• \`/resolve <comment_id> <reporter_id> <resolution>\` - Resolve report\n` +
      `• \`/queue\` - View moderation queue\n` +
      `• \`/report\` - Report a comment\n` +
      `• \`/user <user_id>\` - Get user information\n` +
      `• \`/comment <comment_id>\` - Get comment information\n` +
      `• \`/stats\` - View system statistics\n` +
      `• \`/help\` - Show this help message`
  } else if (userRole === 'admin') {
    helpText += `**Admin Commands:**\n` +
      `• All Moderator commands\n` +
      `• \`/ban <user_id> <reason> [shadow]\` - Ban a user\n` +
      `• \`/unban <user_id> [reason]\` - Unban a user\n` +
      `• \`/shadowban <user_id> <reason>\` - Shadow ban a user\n` +
      `• \`/unshadowban <user_id> [reason]\` - Remove shadow ban\n` +
      `• \`/delete <comment_id>\` - Delete any comment\n` +
      `• \`/help\` - Show this help message`
  } else if (userRole === 'super_admin' || userRole === 'owner') {
    helpText += `**Super Admin Commands:**\n` +
      `• All Admin commands\n` +
      `• \`/promote <user_id> <role> [reason]\` - Promote a user\n` +
      `• \`/demote <user_id> <role> [reason]\` - Demote a user\n` +
      `• \`/config <action> [key] [value]\` - Manage system configuration\n` +
      `• \`/help\` - Show this help message`
  }

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: helpText,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Helper function to remove user from all role lists
async function removeFromAllRoles(supabase: any, userId: string) {
  const roles = ['owner_users', 'super_admin_users', 'admin_users', 'moderator_users']
  
  for (const role of roles) {
    const { data: config } = await supabase
      .from('config')
      .select('value')
      .eq('key', role)
      .single()

    if (config) {
      const currentList = JSON.parse(config.value)
      const filteredList = currentList.filter((id: string) => id !== userId)
      
      await supabase
        .from('config')
        .update({ value: JSON.stringify(filteredList) })
        .eq('key', role)
    }
  }
}

// Get user role from platform configuration
async function getUserRoleFromPlatform(supabase: any, userId: string) {
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

    if (superAdminList.includes(userId)) return 'super_admin'
    if (adminList.includes(userId)) return 'admin'
    if (moderatorList.includes(userId)) return 'moderator'
    return 'user'
  } catch (error) {
    console.error('Get user role from platform error:', error)
    return 'user'
  }
}



// Mute command handler
async function handleMuteCommand_impl(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can mute users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Muted by moderator'
  const duration = options.find(opt => opt.name === 'duration')?.value || 24

  try {
    // Direct database operation using service role key
    const { data: targetUserComments } = await supabase
      .from('comments')
      .select('user_id, client_type')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComments || targetUserComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User **${targetUserId}** not found in system`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Calculate mute end time
    const muteEndTime = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString()

    // Mute the user
    const { error } = await supabase
      .from('comments')
      .update({
        user_muted_until: muteEndTime,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: 'mute'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // Send Discord notification
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'user_muted',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason,
      metadata: { duration: `${duration} hours` }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully muted **${targetUserId}** for ${duration} hours\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Mute command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to mute user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Unmute command handler
async function handleUnmuteCommand_impl(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can unmute users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Mute lifted'

  try {
    // Direct database operation using service role key
    const { data: targetUserComments } = await supabase
      .from('comments')
      .select('user_id, client_type')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComments || targetUserComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User **${targetUserId}** not found in system`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Unmute the user
    const { error } = await supabase
      .from('comments')
      .update({
        user_muted_until: null,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: 'unmute'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // Send Discord notification
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'moderation_action',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason,
      metadata: { action: 'unmuted' }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully unmuted **${targetUserId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unmute command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unmute user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Shadowban command handler
async function handleShadowbanCommand_impl(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can shadow ban users',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Shadow banned'

  try {
    // Direct database operation using service role key
    const { data: targetUserComments } = await supabase
      .from('comments')
      .select('user_id, client_type')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComments || targetUserComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User **${targetUserId}** not found in system`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Shadow ban the user
    const { error } = await supabase
      .from('comments')
      .update({
        user_shadow_banned: true,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: 'shadow_ban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // Send Discord notification
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'user_shadow_banned',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully shadow banned **${targetUserId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Shadowban command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to shadow ban user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Unshadowban command handler
async function handleUnshadowbanCommand_impl(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can remove shadow bans',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Shadow ban lifted'

  try {
    // Direct database operation using service role key
    const { data: targetUserComments } = await supabase
      .from('comments')
      .select('user_id, client_type')
      .eq('user_id', targetUserId)
      .limit(1)

    if (!targetUserComments || targetUserComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User **${targetUserId}** not found in system`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Remove shadow ban
    const { error } = await supabase
      .from('comments')
      .update({
        user_shadow_banned: false,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: 'unshadow_ban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // Send Discord notification
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'moderation_action',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason,
      metadata: { action: 'shadow ban removed' }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully removed shadow ban from **${targetUserId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unshadowban command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to remove shadow ban: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Unpin command handler
async function handleUnpinCommand_impl(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can unpin comments',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value

  try {
    // Direct database operation using service role key
    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Comment **${commentId}** not found`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Unpin the comment
    const { error } = await supabase
      .from('comments')
      .update({
        pinned: false,
        pinned_at: null,
        pinned_by: null
      })
      .eq('id', commentId)

    if (error) throw error

    // Send Discord notification
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'comment_unlocked',
      comment: comment,
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully unpinned comment **${commentId}**`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unpin command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unpin comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Unlock command handler
async function handleUnlockCommand_impl(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can unlock comment threads',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value

  try {
    // Direct database operation using service role key
    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Comment **${commentId}** not found`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Unlock the comment thread
    const { error } = await supabase
      .from('comments')
      .update({
        locked: false,
        locked_at: null,
        locked_by: null
      })
      .eq('id', commentId)

    if (error) throw error

    // Send Discord notification
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'comment_unlocked',
      comment: comment,
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully unlocked comment thread **${commentId}**`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unlock command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unlock comment thread: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Report command handler
async function handleReportCommand_impl(supabase: any, options: any, registration: any) {
  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Reported via Discord'

  try {
    // Direct database operation using service role key
    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id, report_count')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Comment **${commentId}** not found`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Increment report count
    const { error } = await supabase
      .from('comments')
      .update({
        report_count: comment.report_count + 1,
        reported_at: new Date().toISOString()
      })
      .eq('id', commentId)

    if (error) throw error

    // Send Discord notification
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'comment_reported',
      comment: { ...comment, report_count: comment.report_count + 1 },
      user: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully reported comment **${commentId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Report command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to report comment: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Resolve command handler
async function handleResolveCommand_impl(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can resolve reports',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const action = options.find(opt => opt.name === 'action')?.value || 'resolve'

  try {
    // Direct database operation using service role key
    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id, report_count')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Comment **${commentId}** not found`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Resolve the report
    const { error } = await supabase
      .from('comments')
      .update({
        report_count: 0,
        reported_at: null,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: `Report resolved: ${action}`,
        moderation_action: 'resolve_report'
      })
      .eq('id', commentId)

    if (error) throw error

    // Send Discord notification
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'moderation_action',
      comment: comment,
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: `Report resolved: ${action}`,
      metadata: { action: 'report_resolved' }
    })

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully resolved report for comment **${commentId}**\nAction: ${action}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Resolve command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to resolve report: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Queue command handler
async function handleQueueCommand_impl(supabase: any, registration?: any) {
  try {
    // Get reported comments
    const { data: reportedComments } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id, report_count, created_at')
      .gt('report_count', 0)
      .order('report_count', { ascending: false })
      .limit(10)

    if (!reportedComments || reportedComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '✅ No reported comments in queue',
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const queueList = reportedComments.map(comment => 
      `**${comment.id}** - ${comment.report_count} reports - ${comment.username}`
    ).join('\n')

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `🚨 **Report Queue (Top 10)**\n\n${queueList}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Queue command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch report queue: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// User command handler
async function handleUserCommand_impl(supabase: any, options: any) {
  const userId = options.find(opt => opt.name === 'user_id')?.value

  try {
    // Get user information
    const { data: userComments } = await supabase
      .from('comments')
      .select('id, content, upvotes, downvotes, report_count, created_at, moderated, user_muted_until, user_shadow_banned')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!userComments || userComments.length === 0) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ User **${userId}** not found in system`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const totalComments = userComments.length
    const totalUpvotes = userComments.reduce((sum, comment) => sum + comment.upvotes, 0)
    const totalDownvotes = userComments.reduce((sum, comment) => sum + comment.downvotes, 0)
    const totalReports = userComments.reduce((sum, comment) => sum + comment.report_count, 0)
    const moderatedComments = userComments.filter(comment => comment.moderated).length
    const isMuted = userComments.some(comment => comment.user_muted_until && new Date(comment.user_muted_until) > new Date())
    const isShadowBanned = userComments.some(comment => comment.user_shadow_banned)

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `👤 **User Information for ${userId}**\n\n` +
            `💬 **Total Comments:** ${totalComments}\n` +
            `👍 **Total Upvotes:** ${totalUpvotes}\n` +
            `👎 **Total Downvotes:** ${totalDownvotes}\n` +
            `🚨 **Total Reports:** ${totalReports}\n` +
            `🛡️ **Moderated Comments:** ${moderatedComments}\n` +
            `🔇 **Muted:** ${isMuted ? 'Yes' : 'No'}\n` +
            `👻 **Shadow Banned:** ${isShadowBanned ? 'Yes' : 'No'}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('User command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch user information: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Comment command handler
async function handleCommentCommand_impl(supabase: any, options: any) {
  const commentId = options.find(opt => opt.name === 'comment_id')?.value

  try {
    // Get comment information
    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id, upvotes, downvotes, report_count, created_at, moderated, pinned, locked, user_muted_until, user_shadow_banned')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Comment **${commentId}** not found`,
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const status = [
      comment.moderated ? '🛡️ Moderated' : '',
      comment.pinned ? '📌 Pinned' : '',
      comment.locked ? '🔒 Locked' : '',
      comment.user_muted_until && new Date(comment.user_muted_until) > new Date() ? '🔇 User Muted' : '',
      comment.user_shadow_banned ? '👻 Shadow Banned' : ''
    ].filter(Boolean).join(' ') || '✅ Normal'

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `💬 **Comment Information for ${commentId}**\n\n` +
            `👤 **User:** ${comment.username} (${comment.user_id})\n` +
            `📺 **Media ID:** ${comment.media_id}\n` +
            `👍 **Upvotes:** ${comment.upvotes}\n` +
            `👎 **Downvotes:** ${comment.downvotes}\n` +
            `🚨 **Reports:** ${comment.report_count}\n` +
            `📅 **Created:** ${new Date(comment.created_at).toLocaleString()}\n` +
            `🏷️ **Status:** ${status}\n\n` +
            `📝 **Content:**\n${comment.content.substring(0, 200)}${comment.content.length > 200 ? '...' : ''}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Comment command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch comment information: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Config command handler
async function handleConfigCommand_impl(supabase: any, options: any, registration: any) {
  if (!['super_admin', 'owner'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can view configuration',
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get all configuration
    const { data: config } = await supabase
      .from('config')
      .select('key, value')
      .in('key', [
        'super_admin_users',
        'admin_users',
        'moderator_users',
        'discord_bot_token',
        'discord_client_id',
        'discord_guild_id',
        'discord_webhook_url'
      ])

    if (!config) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '❌ No configuration found',
            flags: 64
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const configList = config.map(item => {
      if (item.key.includes('_users')) {
        const users = JSON.parse(item.value)
        return `**${item.key}:** ${users.length > 0 ? users.join(', ') : 'None'}`
      } else if (item.key.includes('token') || item.key.includes('webhook')) {
        return `**${item.key}:** ${item.value ? '✅ Set' : '❌ Not set'}`
      } else {
        return `**${item.key}:** ${item.value || 'Not set'}`
      }
    }).join('\n')

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `⚙️ **Commentum Configuration**\n\n${configList}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Config command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch configuration: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
}
