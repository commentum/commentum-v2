import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyKey } from 'https://deno.land/x/discordeno@18.0.1/mod.ts'

const DISCORD_PUBLIC_KEY = Deno.env.get('DISCORD_PUBLIC_KEY')!
const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')!
const DISCORD_APPLICATION_ID = Deno.env.get('DISCORD_APPLICATION_ID')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Discord slash command definitions
const COMMANDS = {
  comment: {
    name: 'comment',
    description: 'Manage comments',
    options: [
      {
        name: 'action',
        description: 'Action to perform',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'delete', value: 'delete' },
          { name: 'pin', value: 'pin' },
          { name: 'unpin', value: 'unpin' },
          { name: 'lock', value: 'lock' },
          { name: 'unlock', value: 'unlock' }
        ]
      },
      {
        name: 'comment_id',
        description: 'Comment ID',
        type: 4, // INTEGER
        required: true
      },
      {
        name: 'reason',
        description: 'Reason for action (for warn/ban)',
        type: 3, // STRING
        required: false
      }
    ]
  },
  user: {
    name: 'user',
    description: 'Manage users',
    options: [
      {
        name: 'action',
        description: 'Action to perform',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'warn', value: 'warn' },
          { name: 'ban', value: 'ban' },
          { name: 'unban', value: 'unban' },
          { name: 'promote', value: 'promote' },
          { name: 'demote', value: 'demote' }
        ]
      },
      {
        name: 'user_id',
        description: 'User ID to manage',
        type: 3, // STRING
        required: true
      },
      {
        name: 'reason',
        description: 'Reason for action',
        type: 3, // STRING
        required: false
      },
      {
        name: 'duration',
        description: 'Duration in hours (for ban/mute)',
        type: 4, // INTEGER
        required: false
      }
    ]
  },
  reports: {
    name: 'reports',
    description: 'Manage reports',
    options: [
      {
        name: 'action',
        description: 'Action to perform',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'list', value: 'list' },
          { name: 'resolve', value: 'resolve' },
          { name: 'dismiss', value: 'dismiss' }
        ]
      },
      {
        name: 'report_id',
        description: 'Report ID (for resolve/dismiss)',
        type: 4, // INTEGER
        required: false
      }
    ]
  },
  roles: {
    name: 'roles',
    description: 'View all user roles (Moderator+)',
    options: []
  },
  config: {
    name: 'config',
    description: 'Configure Discord integration',
    options: [
      {
        name: 'action',
        description: 'Configuration action',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'setup', value: 'setup' },
          { name: 'verify', value: 'verify' },
          { name: 'approve', value: 'approve' },
          { name: 'revoke', value: 'revoke' },
          { name: 'register', value: 'register' }
        ]
      },
      {
        name: 'user_id',
        description: 'Commentum user ID',
        type: 3, // STRING
        required: false
      },
      {
        name: 'client_type',
        description: 'Platform (anilist, myanimelist, simkl, other)',
        type: 3, // STRING
        required: false,
        choices: [
          { name: 'AniList', value: 'anilist' },
          { name: 'MyAnimeList', value: 'myanimelist' },
          { name: 'SIMKL', value: 'simkl' },
          { name: 'Other', value: 'other' }
        ]
      },
      {
        name: 'discord_user',
        description: 'Discord user ID (for admin approval)',
        type: 3, // STRING
        required: false
      },
      {
        name: 'auth_token',
        description: 'Authentication token (for admin approval)',
        type: 3, // STRING
        required: false
      },
      {
        name: 'role',
        description: 'User role (for admin approval)',
        type: 3, // STRING,
        required: false,
        choices: [
          { name: 'User', value: 'user' },
          { name: 'Moderator', value: 'moderator' },
          { name: 'Admin', value: 'admin' },
          { name: 'Super Admin', value: 'super_admin' }
        ]
      },
      {
        name: 'guild_id',
        description: 'Guild ID (for command registration - leave empty for global)',
        type: 3, // STRING
        required: false
      }
    ]
  }
}

