import { createDiscordResponse, createErrorResponse, createStatsEmbed, createSimpleEmbed } from '../utils.ts'

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
    if (!['admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only administrators can configure servers.')
    }

    // Get options from command
    const serverName = options?.find((opt: any) => opt.name === 'server_name')?.value
    const guildId = options?.find((opt: any) => opt.name === 'guild_id')?.value
    const webhookUrl = options?.find((opt: any) => opt.name === 'webhook_url')?.value
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
        `Server ${serverName} is already configured!\n\nServer Name: ${existingServer.server_name}\nConfigured by: Server setup\n\nCurrent Settings:\n• Role ID: ${existingServer.role_id || 'Not set'}\n• Webhook: ${existingServer.webhook_url ? 'Configured' : 'Not set'}\n• Status: ${existingServer.is_active ? 'Active' : 'Inactive'}`,
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
        webhook_url: webhookUrl || null,
        role_id: roleId || null,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    return createSimpleEmbed(
        'Server Configured Successfully',
        `Server ${serverName} has been successfully configured!\n\nServer ID: ${guildId}\nConfigured by: ${moderatorUsername}\nConfigured: ${new Date().toLocaleDateString()}\n${roleId ? `Role ID: ${roleId}\n` : ''}${webhookUrl ? `Webhook: Configured\n` : ''}\n\nNext Steps:\n• Members can now use /register and select this server\n• Users will be auto-assigned the Discord role if configured\n• Use /config action:view to see all settings\n\nNote: Server "${serverName}" is now available for registration.`,
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
        `You are already registered!\n\n` +
        `Discord: ${registration.discord_username}\n` +
        `Platform: ${registration.platform_type}\n` +
        `Platform ID: ${registration.platform_user_id}\n` +
        `Role: ${registration.user_role}\n` +
        `Registered: ${new Date(registration.registered_at).toLocaleDateString()}\n\n` +
        `To change platforms or servers, contact an admin.`
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
        console.log(`Auto-assigned role ${server.role_id} to user ${userId} in guild ${server.guild_id}`)
        roleInfo = `Discord Role: Auto-assigned (${server.role_id})\n`
      } else {
        console.log(`Failed to assign role ${server.role_id} to user ${userId} in guild ${server.guild_id}`)
        roleInfo = `Discord Role: Failed to assign (${server.role_id})\n`
      }
    } else {
      roleInfo = `Discord Role: Not configured for this server\n`
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
    const { data: comments } = await supabase
      .from('comments')
      .select('id, upvotes, downvotes, report_count, created_at, user_role, deleted, user_banned')

    const totalComments = comments?.length || 0
    const activeComments = comments?.filter(c => !c.deleted && !c.user_banned).length || 0
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
  return createDiscordResponse(helpContent)
}

function getHelpContent(role: string): string {
  const baseCommands = `Commentum Bot Commands\n\n` +
    `User Commands\n` +
    `• \`/register platform:<platform> user_id:<id> server:<name>\` - Register your platform account\n` +
    `• \`/report comment_id:<id> reason:<reason> [notes:<text>]\` - Report a comment\n` +
    `• \`/user user_id:<id>\` - Get user information\n` +
    `• \`/comment comment_id:<id>\` - Get comment information\n` +
    `• \`/stats\` - View system statistics\n` +
    `• \`/help\` - Show this help message\n`;

  const modCommands = `\nModerator Commands\n` +
    `• \`/warn user_id:<id> reason:<reason>\` - Warn a user\n` +
    `• \`/unwarn user_id:<id> reason:<reason>\` - Remove warning\n` +
    `• \`/mute user_id:<id> [duration:<hours>] reason:<reason>\` - Mute user\n` +
    `• \`/unmute user_id:<id> reason:<reason>\` - Unmute user\n` +
    `• \`/pin comment_id:<id> [reason:<text>]\` - Pin comment\n` +
    `• \`/unpin comment_id:<id> [reason:<text>]\` - Unpin comment\n` +
    `• \`/lock comment_id:<id> [reason:<text>]\` - Lock thread\n` +
    `• \`/unlock comment_id:<id> [reason:<text>]\` - Unlock thread\n` +
    `• \`/resolve comment_id:<id> reporter_id:<id> resolution:<type> [notes:<text>]\` - Resolve report\n` +
    `• \`/queue\` - View moderation queue\n` +
    `• \`/delete comment_id:<id>\` - Delete own comments\n`;

  const adminCommands = `\n👑 **Admin Commands**\n` +
    `• \`/ban user_id:<id> reason:<reason> [shadow:<true/false>]\` - Ban user\n` +
    `• \`/unban user_id:<id> reason:<reason>\` - Unban user\n` +
    `• \`/shadowban user_id:<id> reason:<reason>\` - Shadow ban\n` +
    `• \`/unshadowban user_id:<id> reason:<reason>\` - Remove shadow ban\n` +
    `• \`/delete comment_id:<id>\` - Delete any comment\n`;

  const superAdminCommands = `\n⚡ **Super Admin Commands**\n` +
    `• \`/promote user_id:<id> role:<role> [reason:<text>]\` - Promote user\n` +
    `• \`/demote user_id:<id> role:<role> [reason:<text>]\` - Demote user\n` +
    `• \`/config action:<action> [key:<key>] [value:<value>]\` - Manage config\n` +
    `• \`/add server_name:<name> guild_id:<id> [webhook_url:<url>] [role_id:<id>]\` - Configure server\n`;

  const footer = `\n🔗 **Supported Platforms:** AniList, MyAnimeList, SIMKL\n` +
    `📚 **Documentation:** Check pinned messages or ask an admin\n` +
    `❓ **Need Help:** Mention @admin or use the support channel`;

  switch (role) {
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
