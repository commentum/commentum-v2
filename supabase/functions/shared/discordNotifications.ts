// Discord notification utilities for Commentum v2
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

export interface DiscordNotificationData {
  type: 'comment_created' | 'comment_updated' | 'comment_deleted' | 'user_banned' | 'user_warned' | 'comment_pinned' | 'comment_locked' | 'vote_cast' | 'report_filed' | 'report_resolved' | 'report_dismissed' | 
        'vote_removed' | 'user_muted' | 'user_shadow_banned' | 'comment_unlocked' | 'moderation_action' | 'config_updated' | 'system_enabled' | 'system_disabled' | 'user_unbanned' | 'bulk_action';
  comment?: any;
  user?: any;
  media?: any;
  moderator?: any;
  reason?: string;
  voteType?: string;
  reportReason?: string;
  actionedBy?: string;
  metadata?: any;
}

// Background notification queue - stores notifications for async processing
let notificationQueue: DiscordNotificationData[] = [];
let isProcessingQueue = false;

// Add notification to background queue - NON-BLOCKING
export function queueDiscordNotification(data: DiscordNotificationData) {
  // Add to queue without waiting
  notificationQueue.push(data);
  
  // Start background processing if not already running
  if (!isProcessingQueue) {
    processNotificationQueue();
  }
  
  // Immediately return success - don't wait for Discord
  return { success: true, queued: true, message: 'Notification queued for background processing' };
}

// Legacy function for backward compatibility - now just queues the notification
export async function sendDiscordNotification(supabase: any, data: DiscordNotificationData) {
  // Just queue it and return immediately - don't block the main flow
  return queueDiscordNotification(data);
}

