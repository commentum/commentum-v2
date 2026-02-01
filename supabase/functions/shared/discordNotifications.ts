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

    // Get webhook URLs from server_configs table
    const { data: serverConfigs } = await supabase
      .from('server_configs')
      .select('webhook_url')
      .eq('is_active', true)
      .not('webhook_url', 'is', null)

    let webhookUrls: string[] = []
    
    if (serverConfigs && serverConfigs.length > 0) {
      webhookUrls = serverConfigs.map(server => server.webhook_url).filter(url => url)
    }

    if (webhookUrls.length === 0) {
      return { success: false, reason: 'Discord webhook URLs not configured in server_configs table' }
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

    // Create Discord message content (plain text)
    const messageContent = createDiscordMessage(data)

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
            content: messageContent
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

// Create Discord message content (plain text, no embeds)
function createDiscordMessage(data: DiscordNotificationData): string {
  let message = ''

  switch (data.type) {
    case 'comment_created':
      message = `**New Comment (ID: ${data.comment.id})**
* Client Type: ${data.comment.client_type}
* UserID: ${data.comment.user_id}
* Username: ${data.comment.username}
* Media ID: ${data.comment.media_id}
* Media Name: ${data.media?.title || 'Unknown'}
* Content: ${data.comment.content}`
      break

    case 'comment_updated':
      message = `**Comment Updated (ID: ${data.comment.id})**
* Client Type: ${data.comment.client_type}
* UserID: ${data.comment.user_id}
* Username: ${data.comment.username}
* Media ID: ${data.comment.media_id}
* Media Name: ${data.media?.title || 'Unknown'}
* Content: ${data.comment.content}`
      break

    case 'comment_deleted':
      message = `**Comment Deleted (ID: ${data.comment.id})**
* Client Type: ${data.comment.client_type}
* UserID: ${data.comment.user_id}
* Username: ${data.comment.username}
* Media ID: ${data.comment.media_id}
* Media Name: ${data.media?.title || 'Unknown'}
* Deleted By: ${data.moderator?.username || data.comment.username}`
      break

    case 'user_banned':
      message = `**User Banned**
* UserID: ${data.user?.id}
* Username: ${data.user?.username || 'Unknown'}
* Banned By: ${data.moderator?.username || 'System'}
* Reason: ${data.reason || 'No reason provided'}`
      break

    case 'user_warned':
      message = `**User Warned**
* UserID: ${data.user?.id}
* Username: ${data.user?.username || 'Unknown'}
* Warned By: ${data.moderator?.username || 'System'}
* Reason: ${data.reason || 'No reason provided'}
* Action: ${data.severity || 'warning'}`
      break

    case 'comment_pinned':
      message = `**Comment Pinned (ID: ${data.comment.id})**
* Client Type: ${data.comment.client_type}
* UserID: ${data.comment.user_id}
* Username: ${data.comment.username}
* Media ID: ${data.comment.media_id}
* Media Name: ${data.media?.title || 'Unknown'}
* Pinned By: ${data.moderator?.username}
* Content: ${data.comment.content}`
      break

    case 'comment_locked':
      message = `**Thread Locked (ID: ${data.comment.id})**
* Client Type: ${data.comment.client_type}
* UserID: ${data.comment.user_id}
* Username: ${data.comment.username}
* Media ID: ${data.comment.media_id}
* Media Name: ${data.media?.title || 'Unknown'}
* Locked By: ${data.moderator?.username}`
      break

    case 'vote_cast':
      message = `**Vote Cast**
* Comment ID: ${data.comment.id}
* Client Type: ${data.comment.client_type}
* Comment Author: ${data.comment.username}
* Voter ID: ${data.user?.id}
* Voter Username: ${data.user?.username || 'Unknown'}
* Vote Type: ${data.voteType}
* Media ID: ${data.comment.media_id}
* Media Name: ${data.media?.title || 'Unknown'}`
      break

    case 'report_filed':
      message = `**Report Filed**
* Comment ID: ${data.comment.id}
* Client Type: ${data.comment.client_type}
* Comment Author: ${data.comment.username}
* Reporter ID: ${data.user?.id}
* Reporter Username: ${data.user?.username || 'Unknown'}
* Report Reason: ${data.reportReason}
* Media ID: ${data.comment.media_id}
* Media Name: ${data.media?.title || 'Unknown'}`
      break

    case 'report_resolved':
      message = `**Report Resolved**
* Comment ID: ${data.comment.id}
* Client Type: ${data.comment.client_type}
* Comment Author: ${data.comment.username}
* Moderator: ${data.moderator?.username}
* Resolution: ${data.resolution}
* Review Notes: ${data.review_notes || 'No notes provided'}`
      break

    case 'report_dismissed':
      message = `**Report Dismissed**
* Comment ID: ${data.comment.id}
* Client Type: ${data.comment.client_type}
* Comment Author: ${data.comment.username}
* Moderator: ${data.moderator?.username}
* Review Notes: ${data.review_notes || 'No notes provided'}`
      break

    case 'user_muted':
      message = `**User Muted**
* UserID: ${data.user?.id}
* Username: ${data.user?.username || 'Unknown'}
* Muted By: ${data.moderator?.username || 'System'}
* Reason: ${data.reason || 'No reason provided'}
* Duration: ${data.duration || 'Not specified'}`
      break

    case 'user_shadow_banned':
      message = `**User Shadow Banned**
* UserID: ${data.user?.id}
* Username: ${data.user?.username || 'Unknown'}
* Banned By: ${data.moderator?.username || 'System'}
* Reason: ${data.reason || 'No reason provided'}`
      break

    case 'user_unbanned':
      message = `**User Unbanned**
* UserID: ${data.user?.id}
* Username: ${data.user?.username || 'Unknown'}
* Unbanned By: ${data.moderator?.username || 'System'}
* Reason: ${data.reason || 'No reason provided'}`
      break

    case 'comment_unlocked':
      message = `**Thread Unlocked (ID: ${data.comment.id})**
* Client Type: ${data.comment.client_type}
* UserID: ${data.comment.user_id}
* Username: ${data.comment.username}
* Media ID: ${data.comment.media_id}
* Media Name: ${data.media?.title || 'Unknown'}
* Unlocked By: ${data.moderator?.username}`
      break

    default:
      message = `**Notification**
* Type: ${data.type}
* Data: ${JSON.stringify(data, null, 2)}`
  }

  return message
}