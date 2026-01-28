import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

// Import all command handlers
import { 
  handlePromoteCommand, 
  handleDemoteCommand 
} from './handlers/user-commands.ts'

import { 
  handleCommentCommand, 
  handleUserCommand 
} from './handlers/comment-commands.ts'

import { 
  handleBanCommand, 
  handleUnbanCommand, 
  handleWarnCommand 
} from './handlers/moderation-commands.ts'

import { 
  handleConfigCommand, 
  handleStatsCommand, 
  handleSyncCommand 
} from './handlers/config-commands.ts'

import {
  handlePinCommand,
  handleUnpinCommand,
  handleLockCommand,
  handleUnlockCommand,
  handleDeleteCommand
} from './handlers/content-commands.ts'

import {
  handleMuteCommand,
  handleUnmuteCommand,
  handleShadowbanCommand,
  handleUnshadowbanCommand
} from './handlers/user-management-commands.ts'

import {
  handleReportCommand,
  handleResolveCommand,
  handleQueueCommand
} from './handlers/report-commands.ts'

import {
  verifyPlatformToken,
  getUserRoleFromPlatform,
  removeFromAllRoles,
  handleHelpCommand,
  handleRegisterCommand,
  handleWebhooksCommand
} from './handlers/utility-commands.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
}

// Helper functions
function hexToUint8Array(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g)
  if (!matches) return new Uint8Array()
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)))
}

async function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder()
    const keyData = hexToUint8Array(publicKey)
    const messageData = encoder.encode(timestamp + body)
    
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
      false,
      ['verify']
    )
    
    const signatureData = hexToUint8Array(signature)
    
    return await crypto.subtle.verify(
      'NODE-ED25519',
      key,
      signatureData,
      messageData
    )
  } catch (error) {
    console.error('Signature verification error:', error)
    return false
  }
}