// Background queue processor - runs independently
async function processNotificationQueue() {
  if (isProcessingQueue || notificationQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  
  try {
    while (notificationQueue.length > 0) {
      const notification = notificationQueue.shift();
      if (notification) {
        // Process each notification without blocking the main flow
        processNotificationInBackground(notification).catch(error => {
          console.error('Background notification processing failed:', error);
        });
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

// Individual notification processing - runs in background
async function processNotificationInBackground(data: DiscordNotificationData) {
  try {
    // Create a temporary Supabase client for background processing
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    await sendDiscordNotificationInternal(supabase, data);
  } catch (error) {
    console.error('Background notification error:', error);
  }
}

// Internal Discord notification implementation - separated from public API
async function sendDiscordNotificationInternal(supabase: any, data: DiscordNotificationData) {
  try {
    // Check if Discord notifications are enabled
    const { data: config } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_notifications_enabled')
      .single()

    if (!config || JSON.parse(config.value) !== true) {
      return { success: false, reason: 'Discord notifications disabled' }
    }

    // Get webhook configurations
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
    
    // Try to get multiple webhooks first
    if (webhookConfig?.value) {
      try {
        webhookUrls = JSON.parse(webhookConfig.value)
      } catch {
        // Fallback to comma-separated
        webhookUrls = webhookConfig.value.split(',').map(url => url.trim()).filter(url => url)
      }
    }
    
    // Fallback to single webhook if no multiple configured
    if (webhookUrls.length === 0 && singleWebhookConfig?.value) {
      webhookUrls = [singleWebhookConfig.value]
    }

    if (webhookUrls.length === 0) {
      return { success: false, reason: 'Discord webhook URLs not configured' }
    }

    // Check if this notification type is enabled
    const { data: typesConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_notification_types')
      .single()

    const enabledTypes = typesConfig ? JSON.parse(typesConfig.value) : []
    if (!enabledTypes.includes(data.type)) {
      return { success: false, reason: 'Notification type disabled' }
    }

    // Create Discord embed
    const embed = createDiscordEmbed(data)

    // Log notification for tracking using comment ID if available
    let notificationId = null
    if (data.comment?.id) {
      // Use the comment ID for the notification record
      notificationId = data.comment.id
    } else {
      // For non-comment notifications, use the sequence
      const { data: newNotification } = await supabase
        .from('discord_notifications')
        .insert({
          notification_type: data.type,
          target_id: data.comment?.id?.toString() || data.user?.id,
          target_type: data.comment ? 'comment' : data.user ? 'user' : 'unknown',
          comment_data: data.comment ? JSON.stringify(data.comment) : null,
          user_data: data.user ? JSON.stringify(data.user) : null,
          media_data: data.media ? JSON.stringify(data.media) : null,
          webhook_url: JSON.stringify(webhookUrls),
          delivery_status: 'pending'
        })
        .select('id')
        .single()

      if (newNotification) {
        notificationId = newNotification.id
      }
    }

    // For comment notifications, update/insert with comment ID
    if (data.comment?.id) {
      await supabase
        .from('discord_notifications')
        .upsert({
          id: data.comment.id, // Use comment ID
          notification_type: data.type,
          target_id: data.comment?.id?.toString() || data.user?.id,
          target_type: data.comment ? 'comment' : data.user ? 'user' : 'unknown',
          comment_data: data.comment ? JSON.stringify(data.comment) : null,
          user_data: data.user ? JSON.stringify(data.user) : null,
          media_data: data.media ? JSON.stringify(data.media) : null,
          webhook_url: JSON.stringify(webhookUrls), // Store all webhook URLs
          delivery_status: 'pending'
        }, {
          onConflict: 'id'
        })
    }

    // Send to all configured webhooks
    const sendResults = []
    
    for (const webhookUrl of webhookUrls) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: 'Commentum Bot',
            avatar_url: 'https://i.ibb.co/67QzfyTf/1769510599299.png', // Commentum logo
            embeds: [embed]
          })
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error(`Discord webhook error for ${webhookUrl}:`, errorText)
          sendResults.push({
            webhookUrl,
            success: false,
            error: errorText
          })
          continue
        }

        // Parse Discord response (webhooks might return empty response on success)
        let result = { id: null }
        try {
          const responseText = await response.text()
          if (responseText && responseText.trim()) {
            result = JSON.parse(responseText)
          }
        } catch (parseError) {
          console.log('Discord webhook response parsing (this is normal for empty responses):', parseError.message)
          // Use empty result object for empty responses
        }

        sendResults.push({
          webhookUrl,
          success: true,
          messageId: result.id
        })

      } catch (error) {
        console.error(`Failed to send to webhook ${webhookUrl}:`, error)
        sendResults.push({
          webhookUrl,
          success: false,
          error: error.message
        })
      }
    }

    const successfulSends = sendResults.filter(r => r.success)
    const failedSends = sendResults.filter(r => !r.success)

    // Update notification record with results if we have an ID
    if (notificationId) {
      await supabase
        .from('discord_notifications')
        .update({
          delivery_status: failedSends.length === 0 ? 'sent' : 'partial',
          delivery_error: failedSends.length > 0 ? JSON.stringify(failedSends.map(f => f.error)) : null,
          webhook_url: JSON.stringify(webhookUrls), // Store all webhook URLs
          delivered_at: failedSends.length === 0 ? new Date().toISOString() : null
        })
        .eq('id', notificationId)
    }

    return { 
      success: failedSends.length === 0, 
      totalWebhooks: webhookUrls.length,
      successful: successfulSends.length,
      failed: failedSends.length,
      results: sendResults,
      notificationId 
    }

  } catch (error) {
    console.error('Error sending Discord notification:', error)
    return { success: false, reason: error.message }
  }
}

function createDiscordEmbed(data: DiscordNotificationData): any {
  const embed: any = {
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Commentum v2',
      icon_url: 'https://i.ibb.co/67QzfyTf/1769510599299.png'
    }
  }

  switch (data.type) {
    case 'comment_created':
      embed.title = 'New Comment Posted'
      embed.color = 0x00ff00 // Green
      embed.description = `**${data.comment.username}** posted a new comment`
      
      if (data.comment.content) {
        embed.fields = [{
          name: 'Comment',
          value: data.comment.content.length > 300 
            ? data.comment.content.substring(0, 300) + '...' 
            : data.comment.content
        }]
      }

      embed.fields = embed.fields || []
      embed.fields.push({
        name: 'IDs (Click to Copy)',
        value: `**Comment ID:** \`${data.comment.id}\`\n**User ID:** \`${data.comment.user_id}\`\n**Media ID:** \`${data.comment.media_id}\``,
        inline: false
      })

      if (data.media) {
        embed.fields.push({
          name: 'Media',
          value: `**${data.media.title}** (${data.media.year || 'Unknown Year'})`,
          inline: true
        })

        if (data.media.poster) {
          embed.thumbnail = {
            url: data.media.poster
          }
        }
      }

      embed.fields.push({
        name: 'User',
        value: `${data.comment.username} (${data.comment.client_type})`,
        inline: true
      })

      if (data.comment.parent_id) {
        embed.fields.push({
          name: 'Reply To',
          value: `Comment #${data.comment.parent_id}`,
          inline: true
        })
      }
      break

    case 'comment_updated':
      embed.title = 'Comment Edited'
      embed.color = 0xffff00 // Yellow
      embed.description = `**${data.comment.username}** edited their comment`
      
      if (data.comment.content) {
        embed.fields = [{
          name: 'Updated Content',
          value: data.comment.content.length > 300 
            ? data.comment.content.substring(0, 300) + '...' 
            : data.comment.content
        }]
      }

      embed.fields = embed.fields || []
      embed.fields.push({
        name: 'IDs (Click to Copy)',
        value: `**Comment ID:** \`${data.comment.id}\`\n**User ID:** \`${data.comment.user_id}\`\n**Media ID:** \`${data.comment.media_id}\``,
        inline: false
      })
      break

    case 'comment_deleted':
      embed.title = 'Comment Deleted'
      embed.color = 0xff0000 // Red
      embed.description = `**${data.comment.username}** deleted their comment`
      embed.fields = [
        {
          name: 'Deleted By',
          value: data.moderator ? `${data.moderator.username} (Mod)` : `${data.comment.username} (Self)`,
          inline: true
        },
        {
          name: 'IDs (Click to Copy)',
          value: `**Comment ID:** \`${data.comment.id}\`\n**User ID:** \`${data.comment.user_id}\`\n**Media ID:** \`${data.comment.media_id}\``,
          inline: false
        }
      ]
      break

    case 'user_banned':
      embed.title = 'User Banned'
      embed.color = 0xff0000 // Red
      embed.description = `**${data.user?.username || data.user?.id}** has been banned`
      embed.fields = [
        {
          name: 'Banned User',
          value: `${data.user?.username || data.user?.id} (\`${data.user?.id}\`)`,
          inline: true
        },
        {
          name: 'Banned By',
          value: `${data.moderator?.username || 'System'} (\`${data.moderator?.id}\`)`,
          inline: true
        },
        {
          name: 'IDs (Click to Copy)',
          value: `**Banned User ID:** \`${data.user?.id}\`\n**Moderator ID:** \`${data.moderator?.id}\``,
          inline: false
        }
      ]

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason
        })
      }
      break

    case 'user_warned':
      embed.title = 'User Warned'
      embed.color = 0xffa500 // Orange
      embed.description = `**${data.user?.username || data.user?.id}** has been warned`
      embed.fields = [
        {
          name: 'Warned User',
          value: `${data.user?.username || data.user?.id} (\`${data.user?.id}\`)`,
          inline: true
        },
        {
          name: 'Warned By',
          value: `${data.moderator?.username || 'System'} (\`${data.moderator?.id}\`)`,
          inline: true
        },
        {
          name: 'IDs (Click to Copy)',
          value: `**Warned User ID:** \`${data.user?.id}\`\n**Moderator ID:** \`${data.moderator?.id}\``,
          inline: false
        }
      ]

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason
        })
      }

      if (data.severity && data.severity !== 'warning') {
        embed.fields.push({
          name: 'Action',
          value: data.severity === 'mute' ? 'Muted' : data.severity === 'ban' ? 'Banned' : data.severity,
          inline: true
        })
      }
      break

    case 'comment_pinned':
      embed.title = 'Comment Pinned'
      embed.color = 0x00bfff // Deep Sky Blue
      embed.description = `**${data.moderator?.username}** pinned a comment by **${data.comment.username}**`
      
      if (data.comment.content) {
        embed.fields = [{
          name: 'Pinned Comment',
          value: data.comment.content.length > 200 
            ? data.comment.content.substring(0, 200) + '...' 
            : data.comment.content
        }]
      }

      embed.fields = embed.fields || []
      embed.fields.push({
        name: 'IDs (Click to Copy)',
        value: `**Comment ID:** \`${data.comment.id}\`\n**User ID:** \`${data.comment.user_id}\`\n**Media ID:** \`${data.comment.media_id}\`\n**Moderator ID:** \`${data.moderator?.id}\``,
        inline: false
      })

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason,
          inline: true
        })
      }
      break

    case 'comment_locked':
      embed.title = 'Comment Thread Locked'
      embed.color = 0x808080 // Gray
      embed.description = `**${data.moderator?.username}** locked a comment thread by **${data.comment.username}**`
      
      embed.fields = [{
        name: 'IDs (Click to Copy)',
        value: `**Comment ID:** \`${data.comment.id}\`\n**User ID:** \`${data.comment.user_id}\`\n**Media ID:** \`${data.comment.media_id}\`\n**Moderator ID:** \`${data.moderator?.id}\``,
        inline: false
      }]

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason
        })
      }
      break

    case 'vote_cast':
      embed.title = data.voteType === 'upvote' ? 'Upvote Cast' : 'Downvote Cast'
      embed.color = data.voteType === 'upvote' ? 0x00ff00 : 0xff0000
      embed.description = `Someone ${data.voteType}d a comment by **${data.comment.username}**`
      
      if (data.comment.content) {
        embed.fields = [{
          name: 'Comment',
          value: data.comment.content.length > 200 
            ? data.comment.content.substring(0, 200) + '...' 
            : data.comment.content
        }]
      }

      embed.fields = embed.fields || []
      embed.fields.push({
        name: 'IDs (Click to Copy)',
        value: `**Comment ID:** \`${data.comment.id}\`\n**User ID:** \`${data.comment.user_id}\`\n**Media ID:** \`${data.comment.media_id}\``,
        inline: false
      })
      break

    case 'report_filed':
      embed.title = 'Comment Reported'
      embed.color = 0xff4500 // Orange Red
      embed.description = `A comment by **${data.comment.username}** was reported`
      embed.fields = [
        {
          name: 'Report Reason',
          value: data.reportReason || 'Unknown',
          inline: true
        },
        {
          name: 'Reported User',
          value: data.comment.username,
          inline: true
        },
        {
          name: 'IDs (Click to Copy)',
          value: `**Comment ID:** \`${data.comment.id}\`\n**User ID:** \`${data.comment.user_id}\`\n**Media ID:** \`${data.comment.media_id}\`\n**Reporter ID:** \`${data.user?.id}\``,
          inline: false
        }
      ]

      if (data.comment.content) {
        embed.fields.push({
          name: 'Reported Comment',
          value: data.comment.content.length > 200 
            ? data.comment.content.substring(0, 200) + '...' 
            : data.comment.content
        })
      }
      break

    case 'report_resolved':
      embed.title = 'Report Resolved'
      embed.color = 0x00ff00 // Green
      embed.description = `**${data.moderator?.username}** resolved a report on a comment by **${data.comment.username}**`
      embed.fields = [
        {
          name: 'Moderator',
          value: `${data.moderator?.username} (\`${data.moderator?.id}\`)`,
          inline: true
        },
        {
          name: 'Comment Author',
          value: `${data.comment.username} (\`${data.comment.user_id}\`)`,
          inline: true
        },
        {
          name: 'IDs (Click to Copy)',
          value: `**Comment ID:** \`${data.comment.id}\`\n**Moderator ID:** \`${data.moderator?.id}\``,
          inline: false
        }
      ]
      break

    case 'moderation_action':
      embed.title = 'Moderation Action'
      embed.color = 0x9932cc // Dark Orchid
      embed.description = `**${data.moderator?.username}** performed a moderation action`
      
      if (data.metadata?.action) {
        embed.fields = [{
          name: 'Action',
          value: data.metadata.action,
          inline: true
        }]
      }

      embed.fields = embed.fields || []
      embed.fields.push({
        name: 'Moderator',
        value: `${data.moderator?.username} (\`${data.moderator?.id}\`)`,
        inline: true
      })

      if (data.user) {
        embed.fields.push({
          name: 'Target User',
          value: `${data.user.username || data.user.id} (\`${data.user.id}\`)`,
          inline: true
        })
      }

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason
        })
      }
      break

    default:
      embed.title = 'Notification'
      embed.color = 0x0000ff // Blue
      embed.description = `A ${data.type} event occurred`
      break
  }

  return embed
}