import { createDiscordResponse, createErrorResponse, createStatsEmbed, createSimpleEmbed, createEmbedResponse } from '../utils.ts'

// Discord API configuration
const DISCORD_API_BASE = 'https://discord.com/api/v10'
const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')

// Assign Discord role to user
async function assignDiscordRole(guildId: string, userId: string, roleId: string): Promise<boolean> {
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
    
    return response.ok
  } catch (error) {
    console.error('Error assigning role:', error)
    return false
  }
}

// Get server information from Discord API
async function getGuildInfo(guildId: string) {
  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/guilds/${guildId}`,
      {
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
    
    if (response.ok) {
      return await response.json()
    }
    return null
  } catch (error) {
    console.error('Error fetching guild info:', error)
    return null
  }
}

// Handle server registration (/add)
export async function handleAddCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], userRole: string) {
  try {
    // Check if user has permission (only admins can add servers)
    if (!['admin', 'super_admin', 'app_owner', 'owner'].includes(userRole)) {
      return createErrorResponse('Only administrators can configure servers.')
    }

    // Get options from command
    const serverName = options?.find((opt: any) => opt.name === 'server_name')?.value
    const guildId = options?.find((opt: any) => opt.name === 'guild_id')?.value
    const channelId = options?.find((opt: any) => opt.name === 'channel_id')?.value
    const moderationChannelId = options?.find((opt: any) => opt.name === 'moderation_channel_id')?.value
    const roleId = options?.find((opt: any) => opt.name === 'role_id')?.value

    if (!serverName || !guildId) {
      return createErrorResponse('server_name and guild_id are required.')
    }

    // Check if server is already configured
    const { data: existingServer } = await supabase
      .from('server_configs')
      .select('*')
      .eq('guild_id', guildId)
      .single()

    if (existingServer) {
      return createSimpleEmbed(
        'Server Already Configured',
        `Server ${serverName} is already configured!\n\nServer Name: ${existingServer.server_name}\nConfigured by: Server setup\n\nCurrent Settings:\n• Role ID: ${existingServer.role_id || 'Not set'}\n• Comments Channel: ${existingServer.channel_id || 'Not set'}\n• Moderation Channel: ${existingServer.moderation_channel_id || 'Not set'}\n• Status: ${existingServer.is_active ? 'Active' : 'Inactive'}`,
        0xFFA500
      )
    }

    // Get guild info from Discord API to verify guild exists
    const guildInfo = await getGuildInfo(guildId)
    if (!guildInfo) {
      return createErrorResponse(`Guild with ID ${guildId} not found or bot doesn't have access.`)
    }

    // Add server configuration
    const { data: server, error } = await supabase
      .from('server_configs')
      .insert({
        server_name: serverName,
        guild_id: guildId,
        channel_id: channelId || null,
        moderation_channel_id: moderationChannelId || null,
        role_id: roleId || null,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    return createSimpleEmbed(
        'Server Configured Successfully',
        `Server ${serverName} has been successfully configured!\n\nServer ID: ${guildId}\nConfigured by: <@${moderatorId}>\nConfigured: ${new Date().toLocaleDateString()}\n${roleId ? `Role ID: ${roleId}\n` : ''}${channelId ? `Comments Channel: ${channelId}\n` : ''}${moderationChannelId ? `Moderation Channel: ${moderationChannelId}\n` : ''}\n\nNext Steps:\n• Members can now use /register and select this server\n• Users will be auto-assigned the Discord role if configured\n• Use /config action:view to see all settings\n\nNote: Server "${serverName}" is now available for registration.`,
        0x00FF00
      )

  } catch (error) {
    console.error('Add command error:', error)
    return createErrorResponse(`Failed to configure server: ${error.message}`)
  }
}