// Discord interaction handler
async function handleInteraction(interaction: any) {
  const { type, data, member, guild_id } = interaction

  // Handle ping
  if (type === 1) {
    return { type: 1 } // PONG
  }

  // Handle application command
  if (type === 2) {
    const userId = member.user.id
    const userMapping = await getOrCreateDiscordUser(userId, member.user.username, guild_id, member.roles)
    
    if (!userMapping || !userMapping.user_id) {
      return createErrorResponse('You need to configure your Discord user mapping first. Use `/config setup` to get started.')
    }

    const commandName = data.name
    const command = COMMANDS[commandName as keyof typeof COMMANDS]

    if (!command) {
      return createErrorResponse('Unknown command')
    }

    // Get user role from mapping
    const userRole = userMapping.user_role

    // Validate permissions
    const permissionCheck = validateCommandPermission(userRole, commandName, data.options)
    if (!permissionCheck.valid) {
      return createErrorResponse(permissionCheck.reason || 'Insufficient permissions')
    }

    // Execute command
    try {
      switch (commandName) {
        case 'comment':
          return await handleCommentCommand(data.options, userRole, userMapping)
        case 'user':
          return await handleUserCommand(data.options, userRole, userMapping)
        case 'reports':
          return await handleReportsCommand(data.options, userRole, userMapping)
        case 'roles':
          return await handleRolesCommand(data.options, userRole, userMapping)
        case 'config':
          return await handleConfigCommand(data.options, userRole, userMapping, guild_id, member.channel_id)
        default:
          return createErrorResponse('Unknown command')
      }
    } catch (error) {
      console.error('Command execution error:', error)
      return createErrorResponse('Command execution failed: ' + error.message)
    }
  }

  return { type: 4, data: { content: 'Unknown interaction type' } }
}

// Get Discord user role from Supabase
async function getDiscordUserRole(discordUserId: string, guildId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('discord_users')
      .select('user_role, user_id')
      .eq('discord_user_id', discordUserId)
      .eq('guild_id', guildId)
      .single()

    if (error || !data) {
      console.error('Error fetching Discord user role:', error)
      return null
    }

    return data.user_role
  } catch (error) {
    console.error('Error getting Discord user role:', error)
    return null
  }
}

// Validate command permissions
function validateCommandPermission(userRole: string, commandName: string, options: any[]): { valid: boolean; reason?: string } {
  const roleHierarchy = { 'user': 0, 'moderator': 1, 'admin': 2, 'super_admin': 3 }
  const userLevel = roleHierarchy[userRole as keyof typeof roleHierarchy] || 0

  switch (commandName) {
    case 'comment':
      const commentAction = options.find((opt: any) => opt.name === 'action')?.value
      if (['delete'].includes(commentAction) && userLevel < 2) {
        return { valid: false, reason: 'Only admins and super admins can delete comments' }
      }
      break
    case 'user':
      const userAction = options.find((opt: any) => opt.name === 'action')?.value
      if (['ban', 'promote', 'demote'].includes(userAction) && userLevel < 2) {
        return { valid: false, reason: 'Only admins and super admins can perform this action' }
      }
      if (['warn', 'unban'].includes(userAction) && userLevel < 1) {
        return { valid: false, reason: 'Only moderators and above can perform this action' }
      }
      break
    case 'reports':
      if (userLevel < 1) {
        return { valid: false, reason: 'Only moderators and above can manage reports' }
      }
      break
    case 'roles':
      if (userLevel < 1) {
        return { valid: false, reason: 'Only moderators and above can view roles' }
      }
      break
    case 'config':
      const configAction = options.find((opt: any) => opt.name === 'action')?.value
      if (['approve', 'revoke', 'register'].includes(configAction) && userLevel < 2) {
        return { valid: false, reason: 'Only admins and super admins can perform this action' }
      }
      // setup and verify are available to all users
      break
  }

  return { valid: true }
}

