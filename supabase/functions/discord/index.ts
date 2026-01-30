import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Discord API configuration
const DISCORD_API_BASE = 'https://discord.com/api/v10'
const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID') || '1464283126510387488'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

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

// Assign Discord role to user
async function assignDiscordRole(guildId: string, userId: string, roleId: string) {
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

// Handle server registration (/add)
async function handleAddCommand(supabase: any, guildId: string, guildName: string, userId: string) {
  try {
    // Check if server is already configured
    const { data: existingServer } = await supabase
      .from('server_configs')
      .select('*')
      .eq('guild_id', guildId)
      .single()

    if (existingServer) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Server **${guildName}** is already configured!\n**Server Name:** ${existingServer.server_name}\n**Configured by:** Server setup`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Add server configuration
    const { data: server, error } = await supabase
      .from('server_configs')
      .insert({
        server_name: guildName,
        guild_id: guildId,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Server **${guildName}** has been successfully configured!\n\n` +
            `📋 **Server ID:** ${guildId}\n` +
            `👑 **Configured by:** <@${userId}>\n` +
            `📅 **Configured:** ${new Date().toLocaleDateString()}\n\n` +
            `Members can now use \`/register\` to link their platform accounts!\n\n` +
            `⚙️ **Note:** Use the config panel to set webhook URL and role ID for notifications.`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Add command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to configure server: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Handle member registration (/register)
async function handleRegisterCommand(supabase: any, userId: string, username: string, guildId: string, guildName: string, platform: string, platformUserId: string) {
  try {
    // Check if server is configured
    const { data: server } = await supabase
      .from('server_configs')
      .select('*')
      .eq('guild_id', guildId)
      .eq('is_active', true)
      .single()

    if (!server) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Server **${guildName}** is not configured! Ask an admin to use \`/add\` first.`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user is already registered
    const { data: existingUser } = await supabase
      .from('discord_users')
      .select('*')
      .eq('discord_user_id', userId)
      .single()

    if (existingUser) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ You are already registered!\n**Platform:** ${existingUser.platform_type}\n**Platform ID:** ${existingUser.platform_user_id}\n**Role:** ${existingUser.user_role}`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get user role from config based on platform user ID
    let userRole = 'user'
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get_role',
          user_info: {
            user_id: platformUserId,
            username: username
          }
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        userRole = data.role || 'user'
      }
    } catch (error) {
      console.log('Could not fetch user role, using default:', error.message)
    }

    // Register the user
    const { data: registration, error } = await supabase
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

    // Try to assign Discord role if configured for this server
    if (server.role_id) {
      const roleAssigned = await assignDiscordRole(guildId, userId, server.role_id)
      if (roleAssigned) {
        console.log(`Assigned role ${server.role_id} to user ${userId} in guild ${guildId}`)
      }
    }

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ **Welcome to ${guildName}!**\n\n` +
            `👤 **Discord:** ${username}\n` +
            `🎮 **Platform:** ${platform}\n` +
            `🆔 **Platform ID:** ${platformUserId}\n` +
            `🎭 **Role:** ${userRole}\n` +
            `📅 **Registered:** ${new Date().toLocaleDateString()}\n\n` +
            `You can now use all bot commands including moderation tools based on your role!`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Register command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to register: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Handle stats command
async function handleStatsCommand(supabase: any) {
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
    const serverNames = servers?.filter(server => server.is_active).map(s => s.server_name).slice(0, 5).join(', ') || 'None'

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `📊 **Commentum System Statistics**\n\n` +
            `💬 **Comments:** ${totalComments} total (${activeComments} active)\n` +
            `👍 **Upvotes:** ${totalUpvotes}\n` +
            `👎 **Downvotes:** ${totalDownvotes}\n` +
            `🚨 **Reports:** ${totalReports}\n\n` +
            `🏢 **Active Servers:** ${activeServers}\n` +
            `📋 **Server List:** ${serverNames}${servers?.length > 5 ? '...' : ''}\n\n` +
            `👥 **Discord Users:** ${activeUsers}\n` +
            `🛡️ **Mods:** ${mods}\n` +
            `👑 **Admins:** ${admins}\n` +
            `⚡ **Super Admins:** ${superAdmins}\n\n` +
            `🎮 **Platform Breakdown:**\n` +
            `• AniList: ${anilistUsers}\n` +
            `• MyAnimeList: ${malUsers}\n` +
            `• SIMKL: ${simklUsers}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Stats command error:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to fetch statistics: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Handle comment deletion
async function handleDeleteCommand(supabase: any, commentId: string, registration: any) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        comment_id: parseInt(commentId),
        user_info: {
          user_id: registration.platform_user_id,
          username: registration.discord_username
        }
      })
    })

    if (response.ok) {
      const data = await response.json()
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
    } else {
      const error = await response.json()
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Failed to delete comment: ${error.error || 'Unknown error'}`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
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

// Handle user ban
async function handleBanCommand(supabase: any, targetUserId: string, reason: string, shadow: boolean, registration: any) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/moderation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ban',
        target_user_id: targetUserId,
        reason: reason,
        shadow_ban: shadow,
        moderator_info: {
          user_id: registration.platform_user_id,
          username: registration.discord_username
        }
      })
    })

    if (response.ok) {
      const data = await response.json()
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
    } else {
      const error = await response.json()
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Failed to ban user: ${error.error || 'Unknown error'}`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
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

// Handle user promotion
async function handlePromoteCommand(supabase: any, targetUserId: string, newRole: string, reason: string, registration: any) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'promote',
        target_user_id: targetUserId,
        new_role: newRole,
        reason: reason,
        admin_info: {
          user_id: registration.platform_user_id,
          username: registration.discord_username
        }
      })
    })

    if (response.ok) {
      const data = await response.json()
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
    } else {
      const error = await response.json()
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Failed to promote user: ${error.error || 'Unknown error'}`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
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

// Handle user demotion
async function handleDemoteCommand(supabase: any, targetUserId: string, newRole: string, reason: string, registration: any) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'demote',
        target_user_id: targetUserId,
        new_role: newRole,
        reason: reason,
        admin_info: {
          user_id: registration.platform_user_id,
          username: registration.discord_username
        }
      })
    })

    if (response.ok) {
      const data = await response.json()
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `✅ Successfully demoted **${targetUserId}** to **${newRole}**\nReason: ${reason}`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      const error = await response.json()
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Failed to demote user: ${error.error || 'Unknown error'}`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
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
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Handle help command
async function handleHelpCommand() {
  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: `🤖 **Commentum Bot Commands**\n\n` +
          `🏢 **Server Management**\n` +
          `\`/add\` - Configure this server with the bot (Admin only)\n` +
          `\`/register\` - Register your platform account\n\n` +
          `📊 **Information**\n` +
          `\`/stats\` - View platform statistics\n` +
          `\`/help\` - Show this help message\n\n` +
          `🛡️ **Moderation (Registered Users)**\n` +
          `\`/delete\` - Delete a comment\n\n` +
          `👑 **Admin+ Commands**\n` +
          `\`/ban\` - Ban a user\n` +
          `\`/promote\` - Promote a user\n` +
          `\`/demote\` - Demote a user\n\n` +
          `🔗 **Supported Platforms:** AniList, MyAnimeList, SIMKL\n\n` +
          `Need help? Check the documentation!`,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Handle Discord interactions
async function handleDiscordInteraction(supabase: any, body: any) {
  const { type, data, guild_id, member, user } = body

  // Handle slash command interactions
  if (type === 2) {
    const commandName = data.name
    const userId = user?.id || member?.user?.id
    const username = user?.username || member?.user?.username

    // Get user registration
    const { data: registration } = await supabase
      .from('discord_users')
      .select('*')
      .eq('discord_user_id', userId)
      .eq('is_active', true)
      .single()

    // Get guild info
    const guildInfo = await getGuildInfo(guild_id)

    switch (commandName) {
      case 'add':
        // Check if user has admin permissions (simplified check)
        if (!member?.permissions) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '❌ You need administrator permissions to use this command!',
                flags: 64
              }
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        return await handleAddCommand(supabase, guild_id, guildInfo?.name || 'Unknown Server', userId)

      case 'register':
        const platform = data.options?.find(opt => opt.name === 'platform')?.value
        const platformUserId = data.options?.find(opt => opt.name === 'user_id')?.value
        
        if (!platform || !platformUserId) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '❌ Missing required parameters: platform and user_id',
                flags: 64
              }
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        
        return await handleRegisterCommand(supabase, userId, username, guild_id, guildInfo?.name || 'Unknown Server', platform, platformUserId)

      case 'stats':
        return await handleStatsCommand(supabase)

      case 'help':
        return await handleHelpCommand()

      case 'delete':
      case 'ban':
      case 'promote':
      case 'demote':
        if (!registration) {
          return new Response(
            JSON.stringify({
              type: 4,
              data: {
                content: '❌ You must be registered to use this command! Use `/register` first.',
                flags: 64
              }
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        switch (commandName) {
          case 'delete':
            const commentId = data.options?.find(opt => opt.name === 'comment_id')?.value
            if (!commentId) {
              return new Response(
                JSON.stringify({
                  type: 4,
                  data: {
                    content: '❌ Missing required parameter: comment_id',
                    flags: 64
                  }
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              )
            }
            return await handleDeleteCommand(supabase, commentId, registration)
            
          case 'ban':
            const targetUserId = data.options?.find(opt => opt.name === 'user_id')?.value
            const banReason = data.options?.find(opt => opt.name === 'reason')?.value || 'No reason provided'
            const shadow = data.options?.find(opt => opt.name === 'shadow')?.value || false
            
            if (!targetUserId) {
              return new Response(
                JSON.stringify({
                  type: 4,
                  data: {
                    content: '❌ Missing required parameter: user_id',
                    flags: 64
                  }
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              )
            }
            return await handleBanCommand(supabase, targetUserId, banReason, shadow, registration)
            
          case 'promote':
            const promoteTargetId = data.options?.find(opt => opt.name === 'user_id')?.value
            const newRole = data.options?.find(opt => opt.name === 'role')?.value
            const promoteReason = data.options?.find(opt => opt.name === 'reason')?.value || 'Promotion'
            
            if (!promoteTargetId || !newRole) {
              return new Response(
                JSON.stringify({
                  type: 4,
                  data: {
                    content: '❌ Missing required parameters: user_id and role',
                    flags: 64
                  }
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              )
            }
            return await handlePromoteCommand(supabase, promoteTargetId, newRole, promoteReason, registration)
            
          case 'demote':
            const demoteTargetId = data.options?.find(opt => opt.name === 'user_id')?.value
            const demoteRole = data.options?.find(opt => opt.name === 'role')?.value
            const demoteReason = data.options?.find(opt => opt.name === 'reason')?.value || 'Demotion'
            
            if (!demoteTargetId || !demoteRole) {
              return new Response(
                JSON.stringify({
                  type: 4,
                  data: {
                    content: '❌ Missing required parameters: user_id and role',
                    flags: 64
                  }
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              )
            }
            return await handleDemoteCommand(supabase, demoteTargetId, demoteRole, demoteReason, registration)
        }

      default:
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: '❌ Unknown command. Use `/help` to see available commands.',
              flags: 64
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
  }

  return new Response(
    JSON.stringify({ error: 'Unsupported interaction type' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Sync all commands globally
async function handleGlobalSyncCommands(supabase: any) {
  console.log('🚀 Starting global command sync...')

  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
    return new Response(
      JSON.stringify({ error: 'Missing Discord credentials' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Define all slash commands for global deployment
  const commands = [
    // Server Management
    {
      name: 'add',
      description: 'Configure this server with Commentum bot (Admin only)',
    },
    {
      name: 'register',
      description: 'Register your platform account with the bot',
      options: [
        {
          name: 'platform',
          description: 'Choose your platform',
          type: 3, // STRING
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
          type: 3, // STRING
          required: true,
        }
      ]
    },
    
    // Information
    {
      name: 'stats',
      description: 'View Commentum platform statistics',
    },
    {
      name: 'help',
      description: 'Show help and available commands',
    },
    
    // Moderation (with options)
    {
      name: 'delete',
      description: 'Delete a comment (Registered users)',
      options: [
        {
          name: 'comment_id',
          description: 'ID of the comment to delete',
          type: 3, // STRING
          required: true,
        }
      ]
    },
    {
      name: 'ban',
      description: 'Ban a user (Admin+)',
      options: [
        {
          name: 'user_id',
          description: 'ID of the user to ban',
          type: 3, // STRING
          required: true,
        },
        {
          name: 'reason',
          description: 'Reason for banning',
          type: 3, // STRING
          required: false,
        },
        {
          name: 'shadow',
          description: 'Shadow ban (user won\'t know they\'re banned)',
          type: 5, // BOOLEAN
          required: false,
        }
      ]
    },
    {
      name: 'promote',
      description: 'Promote a user to higher role (Super Admin+)',
      options: [
        {
          name: 'user_id',
          description: 'ID of the user to promote',
          type: 3, // STRING
          required: true,
        },
        {
          name: 'role',
          description: 'New role to assign',
          type: 3, // STRING
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
          type: 3, // STRING
          required: false,
        }
      ]
    },
    {
      name: 'demote',
      description: 'Demote a user to lower role (Super Admin+)',
      options: [
        {
          name: 'user_id',
          description: 'ID of the user to demote',
          type: 3, // STRING
          required: true,
        },
        {
          name: 'role',
          description: 'New role to assign',
          type: 3, // STRING
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
          type: 3, // STRING
          required: false,
        }
      ]
    }
  ]

  try {
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

    if (response.ok) {
      const syncedCommands = await response.json()
      console.log('Successfully synced commands:', syncedCommands.length)
      
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `✅ **Global bot sync successful!**\n\n` +
              `🤖 **Commands synced:** ${syncedCommands.length}\n` +
              `📋 **Commands:** ${syncedCommands.map((cmd: any) => `/${cmd.name}`).join(', ')}\n\n` +
              `🎯 **Scope:** Global (all servers)\n` +
              `⚡ **Status:** Active and ready\n\n` +
              `🏢 **Server Setup:**\n` +
              `1. Use \`/add\` to configure this server\n` +
              `2. Use \`/register\` to link your platform account\n` +
              `3. Use \`/help\` to see all commands`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      const errorText = await response.text()
      console.error('Discord API error:', errorText)
      
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ **Discord API Error**\n\nStatus: ${response.status}\nError: ${errorText}`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  } catch (error) {
    console.error('Sync error:', error)
    
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ **Sync Error**\n\n${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Main serve function
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    let body = {}
    if (req.method === 'POST') {
      try {
        body = await req.json()
      } catch (e) {
        console.log('No body or invalid JSON')
      }
    }

    switch (action) {
      case 'sync_global':
        return await handleGlobalSyncCommands(supabase)
      
      case 'interact':
        return await handleDiscordInteraction(supabase, body)
      
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
