// Enhanced Discord notification utilities for Commentum v2
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

export interface DiscordNotificationData {
  type: 'comment_created' | 'comment_updated' | 'comment_deleted' | 'user_banned' | 'user_warned' | 'comment_pinned' | 'comment_locked' | 'report_filed' | 'report_resolved' | 'report_dismissed' | 
        'user_muted' | 'user_shadow_banned' | 'comment_unlocked' | 'moderation_action' | 'config_updated' | 'system_enabled' | 'system_disabled' | 'user_unbanned' | 'bulk_action' | 'vote_cast' | 'vote_removed';
  comment?: any;
  user?: any;
  media?: any;
  moderator?: any;
  reason?: string;
  reportReason?: string;
  actionedBy?: string;
  metadata?: any;
  voteType?: 'upvote' | 'downvote';
  voteScore?: number;
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
    // Check if Discord notifications are enabled (still use config table for this global setting)
    const { data: config } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_notifications_enabled')
      .single()

    if (!config || JSON.parse(config.value) !== true) {
      return { success: false, reason: 'Discord notifications disabled' }
    }

    // Determine which channel to send to based on notification type
    const channelType = getChannelForNotificationType(data.type)
    
    // Get ALL appropriate webhook URLs from ALL active servers
    const webhookUrls = await getChannelWebhookUrls(supabase, channelType)
    
    if (webhookUrls.length === 0) {
      return { success: false, reason: `No webhook URLs configured for ${channelType} channel in any active server` }
    }