// Handle comment-related commands
async function handleCommentCommand(options: any[], userRole: string, userMapping: any) {
  const action = options.find((opt: any) => opt.name === 'action')?.value
  const commentId = options.find((opt: any) => opt.name === 'comment_id')?.value
  const reason = options.find((opt: any) => opt.name === 'reason')?.value

  try {
    switch (action) {
      case 'delete':
        await deleteComment(commentId, userRole)
        return createSuccessResponse(`Comment ${commentId} deleted successfully`)
      case 'pin':
        await pinComment(commentId, userRole)
        return createSuccessResponse(`Comment ${commentId} pinned successfully`)
      case 'unpin':
        await unpinComment(commentId, userRole)
        return createSuccessResponse(`Comment ${commentId} unpinned successfully`)
      case 'lock':
        await lockComment(commentId, userRole)
        return createSuccessResponse(`Comment ${commentId} locked successfully`)
      case 'unlock':
        await unlockComment(commentId, userRole)
        return createSuccessResponse(`Comment ${commentId} unlocked successfully`)
      case 'warn':
        if (!reason) return createErrorResponse('Reason is required for warn action')
        await warnCommentAuthor(commentId, reason, userRole)
        return createSuccessResponse(`Comment author warned for: ${reason}`)
      case 'ban':
        if (!reason) return createErrorResponse('Reason is required for ban action')
        await banCommentAuthor(commentId, reason, userRole)
        return createSuccessResponse(`Comment author banned for: ${reason}`)
      default:
        return createErrorResponse('Unknown comment action')
    }
  } catch (error) {
    console.error('Comment command error:', error)
    return createErrorResponse('Failed to execute comment command')
  }
}

// Handle user-related commands
async function handleUserCommand(options: any[], userRole: string, userMapping: any) {
  const action = options.find((opt: any) => opt.name === 'action')?.value
  const targetUserId = options.find((opt: any) => opt.name === 'user_id')?.value
  const reason = options.find((opt: any) => opt.name === 'reason')?.value
  const duration = options.find((opt: any) => opt.name === 'duration')?.value

  try {
    switch (action) {
      case 'warn':
        if (!reason) return createErrorResponse('Reason is required for warn action')
        await warnUser(targetUserId, reason, userRole)
        return createSuccessResponse(`User ${targetUserId} warned for: ${reason}`)
      case 'ban':
        if (!reason) return createErrorResponse('Reason is required for ban action')
        await banUser(targetUserId, reason, duration, userRole)
        return createSuccessResponse(`User ${targetUserId} banned for: ${reason}`)
      case 'unban':
        await unbanUser(targetUserId, userRole)
        return createSuccessResponse(`User ${targetUserId} unbanned`)
      case 'mute':
        if (!duration) return createErrorResponse('Duration is required for mute action')
        await muteUser(targetUserId, duration, userRole)
        return createSuccessResponse(`User ${targetUserId} muted for ${duration} hours`)
      case 'unmute':
        await unmuteUser(targetUserId, userRole)
        return createSuccessResponse(`User ${targetUserId} unmuted`)
      case 'promote':
        if (!reason) return createErrorResponse('Reason is required for promote action')
        await promoteUser(targetUserId, reason, userRole)
        return createSuccessResponse(`User ${targetUserId} promoted`)
      case 'demote':
        if (!reason) return createErrorResponse('Reason is required for demote action')
        await demoteUser(targetUserId, reason, userRole)
        return createSuccessResponse(`User ${targetUserId} demoted`)
      default:
        return createErrorResponse('Unknown user action')
    }
  } catch (error) {
    console.error('User command error:', error)
    return createErrorResponse('Failed to execute user command')
  }
}

