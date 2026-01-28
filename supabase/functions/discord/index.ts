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
  // Implementation will be below
  return await handleBanCommand_impl(supabase, options, registration)
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

async function handleSyncCommands(supabase: any, guildIds?: string[]) {
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
      name: 'stats',
      description: 'View comment system statistics'
    },
    {
      name: 'help',
      description: 'Show help information'
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
    return await handleRegisterCommand(supabase, options, member)
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
      
      case 'sync-multi':
        return await handleSyncCommands(supabase) // Will use configured guild IDs
      
      case 'webhooks':
        return await handleWebhooksCommand(supabase, options, registration)
      
      case 'help':
        return await handleHelpCommand(registration)
      
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

  // Get user role from config (no token verification needed in new system)
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

async function verifyPlatformToken(platformType: string, userId: string, token: string) {
  try {
    switch (platformType) {
      case 'anilist':
        return await verifyAniListToken(userId, token)
      case 'myanimelist':
        return await verifyMyAnimeListToken(userId, token)
      case 'simkl':
        return await verifySIMKLToken(userId, token)
      default:
        return false
    }
  } catch (error) {
    console.error(`Token verification error for ${platformType}:`, error)
    return false
  }
}

// AniList token verification
async function verifyAniListToken(userId: string, token: string) {
  try {
    const query = `
      query {
        Viewer {
          id
          name
          avatar {
            large
            medium
          }
        }
      }
    `

    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    })

    if (!response.ok) return false

    const data = await response.json()
    if (data.errors) return false

    const user = data.data.Viewer
    return user.id.toString() === userId
  } catch (error) {
    console.error('AniList token verification error:', error)
    return false
  }
}

// MyAnimeList token verification
async function verifyMyAnimeListToken(userId: string, token: string) {
  try {
    const clientId = Deno.env.get('MYANIMELIST_CLIENT_ID')
    if (!clientId) {
      console.warn('MYANIMELIST_CLIENT_ID not configured')
      return false
    }

    const response = await fetch('https://api.myanimelist.net/v2/users/me', {
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    })

    if (!response.ok) return false

    const data = await response.json()
    return data.id.toString() === userId
  } catch (error) {
    console.error('MyAnimeList token verification error:', error)
    return false
  }
}

// SIMKL token verification
async function verifySIMKLToken(userId: string, token: string) {
  try {
    const clientId = Deno.env.get('SIMKL_CLIENT_ID')
    if (!clientId) {
      console.warn('SIMKL_CLIENT_ID not configured')
      return false
    }

    const response = await fetch('https://api.simkl.com/users/settings', {
      headers: {
        'simkl-api-key': token,
      }
    })

    if (!response.ok) return false

    const data = await response.json()
    return data.account?.id?.toString() === userId
  } catch (error) {
    console.error('SIMKL token verification error:', error)
    return false
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

// Unban command handler
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
            content: `❌ User **${targetUserId}** not found in system`,
            flags: 64
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Unban the user
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

    // Send Discord notification for ALL actions
    const { sendDiscordNotification } = await import('../shared/discordNotifications.ts')
    await sendDiscordNotification(supabase, {
      type: 'user_unbanned',
      user: { id: targetUserId, username: targetUserId },
      moderator: { id: registration.platform_user_id, username: registration.platform_user_id },
      reason: reason
    })

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

// Promote command handler
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

// Demote command handler
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
      // user role - don't add to any list
    }

    // Update all role configurations
    await Promise.all([
      supabase.from('config').update({ value: JSON.stringify(newSuperAdmins) }).eq('key', 'super_admin_users'),
      supabase.from('config').update({ value: JSON.stringify(newAdmins) }).eq('key', 'admin_users'),
      supabase.from('config').update({ value: JSON.stringify(newModerators) }).eq('key', 'moderator_users')
    ])

    // Send Discord notification
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

// Mute command handler
async function handleMuteCommand(supabase: any, options: any, registration: any) {
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
async function handleUnmuteCommand(supabase: any, options: any, registration: any) {
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
async function handleShadowbanCommand(supabase: any, options: any, registration: any) {
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
async function handleUnshadowbanCommand(supabase: any, options: any, registration: any) {
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
async function handleUnpinCommand(supabase: any, options: any, registration: any) {
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
async function handleUnlockCommand(supabase: any, options: any, registration: any) {
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
async function handleReportCommand(supabase: any, options: any, registration: any) {
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
async function handleResolveCommand(supabase: any, options: any, registration: any) {
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
async function handleQueueCommand(supabase: any) {
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
async function handleConfigCommand(supabase: any, options: any, registration: any) {
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
