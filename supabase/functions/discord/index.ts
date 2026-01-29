import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { getUserRole, canModerate, getDisplayRole } from '../shared/auth.ts'

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature-ed25519, x-signature-timestamp',
}

// Discord API configuration
const DISCORD_API_BASE = 'https://discord.com/api/v10'

// Utility functions
function hexToUint8Array(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g)
  if (!matches) return new Uint8Array()
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)))
}

async function verifyDiscordSignature(
  signature: string,
  timestamp: string,
  body: string,
  publicKey: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToUint8Array(publicKey),
      { name: 'Ed25519', namedCurve: 'Ed25519' },
      false,
      ['verify']
    )

    return await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToUint8Array(signature),
      new TextEncoder().encode(timestamp + body)
    )
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

// Command handlers
async function handleStatsCommand(supabase: any) {
  try {
    const { data: stats } = await supabase
      .from('comments')
      .select('id, upvotes, downvotes, report_count, created_at')

    const totalComments = stats?.length || 0
    const totalUpvotes = stats?.reduce((sum, comment) => sum + comment.upvotes, 0) || 0
    const totalDownvotes = stats?.reduce((sum, comment) => sum + comment.downvotes, 0) || 0
    const totalReports = stats?.reduce((sum, comment) => sum + comment.report_count, 0) || 0

    const { data: discordUsers } = await supabase
      .from('discord_users')
      .select('user_role, is_active')

    const activeUsers = discordUsers?.filter(user => user.is_active).length || 0
    const mods = discordUsers?.filter(user => user.is_active && user.user_role === 'moderator').length || 0
    const admins = discordUsers?.filter(user => user.is_active && user.user_role === 'admin').length || 0
    const superAdmins = discordUsers?.filter(user => user.is_active && user.user_role === 'super_admin').length || 0

    return {
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
    }
  } catch (error) {
    console.error('Stats command error:', error)
    return {
      type: 4,
      data: {
        content: '❌ Failed to retrieve statistics',
        flags: 64
      }
    }
  }
}