// Handle reports-related commands
async function handleReportsCommand(options: any[], userRole: string, userMapping: any) {
  const action = options.find((opt: any) => opt.name === 'action')?.value
  const reportId = options.find((opt: any) => opt.name === 'report_id')?.value

  try {
    switch (action) {
      case 'list':
        const reports = await getPendingReports()
        const reportList = reports.map(r => `ID: ${r.id} - Comment: ${r.id} - Reports: ${r.report_count}`).join('\n')
        return createSuccessResponse(`**Pending Reports:**\n${reportList}`)
      case 'resolve':
        if (!reportId) return createErrorResponse('Report ID is required for resolve action')
        await resolveReport(reportId, userRole)
        return createSuccessResponse(`Report ${reportId} resolved`)
      case 'dismiss':
        if (!reportId) return createErrorResponse('Report ID is required for dismiss action')
        await dismissReport(reportId, userRole)
        return createSuccessResponse(`Report ${reportId} dismissed`)
      default:
        return createErrorResponse('Unknown reports action')
    }
  } catch (error) {
    console.error('Reports command error:', error)
    return createErrorResponse('Failed to execute reports command')
  }
}

// Handle roles command
async function handleRolesCommand(options: any[], userRole: string, userMapping: any) {
  try {
    const { data, error } = await supabase.functions.invoke('moderation', {
      body: {
        action: 'get_user_roles',
        user_id: userMapping.user_id,
        token: await getTokenForUser(userMapping)
      }
    })
    
    if (error) throw error
    
    const { super_admins, admins, moderators, total_users } = data
    
    let response = `**User Roles Summary** (${total_users} total):\n\n`
    
    if (super_admins.length > 0) {
      response += `👑 **Super Admins** (${super_admins.length}):\n${super_admins.join(', ')}\n\n`
    }
    
    if (admins.length > 0) {
      response += `🛡️ **Admins** (${admins.length}):\n${admins.join(', ')}\n\n`
    }
    
    if (moderators.length > 0) {
      response += `🔧 **Moderators** (${moderators.length}):\n${moderators.join(', ')}\n\n`
    }
    
    if (total_users === 0) {
      response = 'No users with special roles found.'
    }
    
    return createSuccessResponse(response)
  } catch (error) {
    console.error('Roles command error:', error)
    return createErrorResponse('Failed to fetch user roles')
  }
}

// Backend action functions (using existing Edge Functions)
async function deleteComment(commentId: number, userMapping: any) {
  const { data, error } = await supabase.functions.invoke('comments', {
    body: {
      action: 'delete',
      comment_id: commentId,
      user_id: userMapping.user_id,
      token: await getTokenForUser(userMapping)
    }
  })
  
  if (error) throw error
  return data
}

async function pinComment(commentId: number, userMapping: any) {
  const { data, error } = await supabase.functions.invoke('moderation', {
    body: {
      action: 'pin',
      target_id: commentId,
      target_type: 'comment',
      user_id: userMapping.user_id,
      token: await getTokenForUser(userMapping)
    }
  })
  
  if (error) throw error
  return data
}

async function unpinComment(commentId: number, userMapping: any) {
  const { data, error } = await supabase.functions.invoke('moderation', {
    body: {
      action: 'unpin',
      target_id: commentId,
      target_type: 'comment',
      user_id: userMapping.user_id,
      token: await getTokenForUser(userMapping)
    }
  })
  
  if (error) throw error
  return data
}

async function lockComment(commentId: number, userMapping: any) {
  const { data, error } = await supabase.functions.invoke('moderation', {
    body: {
      action: 'lock',
      target_id: commentId,
      target_type: 'comment',
      user_id: userMapping.user_id,
      token: await getTokenForUser(userMapping)
    }
  })
  
  if (error) throw error
  return data
}

async function unlockComment(commentId: number, userMapping: any) {
  const { data, error } = await supabase.functions.invoke('moderation', {
    body: {
      action: 'unlock',
      target_id: commentId,
      target_type: 'comment',
      user_id: userMapping.user_id,
      token: await getTokenForUser(userMapping)
    }
  })
  
  if (error) throw error
  return data
}

