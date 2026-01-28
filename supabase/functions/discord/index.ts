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

// Log on startup
console.log('DISCORD_PUBLIC_KEY exists:', !!DISCORD_PUBLIC_KEY)
console.log('DISCORD_PUBLIC_KEY length:', DISCORD_PUBLIC_KEY?.length)

// Helper functions
function hexToUint8Array(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g)
  if (!matches) return new Uint8Array()
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)))
}

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

    const { action, discord_user_id, discord_username, platform_user_id, platform_type, token, command_data } = body

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
  // Use environment variables first (like the old working version)
  let DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
  let DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')
  let targetGuildIds: string[] = []

  // If guild IDs provided as parameter, use them
  if (guildIds && guildIds.length > 0) {
    targetGuildIds = guildIds
  } else {
    // Use environment variable if available
    const envGuildIds = Deno.env.get('DISCORD_GUILD_IDS')
    if (envGuildIds) {
      try {
        targetGuildIds = JSON.parse(envGuildIds)
      } catch {
        targetGuildIds = envGuildIds.split(',').map(id => id.trim())
      }
    } else {
      // Fallback to single guild_id environment variable
      const envGuildId = Deno.env.get('DISCORD_GUILD_ID')
      if (envGuildId) {
        targetGuildIds = [envGuildId]
      }
    }
  }

  // If still no guild IDs, try database config as fallback
  if (targetGuildIds.length === 0) {
    try {
      const { data: guildIdsConfig } = await supabase
        .from('config')
        .select('value')
        .eq('key', 'discord_guild_ids')
        .single()

      if (guildIdsConfig?.value) {
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
    } catch (error) {
      console.error('Database config error:', error)
    }
  }

  // If still no config from database, try environment variables as final fallback
  if (!DISCORD_BOT_TOKEN) {
    DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
  }
  if (!DISCORD_CLIENT_ID) {
    DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')
  }

  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID || !targetGuildIds.length) {
    return new Response(
      JSON.stringify({ 
        error: 'Discord configuration missing',
        details: {
          bot_token: !!DISCORD_BOT_TOKEN,
          client_id: !!DISCORD_CLIENT_ID,
          guild_ids: targetGuildIds,
          env_bot_token: !!Deno.env.get('DISCORD_BOT_TOKEN'),
          env_client_id: !!Deno.env.get('DISCORD_CLIENT_ID'),
          env_guild_id: !!Deno.env.get('DISCORD_GUILD_ID'),
          env_guild_ids: !!Deno.env.get('DISCORD_GUILD_IDS')
        },
        message: 'Please set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_IDS environment variables'
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