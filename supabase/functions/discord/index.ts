import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { getUserRole } from '../shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Discord API configuration
const DISCORD_API_BASE = 'https://discord.com/api/v10'
const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')
const DISCORD_CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')
const DISCORD_PUBLIC_KEY = Deno.env.get('DISCORD_PUBLIC_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

// Simple ping command handler
async function handlePingCommand() {
  return new Response(
    JSON.stringify({
      type: 4,
      data: {
        content: '🏓 Pong! Bot is working correctly - MINIMAL VERSION',
        flags: 64
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Handle Discord interactions
async function handleDiscordInteraction(supabase: any, body: any) {
  const { type, data } = body

  // Handle slash command interactions
  if (type === 2) {
    const commandName = data.name

    switch (commandName) {
      case 'ping':
        return await handlePingCommand()
      
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
  }

  return new Response(
    JSON.stringify({ error: 'Unsupported interaction type' }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Delete all existing commands (both global and guild)
async function handleDeleteAllCommands(supabase: any) {
  console.log('🧹 Starting to delete ALL existing Discord commands...')

  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
    return new Response(
      JSON.stringify({ error: 'Missing Discord credentials' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const results = {
    global: { success: false, count: 0, error: null },
    guilds: []
  }

  // Delete global commands
  try {
    console.log('Deleting global commands...')
    const globalResponse = await fetch(
      `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([]) // Empty array to delete all
      }
    )

    if (globalResponse.ok) {
      const deletedCommands = await globalResponse.json()
      results.global = { success: true, count: deletedCommands.length, error: null }
      console.log(`✅ Successfully deleted ${deletedCommands.length} global commands`)
    } else {
      const errorText = await globalResponse.text()
      results.global.error = errorText
      console.log(`⚠️ Failed to delete global commands: ${errorText}`)
    }
  } catch (error) {
    results.global.error = error.message
    console.log(`❌ Error deleting global commands:`, error.message)
  }

  // Get guilds from database and delete guild commands
  try {
    const { data: activeRegistrations } = await supabase
      .from('discord_users')
      .select('discord_user_id')
      .eq('is_active', true)

    if (activeRegistrations && activeRegistrations.length > 0) {
      console.log(`Deleting commands from ${activeRegistrations.length} guilds...`)
      
      for (const registration of activeRegistrations) {
        const guildId = registration.discord_user_id
        
        try {
          const guildResponse = await fetch(
            `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/guilds/${guildId}/commands`,
            {
              method: 'PUT',
              headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify([]) // Empty array to delete all
            }
          )

          if (guildResponse.ok) {
            const deletedCommands = await guildResponse.json()
            results.guilds.push({ guildId, success: true, count: deletedCommands.length, error: null })
            console.log(`✅ Deleted ${deletedCommands.length} commands from guild ${guildId}`)
          } else {
            const errorText = await guildResponse.text()
            results.guilds.push({ guildId, success: false, count: 0, error: errorText })
            console.log(`⚠️ Failed to delete commands from guild ${guildId}: ${errorText}`)
          }
        } catch (error) {
          results.guilds.push({ guildId, success: false, count: 0, error: error.message })
          console.log(`❌ Error deleting guild ${guildId} commands:`, error.message)
        }
      }
    }
  } catch (error) {
    console.log('❌ Error getting guilds from database:', error.message)
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Command deletion completed',
      results
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Sync minimal commands globally only
async function handleGlobalSyncCommands(supabase: any) {
  console.log('🚀 Starting global command sync...')

  if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
    return new Response(
      JSON.stringify({ error: 'Missing Discord credentials' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Define minimal slash commands for global deployment
  const commands = [
    {
      name: 'ping',
      description: 'Test command to verify bot is working - MINIMAL VERSION'
    }
  ]

  try {
    // Sync to application globally (no guild-specific endpoint)
    console.log('Sending bulk overwrite request to Discord:')
    console.log('- URL:', `${DISCORD_API_BASE}/applications/${DISCORD_CLIENT_ID}/commands`)
    console.log('- Method: PUT')
    console.log('- Commands count:', commands.length)
    console.log('- Bot token length:', DISCORD_BOT_TOKEN.length)
    console.log('- Client ID:', DISCORD_CLIENT_ID)

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

    console.log('Discord API response status:', response.status)
    console.log('Discord API response headers:', Object.fromEntries(response.headers.entries()))

    if (response.ok) {
      const syncedCommands = await response.json()
      console.log('Successfully synced commands:', syncedCommands.length)
      
      return new Response(
        JSON.stringify({
          type: 4,
          data: {
            content: `✅ **Global bot sync successful!**\n\n` +
              `🤖 **Commands synced:** ${syncedCommands.length}\n` +
              `📋 **Commands:** ${syncedCommands.map((cmd: any) => cmd.name).join(', ')}\n\n` +
              `🎯 **Scope:** Global (all servers)\n` +
              `⚡ **Status:** Active and ready`,
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
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)
    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    // Parse request body for POST requests
    let body = {}
    if (req.method === 'POST') {
      try {
        body = await req.json()
      } catch (e) {
        console.log('No body or invalid JSON')
      }
    }

    switch (action) {
      case 'delete_all_commands':
        return await handleDeleteAllCommands(supabase)
      
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