async function warnCommentAuthor(commentId: number, reason: string, userMapping: any) {
  // Get comment author first
  const { data: comment } = await supabase
    .from('comments')
    .select('user_id')
    .eq('id', commentId)
    .single()

  if (!comment) throw new Error('Comment not found')

  const { data, error } = await supabase.functions.invoke('moderation', {
    body: {
      action: 'warn',
      target_id: parseInt(comment.user_id),
      target_type: 'user',
      user_id: userMapping.user_id,
      token: await getTokenForUser(userMapping),
      reason: reason
    }
  })
  
  if (error) throw error
  return data
}

async function banCommentAuthor(commentId: number, reason: string, userMapping: any) {
  // Get comment author first
  const { data: comment } = await supabase
    .from('comments')
    .select('user_id')
    .eq('id', commentId)
    .single()

  if (!comment) throw new Error('Comment not found')

  const { data, error } = await supabase.functions.invoke('moderation', {
    body: {
      action: 'ban',
      target_id: parseInt(comment.user_id),
      target_type: 'user',
      user_id: userMapping.user_id,
      token: await getTokenForUser(userMapping),
      reason: reason
    }
  })
  
  if (error) throw error
  return data
}

async function warnUser(userId: string, reason: string, userMapping: any) {
  const { data, error } = await supabase.functions.invoke('moderation', {
    body: {
      action: 'warn',
      target_id: parseInt(userId),
      target_type: 'user',
      user_id: userMapping.user_id,
      token: await getTokenForUser(userMapping),
      reason: reason
    }
  })
  
  if (error) throw error
  return data
}

async function banUser(userId: string, reason: string, duration: number | undefined, userMapping: any) {
  const { data, error } = await supabase.functions.invoke('moderation', {
    body: {
      action: 'ban',
      target_id: parseInt(userId),
      target_type: 'user',
      user_id: userMapping.user_id,
      token: await getTokenForUser(userMapping),
      reason: reason,
      duration: duration
    }
  })
  
  if (error) throw error
  return data
}

async function unbanUser(userId: string, userMapping: any) {
  // This would need to be implemented in the moderation function
  // For now, we'll update the user_banned flag directly
  const { data, error } = await supabase
    .from('comments')
    .update({ user_banned: false })
    .eq('user_id', userId)
  
  if (error) throw error
  return data
}

async function muteUser(userId: string, duration: number, userMapping: any) {
  const muteUntil = new Date(Date.now() + duration * 60 * 60 * 1000).toISOString()
  
  const { data, error } = await supabase
    .from('comments')
    .update({ user_muted_until: muteUntil })
    .eq('user_id', userId)
  
  if (error) throw error
  return data
}

async function unmuteUser(userId: string, userMapping: any) {
  const { data, error } = await supabase
    .from('comments')
    .update({ user_muted_until: null })
    .eq('user_id', userId)
  
  if (error) throw error
  return data
}

async function getPendingReports() {
  const { data, error } = await supabase
    .from('comments')
    .select('id, report_count, reports')
    .eq('report_status', 'pending')
    .gt('report_count', 0)
    .limit(10)
  
  if (error) throw error
  return data
}

async function resolveReport(reportId: number, userMapping: any) {
  const { data, error } = await supabase.functions.invoke('reports', {
    body: {
      action: 'resolve',
      report_id: reportId,
      user_id: userMapping.user_id,
      token: await getTokenForUser(userMapping)
    }
  })
  
  if (error) throw error
  return data
}

async function dismissReport(reportId: number, userRole: string) {
  // Update report status to dismissed
  const { data, error } = await supabase
    .from('comments')
    .update({ report_status: 'dismissed' })
    .eq('id', reportId)
  
  if (error) throw error
  return data
}