// Handle member registration (/register)
export async function handleRegisterCommand(supabase: any, userId: string, username: string, guildId: string, guildName: string, options: any[], registration: any) {
  try {
    // Get options from command
    const platform = options?.find((opt: any) => opt.name === 'platform')?.value
    const platformUserId = options?.find((opt: any) => opt.name === 'user_id')?.value
    const serverName = options?.find((opt: any) => opt.name === 'server')?.value

    if (!platform || !platformUserId || !serverName) {
      return createErrorResponse('platform, user_id, and server are required.')
    }

    // Get server configuration
    const { data: server, error: serverError } = await supabase
      .from('server_configs')
      .select('*')
      .eq('server_name', serverName)
      .eq('is_active', true)
      .single()

    if (serverError || !server) {
      return createErrorResponse(`Server "${serverName}" not found or not active. Available servers can be viewed by admins.`)
    }

    // Check if user is already registered
    if (registration) {
      return createDiscordResponse(
        `❌ You are already registered!\n\n` +
        `👤 **Discord:** ${registration.discord_username}\n` +
        `🎮 **Platform:** ${registration.platform_type}\n` +
        `🆔 **Platform ID:** ${registration.platform_user_id}\n` +
        `🎭 **Role:** ${registration.user_role}\n` +
        `📅 **Registered:** ${new Date(registration.registered_at).toLocaleDateString()}\n\n` +
        `⚠️ To change platforms or servers, contact an admin.`
      )
    }

    // Get user role from database based on platform user ID
    let userRole = 'user'
    try {
      // Check if user is in any role config
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

      if (superAdminList.includes(platformUserId)) {
        userRole = 'super_admin'
      } else if (adminList.includes(platformUserId)) {
        userRole = 'admin'
      } else if (moderatorList.includes(platformUserId)) {
        userRole = 'moderator'
      }
    } catch (error) {
      console.log('Could not fetch user role, using default:', error.message)
    }

    // Register the user
    const { data: newRegistration, error } = await supabase
      .from('discord_users')
      .insert({
        discord_user_id: userId,
        discord_username: username,
        platform_user_id: platformUserId,
        platform_type: platform,
        user_role: userRole,
        registered_at: new Date().toISOString(),
        is_active: true,
        is_verified: true,
        verified_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) throw error

    // Auto-assign Discord role if configured for this server
    let roleAssigned = false
    let roleInfo = ''
    if (server.role_id) {
      roleAssigned = await assignDiscordRole(server.guild_id, userId, server.role_id)
      if (roleAssigned) {
        console.log(`✅ Auto-assigned role ${server.role_id} to user ${userId} in guild ${server.guild_id}`)
        roleInfo = `🎭 **Discord Role:** ✅ Auto-assigned (${server.role_id})\n`
      } else {
        console.log(`❌ Failed to assign role ${server.role_id} to user ${userId} in guild ${server.guild_id}`)
        roleInfo = `🎭 **Discord Role:** ⚠️ Failed to assign (${server.role_id})\n`
      }
    } else {
      roleInfo = `🎭 **Discord Role:** ⚠️ Not configured for this server\n`
    }

    // Create role-specific welcome message
    const rolePermissions = getRolePermissions(userRole)
    
    return createSimpleEmbed(
        'Welcome to ' + serverName + '!',
        `Discord: ${username}\nPlatform: ${platform}\nPlatform ID: ${platformUserId}\nServer: ${serverName}\nRole: ${userRole}\nRegistered: ${new Date().toLocaleDateString()}\n${roleInfo}\n\nYour Permissions:\n${rolePermissions}\n\nGetting Started:\n• Use /help to see all available commands\n• Use /stats to view platform statistics\n• Check pinned messages for server rules\n\nYou're ready to use the Commentum system on ${serverName}!`,
        0x00FF00
      )

  } catch (error) {
    console.error('Register command error:', error)
    return createErrorResponse(`Failed to register: ${error.message}`)
  }
}

// Get available servers for registration
export async function getAvailableServers(supabase: any): Promise<string[]> {
  try {
    const { data: servers } = await supabase
      .from('server_configs')
      .select('server_name')
      .eq('is_active', true)
      .order('server_name')

    return servers?.map(s => s.server_name) || []
  } catch (error) {
    console.error('Error fetching servers:', error)
    return []
  }
}

// Handle stats command
export async function handleStatsCommand(supabase: any, userRole: string) {
  try {
    // Get comment statistics
    // Note: user_banned column removed from comments table; we get banned info from commentum_users
    const { data: comments } = await supabase
      .from('comments')
      .select('id, upvotes, downvotes, report_count, created_at, user_role, deleted, user_id')

    // Get banned user IDs from commentum_users (respecting expiration)
    const { data: bannedUsers } = await supabase
      .from('commentum_users')
      .select('commentum_user_id')
      .eq('commentum_user_banned', true)
      .or('commentum_user_banned_until.is.null,commentum_user_banned_until.gt.' + new Date().toISOString())
    const bannedUserIds = new Set((bannedUsers || []).map((u: any) => u.commentum_user_id))

    const totalComments = comments?.length || 0
    const activeComments = comments?.filter(c => !c.deleted && !bannedUserIds.has(c.user_id)).length || 0
    const totalUpvotes = comments?.reduce((sum, comment) => sum + comment.upvotes, 0) || 0
    const totalDownvotes = comments?.reduce((sum, comment) => sum + comment.downvotes, 0) || 0
    const totalReports = comments?.reduce((sum, comment) => sum + comment.report_count, 0) || 0

    // Get registered Discord users
    const { data: discordUsers } = await supabase
      .from('discord_users')
      .select('user_role, is_active, platform_type')

    const activeUsers = discordUsers?.filter(user => user.is_active).length || 0
    const mods = discordUsers?.filter(user => user.is_active && user.user_role === 'moderator').length || 0
    const admins = discordUsers?.filter(user => user.is_active && user.user_role === 'admin').length || 0
    const superAdmins = discordUsers?.filter(user => user.is_active && user.user_role === 'super_admin').length || 0

    // Platform breakdown
    const anilistUsers = discordUsers?.filter(user => user.platform_type === 'anilist').length || 0
    const malUsers = discordUsers?.filter(user => user.platform_type === 'myanimelist').length || 0
    const simklUsers = discordUsers?.filter(user => user.platform_type === 'simkl').length || 0

    // Get configured servers
    const { data: servers } = await supabase
      .from('server_configs')
      .select('server_name, is_active')

    const activeServers = servers?.filter(server => server.is_active).length || 0

    // Get system configuration
    const { data: configs } = await supabase
      .from('config')
      .select('key, value')
      .in('key', ['system_enabled', 'voting_enabled', 'reporting_enabled', 'discord_notifications_enabled'])

    const systemEnabled = configs?.find(c => c.key === 'system_enabled')?.value === 'true'
    const votingEnabled = configs?.find(c => c.key === 'voting_enabled')?.value === 'true'
    const reportingEnabled = configs?.find(c => c.key === 'reporting_enabled')?.value === 'true'
    const discordEnabled = configs?.find(c => c.key === 'discord_notifications_enabled')?.value === 'true'

    const stats = {
      totalComments,
      activeComments,
      totalUpvotes,
      totalDownvotes,
      totalReports,
      activeServers,
      mods,
      admins,
      superAdmins,
      anilistUsers,
      malUsers,
      simklUsers,
      systemEnabled,
      votingEnabled,
      reportingEnabled,
      discordEnabled
    }

    return createStatsEmbed(stats)

  } catch (error) {
    console.error('Stats command error:', error)
    return createErrorResponse(`Failed to fetch statistics: ${error.message}`)
  }
}

// Handle help command
export async function handleHelpCommand(userRole: string) {
  const helpContent = getHelpContent(userRole)
  // Split on the section headers so each section is its own embed field (<=1024 chars)
  const sections = helpContent.split(/\n(?=[^\n]*\*\*[^\n]*\*\*\n)/).filter(Boolean)
  const fields = sections.map((sec, i) => {
    const [title, ...rest] = sec.replace(/^\n+/, '').split('\n')
    return { name: title.replace(/\*\*/g, '').slice(0, 256) || `Section ${i + 1}`, value: (rest.join('\n').trim() || '—').slice(0, 1024), inline: false }
  })
  return createEmbedResponse('🤖 Commentum Bot Help', 'Commands available for your role', fields.filter((x) => x.value !== '—').slice(0, 25), 0x5865F2, undefined, undefined, true)
}

function getHelpContent(role: string): string {
  const baseCommands = `🤖 **Commentum Bot Commands**\n\n` +
    `📝 **Everyone**\n` +
    `• \`/register platform:<platform> user_id:<id> server:<n>\` - Register your platform account\n` +
    `• \`/report comment_id:<id> reason:<reason> [notes:<text>]\` - Report a comment\n` +
    `• \`/user user_id:<id> [section:<overview|points|customization|linked>]\` - Full user profile\n` +
    `• \`/comment comment_id:<id>\` - Comment details\n` +
    `• \`/search_comments\` - Search comments\n` +
    `• \`/stats\` - System statistics\n` +
    `• \`/leaderboard [platform] [page]\` - Points leaderboard\n` +
    `• \`/mypoints\` - Your own points (needs \`/register\`)\n` +
    `• \`/customizations [user_id]\` - Customization catalog / a user's equipped items\n` +
    `• \`/announcements\` - Latest announcements\n` +
    `• \`/help\` - This message\n`;

  const modCommands = `\n🛡️ **Moderator**\n` +
    `• \`/warn\` \`/unwarn\` \`/mute\` \`/unmute\` - user_id + reason (mute: [duration hours])\n` +
    `• \`/pin\` \`/unpin\` \`/lock\` \`/unlock\` - comment_id [reason]\n` +
    `• \`/resolve comment_id reporter_id resolution [notes]\` - Resolve a report\n` +
    `• \`/queue [page]\` - Pending reports (oldest first)\n` +
    `• \`/user user_id section:moderation\` - Ban/mute/warning reasons, who and when, notes\n` +
    `• \`/modlog user_id\` - Full moderation history of a user\n` +
    `• \`/note user_id action:<view|add|clear> [text]\` - Staff notes (clear = admin)\n` +
    `• \`/bans [type] [page]\` - Active bans, shadow bans and mutes\n` +
    `• \`/audit [limit] [moderator_id]\` - Recent moderation actions\n` +
    `• \`/sync_status\` - Dantotsu sync health\n` +
    `• \`/delete comment_id\` - Delete a comment\n` +
    `• \`/points_check user_id\` - Points and adjustments\n`;

  const adminCommands = `\n👑 **Admin**\n` +
    `• \`/ban\` \`/unban\` \`/shadowban\` \`/unshadowban\` - user_id + reason\n` +
    `• \`/purge user_id reason confirm:true\` - Delete all of a user's comments\n` +
    `• \`/points_give\` \`/points_deduct\` \`/points_undo\`\n`;

  const superAdminCommands = `\n⚡ **Super Admin**\n` +
    `• \`/promote\` \`/demote\` - user_id role [reason]\n` +
    `• \`/config action [key] [value]\` - Manage config\n` +
    `• \`/add\` - Configure a server\n`;

  const footer = `\n🔗 **Platforms:** AniList, MyAnimeList, SIMKL`;

  switch (role) {
    case 'owner':
    case 'app_owner':
    case 'super_admin':
      return baseCommands + modCommands + adminCommands + superAdminCommands + footer
    case 'admin':
      return baseCommands + modCommands + adminCommands + footer
    case 'moderator':
      return baseCommands + modCommands + footer
    default:
      return baseCommands + footer
  }
}
