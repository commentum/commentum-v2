import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_KEY')!
const DISCORD_WEBHOOK_URL = Deno.env.get('DISCORD_WEBHOOK_URL')!
const DISCORD_BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')! // For bot avatar

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Cache bot user info to avoid repeated API calls
let botUserInfo: any = null

// Get bot user information for avatar
async function getBotUserInfo() {
  if (botUserInfo) return botUserInfo
  
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      console.error('Failed to get bot user info:', await response.text())
      return null
    }

    botUserInfo = await response.json()
    return botUserInfo
  } catch (error) {
    console.error('Error getting bot user info:', error)
    return null
  }
}

// Discord webhook notification function
async function sendDiscordNotification(embed: any) {
  try {
    // Get bot user info for avatar
    const botInfo = await getBotUserInfo()
    
    const payload = {
      embeds: [embed],
      username: 'Commentum Bot',
      avatar_url: botInfo?.avatar 
        ? `https://cdn.discordapp.com/avatars/${botInfo.id}/${botInfo.avatar}.png`
        : 'https://via.placeholder.com/256/256/4287f5/ffffff?text=CM' // Fallback avatar
    }

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      console.error('Discord webhook error:', await response.text())
      return false
    }

    return true
  } catch (error) {
    console.error('Error sending Discord notification:', error)
    return false
  }
}

// Create notification embed for new comment
function createNewCommentEmbed(comment: any) {
  return {
    title: '📝 New Comment Posted',
    color: 0x00ff00, // Green
    timestamp: new Date(comment.created_at).toISOString(),
    fields: [
      {
        name: 'User',
        value: `${comment.username} (${comment.user_id})`,
        inline: true
      },
      {
        name: 'Media',
        value: `${comment.media_title} (${comment.media_type.toUpperCase()})`,
        inline: true
      },
      {
        name: 'Content',
        value: comment.content.length > 200 
          ? comment.content.substring(0, 200) + '...' 
          : comment.content
      },
      {
        name: 'Comment ID',
        value: comment.id.toString(),
        inline: true
      }
    ],
    footer: {
      text: `Client: ${comment.client_type}`
    }
  }
}

// Create notification embed for moderation actions
function createModerationEmbed(comment: any, action: string, moderatorId: string) {
  const actionColors = {
    'delete': 0xff0000,    // Red
    'pin': 0xffd700,       // Gold
    'unpin': 0x808080,     // Gray
    'lock': 0xff8c00,      // Dark Orange
    'unlock': 0x00ff00,    // Green
    'warn': 0xffa500,      // Orange
    'ban': 0x8b0000        // Dark Red
  }

  return {
    title: `🔨 Comment ${action.charAt(0).toUpperCase() + action.slice(1)}`,
    color: actionColors[action as keyof typeof actionColors] || 0x0000ff,
    timestamp: new Date().toISOString(),
    fields: [
      {
        name: 'Comment ID',
        value: comment.id.toString(),
        inline: true
      },
      {
        name: 'Author',
        value: `${comment.username} (${comment.user_id})`,
        inline: true
      },
      {
        name: 'Content',
        value: comment.content.length > 200 
          ? comment.content.substring(0, 200) + '...' 
          : comment.content
      },
      {
        name: 'Moderator',
        value: moderatorId,
        inline: true
      }
    ],
    footer: {
      text: `Client: ${comment.client_type} | Media: ${comment.media_title}`
    }
  }
}

// Create notification embed for new report
function createNewReportEmbed(comment: any, reportCount: number) {
  return {
    title: '🚨 New Comment Report',
    color: 0xff0000, // Red
    timestamp: new Date().toISOString(),
    fields: [
      {
        name: 'Comment ID',
        value: comment.id.toString(),
        inline: true
      },
      {
        name: 'Report Count',
        value: reportCount.toString(),
        inline: true
      },
      {
        name: 'Author',
        value: `${comment.username} (${comment.user_id})`,
        inline: true
      },
      {
        name: 'Content',
        value: comment.content.length > 200 
          ? comment.content.substring(0, 200) + '...' 
          : comment.content
      }
    ],
    footer: {
      text: `Client: ${comment.client_type} | Media: ${comment.media_title}`
    }
  }
}

// Handle database webhook events
async function handleWebhookEvent(event: any) {
  const { table, record, type } = event

  // Handle new comment insertion
  if (table === 'comments' && type === 'INSERT') {
    // Only notify for non-deleted comments
    if (!record.deleted) {
      const embed = createNewCommentEmbed(record)
      await sendDiscordNotification(embed)
    }
  }

  // Handle comment updates (moderation actions)
  if (table === 'comments' && type === 'UPDATE') {
    const { old_record, new_record } = event
    
    // Check if this was a moderation action
    const moderationActions = ['deleted', 'pinned', 'locked']
    const wasModerationAction = moderationActions.some(action => 
      old_record[action] !== new_record[action]
    )

    if (wasModerationAction) {
      let action = ''
      
      if (old_record.deleted !== new_record.deleted && new_record.deleted) {
        action = 'delete'
      } else if (old_record.pinned !== new_record.pinned && new_record.pinned) {
        action = 'pin'
      } else if (old_record.pinned !== new_record.pinned && !new_record.pinned) {
        action = 'unpin'
      } else if (old_record.locked !== new_record.locked && new_record.locked) {
        action = 'lock'
      } else if (old_record.locked !== new_record.locked && !new_record.locked) {
        action = 'unlock'
      }

      if (action) {
        const embed = createModerationEmbed(new_record, action, new_record.moderated_by || 'System')
        await sendDiscordNotification(embed)
      }
    }

    // Check if report count increased
    if (old_record.report_count !== new_record.report_count && new_record.report_count > old_record.report_count) {
      const embed = createNewReportEmbed(new_record, new_record.report_count)
      await sendDiscordNotification(embed)
    }
  }

  return { success: true }
}

// Main handler
serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const event = await req.json()
    const result = await handleWebhookEvent(event)
    
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Webhook handler error:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})