async function promoteUser(userId: string, reason: string, userMapping: any) {
  const { data, error } = await supabase.functions.invoke('moderation', {
    body: {
      action: 'promote_user',
      target_user_id: userId,
      moderator_id: userMapping.user_id,
      reason: reason,
      token: await getTokenForUser(userMapping)
    }
  })
  
  if (error) throw error
  return data
}

async function demoteUser(userId: string, reason: string, userMapping: any) {
  const { data, error } = await supabase.functions.invoke('moderation', {
    body: {
      action: 'demote_user',
      target_user_id: userId,
      moderator_id: userMapping.user_id,
      reason: reason,
      token: await getTokenForUser(userMapping)
    }
  })
  
  if (error) throw error
  return data
}

// Missing critical functions

// Get or create Discord user mapping
async function getOrCreateDiscordUser(
  discordUserId: string,
  username: string,
  guildId: string,
  roles: string[]
) {
  try {
    const { data, error } = await supabase
      .from('discord_users')
      .select('*')
      .eq('discord_user_id', discordUserId)
      .eq('guild_id', guildId)
      .eq('is_active', true)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
      console.error('Error fetching Discord user:', error)
      return null
    }

    if (data) {
      // Update last_verified and roles
      await supabase
        .from('discord_users')
        .update({ 
          last_verified: new Date().toISOString(),
          discord_roles: roles,
          discord_username: username
        })
        .eq('id', data.id)
      
      return data
    }

    // User doesn't exist - return null so they need to set up
    return null
  } catch (error) {
    console.error('Error in getOrCreateDiscordUser:', error)
    return null
  }
}