// Main server function
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
    
    const rawBody = await req.text()
    const body = rawBody
    
    // Parse JSON body
    let params
    try {
      params = JSON.parse(body)
    } catch {
      params = {}
    }

    // Handle different actions
    const action = params.action || params.type
    
    switch (action) {
      case 'sync_commands':
        return await handleSyncCommands(supabase, params.guild_ids)
        
      case 'register':
        return await handleDiscordRegistration(supabase, params)
        
      case 'verify':
        return await handleDiscordVerification(supabase, params)
        
      case 'interaction':
        return await handleDiscordInteraction(supabase, params)
        
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

// Discord interaction handler
async function handleDiscordInteraction(supabase: any, params: any) {
  const { command_data } = params

  if (!command_data) {
    return new Response(
      JSON.stringify({ error: 'Command data required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const commandName = command_data.name
  const options = command_data.options || []
  
  // Get user registration for permission checks
  const { data: registration } = await supabase
    .from('discord_users')
    .select('*')
    .eq('discord_user_id', command_data.member.user.id)
    .single()

  try {
    switch (commandName) {
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
        return await handleQueueCommand(supabase)
      
      case 'user':
        return await handleUserCommand(supabase, options)
      
      case 'comment':
        return await handleCommentCommand(supabase, options)
      
      case 'config':
        return await handleConfigCommand(supabase, options, registration)
      
      case 'stats':
        return await handleStatsCommand(supabase)
      
      case 'sync':
        return await handleSyncCommand(supabase, registration)
      
      case 'help':
        return await handleHelpCommand(registration)
      
      case 'register':
        return await handleRegisterCommand(supabase, options, command_data.member)
      
      case 'webhooks':
        return await handleWebhooksCommand(supabase, options, registration)
      
      default:
        return new Response(
          JSON.stringify({
            type: 4,
            data: {
              content: '❌ Unknown command. Use /help for available commands.',
              flags: 64
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Error handling Discord command:', error)
    return new Response(
      JSON.stringify({
        type: 4,
        data: {
          content: `❌ Error: ${error.message}`,
          flags: 64
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// Core Discord functions
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

  try {
    // Register Discord user
    await supabase
      .from('discord_users')
      .insert({
        discord_user_id,
        discord_username,
        platform_user_id,
        platform_type,
        user_role: userRole,
        is_active: true,
        registered_at: new Date().toISOString()
      })

    return new Response(
      JSON.stringify({ 
        success: true, 
        user_role: userRole,
        message: `Successfully registered ${discord_username} as ${userRole}`
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Registration error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to register user' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleDiscordVerification(supabase: any, params: any) {
  const { discord_user_id } = params

  if (!discord_user_id) {
    return new Response(
      JSON.stringify({ error: 'Discord user ID is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get Discord user registration
    const { data: registration } = await supabase
      .from('discord_users')
      .select('*')
      .eq('discord_user_id', discord_user_id)
      .single()

    if (!registration) {
      return new Response(
        JSON.stringify({ error: 'Discord user not registered' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get user's current role from platform
    const currentRole = await getUserRoleFromPlatform(supabase, registration.platform_user_id)

    return new Response(
      JSON.stringify({
        success: true,
        registration: {
          ...registration,
          current_role: currentRole
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Verification error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to verify user' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleGetUserRole(supabase: any, params: any) {
  const { user_id, platform_type } = params

  if (!user_id || !platform_type) {
    return new Response(
      JSON.stringify({ error: 'User ID and platform type are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const userRole = await getUserRoleFromPlatform(supabase, user_id)

    return new Response(
      JSON.stringify({
        success: true,
        user_id,
        platform_type,
        user_role: userRole
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Get user role error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to get user role' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleSyncCommands(supabase: any, guildIds?: string[]) {
  try {
    // Get Discord configuration
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

    const { data: guildIdsConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_guild_ids')
      .single()

    // DON'T parse these - they're plain strings, not JSON
    const DISCORD_BOT_TOKEN = botTokenConfig?.value || ''
    const DISCORD_CLIENT_ID = clientIdConfig?.value || ''

    // Get guild IDs - use provided ones, or from config, or fallback to single guild_id
    let targetGuildIds: string[] = []
    if (guildIds && guildIds.length > 0) {
      targetGuildIds = guildIds
    } else if (guildIdsConfig?.value) {
      try {
        targetGuildIds = JSON.parse(guildIdsConfig.value)
      } catch {
        targetGuildIds = guildIdsConfig.value.split(',').map(id => id.trim())
      }
    } else {
      // Fallback to single guild_id config
      const { data: guildIdConfig } = await supabase
        .from('config')
        .select('value')
        .eq('key', 'discord_guild_id')
        .single()
      if (guildIdConfig?.value) {
        targetGuildIds = [guildIdConfig.value]
      }
    }

    if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID || !targetGuildIds.length) {
      return new Response(
        JSON.stringify({ 
          error: 'Discord configuration missing in database',
          details: {
            bot_token: !!DISCORD_BOT_TOKEN,
            client_id: !!DISCORD_CLIENT_ID,
            guild_ids: targetGuildIds
          },
          message: 'Please update config table with Discord credentials'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Define slash commands
    const commands = [
      {
        name: 'ban',
        description: 'Ban a user from commenting (Moderator only)',
        options: [
          {
            name: 'user_id',
            description: 'User ID to ban',
            type: 3,
            required: true
          },
          {
            name: 'reason',
            description: 'Reason for ban',
            type: 3,
            required: false
          },
          {
            name: 'shadow',
            description: 'Shadow ban (user can\'t see they\'re banned)',
            type: 5,
            required: false
          }
        ]
      },
      {
        name: 'unban',
        description: 'Unban a user (Moderator only)',
        options: [
          {
            name: 'user_id',
            description: 'User ID to unban',
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
            description: 'User ID to promote',
            type: 3,
            required: true
          },
          {
            name: 'role',
            description: 'New role (moderator, admin, super_admin)',
            type: 3,
            required: true,
            choices: [
              { name: 'moderator', value: 'moderator' },
              { name: 'admin', value: 'admin' },
              { name: 'super_admin', value: 'super_admin' }
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
        description: 'Demote a user from role (Super Admin only)',
        options: [
          {
            name: 'user_id',
            description: 'User ID to demote',
            type: 3,
            required: true
          },
          {
            name: 'role',
            description: 'Role to remove (moderator, admin, super_admin)',
            type: 3,
            required: true,
            choices: [
              { name: 'moderator', value: 'moderator' },
              { name: 'admin', value: 'admin' },
              { name: 'super_admin', value: 'super_admin' }
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
        description: 'Warn a user (Moderator only)',
        options: [
          {
            name: 'user_id',
            description: 'User ID to warn',
            type: 3,
            required: true
          },
          {
            name: 'reason',
            description: 'Reason for warning',
            type: 3,
            required: false
          }
        ]
      },
      {
        name: 'mute',
        description: 'Mute a user temporarily (Moderator only)',
        options: [
          {
            name: 'user_id',
            description: 'User ID to mute',
            type: 3,
            required: true
          },
          {
            name: 'duration',
            description: 'Mute duration (e.g., 24h, 3d, 1w)',
            type: 3,
            required: false
          },
          {
            name: 'reason',
            description: 'Reason for mute',
            type: 3,
            required: false
          }
        ]
      },
      {
        name: 'unmute',
        description: 'Unmute a user (Moderator only)',
        options: [
          {
            name: 'user_id',
            description: 'User ID to unmute',
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
        description: 'Shadow ban a user (Admin only)',
        options: [
          {
            name: 'user_id',
            description: 'User ID to shadow ban',
            type: 3,
            required: true
          },
          {
            name: 'reason',
            description: 'Reason for shadow ban',
            type: 3,
            required: false
          }
        ]
      },
      {
        name: 'unshadowban',
        description: 'Remove shadow ban from user (Admin only)',
        options: [
          {
            name: 'user_id',
            description: 'User ID to unshadow ban',
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
        description: 'Pin a comment (Moderator only)',
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
        description: 'Unpin a comment (Moderator only)',
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
        description: 'Lock a comment thread (Moderator only)',
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
        description: 'Unlock a comment thread (Moderator only)',
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
        description: 'Delete a comment (Moderator only)',
        options: [
          {
            name: 'comment_id',
            description: 'Comment ID to delete',
            type: 3,
            required: true
          },
          {
            name: 'reason',
            description: 'Reason for deletion',
            type: 3,
            required: false
          }
        ]
      },
      {
        name: 'report',
        description: 'Report a comment (Moderator only)',
        options: [
          {
            name: 'comment_id',
            description: 'Comment ID to report',
            type: 3,
            required: true
          },
          {
            name: 'reason',
            description: 'Reason for report',
            type: 3,
            required: false
          }
        ]
      },
      {
        name: 'resolve',
        description: 'Resolve a report (Moderator only)',
        options: [
          {
            name: 'comment_id',
            description: 'Comment ID with report',
            type: 3,
            required: true
          },
          {
            name: 'resolution',
            description: 'Resolution status',
            type: 3,
            required: false,
            choices: [
              { name: 'resolved', value: 'resolved' },
              { name: 'dismissed', value: 'dismissed' },
              { name: 'reviewed', value: 'reviewed' }
            ]
          }
        ]
      },
      {
        name: 'queue',
        description: 'View moderation queue (Moderator only)'
      },
      {
        name: 'user',
        description: 'Get information about a user',
        options: [
          {
            name: 'user_id',
            description: 'User ID to lookup',
            type: 3,
            required: true
          }
        ]
      },
      {
        name: 'comment',
        description: 'Get information about a comment',
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
        name: 'config',
        description: 'View system configuration (Super Admin only)'
      },
      {
        name: 'stats',
        description: 'View system statistics'
      },
      {
        name: 'sync',
        description: 'Sync Discord commands (Super Admin only)'
      },
      {
        name: 'help',
        description: 'Show available commands'
      },
      {
        name: 'register',
        description: 'Register Discord user with platform account',
        options: [
          {
            name: 'user_id',
            description: 'Platform user ID',
            type: 3,
            required: true
          },
          {
            name: 'platform',
            description: 'Platform type',
            type: 3,
            required: true,
            choices: [
              { name: 'anilist', value: 'anilist' },
              { name: 'myanimelist', value: 'myanimelist' },
              { name: 'simkl', value: 'simkl' }
            ]
          },
          {
            name: 'token',
            description: 'Platform access token',
            type: 3,
            required: true
          }
        ]
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
    
    for (const guildId of targetGuildIds) {
      try {
        const response = await fetch(
          `https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/guilds/${guildId}/commands`,
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