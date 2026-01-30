import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifySignature } from './utils.ts'
import { routeInteraction } from './router.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Check if this is a global command sync request (bypass Discord signature verification)
    if (req.method === 'POST') {
      try {
        const cloneReq = req.clone()
        const body = await cloneReq.json()
        if (body.action === 'sync_global_commands' || body.action === 'sync_commands') {
          console.log('🌍 Handling global command sync request')
          return await handleGlobalCommandSync()
        }
      } catch (syncError) {
        // If it's not a sync request, continue with normal Discord processing
        console.log('Not a sync request, continuing with normal Discord processing')
      }
    }

    // Verify Discord signature for normal interactions
    const signature = req.headers.get('x-signature-ed25519')
    const timestamp = req.headers.get('x-signature-timestamp')
    
    if (!signature || !timestamp) {
      return new Response('Missing signature headers', { status: 401 })
    }

    const body = await req.text()
    const isValidSignature = await verifySignature(body, signature, timestamp)
    
    if (!isValidSignature) {
      return new Response('Invalid signature', { status: 401 })
    }

    const interaction = JSON.parse(body)
    
    // Handle ping for Discord verification
    if (interaction.type === 1) {
      return new Response(
        JSON.stringify({ type: 1 }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Route interaction to appropriate handler
    return await routeInteraction(supabase, interaction)

  } catch (error) {
    console.error('Discord bot error:', error)
    return new Response(
      JSON.stringify({ 
        type: 4,
        data: {
          content: '❌ An error occurred while processing your command.',
          flags: 64
        }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Global Command Sync Function
async function handleGlobalCommandSync(): Promise<Response> {
  const DISCORD_API_BASE = 'https://discord.com/api/v10'
  const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
  const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')

  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
    return new Response(
      JSON.stringify({ 
        error: 'Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID environment variables' 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Define all global slash commands
  const globalCommands = [
    {
      name: 'register',
      description: 'Register your platform account with Commentum',
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
          name: 'server',
          description: 'Server name to register with',
          type: 3, // STRING
          required: true
        }
      ]
    },
    {
      name: 'report',
      description: 'Report a comment for moderation',
      options: [
        {
          name: 'comment_id',
          description: 'Comment ID to report',
          type: 4, // INTEGER
          required: true
        },
        {
          name: 'reason',
          description: 'Report reason',
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
      name: 'user',
      description: 'Get detailed user information',
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
      description: 'Get detailed comment information',
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
      name: 'stats',
      description: 'View system statistics'
    },
    {
      name: 'help',
      description: 'Show help information based on your role'
    },
    {
      name: 'warn',
      description: 'Warn a user',
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
      name: 'unwarn',
      description: 'Remove warning from user',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to unwarn',
          type: 3, // STRING
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for removing warning',
          type: 3, // STRING
          required: false
        }
      ]
    },
    {
      name: 'mute',
      description: 'Mute a user for specified duration',
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
      description: 'Remove mute from a user',
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
      name: 'pin',
      description: 'Pin a comment to highlight it',
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
      description: 'Unpin a comment',
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
      description: 'Lock a comment thread to prevent replies',
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
      description: 'Unlock a comment thread',
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
      name: 'resolve',
      description: 'Resolve a reported comment',
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
      description: 'View moderation queue of pending reports'
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
      name: 'ban',
      description: 'Ban a user from the system',
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
      description: 'Unban a user',
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
      name: 'shadowban',
      description: 'Shadow ban a user',
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
      description: 'Remove shadow ban from a user',
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
      name: 'promote',
      description: 'Promote a user to higher role',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to promote',
          type: 3, // STRING
          required: true
        },
        {
          name: 'role',
          description: 'New role',
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
      description: 'Demote a user to lower role',
      options: [
        {
          name: 'user_id',
          description: 'Platform user ID to demote',
          type: 3, // STRING
          required: true
        },
        {
          name: 'role',
          description: 'New role',
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
      name: 'config',
      description: 'View or update system configuration',
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
      name: 'add',
      description: 'Configure a new server (Super Admin only)',
      options: [
        {
          name: 'server_name',
          description: 'Server name',
          type: 3, // STRING
          required: true
        },
        {
          name: 'guild_id',
          description: 'Discord guild ID',
          type: 3, // STRING
          required: true
        },
        {
          name: 'webhook_url',
          description: 'Discord webhook URL',
          type: 3, // STRING
          required: false
        },
        {
          name: 'role_id',
          description: 'Discord role ID for auto-assignment',
          type: 3, // STRING
          required: false
        }
      ]
    }
  ]

  try {
    console.log(`🌍 Syncing ${globalCommands.length} global commands to Discord...`)

    const response = await fetch(
      `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(globalCommands)
      }
    )

    if (!response.ok) {
      const errorData = await response.text()
      console.error('❌ Global command sync failed:', errorData)
      return new Response(
        JSON.stringify({ 
          error: 'Failed to sync global commands',
          status: response.status,
          details: errorData
        }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const result = await response.json()
    console.log(`✅ Successfully synced ${result.length} global commands!`)

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Successfully synced ${result.length} global commands to Discord!`,
        commands: result.map((cmd: any) => ({
          name: cmd.name,
          description: cmd.description,
          id: cmd.id
        }))
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Error syncing global commands:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error during global command sync',
        details: error.message
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}