// Handle config command for Discord user setup
async function handleConfigCommand(
  options: any[],
  userRole: string,
  userMapping: any,
  guildId: string,
  channelId: string
) {
  const action = options.find((opt: any) => opt.name === 'action')?.value
  const userId = options.find((opt: any) => opt.name === 'user_id')?.value
  const clientType = options.find((opt: any) => opt.name === 'client_type')?.value
  const discordUser = options.find((opt: any) => opt.name === 'discord_user')?.value
  const authToken = options.find((opt: any) => opt.name === 'auth_token')?.value
  const role = options.find((opt: any) => opt.name === 'role')?.value

  try {
    switch (action) {
      case 'setup':
        if (!userId || !clientType) {
          return createErrorResponse(
            'Setup requires both user_id and client_type. Example: `/config setup user_id:12345 client_type:anilist`'
          )
        }

        // Check if user already exists
        const { data: existingUser } = await supabase
          .from('discord_users')
          .select('*')
          .eq('user_id', userId)
          .eq('client_type', clientType)
          .single()

        if (existingUser) {
          return createErrorResponse(
            'This Commentum user is already linked to another Discord user. Contact an admin if you need to change it.'
          )
        }

        return createSuccessResponse(
          `**Discord Integration Setup**\n\n` +
          `To complete your setup, please ask an administrator to run the following command:\n` +
          `\`/config approve user_id:${userId} client_type:${clientType} discord_user:<YOUR_DISCORD_ID> auth_token:<YOUR_TOKEN> role:<ROLE>\`\n\n` +
          `Your Discord ID: \`${userMapping?.discord_user_id || 'Unknown'}\`\n` +
          `Make sure to provide your actual Discord user ID and authentication token to the admin.\n\n` +
          `**Token Sources:**\n` +
          `• **AniList**: Get from your account settings\n` +
          `• **MyAnimeList**: Generate from API settings\n` +
          `• **SIMKL**: Get from account settings`
        )

      case 'verify':
        if (!userMapping || !userMapping.user_id) {
          return createErrorResponse(
            'No Discord integration found. Use `/config setup` to get started.'
          )
        }

        const verificationResult = await supabase
          .rpc('verify_discord_user_role', {
            discord_user_id_param: userMapping.discord_user_id,
            guild_id_param: guildId
          })

        if (verificationResult.error) {
          return createErrorResponse('Verification failed: ' + verificationResult.error.message)
        }

        const verification = verificationResult.data[0]
        if (verification.is_valid) {
          return createSuccessResponse(
            `✅ **Verification Successful**\n\n` +
            `Discord User: ${userMapping.discord_username}\n` +
            `Commentum User ID: ${userMapping.user_id}\n` +
            `Role: ${userMapping.user_role}\n` +
            `Client: ${userMapping.client_type}\n` +
            `Last Verified: ${new Date(userMapping.last_verified).toLocaleString()}\n` +
            `Token Status: ${userMapping.auth_token ? 'Stored' : 'Missing'}`
          )
        } else {
          return createErrorResponse(
            '❌ **Verification Failed**\n\n' +
            'Your Discord integration has expired or needs re-verification. ' +
            'Please contact an administrator to refresh your verification.'
          )
        }

      case 'approve':
        if (!userId || !clientType || !discordUser || !authToken || !role) {
          return createErrorResponse(
            'Admin approval requires all parameters: user_id, client_type, discord_user, auth_token, role'
          )
        }

        // Verify the token first
        const { verifyToken } = await import('../shared/auth.ts')
        const tokenValid = await verifyToken(supabase, clientType, userId, authToken)
        if (!tokenValid) {
          return createErrorResponse('Token verification failed. The provided token is invalid for this user/platform.')
        }

        // Get Discord user info
        const discordUserInfo = await getDiscordUserInfo(discordUser)
        if (!discordUserInfo) {
          return createErrorResponse('Failed to fetch Discord user information. Check the Discord user ID.')
        }

        // Create the Discord user mapping
        const { error: upsertError } = await supabase
          .rpc('upsert_discord_user', {
            discord_user_id_param: discordUser,
            discord_username_param: discordUserInfo.username,
            guild_id_param: guildId,
            user_id_param: userId,
            user_role_param: role,
            client_type_param: clientType,
            auth_token_param: authToken
          })

        if (upsertError) {
          return createErrorResponse('Failed to create Discord integration: ' + upsertError.message)
        }

        return createSuccessResponse(
          `✅ **Discord Integration Approved**\n\n` +
          `Discord User: ${discordUserInfo.username} (${discordUser})\n` +
          `Commentum User: ${userId}\n` +
          `Platform: ${clientType}\n` +
          `Role: ${role}\n` +
          `Token: Verified and stored\n\n` +
          'The user can now use Discord commands to manage comments.'
        )

      case 'revoke':
        if (!discordUser) {
          return createErrorResponse('Revoke requires discord_user parameter')
        }

        const { error: revokeError } = await supabase
          .from('discord_users')
          .update({ is_active: false })
          .eq('discord_user_id', discordUser)
          .eq('guild_id', guildId)

        if (revokeError) {
          return createErrorResponse('Failed to revoke Discord integration: ' + revokeError.message)
        }

        return createSuccessResponse(
          `✅ **Discord Integration Revoked**\n\n` +
          `Discord User ID: ${discordUser}\n` +
          'The user can no longer use Discord commands.'
        )

      case 'register':
        const guildIdForRegister = options.find((opt: any) => opt.name === 'guild_id')?.value
        
        try {
          const result = await registerCommands(guildIdForRegister)
          if (result.success) {
            return createSuccessResponse(
              `✅ **Commands Registered Successfully!**\n\n` +
              `${result.message}\n\n` +
              `📝 **Registered Commands:**\n` +
              `${Object.values(COMMANDS).map(cmd => `• /${cmd.name} - ${cmd.description}`).join('\n')}\n\n` +
              `🎯 **Next Steps:**\n` +
              `• Test the commands in your server\n` +
              `• Use \`/config setup\` to link your Discord account`
            )
          } else {
            return createErrorResponse(`Failed to register commands: ${result.error}`)
          }
        } catch (error) {
          return createErrorResponse(`Command registration failed: ${error.message}`)
        }

      default:
        return createErrorResponse('Unknown config action')
    }
  } catch (error) {
    console.error('Config command error:', error)
    return createErrorResponse('Failed to execute config command: ' + error.message)
  }
}

