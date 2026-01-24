import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Discord bot configuration
const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')
const DISCORD_GUILD_ID = Deno.env.get('DISCORD_GUILD_ID')
const DISCORD_WEBHOOK_URL = Deno.env.get('DISCORD_WEBHOOK_URL')

// Discord API endpoints
const DISCORD_API_BASE = 'https://discord.com/api/v10'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { action, discord_user_id, discord_username, platform_user_id, platform_type, token, command_data } = await req.json()

    switch (action) {
      case 'register':
        return await handleDiscordRegistration(supabase, {
          discord_user_id,
          discord_username,
          platform_user_id,
          platform_type,
          token
        })
      
      case 'verify':
        return await handleDiscordVerification(supabase, {
          discord_user_id,
          platform_user_id,
          platform_type,
          token
        })
      
      case 'get_user_role':
        return await handleGetUserRole(supabase, {
          discord_user_id
        })
      
      case 'sync_commands':
        return await handleSyncCommands(supabase)
      
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
  const { discord_user_id, discord_username, platform_user_id, platform_type, token } = params

  // Validate required fields
  if (!discord_user_id || !discord_username || !platform_user_id || !platform_type || !token) {
    return new Response(
      JSON.stringify({ error: 'All fields are required for registration' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Verify platform token
  const tokenValid = await verifyPlatformToken(platform_type, platform_user_id, token)
  if (!tokenValid) {
    return new Response(
      JSON.stringify({ error: 'Invalid platform token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

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
  const { discord_user_id, platform_user_id, platform_type, token } = params

  // Verify platform token
  const tokenValid = await verifyPlatformToken(platform_type, platform_user_id, token)
  if (!tokenValid) {
    return new Response(
      JSON.stringify({ error: 'Invalid platform token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

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

async function handleSyncCommands(supabase: any) {
  // Fetch Discord config from database
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

  const { data: guildIdConfig } = await supabase
    .from('config')
    .select('value')
    .eq('key', 'discord_guild_id')
    .single()

  // DON'T parse these - they're plain strings, not JSON
  const DISCORD_BOT_TOKEN = botTokenConfig?.value || ''
  const DISCORD_CLIENT_ID = clientIdConfig?.value || ''
  const DISCORD_GUILD_ID = guildIdConfig?.value || ''

  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
    return new Response(
      JSON.stringify({ 
        error: 'Discord configuration missing in database',
        details: {
          bot_token: !!DISCORD_BOT_TOKEN,
          client_id: !!DISCORD_CLIENT_ID,
          guild_id: !!DISCORD_GUILD_ID
        },
        message: 'Please update config table with Discord credentials'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
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
          required: true
        },
        {
          name: 'token',
          description: 'Your platform access token',
          type: 3, // STRING
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
          type: 3, // STRING
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for ban',
          type: 3, // STRING
          required: true
        },
        {
          name: 'shadow',
          description: 'Shadow ban (true/false)',
          type: 5, // BOOLEAN
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
          type: 3, // STRING
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unban',
          type: 3, // STRING
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
          type: 3, // STRING
          required: true
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
          type: 3, // STRING
          required: true
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
          type: 3, // STRING
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for warning',
          type: 3, // STRING
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
          type: 3, // STRING
          required: true
        },
        {
          name: 'duration',
          description: 'Duration in hours (default: 24)',
          type: 4, // INTEGER
          required: false
        },
        {
          name: 'reason',
          description: 'Reason for muting',
          type: 3, // STRING
          required: true
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
          type: 3, // STRING
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unmuting',
          type: 3, // STRING
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
          type: 3, // STRING
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for shadow ban',
          type: 3, // STRING
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
          type: 3, // STRING
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for removing shadow ban',
          type: 3, // STRING
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
          type: 4, // INTEGER
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for pinning',
          type: 3, // STRING
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
          type: 4, // INTEGER
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unpinning',
          type: 3, // STRING
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
          type: 4, // INTEGER
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for locking',
          type: 3, // STRING
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
          type: 4, // INTEGER
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for unlocking',
          type: 3, // STRING
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
          type: 4, // INTEGER
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
          type: 4, // INTEGER
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for report',
          type: 3, // STRING
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
          type: 3, // STRING
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
          type: 4, // INTEGER
          required: true
        },
        {
          name: 'reporter_id',
          description: 'Reporter user ID',
          type: 3, // STRING
          required: true
        },
        {
          name: 'resolution',
          description: 'Resolution type',
          type: 3, // STRING
          required: true,
          choices: [
            { name: 'Resolved', value: 'resolved' },
            { name: 'Dismissed', value: 'dismissed' }
          ]
        },
        {
          name: 'notes',
          description: 'Review notes',
          type: 3, // STRING
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
          type: 3, // STRING
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
          type: 4, // INTEGER
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
          type: 3, // STRING
          required: true,
          choices: [
            { name: 'View Config', value: 'view' },
            { name: 'Update Config', value: 'update' }
          ]
        },
        {
          name: 'key',
          description: 'Configuration key',
          type: 3, // STRING
          required: false
        },
        {
          name: 'value',
          description: 'New configuration value',
          type: 3, // STRING
          required: false
        }
      ]
    },
    {
      name: 'stats',
      description: 'View comment system statistics'
    },
    {
      name: 'cmd',
      description: 'Command palette and registration interface',
      options: [
        {
          name: 'action',
          description: 'Action to perform',
          type: 3, // STRING
          required: true,
          choices: [
            { name: 'Register', value: 'register' },
            { name: 'List Commands', value: 'list' },
            { name: 'Quick Actions', value: 'quick' },
            { name: 'Status', value: 'status' }
          ]
        },
        {
          name: 'platform',
          description: 'Platform (for registration)',
          type: 3, // STRING
          required: false,
          choices: [
            { name: 'AniList', value: 'anilist' },
            { name: 'MyAnimeList', value: 'myanimelist' },
            { name: 'SIMKL', value: 'simkl' }
          ]
        },
        {
          name: 'user_id',
          description: 'Platform user ID (for registration)',
          type: 3, // STRING
          required: false
        },
        {
          name: 'token',
          description: 'Platform access token (for registration)',
          type: 3, // STRING
          required: false
        }
      ]
    },
    {
      name: 'help',
      description: 'Show help information'
    }
  ]

  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/guilds/${DISCORD_GUILD_ID}/commands`,
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
      console.error('Discord API error:', errorText)
      throw new Error(`Discord API error: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    return new Response(
      JSON.stringify({
        success: true,
        commands: result,
        message: `Synced ${result.length} commands to Discord guild ${DISCORD_GUILD_ID}`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

  const { name: commandName, options, member, guild_id, channel_id } = command_data
  const discordUserId = member?.user?.id

  if (!discordUserId) {
    return new Response(
      JSON.stringify({ error: 'Discord user ID not found' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get user role and permissions
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
          flags: 64 // Ephemeral
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Handle different commands
  try {
    switch (commandName) {
      case 'register':
        return await handleRegisterCommand(supabase, options, member)
      
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
      
      case 'cmd':
        return await handleCmdCommand(supabase, options, registration, member)
      
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
async function handleRegisterCommand(supabase: any, options: any, member: any) {
  const platform = options.find(opt => opt.name === 'platform')?.value
  const userId = options.find(opt => opt.name === 'user_id')?.value
  const token = options.find(opt => opt.name === 'token')?.value

  // Verify token
  const tokenValid = await verifyPlatformToken(platform, userId, token)
  if (!tokenValid) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Invalid platform token. Please check your credentials.',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get user role
  const userRole = await getUserRoleFromPlatform(supabase, userId)

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

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: `✅ Successfully registered as **${userRole}**!\nPlatform: ${platform}\nUser ID: ${userId}`,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleBanCommand(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin'].includes(registration.user_role)) {
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

  // Call moderation API
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/moderation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'ban_user',
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        target_user_id: targetUserId,
        reason: reason,
        shadow_ban: shadow,
        token: 'bypass' // Admin actions bypass token verification
      })
    }
  )

  const result = await response.json()

  if (result.success) {
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
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to ban user: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleWarnCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin'].includes(registration.user_role)) {
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

  // Call moderation API
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/moderation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'warn_user',
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        target_user_id: targetUserId,
        reason: reason,
        severity: 'warning',
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.success) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully warned user **${targetUserId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to warn user: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handlePinCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin'].includes(registration.user_role)) {
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

  // Call moderation API
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/moderation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'pin_comment',
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        comment_id: commentId,
        reason: reason,
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.success) {
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
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to pin comment: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleLockCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin'].includes(registration.user_role)) {
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

  // Call moderation API
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/moderation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'lock_thread',
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        comment_id: commentId,
        reason: reason,
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.success) {
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
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to lock comment: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleDeleteCommand(supabase: any, options: any, registration: any) {
  const commentId = options.find(opt => opt.name === 'comment_id')?.value

  // Call comments API
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/comments`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'delete',
        comment_id: commentId,
        client_type: registration.platform_type,
        user_id: registration.platform_user_id,
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.success) {
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
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to delete comment: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

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

// Helper functions
async function verifyPlatformToken(platformType: string, userId: string, token: string) {
  try {
    switch (platformType) {
      case 'anilist':
        const response = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: '{ Viewer { id name } }'
          })
        })
        if (!response.ok) return false
        const data = await response.json()
        return data.data?.Viewer?.id?.toString() === userId

      case 'myanimelist':
        const malResponse = await fetch('https://api.myanimelist.net/v2/users/me', {
          headers: {
            'Authorization': `Bearer ${token}`,
          }
        })
        if (!malResponse.ok) return false
        const malData = await malResponse.json()
        return malData.id?.toString() === userId

      case 'simkl':
        const simklResponse = await fetch('https://api.simkl.com/users/settings', {
          headers: {
            'simkl-api-key': token,
          }
        })
        if (!simklResponse.ok) return false
        const simklData = await simklResponse.json()
        return simklData.account?.id?.toString() === userId

      default:
        return false
    }
  } catch (error) {
    console.error('Token verification error:', error)
    return false
  }
}

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
    console.error('Get user role error:', error)
    return 'user'
  }
}

// Additional command handlers
async function handleUnbanCommand(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin'].includes(registration.user_role)) {
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
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Unbanned by admin'

  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/moderation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'unban_user',
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        target_user_id: targetUserId,
        reason: reason,
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.success) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully unbanned user **${targetUserId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unban user: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handlePromoteCommand(supabase: any, options: any, registration: any) {
  if (registration.user_role !== 'super_admin') {
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
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Promoted by Super Admin'

  // Update user role in config
  const roleKey = `${newRole}_users`
  const { data: currentConfig } = await supabase
    .from('config')
    .select('value')
    .eq('key', roleKey)
    .single()

  const currentList = currentConfig ? JSON.parse(currentConfig.value) : []
  if (!currentList.includes(targetUserId)) {
    currentList.push(targetUserId)
  }

  // Remove from other role lists
  await removeFromAllRoles(supabase, targetUserId)

  // Add to new role
  const { error } = await supabase
    .from('config')
    .update({ value: JSON.stringify(currentList) })
    .eq('key', roleKey)

  if (error) {
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
}

async function handleDemoteCommand(supabase: any, options: any, registration: any) {
  if (registration.user_role !== 'super_admin') {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can demote users',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const newRole = options.find(opt => opt.name === 'role')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Demoted by Super Admin'

  // Remove from all roles
  await removeFromAllRoles(supabase, targetUserId)

  // Add to new role if not user
  if (newRole !== 'user') {
    const roleKey = `${newRole}_users`
    const { data: currentConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', roleKey)
      .single()

    const currentList = currentConfig ? JSON.parse(currentConfig.value) : []
    if (!currentList.includes(targetUserId)) {
      currentList.push(targetUserId)
    }

    const { error } = await supabase
      .from('config')
      .update({ value: JSON.stringify(currentList) })
      .eq('key', roleKey)

    if (error) {
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
}

async function handleMuteCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can mute users',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const duration = options.find(opt => opt.name === 'duration')?.value || 24
  const reason = options.find(opt => opt.name === 'reason')?.value

  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/moderation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'warn_user',
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        target_user_id: targetUserId,
        reason: reason,
        severity: 'mute',
        duration: duration,
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.success) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully muted **${targetUserId}** for ${duration} hours\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to mute user: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleUnmuteCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can unmute users',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Unmuted by moderator'

  // Update user comments to remove mute
  const { error } = await supabase
    .from('comments')
    .update({ user_muted_until: null })
    .eq('user_id', targetUserId)

  if (error) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unmute user: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: `✅ Successfully unmuted **${targetUserId}**\nReason: ${reason}`,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleShadowbanCommand(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can shadow ban users',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value

  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/moderation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'ban_user',
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        target_user_id: targetUserId,
        reason: reason,
        shadow_ban: true,
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.success) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully shadow banned **${targetUserId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to shadow ban user: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleUnshadowbanCommand(supabase: any, options: any, registration: any) {
  if (!['admin', 'super_admin'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Admins and Super Admins can remove shadow bans',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const targetUserId = options.find(opt => opt.name === 'user_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Shadow ban removed by admin'

  // Update user comments to remove shadow ban
  const { error } = await supabase
    .from('comments')
    .update({ user_shadow_banned: false })
    .eq('user_id', targetUserId)

  if (error) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to remove shadow ban: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: `✅ Successfully removed shadow ban from **${targetUserId}**\nReason: ${reason}`,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUnpinCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can unpin comments',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Unpinned by moderator'

  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/moderation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'unpin_comment',
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        comment_id: commentId,
        reason: reason,
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.success) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully unpinned comment **${commentId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unpin comment: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleUnlockCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can unlock comments',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value || 'Thread unlocked by moderator'

  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/moderation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'unlock_thread',
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        comment_id: commentId,
        reason: reason,
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.success) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully unlocked comment **${commentId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to unlock comment: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleReportCommand(supabase: any, options: any, registration: any) {
  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reason = options.find(opt => opt.name === 'reason')?.value
  const notes = options.find(opt => opt.name === 'notes')?.value

  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/reports`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'create',
        comment_id: commentId,
        reporter_id: registration.platform_user_id,
        reason: reason,
        notes: notes
      })
    }
  )

  const result = await response.json()

  if (result.success) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully reported comment **${commentId}**\nReason: ${reason}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to report comment: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleResolveCommand(supabase: any, options: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can resolve reports',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const commentId = options.find(opt => opt.name === 'comment_id')?.value
  const reporterId = options.find(opt => opt.name === 'reporter_id')?.value
  const resolution = options.find(opt => opt.name === 'resolution')?.value
  const notes = options.find(opt => opt.name === 'notes')?.value

  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/reports`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'resolve',
        comment_id: commentId,
        reporter_id: reporterId,
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        resolution: resolution,
        review_notes: notes,
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.success) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully ${resolution} report on comment **${commentId}**`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Failed to resolve report: ${result.error}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleQueueCommand(supabase: any, registration: any) {
  if (!['moderator', 'admin', 'super_admin'].includes(registration.user_role)) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Moderators and above can view the moderation queue',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/reports`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        action: 'get_queue',
        client_type: registration.platform_type,
        moderator_id: registration.platform_user_id,
        token: 'bypass'
      })
    }
  )

  const result = await response.json()

  if (result.reports && result.reports.length > 0) {
    const reportList = result.reports.slice(0, 10).map((report: any, index: number) => 
      `${index + 1}. **Comment ${report.commentId}** by ${report.author.username}\n   Reason: ${report.reports[0].reason}\n   Reports: ${report.totalReports}`
    ).join('\n\n')

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `🚨 **Moderation Queue** (${result.total} total)\n\n${reportList}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } else {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '✅ No pending reports in the queue',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleUserCommand(supabase: any, options: any) {
  const userId = options.find(opt => opt.name === 'user_id')?.value

  const { data: comments } = await supabase
    .from('comments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5)

  if (!comments || comments.length === 0) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ No comments found for user **${userId}**`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const user = comments[0]
  const totalComments = comments.length
  const totalUpvotes = comments.reduce((sum, comment) => sum + comment.upvotes, 0)
  const totalDownvotes = comments.reduce((sum, comment) => sum + comment.downvotes, 0)

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: `👤 **User Information for ${userId}**\n\n` +
          `**Username:** ${user.username}\n` +
          `**Platform:** ${user.client_type}\n` +
          `**Role:** ${user.user_role}\n` +
          `**Status:** ${user.user_banned ? '🚫 Banned' : user.user_shadow_banned ? '👻 Shadow Banned' : user.user_muted_until && new Date(user.user_muted_until) > new Date() ? '🔇 Muted' : '✅ Active'}\n\n` +
          `**Statistics:**\n` +
          `💬 Comments: ${totalComments}\n` +
          `👍 Upvotes: ${totalUpvotes}\n` +
          `👎 Downvotes: ${totalDownvotes}\n` +
          `⚠️ Warnings: ${user.user_warnings}`,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleCommentCommand(supabase: any, options: any) {
  const commentId = options.find(opt => opt.name === 'comment_id')?.value

  const { data: comment } = await supabase
    .from('comments')
    .select('*')
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

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: `💬 **Comment Information**\n\n` +
          `**ID:** ${comment.id}\n` +
          `**Author:** ${comment.username} (${comment.user_id})\n` +
          `**Platform:** ${comment.client_type}\n` +
          `**Media:** ${comment.media_title} (${comment.media_year})\n` +
          `**Created:** ${new Date(comment.created_at).toLocaleString()}\n\n` +
          `**Status:** ${comment.deleted ? '🗑️ Deleted' : comment.locked ? '🔒 Locked' : comment.pinned ? '📌 Pinned' : '💬 Active'}\n` +
          `**Votes:** 👍 ${comment.upvotes} / 👎 ${comment.downvotes} (Score: ${comment.vote_score})\n` +
          `**Reports:** 🚨 ${comment.report_count}\n\n` +
          `**Content:**\n${comment.content}`,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleConfigCommand(supabase: any, options: any, registration: any) {
  if (registration.user_role !== 'super_admin') {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: '❌ Only Super Admins can manage configuration',
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const action = options.find(opt => opt.name === 'action')?.value

  if (action === 'view') {
    const { data: configs } = await supabase
      .from('config')
      .select('*')
      .order('key')

    const configList = configs.map((config: any) => 
      `**${config.key}:** ${config.value}`
    ).join('\n')

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `⚙️ **System Configuration**\n\n${configList}`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } else if (action === 'update') {
    const key = options.find(opt => opt.name === 'key')?.value
    const value = options.find(opt => opt.name === 'value')?.value

    if (!key || !value) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '❌ Key and value are required for updating configuration',
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { error } = await supabase
      .from('config')
      .update({ value: value })
      .eq('key', key)

    if (error) {
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `❌ Failed to update configuration: ${error.message}`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `✅ Successfully updated **${key}** to **${value}**`,
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
  } else if (userRole === 'super_admin') {
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
  const roles = ['super_admin_users', 'admin_users', 'moderator_users']
  
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

// Command palette handler
// Command palette handler
async function handleCmdCommand(supabase: any, options: any, registration: any, member: any) {
  const action = options.find(opt => opt.name === 'action')?.value

  switch (action) {
    case 'register':
      return await handleCmdRegister(supabase, options, member, registration)
    
    case 'list':
      return await handleCmdList(registration)
    
    case 'quick':
      return await handleCmdQuick(registration)
    
    case 'status':
      return await handleCmdStatus(supabase, registration)
    
    default:
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: '❌ Invalid action. Use: register, list, quick, or status',
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
  }
}

async function handleCmdRegister(supabase: any, options: any, member: any, registration: any) {
  const platform = options.find(opt => opt.name === 'platform')?.value
  const userId = options.find(opt => opt.name === 'user_id')?.value
  const token = options.find(opt => opt.name === 'token')?.value

  if (!platform || !userId || !token) {
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `📝 **Quick Registration**\n\n` +
            `To register, provide:\n` +
            `• **Platform**: ${platform || 'required'}\n` +
            `• **User ID**: ${userId || 'required'}\n` +
            `• **Token**: ${token ? '✅ Provided' : 'required'}\n\n` +
            `**Example:**\n` +
            `\`/cmd action:register platform:anilist user_id:123456 token:your_token\`\n\n` +
            `**How to get tokens:**\n` +
            `• **AniList**: Go to Settings -> Developer -> Create Personal Access Token\n` +
            `• **MyAnimeList**: Go to API Settings -> Create Client ID\n` +
            `• **SIMKL**: Get API Key from SIMKL API settings`,
          flags: 64
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // If all fields are provided, proceed with registration
  return await handleRegisterCommand(supabase, [
    { name: 'platform', value: platform },
    { name: 'user_id', value: userId },
    { name: 'token', value: token }
  ], member)
}

async function handleCmdList(registration: any) {
  const userRole = registration?.user_role || 'user'
  
  let commands = []

  // Basic commands for all users
  commands.push('📝 **Basic Commands**')
  commands.push('• `/register` - Register your account')
  commands.push('• `/report <comment_id> <reason>` - Report content')
  commands.push('• `/user <user_id>` - Get user info')
  commands.push('• `/comment <comment_id>` - Get comment info')
  commands.push('• `/stats` - View statistics')
  commands.push('• `/help` - Show help')

  if (['moderator', 'admin', 'super_admin'].includes(userRole)) {
    commands.push('\n🛡️ **Moderator Commands**')
    commands.push('• `/warn <user_id> <reason>` - Warn user')
    commands.push('• `/mute <user_id> [duration] <reason>` - Mute user')
    commands.push('• `/unmute <user_id>` - Unmute user')
    commands.push('• `/pin <comment_id> [reason]` - Pin comment')
    commands.push('• `/unpin <comment_id>` - Unpin comment')
    commands.push('• `/lock <comment_id> [reason]` - Lock thread')
    commands.push('• `/unlock <comment_id>` - Unlock thread')
    commands.push('• `/resolve <comment_id> <reporter_id> <resolution>` - Resolve report')
    commands.push('• `/queue` - View moderation queue')
  }

  if (['admin', 'super_admin'].includes(userRole)) {
    commands.push('\n👑 **Admin Commands**')
    commands.push('• `/ban <user_id> <reason> [shadow]` - Ban user')
    commands.push('• `/unban <user_id>` - Unban user')
    commands.push('• `/shadowban <user_id> <reason>` - Shadow ban')
    commands.push('• `/unshadowban <user_id>` - Remove shadow ban')
    commands.push('• `/delete <comment_id>` - Delete any comment')
  }

  if (userRole === 'super_admin') {
    commands.push('\n⚡ **Super Admin Commands**')
    commands.push('• `/promote <user_id> <role> [reason]` - Promote user')
    commands.push('• `/demote <user_id> <role> [reason]` - Demote user')
    commands.push('• `/config <action> [key] [value]` - System config')
  }

  commands.push('\n🎯 **Quick Actions**')
  commands.push('• `/cmd action:quick` - Quick action menu')
  commands.push('• `/cmd action:status` - System status')
  commands.push('• `/cmd action:register` - Quick registration')

  const commandList = commands.join('\n')

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: `🤖 **Commentum Command List**\n\n**Your Role:** ${userRole}\n\n${commandList}`,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleCmdQuick(registration: any) {
  const userRole = registration?.user_role || 'user'
  
  let quickActions = []

  // Quick actions based on role
  if (userRole === 'user') {
    quickActions = [
      '🔍 **Quick Lookups**',
      '• User info: `/user <user_id>`',
      '• Comment info: `/comment <comment_id>`',
      '• System stats: `/stats`',
      '',
      '📝 **Quick Actions**',
      '• Report comment: `/report <comment_id> <reason>`',
      '• Register: `/cmd action:register`',
      '• Get help: `/help`'
    ]
  } else if (userRole === 'moderator') {
    quickActions = [
      '🛡️ **Quick Moderation**',
      '• Warn user: `/warn <user_id> <reason>`',
      '• Mute user: `/mute <user_id> 24 <reason>`',
      '• Pin comment: `/pin <comment_id>`',
      '• Lock thread: `/lock <comment_id>`',
      '',
      '📊 **Quick Info**',
      '• Check queue: `/queue`',
      '• User lookup: `/user <user_id>`',
      '• Resolve report: `/resolve <comment_id> <reporter_id> resolved`',
      '',
      '⚡ **Quick Actions**',
      '• View all commands: `/cmd action:list`',
      '• System status: `/cmd action:status`'
    ]
  } else if (userRole === 'admin') {
    quickActions = [
      '🔨 **Quick Admin Actions**',
      '• Ban user: `/ban <user_id> <reason>`',
      '• Shadow ban: `/shadowban <user_id> <reason>`',
      '• Delete comment: `/delete <comment_id>`',
      '• Unban user: `/unban <user_id>`',
      '',
      '🛡️ **Quick Moderation**',
      '• Warn user: `/warn <user_id> <reason>`',
      '• Pin/Unpin: `/pin <comment_id>` / `/unpin <comment_id>`',
      '• Lock/Unlock: `/lock <comment_id>` / `/unlock <comment_id>`',
      '',
      '📊 **Quick Info**',
      '• Check queue: `/queue`',
      '• User lookup: `/user <user_id>`',
      '• System stats: `/stats`',
      '',
      '⚡ **Quick Actions**',
      '• View all commands: `/cmd action:list`',
      '• System status: `/cmd action:status`'
    ]
  } else if (userRole === 'super_admin') {
    quickActions = [
      '⚡ **Quick Super Admin Actions**',
      '• Promote user: `/promote <user_id> <role>`',
      '• Demote user: `/demote <user_id> <role>`',
      '• Ban/Unban: `/ban <user_id> <reason>` / `/unban <user_id>`',
      '• Update config: `/config action:update key:<key> value:<value>`',
      '',
      '🔨 **Quick Admin Actions**',
      '• Shadow ban: `/shadowban <user_id> <reason>`',
      '• Delete comment: `/delete <comment_id>`',
      '• System toggle: `/config action:update key:system_enabled value:false`',
      '',
      '📊 **Quick Info**',
      '• View config: `/config action:view`',
      '• System stats: `/stats`',
      '• Check queue: `/queue`',
      '',
      '⚡ **Quick Actions**',
      '• View all commands: `/cmd action:list`',
      '• System status: `/cmd action:status`'
    ]
  }

  const actionList = quickActions.join('\n')

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: `⚡ **Quick Actions**\n\n**Your Role:** ${userRole}\n\n${actionList}`,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleCmdStatus(supabase: any, registration: any) {
  const userRole = registration?.user_role || 'user'
  
  // Get system status
  const { data: systemConfig } = await supabase
    .from('config')
    .select('key, value')
    .in('key', ['system_enabled', 'voting_enabled', 'reporting_enabled', 'discord_notifications_enabled'])
  const { data: commentStats } = await supabase
    .from('comments')
    .select('id')
  const { data: discordUsers } = await supabase
    .from('discord_users')
    .select('user_role, is_active')
    .eq('is_active', true)

  const systemStatus = systemConfig?.reduce((acc, config) => {
    acc[config.key] = JSON.parse(config.value)
    return acc
  }, {}) || {}

  const totalComments = commentStats?.length || 0
  const activeUsers = discordUsers?.length || 0
  const moderators = discordUsers?.filter(u => u.user_role === 'moderator').length || 0
  const admins = discordUsers?.filter(u => u.user_role === 'admin').length || 0
  const superAdmins = discordUsers?.filter(u => u.user_role === 'super_admin').length || 0

  let statusEmoji = '🟢'
  if (!systemStatus.system_enabled) statusEmoji = '🔴'
  else if (!systemStatus.voting_enabled || !systemStatus.reporting_enabled) statusEmoji = '🟡'

  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: `${statusEmoji} **System Status**\n\n` +
          `**🤖 Bot Status:** ${systemStatus.system_enabled ? '🟢 Online' : '🔴 Offline'}\n` +
          `**💬 Comments:** ${systemStatus.system_enabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
          `**🗳️ Voting:** ${systemStatus.voting_enabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
          `**🚨 Reporting:** ${systemStatus.reporting_enabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
          `**📢 Discord Notifications:** ${systemStatus.discord_notifications_enabled ? '🟢 Enabled' : '🔴 Disabled'}\n\n` +
          `**📊 Statistics:**\n` +
          `• Total Comments: ${totalComments}\n` +
          `• Active Discord Users: ${activeUsers}\n` +
          `• Moderators: ${moderators}\n` +
          `• Admins: ${admins}\n` +
          `• Super Admins: ${superAdmins}\n\n` +
          `**👤 Your Role:** ${userRole}\n` +
          `**📅 Last Check:** ${new Date().toLocaleString()}`,
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