    // Check if this notification type is enabled (still use config table for this global setting)
    const { data: typesConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_notification_types')
      .single()

    const enabledTypes = typesConfig ? JSON.parse(typesConfig.value) : []
    if (!enabledTypes.includes(data.type)) {
      return { success: false, reason: 'Notification type disabled' }
    }

    // Create Discord embed content
    const embedData = createDiscordEmbed(data)

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
          webhook_url: JSON.stringify(webhookUrls),
          delivery_status: 'pending'
        }, {
          onConflict: 'id'
        })
    }

    // Send to ALL configured webhooks for this channel type
    const sendResults = []
    
    for (const webhookUrl of webhookUrls) {
      const sendResult = await sendToWebhook(webhookUrl, embedData, data.type)
      sendResults.push({
        webhookUrl,
        success: sendResult.success,
        messageId: sendResult.messageId,
        error: sendResult.error
      })
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
          webhook_url: JSON.stringify(webhookUrls),
          delivered_at: failedSends.length === 0 ? new Date().toISOString() : null
        })
        .eq('id', notificationId)
    }

    return { 
      success: failedSends.length === 0, 
      channel: channelType,
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

// Determine which channel a notification type should go to
function getChannelForNotificationType(notificationType: string): 'comments' | 'moderation' {
  const commentsChannelTypes = [
    'comment_created',
    'comment_updated', 
    'comment_deleted',
    'comment_pinned',
    'comment_locked',
    'comment_unlocked',
    'vote_cast',
    'vote_removed'
  ]
  
  return commentsChannelTypes.includes(notificationType) ? 'comments' : 'moderation'
}

// Get the webhook URLs for a specific channel from ALL active servers
async function getChannelWebhookUrls(supabase: any, channelType: 'comments' | 'moderation'): Promise<string[]> {
  try {
    // Get ALL active server configurations
    const { data: serverConfigs } = await supabase
      .from('server_configs')
      .select('*')
      .eq('is_active', true)

    if (!serverConfigs || serverConfigs.length === 0) {
      console.error('No active server configurations found')
      return []
    }

    const webhookUrls: string[] = []

    // For each server, get the appropriate webhook URL
    for (const serverConfig of serverConfigs) {
      let webhookUrl: string | null = null

      if (channelType === 'comments') {
        // Use existing webhook_url for comments channel
        webhookUrl = serverConfig.webhook_url
      } else {
        // Use new moderation_webhook_url for moderation channel
        webhookUrl = serverConfig.moderation_webhook_url
      }

      if (webhookUrl) {
        webhookUrls.push(webhookUrl)
      }
    }

    return webhookUrls
  } catch (error) {
    console.error('Error fetching webhook URLs from server_configs:', error)
    return []
  }
}

// Send message to a specific webhook
async function sendToWebhook(webhookUrl: string, embedData: any, notificationType: string) {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'Commentum Bot',
        embeds: [embedData]
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Discord webhook error for ${notificationType}:`, errorText)
      return { success: false, error: errorText }
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

    return { success: true, messageId: result.id }

  } catch (error) {
    console.error(`Failed to send to webhook:`, error)
    return { success: false, error: error.message }
  }
}

function createDiscordEmbed(data: DiscordNotificationData): any {
  const baseEmbed = {
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Commentum v2',
      icon_url: 'https://i.ibb.co/67QzfyTf/1769510599299.png'
    }
  }

  switch (data.type) {
    case 'comment_created':
      return {
        ...baseEmbed,
        title: 'New Comment Posted',
        description: `A new comment was posted by **${data.comment?.username}**`,
        color: 0x00FF00, // Green
        fields: [
          {
            name: 'User Info',
            value: `**ID:** ${data.comment?.user_id} (${data.comment?.username})\n**Client:** ${data.comment?.client_type}`,
            inline: true
          },
          {
            name: 'Media Info',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          },
          {
            name: 'Comment Details',
            value: `**ID:** ${data.comment?.id}\n**Content:** ${data.comment?.content || 'No content'}`,
            inline: false
          }
        ]
      }

    case 'comment_updated':
      return {
        ...baseEmbed,
        title: 'Comment Edited',
        description: `Comment **${data.comment?.id}** was edited by **${data.comment?.username}**`,
        color: 0x9B59B6, // Purple
        fields: [
          {
            name: 'User Info',
            value: `**ID:** ${data.comment?.user_id} (${data.comment?.username})\n**Client:** ${data.comment?.client_type}`,
            inline: true
          },
          {
            name: 'Media Info',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          },
          {
            name: 'Updated Content',
            value: `**ID:** ${data.comment?.id}\n**New Content:** ${data.comment?.content || 'No content'}`,
            inline: false
          }
        ]
      }

    case 'comment_deleted':
      return {
        ...baseEmbed,
        title: 'Comment Deleted',
        description: `Comment **${data.comment?.id}** was deleted by **${data.moderator?.username || data.comment?.username}**`,
        color: 0xFF0000, // Red
        fields: [
          {
            name: 'User Info',
            value: `**ID:** ${data.comment?.user_id} (${data.comment?.username})\n**Client:** ${data.comment?.client_type}`,
            inline: true
          },
          {
            name: 'Media Info',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          },
          {
            name: 'Deleted By',
            value: data.moderator?.username || 'Original Author',
            inline: true
          },
          {
            name: 'Deleted Comment',
            value: `**ID:** ${data.comment?.id}\n**Original Content:** ${data.comment?.content || 'No content'}`,
            inline: false
          }
        ]
      }

    case 'vote_cast':
      return {
        ...baseEmbed,
        title: `${data.voteType === 'upvote' ? 'Upvote' : 'Downvote'} Cast`,
        description: `**${data.user?.username}** cast a ${data.voteType} on comment **${data.comment?.id}**`,
        color: 0xFFA500, // Orange
        fields: [
          {
            name: 'Vote Details',
            value: `**Vote Type:** ${data.voteType === 'upvote' ? 'Upvote' : 'Downvote'}\n**New Score:** ${data.voteScore || 0}\n**Comment ID:** ${data.comment?.id}`,
            inline: true
          },
          {
            name: 'Voter Info',
            value: `**ID:** ${data.user?.id} (${data.user?.username})`,
            inline: true
          },
          {
            name: 'Media Context',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          },
          {
            name: 'Comment Content',
            value: data.comment?.content || 'No content',
            inline: false
          }
        ]
      }

    case 'vote_removed':
      return {
        ...baseEmbed,
        title: 'Vote Removed',
        description: `**${data.user?.username}** removed their vote from comment **${data.comment?.id}**`,
        color: 0xFFA500, // Orange
        fields: [
          {
            name: 'Vote Details',
            value: `**Action:** Vote Removed\n**New Score:** ${data.voteScore || 0}\n**Comment ID:** ${data.comment?.id}`,
            inline: true
          },
          {
            name: 'User Info',
            value: `**ID:** ${data.user?.id} (${data.user?.username})`,
            inline: true
          },
          {
            name: 'Media Context',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          }
        ]
      }

    case 'report_filed':
      return {
        ...baseEmbed,
        title: 'Comment Reported',
        description: `Comment **${data.comment?.id}** was reported by **${data.user?.username}**`,
        color: 0xFF8C00, // Dark Orange
        fields: [
          {
            name: 'Report Details',
            value: `**Reason:** ${data.reportReason}\n**Comment ID:** ${data.comment?.id}\n**Reported By:** ${data.user?.username}`,
            inline: false
          },
          {
            name: 'Comment Author',
            value: `**ID:** ${data.comment?.user_id} (${data.comment?.username})`,
            inline: true
          },
          {
            name: 'Media Context',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          },
          {
            name: 'Reported Comment',
            value: data.comment?.content || 'No content',
            inline: false
          }
        ]
      }

    case 'user_banned':
      return {
        ...baseEmbed,
        title: 'User Banned',
        description: `**${data.comment?.username}** has been banned from the system`,
        color: 0x8B0000, // Dark Red
        fields: [
          {
            name: 'Ban Details',
            value: `**ID:** ${data.user?.id} (${data.comment?.username})\n**Reason:** ${data.reason}\n**Banned By:** ${data.moderator?.username || 'System'}`,
            inline: false
          },
          {
            name: 'Client Type',
            value: data.comment?.client_type || 'Unknown',
            inline: true
          }
        ]
      }

    case 'user_warned':
      return {
        ...baseEmbed,
        title: 'User Warned',
        description: `**${data.comment?.username}** has received a warning`,
        color: 0xFFD700, // Gold
        fields: [
          {
            name: 'Warning Details',
            value: `**ID:** ${data.user?.id} (${data.comment?.username})\n**Reason:** ${data.reason}\n**Warned By:** ${data.moderator?.username || 'System'}`,
            inline: false
          },
          {
            name: 'Client Type',
            value: data.comment?.client_type || 'Unknown',
            inline: true
          }
        ]
      }

    case 'user_muted':
      return {
        ...baseEmbed,
        title: 'User Muted',
        description: `**${data.comment?.username}** has been muted`,
        color: 0x808080, // Gray
        fields: [
          {
            name: 'Mute Details',
            value: `**ID:** ${data.user?.id} (${data.comment?.username})\n**Reason:** ${data.reason}\n**Muted By:** ${data.moderator?.username || 'System'}`,
            inline: false
          },
          {
            name: 'Client Type',
            value: data.comment?.client_type || 'Unknown',
            inline: true
          }
        ]
      }

    case 'user_shadow_banned':
      return {
        ...baseEmbed,
        title: 'User Shadow Banned',
        description: `**${data.comment?.username}** has been shadow banned`,
        color: 0x4B0082, // Indigo
        fields: [
          {
            name: 'Shadow Ban Details',
            value: `**ID:** ${data.user?.id} (${data.comment?.username})\n**Reason:** ${data.reason}\n**Banned By:** ${data.moderator?.username || 'System'}`,
            inline: false
          },
          {
            name: 'Client Type',
            value: data.comment?.client_type || 'Unknown',
            inline: true
          }
        ]
      }

    case 'comment_pinned':
      return {
        ...baseEmbed,
        title: 'Comment Pinned',
        description: `Comment **${data.comment?.id}** has been pinned by **${data.moderator?.username}**`,
        color: 0x00BFFF, // Deep Sky Blue
        fields: [
          {
            name: 'Pin Details',
            value: `**Comment ID:** ${data.comment?.id}\n**Pinned By:** ${data.moderator?.username}\n**Reason:** ${data.reason || 'No reason provided'}`,
            inline: false
          },
          {
            name: 'Comment Author',
            value: `**ID:** ${data.comment?.user_id} (${data.comment?.username})`,
            inline: true
          },
          {
            name: 'Media Context',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          },
          {
            name: 'Pinned Comment',
            value: data.comment?.content || 'No content',
            inline: false
          }
        ]
      }

    case 'comment_locked':
      return {
        ...baseEmbed,
        title: 'Comment Thread Locked',
        description: `Comment **${data.comment?.id}** thread has been locked by **${data.moderator?.username}**`,
        color: 0x8B4513, // Saddle Brown
        fields: [
          {
            name: 'Lock Details',
            value: `**Comment ID:** ${data.comment?.id}\n**Locked By:** ${data.moderator?.username}\n**Reason:** ${data.reason || 'No reason provided'}`,
            inline: false
          },
          {
            name: 'Comment Author',
            value: `**ID:** ${data.comment?.user_id} (${data.comment?.username})`,
            inline: true
          },
          {
            name: 'Media Context',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          },
          {
            name: 'Locked Comment',
            value: data.comment?.content || 'No content',
            inline: false
          }
        ]
      }

    case 'comment_unlocked':
      return {
        ...baseEmbed,
        title: 'Comment Thread Unlocked',
        description: `Comment **${data.comment?.id}** thread has been unlocked by **${data.moderator?.username}**`,
        color: 0x32CD32, // Lime Green
        fields: [
          {
            name: 'Unlock Details',
            value: `**Comment ID:** ${data.comment?.id}\n**Unlocked By:** ${data.moderator?.username}\n**Reason:** ${data.reason || 'No reason provided'}`,
            inline: false
          },
          {
            name: 'Comment Author',
            value: `**ID:** ${data.comment?.user_id} (${data.comment?.username})`,
            inline: true
          },
          {
            name: 'Media Context',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          }
        ]
      }

    case 'report_resolved':
      return {
        ...baseEmbed,
        title: 'Report Resolved',
        description: `Report for comment **${data.comment?.id}** has been resolved by **${data.moderator?.username}**`,
        color: 0x00FA9A, // Medium Spring Green
        fields: [
          {
            name: 'Resolution Details',
            value: `**Comment ID:** ${data.comment?.id}\n**Resolved By:** ${data.moderator?.username}\n**Resolution:** Approved`,
            inline: false
          },
          {
            name: 'Media Context',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          },
          {
            name: 'Comment Context',
            value: data.comment?.content || 'No content',
            inline: false
          }
        ]
      }

    case 'report_dismissed':
      return {
        ...baseEmbed,
        title: 'Report Dismissed',
        description: `Report for comment **${data.comment?.id}** has been dismissed by **${data.moderator?.username}**`,
        color: 0xDC143C, // Crimson
        fields: [
          {
            name: 'Dismissal Details',
            value: `**Comment ID:** ${data.comment?.id}\n**Dismissed By:** ${data.moderator?.username}\n**Resolution:** Dismissed`,
            inline: false
          },
          {
            name: 'Media Context',
            value: `**ID:** ${data.comment?.media_id} (${data.media?.type || 'Unknown'}) (${data.media?.year || 'Unknown'})\n**Title:** ${data.media?.title || 'Unknown'}`,
            inline: true
          },
          {
            name: 'Comment Context',
            value: data.comment?.content || 'No content',
            inline: false
          }
        ]
      }

    default:
      return {
        ...baseEmbed,
        title: 'System Notification',
        description: `A system event occurred: ${data.type}`,
        color: 0x808080, // Gray
        fields: [
          {
            name: 'Event Details',
            value: `**Type:** ${data.type}\n**Timestamp:** ${new Date().toISOString()}`,
            inline: false
          }
        ]
      }
  }
}