// Get proper authentication token for user
async function getTokenForUser(userMapping: any): Promise<string> {
  // Retrieve the stored authentication token for the user
  if (!userMapping || !userMapping.user_id) {
    throw new Error('Invalid user mapping')
  }

  if (!userMapping.auth_token) {
    throw new Error('No authentication token stored for this user')
  }

  return userMapping.auth_token
}

// Response helpers
function createSuccessResponse(message: string) {
  return {
    type: 4,
    data: {
      content: `✅ ${message}`,
      flags: 64 // EPHEMERAL
    }
  }
}

function createErrorResponse(message: string) {
  return {
    type: 4,
    data: {
      content: `❌ ${message}`,
      flags: 64 // EPHEMERAL
    }
  }
}

// Command Registration Function
async function registerCommands(guildId?: string) {
  try {
    console.log('🚀 Registering Discord slash commands...')
    
    // Validate required environment variables
    if (!DISCORD_APPLICATION_ID) {
      throw new Error('DISCORD_APPLICATION_ID environment variable is required')
    }
    
    if (!DISCORD_BOT_TOKEN) {
      throw new Error('DISCORD_BOT_TOKEN environment variable is required')
    }
    
    // Convert COMMANDS object to array for Discord API
    const commandsArray = Object.values(COMMANDS)
    
    // Choose endpoint based on whether guildId is provided
    const endpoint = guildId 
      ? `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${guildId}/commands`
      : `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commandsArray)
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('❌ Failed to register commands:', error)
      throw new Error(`Failed to register commands: ${error}`)
    }

    const data = await response.json()
    console.log('✅ Commands registered successfully!')
    
    if (Array.isArray(data)) {
      console.log(`📝 Registered ${data.length} commands:`)
      data.forEach(cmd => {
        console.log(`  • /${cmd.name} - ${cmd.description}`)
      })
    }

    return {
      success: true,
      commands: data,
      endpoint: guildId ? 'guild' : 'global',
      message: guildId 
        ? 'Commands registered for guild (instant availability)'
        : 'Commands registered globally (may take up to 1 hour to propagate)'
    }
  } catch (error) {
    console.error('❌ Error registering commands:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

// Discord API response functions using bot token
async function sendDiscordResponse(interactionId: string, interactionToken: string, responseData: any) {
  const response = await fetch(`https://discord.com/api/v10/interactions/${interactionId}/${interactionToken}/callback`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(responseData)
  })

  if (!response.ok) {
    throw new Error(`Discord API error: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

async function sendFollowupMessage(interactionToken: string, content: string, embeds?: any[]) {
  const response = await fetch(`https://discord.com/api/v10/webhooks/${DISCORD_BOT_TOKEN}/${interactionToken}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content,
      embeds,
      flags: 64 // EPHEMERAL
    })
  })

  if (!response.ok) {
    throw new Error(`Discord followup error: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

async function getDiscordUserInfo(userId: string) {
  const response = await fetch(`https://discord.com/api/v10/users/${userId}`, {
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Discord user info error: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

// Main handler
serve(async (req) => {
  // Handle command registration requests (bypass Discord signature verification)
  if (req.url.includes('/register')) {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    try {
      const { guild_id } = await req.json()
      const result = await registerCommands(guild_id)
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }

  // Handle Discord interactions
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const signature = req.headers.get('x-signature-ed25519')
  const timestamp = req.headers.get('x-signature-timestamp')
  
  if (!signature || !timestamp) {
    return new Response('Missing signature headers', { status: 401 })
  }

  const body = await req.text()
  const isValid = await verifyKey(body, signature, timestamp, DISCORD_PUBLIC_KEY)

  if (!isValid) {
    return new Response('Invalid signature', { status: 401 })
  }

  try {
    const interaction = JSON.parse(body)
    const response = await handleInteraction(interaction)
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Interaction handling error:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})