async function handleRegisterCommand(supabase: any, options: any, member: any) {
  try {
    const platform = options.find(opt => opt.name === 'platform')?.value
    const userId = options.find(opt => opt.name === 'user_id')?.value

    if (!platform || !userId) {
      return {
        type: 4,
        data: {
          content: '❌ Platform and user_id are required',
          flags: 64
        }
      }
    }

    const userRole = await getUserRole(supabase, userId)

    const { data: registration, error } = await supabase
      .from('discord_users')
      .upsert({
        discord_user_id: member.user.id,
        discord_username: member.user.username,
        discord_discriminator: member.user.discriminator,
        discord_avatar: member.user.avatar,
        platform_user_id: userId,
        platform_type: platform,
        user_role: userRole,
        is_verified: true,
        verified_at: new Date().toISOString(),
        is_active: true,
        registered_at: new Date().toISOString(),
        last_command_at: new Date().toISOString()
      }, {
        onConflict: 'discord_user_id'
      })
      .select()
      .single()

    if (error) throw error

    return {
      type: 4,
      data: {
        content: `✅ Successfully registered as **${userRole}**!\n` +
          `🎯 Platform: ${platform}\n` +
          `🆔 User ID: ${userId}\n` +
          `📅 Registered: ${new Date().toLocaleDateString()}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Register command error:', error)
    return {
      type: 4,
      data: {
        content: '❌ Failed to register user',
        flags: 64
      }
    }
  }
}

async function handleDeleteCommand(supabase: any, options: any, registration: any) {
  try {
    const commentId = options.find(opt => opt.name === 'comment_id')?.value

    if (!commentId) {
      return {
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }
    }

    const { data: comment } = await supabase
      .from('comments')
      .select('id, username, content, user_id, media_id, deleted')
      .eq('id', commentId)
      .single()

    if (!comment) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** not found`,
          flags: 64
        }
      }
    }

    if (comment.deleted) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** is already deleted`,
          flags: 64
        }
      }
    }

    // Check permissions
    if (comment.user_id !== registration.platform_user_id) {
      const userRole = await getUserRole(supabase, registration.platform_user_id)
      if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
        return {
          type: 4,
          data: {
            content: '❌ You can only delete your own comments',
            flags: 64
          }
        }
      }
    }

    const { error } = await supabase
      .from('comments')
      .update({
        deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: registration.platform_user_id
      })
      .eq('id', commentId)

    if (error) throw error

    // Send notification
    try {
      const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
      await sendDiscordNotification(supabase, {
        type: 'comment_deleted',
        comment: { ...comment, deleted: true },
        moderator: { id: registration.platform_user_id, username: registration.platform_user_id }
      })
    } catch (notificationError) {
      console.error('Failed to send notification:', notificationError)
    }

    return {
      type: 4,
      data: {
        content: `✅ Successfully deleted comment **${commentId}**`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Delete command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to delete comment: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleBanCommand(supabase: any, options: any, registration: any) {
  try {
    const targetUserId = options.find(opt => opt.name === 'user_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value
    const shadow = options.find(opt => opt.name === 'shadow')?.value || false

    if (!targetUserId || !reason) {
      return {
        type: 4,
        data: {
          content: '❌ User ID and reason are required',
          flags: 64
        }
      }
    }

    // Check permissions
    if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can ban users',
          flags: 64
        }
      }
    }

    // Update all comments by the user
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

    const action = shadow ? 'shadow banned' : 'banned'
    
    return {
      type: 4,
      data: {
        content: `✅ Successfully ${action} user **${targetUserId}**\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Action by: ${registration.platform_user_id}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Ban command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to ban user: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleWarnCommand(supabase: any, options: any, registration: any) {
  try {
    const targetUserId = options.find(opt => opt.name === 'user_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value

    if (!targetUserId || !reason) {
      return {
        type: 4,
        data: {
          content: '❌ User ID and reason are required',
          flags: 64
        }
      }
    }

    // Check permissions
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Moderators and above can warn users',
          flags: 64
        }
      }
    }

    // Get current warning count
    const { data: userComments } = await supabase
      .from('comments')
      .select('user_warnings')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(1)

    const currentWarnings = userComments?.[0]?.user_warnings || 0
    const newWarnings = currentWarnings + 1

    // Update all comments by the user
    const { error } = await supabase
      .from('comments')
      .update({
        user_warnings: newWarnings,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: 'warning'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    // Check for auto-mute/ban thresholds
    const { data: autoMuteThreshold } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'auto_mute_threshold')
      .single()

    const { data: autoBanThreshold } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'auto_ban_threshold')
      .single()

    const muteThreshold = autoMuteThreshold ? parseInt(autoMuteThreshold.value) : 5
    const banThreshold = autoBanThreshold ? parseInt(autoBanThreshold.value) : 10

    let autoAction = ''
    if (newWarnings >= banThreshold) {
      // Auto-ban
      await supabase
        .from('comments')
        .update({ user_banned: true })
        .eq('user_id', targetUserId)
      autoAction = '\n⚠️ **Auto-ban triggered**'
    } else if (newWarnings >= muteThreshold) {
      // Auto-mute for 24 hours
      const muteUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      await supabase
        .from('comments')
        .update({ user_muted_until: muteUntil })
        .eq('user_id', targetUserId)
      autoAction = '\n🔇 **Auto-mute triggered (24 hours)**'
    }

    return {
      type: 4,
      data: {
        content: `⚠️ User **${targetUserId}** warned (${newWarnings}/${banThreshold} warnings)\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Warned by: ${registration.platform_user_id}${autoAction}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Warn command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to warn user: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handlePinCommand(supabase: any, options: any, registration: any) {
  try {
    const commentId = options.find(opt => opt.name === 'comment_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value || 'No reason provided'

    if (!commentId) {
      return {
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }
    }

    // Check permissions
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Moderators and above can pin comments',
          flags: 64
        }
      }
    }

    const { data: comment, error } = await supabase
      .from('comments')
      .select('id, content, username, pinned')
      .eq('id', commentId)
      .single()

    if (error || !comment) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** not found`,
          flags: 64
        }
      }
    }

    if (comment.pinned) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** is already pinned`,
          flags: 64
        }
      }
    }

    const { error: updateError } = await supabase
      .from('comments')
      .update({
        pinned: true,
        pinned_at: new Date().toISOString(),
        pinned_by: registration.platform_user_id
      })
      .eq('id', commentId)

    if (updateError) throw updateError

    return {
      type: 4,
      data: {
        content: `📌 Successfully pinned comment **${commentId}**\n` +
          `💬 Content: ${comment.content.substring(0, 100)}${comment.content.length > 100 ? '...' : ''}\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Pinned by: ${registration.platform_user_id}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Pin command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to pin comment: ${error.message}`,
        flags: 64
      }
    }
  }
}

// Additional command handlers
async function handleUnbanCommand(supabase: any, options: any, registration: any) {
  try {
    const targetUserId = options.find(opt => opt.name === 'user_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value || 'No reason provided'

    if (!targetUserId) {
      return {
        type: 4,
        data: {
          content: '❌ User ID is required',
          flags: 64
        }
      }
    }

    if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can unban users',
          flags: 64
        }
      }
    }

    const { error } = await supabase
      .from('comments')
      .update({
        user_banned: false,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: 'unban'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return {
      type: 4,
      data: {
        content: `✅ Successfully unbanned user **${targetUserId}**\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Action by: ${registration.platform_user_id}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Unban command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to unban user: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handlePromoteCommand(supabase: any, options: any, registration: any) {
  try {
    const targetUserId = options.find(opt => opt.name === 'user_id')?.value
    const newRole = options.find(opt => opt.name === 'role')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value || 'Promotion'

    if (!targetUserId || !newRole) {
      return {
        type: 4,
        data: {
          content: '❌ User ID and role are required',
          flags: 64
        }
      }
    }

    if (!['super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Super Admins can promote users',
          flags: 64
        }
      }
    }

    // Update config with new role
    const roleKey = `${newRole}_users`
    const { data: currentConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', roleKey)
      .single()

    const currentUsers = currentConfig ? JSON.parse(currentConfig.value) : []
    if (!currentUsers.includes(targetUserId)) {
      currentUsers.push(targetUserId)
      
      await supabase
        .from('config')
        .update({ value: JSON.stringify(currentUsers) })
        .eq('key', roleKey)
    }

    return {
      type: 4,
      data: {
        content: `✅ Successfully promoted **${targetUserId}** to **${newRole}**\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Promoted by: ${registration.platform_user_id}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Promote command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to promote user: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleMuteCommand(supabase: any, options: any, registration: any) {
  try {
    const targetUserId = options.find(opt => opt.name === 'user_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value
    const duration = options.find(opt => opt.name === 'duration')?.value || 24

    if (!targetUserId || !reason) {
      return {
        type: 4,
        data: {
          content: '❌ User ID and reason are required',
          flags: 64
        }
      }
    }

    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Moderators and above can mute users',
          flags: 64
        }
      }
    }

    const muteUntil = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString()

    const { error } = await supabase
      .from('comments')
      .update({
        user_muted_until: muteUntil,
        moderated: true,
        moderated_at: new Date().toISOString(),
        moderated_by: registration.platform_user_id,
        moderation_reason: reason,
        moderation_action: 'mute'
      })
      .eq('user_id', targetUserId)

    if (error) throw error

    return {
      type: 4,
      data: {
        content: `🔇 Successfully muted user **${targetUserId}**\n` +
          `⏰ Duration: ${duration} hours\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Muted by: ${registration.platform_user_id}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Mute command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to mute user: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleUnpinCommand(supabase: any, options: any, registration: any) {
  try {
    const commentId = options.find(opt => opt.name === 'comment_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value || 'No reason provided'

    if (!commentId) {
      return {
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }
    }

    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Moderators and above can unpin comments',
          flags: 64
        }
      }
    }

    const { data: comment, error } = await supabase
      .from('comments')
      .select('id, content, username, pinned')
      .eq('id', commentId)
      .single()

    if (error || !comment) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** not found`,
          flags: 64
        }
      }
    }

    if (!comment.pinned) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** is not pinned`,
          flags: 64
        }
      }
    }

    const { error: updateError } = await supabase
      .from('comments')
      .update({
        pinned: false,
        pinned_at: null,
        pinned_by: null
      })
      .eq('id', commentId)

    if (updateError) throw updateError

    return {
      type: 4,
      data: {
        content: `📌 Successfully unpinned comment **${commentId}**\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Unpinned by: ${registration.platform_user_id}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Unpin command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to unpin comment: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleUserCommand(supabase: any, options: any) {
  try {
    const userId = options.find(opt => opt.name === 'user_id')?.value

    if (!userId) {
      return {
        type: 4,
        data: {
          content: '❌ User ID is required',
          flags: 64
        }
      }
    }

    const { data: userComments } = await supabase
      .from('comments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!userComments || userComments.length === 0) {
      return {
        type: 4,
        data: {
          content: `❌ No comments found for user **${userId}**`,
          flags: 64
        }
      }
    }

    const userRole = await getUserRole(supabase, userId)
    const totalComments = userComments.length
    const totalUpvotes = userComments.reduce((sum, comment) => sum + comment.upvotes, 0)
    const totalDownvotes = userComments.reduce((sum, comment) => sum + comment.downvotes, 0)
    const warningCount = userComments[0]?.user_warnings || 0
    const isBanned = userComments[0]?.user_banned || false
    const isMuted = userComments[0]?.user_muted_until && new Date(userComments[0].user_muted_until) > new Date()

    let status = '✅ Active'
    if (isBanned) status = '🚫 Banned'
    else if (isMuted) status = '🔇 Muted'
    else if (warningCount > 0) status = `⚠️ ${warningCount} warnings`

    return {
      type: 4,
      data: {
        content: `👤 **User Information for ${userId}**\n\n` +
          `🎭 **Role:** ${userRole}\n` +
          `📊 **Status:** ${status}\n` +
          `💬 **Comments:** ${totalComments}\n` +
          `👍 **Upvotes:** ${totalUpvotes}\n` +
          `👎 **Downvotes:** ${totalDownvotes}\n` +
          `⚠️ **Warnings:** ${warningCount}\n\n` +
          `📝 **Recent Comments:** ${userComments.slice(0, 3).map(c => `• ${c.content.substring(0, 50)}...`).join('\n')}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('User command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to get user information: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleCommentCommand(supabase: any, options: any) {
  try {
    const commentId = options.find(opt => opt.name === 'comment_id')?.value

    if (!commentId) {
      return {
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }
    }

    const { data: comment, error } = await supabase
      .from('comments')
      .select('*')
      .eq('id', commentId)
      .single()

    if (error || !comment) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** not found`,
          flags: 64
        }
      }
    }

    const status = comment.deleted ? '🚫 Deleted' : 
                   comment.pinned ? '📌 Pinned' : 
                   comment.locked ? '🔒 Locked' : '✅ Active'

    return {
      type: 4,
      data: {
        content: `💬 **Comment Information**\n\n` +
          `🆔 **ID:** ${comment.id}\n` +
          `👤 **User:** ${comment.username} (${comment.user_id})\n` +
          `🎯 **Media:** ${comment.media_title} (${comment.media_type})\n` +
          `📊 **Status:** ${status}\n` +
          `👍 **Votes:** ${comment.upvotes}↑ ${comment.downvotes}↓ (Score: ${comment.vote_score})\n` +
          `📅 **Created:** ${new Date(comment.created_at).toLocaleDateString()}\n` +
          `${comment.edited ? `✏️ **Edited:** ${new Date(comment.edited_at).toLocaleDateString()}\n` : ''}` +
          `📝 **Content:** ${comment.content.substring(0, 200)}${comment.content.length > 200 ? '...' : ''}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Comment command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to get comment information: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleUnmuteCommand(supabase: any, options: any, registration: any) {
  try {
    const targetUserId = options.find(opt => opt.name === 'user_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value || 'No reason provided'

    if (!targetUserId) {
      return {
        type: 4,
        data: {
          content: '❌ User ID is required',
          flags: 64
        }
      }
    }

    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Moderators and above can unmute users',
          flags: 64
        }
      }
    }

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

    return {
      type: 4,
      data: {
        content: `🔊 Successfully unmuted user **${targetUserId}**\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Unmuted by: ${registration.platform_user_id}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Unmute command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to unmute user: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleShadowbanCommand(supabase: any, options: any, registration: any) {
  try {
    const targetUserId = options.find(opt => opt.name === 'user_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value

    if (!targetUserId || !reason) {
      return {
        type: 4,
        data: {
          content: '❌ User ID and reason are required',
          flags: 64
        }
      }
    }

    if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can shadow ban users',
          flags: 64
        }
      }
    }

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

    return {
      type: 4,
      data: {
        content: `👻 Successfully shadow banned user **${targetUserId}**\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Action by: ${registration.platform_user_id}\n\n` +
          `⚠️ User can still post but comments are hidden from others`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Shadowban command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to shadow ban user: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleUnshadowbanCommand(supabase: any, options: any, registration: any) {
  try {
    const targetUserId = options.find(opt => opt.name === 'user_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value || 'No reason provided'

    if (!targetUserId) {
      return {
        type: 4,
        data: {
          content: '❌ User ID is required',
          flags: 64
        }
      }
    }

    if (!['admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can remove shadow bans',
          flags: 64
        }
      }
    }

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

    return {
      type: 4,
      data: {
        content: `✅ Successfully removed shadow ban from user **${targetUserId}**\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Action by: ${registration.platform_user_id}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Unshadowban command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to remove shadow ban: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleLockCommand(supabase: any, options: any, registration: any) {
  try {
    const commentId = options.find(opt => opt.name === 'comment_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value || 'No reason provided'

    if (!commentId) {
      return {
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }
    }

    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Moderators and above can lock comments',
          flags: 64
        }
      }
    }

    const { data: comment, error } = await supabase
      .from('comments')
      .select('id, content, username, locked')
      .eq('id', commentId)
      .single()

    if (error || !comment) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** not found`,
          flags: 64
        }
      }
    }

    if (comment.locked) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** is already locked`,
          flags: 64
        }
      }
    }

    const { error: updateError } = await supabase
      .from('comments')
      .update({
        locked: true,
        locked_at: new Date().toISOString(),
        locked_by: registration.platform_user_id
      })
      .eq('id', commentId)

    if (updateError) throw updateError

    return {
      type: 4,
      data: {
        content: `🔒 Successfully locked comment **${commentId}**\n` +
          `💬 Content: ${comment.content.substring(0, 100)}${comment.content.length > 100 ? '...' : ''}\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Locked by: ${registration.platform_user_id}\n\n` +
          `⚠️ No more replies can be made to this comment`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Lock command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to lock comment: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleUnlockCommand(supabase: any, options: any, registration: any) {
  try {
    const commentId = options.find(opt => opt.name === 'comment_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value || 'No reason provided'

    if (!commentId) {
      return {
        type: 4,
        data: {
          content: '❌ Comment ID is required',
          flags: 64
        }
      }
    }

    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Moderators and above can unlock comments',
          flags: 64
        }
      }
    }

    const { data: comment, error } = await supabase
      .from('comments')
      .select('id, content, username, locked')
      .eq('id', commentId)
      .single()

    if (error || !comment) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** not found`,
          flags: 64
        }
      }
    }

    if (!comment.locked) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** is not locked`,
          flags: 64
        }
      }
    }

    const { error: updateError } = await supabase
      .from('comments')
      .update({
        locked: false,
        locked_at: null,
        locked_by: null
      })
      .eq('id', commentId)

    if (updateError) throw updateError

    return {
      type: 4,
      data: {
        content: `🔓 Successfully unlocked comment **${commentId}**\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Unlocked by: ${registration.platform_user_id}\n\n` +
          `✅ Replies are now allowed`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Unlock command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to unlock comment: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleReportCommand(supabase: any, options: any, registration: any) {
  try {
    const commentId = options.find(opt => opt.name === 'comment_id')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value
    const notes = options.find(opt => opt.name === 'notes')?.value || ''

    if (!commentId || !reason) {
      return {
        type: 4,
        data: {
          content: '❌ Comment ID and reason are required',
          flags: 64
        }
      }
    }

    const { data: comment, error } = await supabase
      .from('comments')
      .select('id, user_id, reported, report_count, reports')
      .eq('id', commentId)
      .single()

    if (error || !comment) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** not found`,
          flags: 64
        }
      }
    }

    if (comment.user_id === registration.platform_user_id) {
      return {
        type: 4,
        data: {
          content: '❌ You cannot report your own comment',
          flags: 64
        }
      }
    }

    // Check if already reported by this user
    const existingReports = comment.reports ? JSON.parse(comment.reports) : []
    const alreadyReported = existingReports.some(report => report.reporter_id === registration.platform_user_id)

    if (alreadyReported) {
      return {
        type: 4,
        data: {
          content: '❌ You have already reported this comment',
          flags: 64
        }
      }
    }

    // Add new report
    const newReport = {
      id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      reporter_id: registration.platform_user_id,
      reporter_username: registration.discord_username,
      reason: reason,
      notes: notes,
      created_at: new Date().toISOString(),
      status: 'pending'
    }

    existingReports.push(newReport)
    const newReportCount = comment.report_count + 1

    const { error: updateError } = await supabase
      .from('comments')
      .update({
        reported: true,
        report_count: newReportCount,
        reports: JSON.stringify(existingReports),
        report_status: 'pending'
      })
      .eq('id', commentId)

    if (updateError) throw updateError

    return {
      type: 4,
      data: {
        content: `🚨 Successfully reported comment **${commentId}**\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Reported by: ${registration.discord_username}\n` +
          `📊 Total reports: ${newReportCount}\n\n` +
          `✅ Moderators will review this report`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Report command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to report comment: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleResolveCommand(supabase: any, options: any, registration: any) {
  try {
    const commentId = options.find(opt => opt.name === 'comment_id')?.value
    const reporterId = options.find(opt => opt.name === 'reporter_id')?.value
    const resolution = options.find(opt => opt.name === 'resolution')?.value
    const notes = options.find(opt => opt.name === 'notes')?.value || ''

    if (!commentId || !reporterId || !resolution) {
      return {
        type: 4,
        data: {
          content: '❌ Comment ID, reporter ID, and resolution are required',
          flags: 64
        }
      }
    }

    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Moderators and above can resolve reports',
          flags: 64
        }
      }
    }

    const { data: comment, error } = await supabase
      .from('comments')
      .select('id, reports, report_count')
      .eq('id', commentId)
      .single()

    if (error || !comment) {
      return {
        type: 4,
        data: {
          content: `❌ Comment **${commentId}** not found`,
          flags: 64
        }
      }
    }

    const reports = comment.reports ? JSON.parse(comment.reports) : []
    const targetReport = reports.find(report => report.reporter_id === reporterId)

    if (!targetReport) {
      return {
        type: 4,
        data: {
          content: `❌ No report found from user **${reporterId}** on comment **${commentId}**`,
          flags: 64
        }
      }
    }

    // Update the specific report
    targetReport.status = resolution
    targetReport.reviewed_by = registration.platform_user_id
    targetReport.reviewed_at = new Date().toISOString()
    targetReport.review_notes = notes

    // Check if all reports are resolved
    const allResolved = reports.every(report => 
      report.status === 'resolved' || report.status === 'dismissed'
    )

    const { error: updateError } = await supabase
      .from('comments')
      .update({
        reports: JSON.stringify(reports),
        report_status: allResolved ? 'resolved' : 'pending'
      })
      .eq('id', commentId)

    if (updateError) throw updateError

    const resolutionEmoji = resolution === 'resolved' ? '✅' : '❌'

    return {
      type: 4,
      data: {
        content: `${resolutionEmoji} Successfully ${resolution} report on comment **${commentId}**\n` +
          `👤 Reporter: ${reporterId}\n` +
          `📝 Notes: ${notes}\n` +
          `👤 Resolved by: ${registration.platform_user_id}\n` +
          `📊 Overall status: ${allResolved ? 'All reports resolved' : 'Still has pending reports'}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Resolve command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to resolve report: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleQueueCommand(supabase: any) {
  try {
    const { data: reportedComments } = await supabase
      .from('comments')
      .select('id, content, username, user_id, report_count, reports, created_at')
      .eq('reported', true)
      .eq('report_status', 'pending')
      .order('report_count', { ascending: false })
      .limit(10)

    if (!reportedComments || reportedComments.length === 0) {
      return {
        type: 4,
        data: {
          content: '📋 **Moderation Queue**\n\n✅ No pending reports to review!',
          flags: 64
        }
      }
    }

    let queueMessage = `📋 **Moderation Queue (${reportedComments.length} pending)**\n\n`

    reportedComments.forEach((comment, index) => {
      const reports = comment.reports ? JSON.parse(comment.reports) : []
      const pendingReports = reports.filter(r => r.status === 'pending')
      const latestReport = pendingReports[pendingReports.length - 1]

      queueMessage += `${index + 1}. **Comment ${comment.id}** (${comment.report_count} reports)\n`
      queueMessage += `   👤 User: ${comment.username} (${comment.user_id})\n`
      queueMessage += `   📝 Content: ${comment.content.substring(0, 80)}${comment.content.length > 80 ? '...' : ''}\n`
      queueMessage += `   🚨 Latest: ${latestReport?.reason || 'Unknown'} by ${latestReport?.reporter_username || 'Unknown'}\n`
      queueMessage += `   📅 Created: ${new Date(comment.created_at).toLocaleDateString()}\n\n`
    })

    if (queueMessage.length > 1900) {
      queueMessage = queueMessage.substring(0, 1900) + '...\n\n(Truncated due to length)'
    }

    return {
      type: 4,
      data: {
        content: queueMessage,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Queue command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to get moderation queue: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleDemoteCommand(supabase: any, options: any, registration: any) {
  try {
    const targetUserId = options.find(opt => opt.name === 'user_id')?.value
    const newRole = options.find(opt => opt.name === 'role')?.value
    const reason = options.find(opt => opt.name === 'reason')?.value || 'Demotion'

    if (!targetUserId || !newRole) {
      return {
        type: 4,
        data: {
          content: '❌ User ID and role are required',
          flags: 64
        }
      }
    }

    if (!['super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Super Admins can demote users',
          flags: 64
        }
      }
    }

    // Remove from all role lists first
    const roleKeys = ['moderator_users', 'admin_users', 'super_admin_users']
    for (const roleKey of roleKeys) {
      const { data: currentConfig } = await supabase
        .from('config')
        .select('value')
        .eq('key', roleKey)
        .single()

      if (currentConfig) {
        const currentUsers = JSON.parse(currentConfig.value)
        const updatedUsers = currentUsers.filter((id: string) => id !== targetUserId)
        
        await supabase
          .from('config')
          .update({ value: JSON.stringify(updatedUsers) })
          .eq('key', roleKey)
      }
    }

    // Add to new role if not 'user'
    if (newRole !== 'user') {
      const roleKey = `${newRole}_users`
      const { data: currentConfig } = await supabase
        .from('config')
        .select('value')
        .eq('key', roleKey)
        .single()

      const currentUsers = currentConfig ? JSON.parse(currentConfig.value) : []
      if (!currentUsers.includes(targetUserId)) {
        currentUsers.push(targetUserId)
        
        await supabase
          .from('config')
          .update({ value: JSON.stringify(currentUsers) })
          .eq('key', roleKey)
      }
    }

    return {
      type: 4,
      data: {
        content: `⬇️ Successfully demoted **${targetUserId}** to **${newRole}**\n` +
          `📝 Reason: ${reason}\n` +
          `👤 Demoted by: ${registration.platform_user_id}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Demote command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to demote user: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleConfigCommand(supabase: any, options: any, registration: any) {
  try {
    const action = options.find(opt => opt.name === 'action')?.value
    const key = options.find(opt => opt.name === 'key')?.value
    const value = options.find(opt => opt.name === 'value')?.value

    if (!action) {
      return {
        type: 4,
        data: {
          content: '❌ Action is required',
          flags: 64
        }
      }
    }

    if (!['super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Super Admins can manage configuration',
          flags: 64
        }
      }
    }

    switch (action) {
      case 'view':
        if (key) {
          // View specific config
          const { data: config } = await supabase
            .from('config')
            .select('value, updated_at')
            .eq('key', key)
            .single()

          if (!config) {
            return {
              type: 4,
              data: {
                content: `❌ Configuration key **${key}** not found`,
                flags: 64
              }
            }
          }

          return {
            type: 4,
            data: {
              content: `⚙️ **Configuration: ${key}**\n\n` +
                `📝 Value: \`${config.value}\`\n` +
                `📅 Updated: ${new Date(config.updated_at).toLocaleString()}`,
              flags: 64
            }
          }
        } else {
          // View all config
          const { data: allConfig } = await supabase
            .from('config')
            .select('key, value, updated_at')
            .order('key')

          let configMessage = '⚙️ **System Configuration**\n\n'
          allConfig.forEach(config => {
            configMessage += `**${config.key}:** \`${config.value}\`\n`
          })

          return {
            type: 4,
            data: {
              content: configMessage,
              flags: 64
            }
          }
        }

      case 'update':
        if (!key || !value) {
          return {
            type: 4,
            data: {
              content: '❌ Key and value are required for update',
              flags: 64
            }
          }
        }

        const { error: updateError } = await supabase
          .from('config')
          .update({ value: value })
          .eq('key', key)

        if (updateError) throw updateError

        return {
          type: 4,
          data: {
            content: `✅ Successfully updated configuration\n` +
              `🔑 Key: **${key}**\n` +
              `📝 New Value: \`${value}\`\n` +
              `👤 Updated by: ${registration.platform_user_id}`,
            flags: 64
          }
        }

      default:
        return {
          type: 4,
          data: {
            content: '❌ Invalid action. Use: view or update',
            flags: 64
          }
        }
    }
  } catch (error) {
    console.error('Config command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to manage configuration: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleSyncCommand(supabase: any, registration: any) {
  try {
    if (!['super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Super Admins can sync commands',
          flags: 64
        }
      }
    }

    // Get Discord config from database
    const { data: guildIdConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_guild_id')
      .single()

    if (!guildIdConfig?.value) {
      return {
        type: 4,
        data: {
          content: '❌ Discord guild ID not configured',
          flags: 64
        }
      }
    }

    const guildId = guildIdConfig.value
    const results = await syncCommands(supabase, [guildId])

    return {
      type: 4,
      data: {
        content: `🔄 **Command Sync Results:**\n\n${results.join('\n')}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Sync command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to sync commands: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleSyncMultiCommand(supabase: any, registration: any) {
  try {
    if (!['super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Super Admins can sync commands to multiple servers',
          flags: 64
        }
      }
    }

    // Get multiple guild IDs from config
    const { data: guildIdsConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_guild_ids')
      .single()

    let targetGuildIds: string[] = []
    if (guildIdsConfig?.value) {
      try {
        targetGuildIds = JSON.parse(guildIdsConfig.value)
      } catch {
        targetGuildIds = guildIdsConfig.value.split(',').map(id => id.trim()).filter(id => id)
      }
    }

    if (targetGuildIds.length === 0) {
      return {
        type: 4,
        data: {
          content: '❌ No guild IDs configured for multi-sync\n' +
            'Configure `discord_guild_ids` in config with multiple guild IDs',
          flags: 64
        }
      }
    }

    const results = await syncCommands(supabase, targetGuildIds)

    return {
      type: 4,
      data: {
        content: `🔄 **Multi-Server Sync Results:**\n\n` +
          `📊 Synced to ${targetGuildIds.length} servers\n\n` +
          `${results.join('\n')}`,
        flags: 64
      }
    }
  } catch (error) {
    console.error('Sync-multi command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to sync commands to multiple servers: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleWebhooksCommand(supabase: any, options: any, registration: any) {
  try {
    if (!['super_admin', 'owner'].includes(registration.user_role)) {
      return {
        type: 4,
        data: {
          content: '❌ Only Super Admins can manage webhooks',
          flags: 64
        }
      }
    }

    const action = options.find(opt => opt.name === 'action')?.value
    const webhookUrl = options.find(opt => opt.name === 'webhook_url')?.value

    switch (action) {
      case 'list':
        const { data: webhookConfig } = await supabase
          .from('config')
          .select('value')
          .eq('key', 'discord_webhook_urls')
          .single()

        let webhookUrls: string[] = []
        if (webhookConfig?.value) {
          try {
            webhookUrls = JSON.parse(webhookConfig.value)
          } catch {
            webhookUrls = webhookConfig.value.split(',').map(url => url.trim()).filter(url => url)
          }
        }

        const webhookList = webhookUrls.map((url, index) => {
          const shortUrl = url.length > 50 ? url.substring(0, 47) + '...' : url
          return `${index + 1}. ${shortUrl}`
        }).join('\n')

        return {
          type: 4,
          data: {
            content: `📡 **Configured Webhooks (${webhookUrls.length})**\n\n${webhookList || 'No webhooks configured'}`,
            flags: 64
          }
        }

      case 'add':
        if (!webhookUrl) {
          return {
            type: 4,
            data: {
              content: '❌ Webhook URL is required for add action',
              flags: 64
            }
          }
        }

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

        if (!currentUrls.includes(webhookUrl)) {
          currentUrls.push(webhookUrl)
          
          await supabase
            .from('config')
            .update({ value: JSON.stringify(currentUrls) })
            .eq('key', 'discord_webhook_urls')

          return {
            type: 4,
            data: {
              content: `✅ Webhook added successfully\nTotal webhooks: ${currentUrls.length}`,
              flags: 64
            }
          }
        } else {
          return {
            type: 4,
            data: {
              content: '⚠️ This webhook is already configured',
              flags: 64
            }
          }
        }

      case 'test':
        try {
          const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
          const testResult = await sendDiscordNotification(supabase, {
            type: 'moderation_action',
            user: { id: 'test', username: 'Test User' },
            moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
            reason: 'Test notification',
            metadata: { action: 'webhook test' }
          })

          if (testResult.success) {
            return {
              type: 4,
              data: {
                content: `✅ Test notification sent successfully\nSent to: ${testResult.successful}/${testResult.totalWebhooks} webhooks`,
                flags: 64
              }
            }
          } else {
            return {
              type: 4,
              data: {
                content: `❌ Test notification failed\nSent to: ${testResult.successful}/${testResult.totalWebhooks} webhooks\nErrors: ${testResult.failed} failed`,
                flags: 64
              }
            }
          }
        } catch (notificationError) {
          return {
            type: 4,
            data: {
              content: `❌ Test notification failed: ${notificationError.message}`,
              flags: 64
            }
          }
        }

      default:
        return {
          type: 4,
          data: {
            content: '❌ Unknown action. Use: list, add, remove, or test',
            flags: 64
          }
        }
    }
  } catch (error) {
    console.error('Webhooks command error:', error)
    return {
      type: 4,
      data: {
        content: `❌ Failed to manage webhooks: ${error.message}`,
        flags: 64
      }
    }
  }
}

async function handleHelpCommand(registration: any) {
  const userRole = registration.user_role || 'user'
  
  let commands = '**📖 Available Commands:**\n\n'
  
  // Basic commands for everyone
  commands += '**🔧 Basic Commands:**\n'
  commands += '`/register` - Register your Discord account\n'
  commands += '`/stats` - View system statistics\n'
  commands += '`/user <user_id>` - Get user information\n'
  commands += '`/comment <comment_id>` - Get comment information\n'
  commands += '`/report <comment_id> <reason>` - Report a comment\n'
  commands += '`/help` - Show this help message\n\n'

  // Moderator+ commands
  if (['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
    commands += '**🛡️ Moderator Commands:**\n'
    commands += '`/warn <user_id> <reason>` - Warn a user\n'
    commands += '`/mute <user_id> <reason> [duration]` - Mute a user\n'
    commands += '`/unmute <user_id> [reason]` - Unmute a user\n'
    commands += '`/pin <comment_id> [reason]` - Pin a comment\n'
    commands += '`/unpin <comment_id> [reason]` - Unpin a comment\n'
    commands += '`/lock <comment_id> [reason]` - Lock a comment thread\n'
    commands += '`/unlock <comment_id> [reason]` - Unlock a comment thread\n'
    commands += '`/resolve <comment_id> <reporter_id> <resolution>` - Resolve a report\n'
    commands += '`/queue` - View moderation queue\n'
    commands += '`/delete <comment_id>` - Delete a comment (own or any as mod)\n\n'
  }

  // Admin+ commands
  if (['admin', 'super_admin', 'owner'].includes(userRole)) {
    commands += '**👑 Admin Commands:**\n'
    commands += '`/ban <user_id> <reason> [shadow]` - Ban a user\n'
    commands += '`/unban <user_id> [reason]` - Unban a user\n'
    commands += '`/shadowban <user_id> <reason>` - Shadow ban a user\n'
    commands += '`/unshadowban <user_id> [reason]` - Remove shadow ban\n'
    commands += '`/config <action> [key] [value]` - Manage configuration\n'
    commands += '`/sync` - Sync Discord commands\n'
    commands += '`/sync-multi` - Sync to multiple servers\n\n'
  }

  // Super Admin+ commands
  if (['super_admin', 'owner'].includes(userRole)) {
    commands += '**⚡ Super Admin Commands:**\n'
    commands += '`/promote <user_id> <role> [reason]` - Promote a user\n'
    commands += '`/demote <user_id> <role> [reason]` - Demote a user\n'
    commands += '`/sync-multi` - Sync to multiple servers\n'
    commands += '`/webhooks <action> [url]` - Manage webhooks\n'
  }

  commands += '\n**📝 Usage Tips:**\n'
  commands += '• Use `<>` for required parameters\n'
  commands += '• Use `[]` for optional parameters\n'
  commands += '• Your current role: **' + userRole + '**'

  return {
    type: 4,
    data: {
      content: commands,
      flags: 64
    }
  }
}

// Slash command definitions
function getSlashCommands() {
  return [
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
            { name: 'SIMKL', value: 'simkl' },
            { name: 'Other', value: 'other' }
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
      description: 'Ban a user (Admin+ only)',
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
      description: 'Unban a user (Admin+ only)',
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
      name: 'stats',
      description: 'View comment system statistics'
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
      description: 'Shadow ban a user (Admin+ only)',
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
      description: 'Remove shadow ban from user (Admin+ only)',
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
      name: 'sync',
      description: 'Sync Discord commands (Super Admin only)'
    },
    {
      name: 'sync-multi',
      description: 'Sync Discord commands to multiple servers (Super Admin only)'
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
            { name: 'test', value: 'test' }
          ]
        },
        {
          name: 'webhook_url',
          description: 'Webhook URL to add',
          type: 3,
          required: false
        }
      ]
    },
    {
      name: 'help',
      description: 'Show help information'
    }
  ]
}

// Main interaction handler
async function handleDiscordInteraction(supabase: any, body: any) {
  const commandName = body.data?.name
  const options = body.data?.options || []
  const member = body.member
  const discordUserId = member?.user?.id

  if (!discordUserId) {
    return {
      type: 4,
      data: {
        content: '❌ Discord user ID not found',
        flags: 64
      }
    }
  }

  // Register command doesn't require existing registration
  if (commandName === 'register') {
    return await handleRegisterCommand(supabase, options, member)
  }

  // Check user registration for all other commands
  const { data: registration } = await supabase
    .from('discord_users')
    .select('user_role, platform_user_id, platform_type, discord_username')
    .eq('discord_user_id', discordUserId)
    .eq('is_active', true)
    .single()

  if (!registration) {
    return {
      type: 4,
      data: {
        content: '❌ You need to register first using `/register`',
        flags: 64
      }
    }
  }

  // Update last command timestamp
  await supabase
    .from('discord_users')
    .update({ last_command_at: new Date().toISOString() })
    .eq('discord_user_id', discordUserId)

  // Handle commands
  switch (commandName) {
    case 'stats':
      return await handleStatsCommand(supabase)
    
    case 'delete':
      return await handleDeleteCommand(supabase, options, registration)
    
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
    
    case 'report':
      return await handleReportCommand(supabase, options, registration)
    
    case 'resolve':
      return await handleResolveCommand(supabase, options, registration)
    
    case 'queue':
      return await handleQueueCommand(supabase)
    
    case 'user':
      return await handleUserCommand(supabase, options)
    
    case 'comment':
      return await handleCommentCommand(supabase, options)
    
    case 'config':
      return await handleConfigCommand(supabase, options, registration)
    
    case 'sync':
      return await handleSyncCommand(supabase, registration)
    
    case 'sync-multi':
      return await handleSyncMultiCommand(supabase, registration)
    
    case 'webhooks':
      return await handleWebhooksCommand(supabase, options, registration)
    
    case 'help':
      return await handleHelpCommand(registration)
    
    default:
      return {
        type: 4,
        data: {
          content: '❌ Command not implemented yet',
          flags: 64
        }
      }
  }
}

// Sync commands function
async function syncCommands(supabase: any, guildIds: string[]) {
  try {
    // Get Discord config from database
    const { data: botTokenConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_bot_token')
      .single()

    const { data: clientIdConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_client_id')
      .single()

    const { data: publicKeyConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_public_key')
      .single()

    const botToken = botTokenConfig?.value
    const clientId = clientIdConfig?.value
    const publicKey = publicKeyConfig?.value

    if (!botToken || !clientId || !publicKey) {
      throw new Error('Missing Discord configuration in database')
    }

    const commands = getSlashCommands()
    const results = []

    for (const guildId of guildIds) {
      const response = await fetch(
        `${DISCORD_API_BASE}/applications/${clientId}/guilds/${guildId}/commands`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bot ${botToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(commands)
        }
      )

      if (response.ok) {
        results.push(`✅ Guild ${guildId}: Commands synced`)
      } else {
        const error = await response.text()
        results.push(`❌ Guild ${guildId}: ${error}`)
      }
    }

    return results
  } catch (error) {
    console.error('Sync commands error:', error)
    throw error
  }
}

// Main serve function
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get Discord config from database
    const { data: publicKeyConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_public_key')
      .single()

    const publicKey = publicKeyConfig?.value

    const signature = req.headers.get('x-signature-ed25519')
    const timestamp = req.headers.get('x-signature-timestamp')
    const rawBody = await req.text()

    // Handle PING request
    if (rawBody.includes('"type":1')) {
      if (publicKey && signature && timestamp) {
        const isValid = await verifyDiscordSignature(signature, timestamp, rawBody, publicKey)
        if (!isValid) {
          return new Response(
            JSON.stringify({ error: 'Invalid signature' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }
      return new Response(
        JSON.stringify({ type: 1 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify signature for interactions
    if (publicKey && signature && timestamp) {
      const isValid = await verifyDiscordSignature(signature, timestamp, rawBody, publicKey)
      if (!isValid) {
        return new Response(
          JSON.stringify({ error: 'Invalid signature' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    const body = JSON.parse(rawBody)

    // Handle slash command interaction
    if (body.type === 2) {
      const result = await handleDiscordInteraction(supabase, body)
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Handle other actions
    const { action } = body
    switch (action) {
      case 'sync_commands':
        const guildIds = body.guild_ids || []
        const syncResults = await syncCommands(supabase, guildIds)
        return new Response(
          JSON.stringify({ success: true, results: syncResults }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Discord bot error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})