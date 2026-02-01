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

    // Create Discord message content
    const content = createDiscordMessage(data)

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
            content: content
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

function createDiscordMessage(data: DiscordNotificationData): string {
  switch (data.type) {
    case 'comment_created':
      let message = "```\n"
      message += `**New Comment (ID: ${data.comment?.id})**\n`
      message += `* Client Type: ${data.comment?.client_type}\n`
      message += `* UserID: ${data.comment?.user_id} | Username: ${data.comment?.username}\n`
      message += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      message += `* Media Name: ${data.media?.title}\n`
      message += `* Content: ${data.comment?.content}`
      message += "\n```"
      return message

    case 'comment_updated':
      let updateMessage = "```\n"
      updateMessage += `**Comment Updated (ID: ${data.comment?.id})**\n`
      updateMessage += `* Client Type: ${data.comment?.client_type}\n`
      updateMessage += `* UserID: ${data.comment?.user_id} | Username: ${data.comment?.username}\n`
      updateMessage += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      updateMessage += `* Media Name: ${data.media?.title}\n`
      updateMessage += `* Content: ${data.comment?.content}`
      updateMessage += "\n```"
      return updateMessage

    case 'comment_deleted':
      let deleteMessage = "```\n"
      deleteMessage += `**Comment Deleted (ID: ${data.comment?.id})**\n`
      deleteMessage += `* Client Type: ${data.comment?.client_type}\n`
      deleteMessage += `* UserID: ${data.comment?.user_id} | Username: ${data.comment?.username}\n`
      deleteMessage += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      deleteMessage += `* Media Name: ${data.media?.title}\n`
      deleteMessage += `* Deleted By: ${data.moderator?.username || data.comment?.username}`
      deleteMessage += "\n```"
      return deleteMessage

    case 'user_banned':
      let banMessage = "```\n"
      banMessage += `**User Banned**\n`
      banMessage += `* Client Type: ${data.comment?.client_type}\n`
      banMessage += `* UserID: ${data.user?.id} | Username: ${data.user?.username}\n`
      banMessage += `* Reason: ${data.reason}`
      banMessage += "\n```"
      return banMessage

    case 'user_warned':
      let warnMessage = "```\n"
      warnMessage += `**User Warned**\n`
      warnMessage += `* Client Type: ${data.comment?.client_type}\n`
      warnMessage += `* UserID: ${data.user?.id} | Username: ${data.user?.username}\n`
      warnMessage += `* Reason: ${data.reason}`
      warnMessage += "\n```"
      return warnMessage

    case 'comment_pinned':
      let pinMessage = "```\n"
      pinMessage += `**Comment Pinned (ID: ${data.comment?.id})**\n`
      pinMessage += `* Client Type: ${data.comment?.client_type}\n`
      pinMessage += `* UserID: ${data.comment?.user_id} | Username: ${data.comment?.username}\n`
      pinMessage += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      pinMessage += `* Media Name: ${data.media?.title}\n`
      pinMessage += `* Pinned By: ${data.moderator?.username}`
      pinMessage += "\n```"
      return pinMessage

    case 'comment_locked':
      let lockMessage = "```\n"
      lockMessage += `**Comment Locked (ID: ${data.comment?.id})**\n`
      lockMessage += `* Client Type: ${data.comment?.client_type}\n`
      lockMessage += `* UserID: ${data.comment?.user_id} | Username: ${data.comment?.username}\n`
      lockMessage += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      lockMessage += `* Media Name: ${data.media?.title}\n`
      lockMessage += `* Locked By: ${data.moderator?.username}`
      lockMessage += "\n```"
      return lockMessage

    case 'vote_cast':
      let voteMessage = "```\n"
      voteMessage += `**Vote Cast (Comment ID: ${data.comment?.id})**\n`
      voteMessage += `* Client Type: ${data.comment?.client_type}\n`
      voteMessage += `* UserID: ${data.user?.id} | Username: ${data.user?.username}\n`
      voteMessage += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      voteMessage += `* Media Name: ${data.media?.title}\n`
      voteMessage += `* Vote Type: ${data.voteType}`
      voteMessage += "\n```"
      return voteMessage

    case 'report_filed':
      let reportMessage = "```\n"
      reportMessage += `**Report Filed (Comment ID: ${data.comment?.id})**\n`
      reportMessage += `* Client Type: ${data.comment?.client_type}\n`
      reportMessage += `* UserID: ${data.user?.id} | Username: ${data.user?.username}\n`
      reportMessage += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      reportMessage += `* Media Name: ${data.media?.title}\n`
      reportMessage += `* Report Reason: ${data.reportReason}`
      reportMessage += "\n```"
      return reportMessage

    case 'report_resolved':
      let resolveMessage = "```\n"
      resolveMessage += `**Report Resolved (Comment ID: ${data.comment?.id})**\n`
      resolveMessage += `* Client Type: ${data.comment?.client_type}\n`
      resolveMessage += `* UserID: ${data.moderator?.id} | Username: ${data.moderator?.username}\n`
      resolveMessage += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      resolveMessage += `* Media Name: ${data.media?.title}\n`
      resolveMessage += `* Resolved By: ${data.moderator?.username}`
      resolveMessage += "\n```"
      return resolveMessage

    case 'user_muted':
      let muteMessage = "```\n"
      muteMessage += `**User Muted**\n`
      muteMessage += `* Client Type: ${data.comment?.client_type}\n`
      muteMessage += `* UserID: ${data.user?.id} | Username: ${data.user?.username}\n`
      muteMessage += `* Reason: ${data.reason}`
      muteMessage += "\n```"
      return muteMessage

    case 'user_shadow_banned':
      let shadowBanMessage = "```\n"
      shadowBanMessage += `**User Shadow Banned**\n`
      shadowBanMessage += `* Client Type: ${data.comment?.client_type}\n`
      shadowBanMessage += `* UserID: ${data.user?.id} | Username: ${data.user?.username}\n`
      shadowBanMessage += `* Reason: ${data.reason}`
      shadowBanMessage += "\n```"
      return shadowBanMessage

    case 'comment_unlocked':
      let unlockMessage = "```\n"
      unlockMessage += `**Comment Unlocked (ID: ${data.comment?.id})**\n`
      unlockMessage += `* Client Type: ${data.comment?.client_type}\n`
      unlockMessage += `* UserID: ${data.comment?.user_id} | Username: ${data.comment?.username}\n`
      unlockMessage += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      unlockMessage += `* Media Name: ${data.media?.title}\n`
      unlockMessage += `* Unlocked By: ${data.moderator?.username}`
      unlockMessage += "\n```"
      return unlockMessage

    case 'moderation_action':
      let modMessage = "```\n"
      modMessage += `**Moderation Action**\n`
      modMessage += `* Client Type: ${data.comment?.client_type}\n`
      modMessage += `* UserID: ${data.moderator?.id} | Username: ${data.moderator?.username}\n`
      modMessage += `* Action: ${data.metadata?.action} - ${data.reason}`
      modMessage += "\n```"
      return modMessage

    case 'user_unbanned':
      let unbanMessage = "```\n"
      unbanMessage += `**User Unbanned**\n`
      unbanMessage += `* Client Type: ${data.comment?.client_type}\n`
      unbanMessage += `* UserID: ${data.user?.id} | Username: ${data.user?.username}\n`
      unbanMessage += `* Reason: ${data.reason}`
      unbanMessage += "\n```"
      return unbanMessage

    case 'report_dismissed':
      let dismissMessage = "```\n"
      dismissMessage += `**Report Dismissed (Comment ID: ${data.comment?.id})**\n`
      dismissMessage += `* Client Type: ${data.comment?.client_type}\n`
      dismissMessage += `* UserID: ${data.moderator?.id} | Username: ${data.moderator?.username}\n`
      dismissMessage += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      dismissMessage += `* Media Name: ${data.media?.title}\n`
      dismissMessage += `* Dismissed By: ${data.moderator?.username}`
      dismissMessage += "\n```"
      return dismissMessage

    case 'vote_removed':
      let removeVoteMessage = "```\n"
      removeVoteMessage += `**Vote Removed (Comment ID: ${data.comment?.id})**\n`
      removeVoteMessage += `* Client Type: ${data.comment?.client_type}\n`
      removeVoteMessage += `* UserID: ${data.user?.id} | Username: ${data.user?.username}\n`
      removeVoteMessage += `* Media ID: ${data.comment?.media_id} | Media Type: ${data.media?.type}\n`
      removeVoteMessage += `* Media Name: ${data.media?.title}\n`
      removeVoteMessage += `* Vote Type Removed: ${data.voteType}`
      removeVoteMessage += "\n```"
      return removeVoteMessage

    case 'config_updated':
      let configMessage = "```\n"
      configMessage += `**Configuration Updated**\n`
      configMessage += `* Client Type: System\n`
      configMessage += `* UserID: ${data.moderator?.id} | Username: ${data.moderator?.username}\n`
      configMessage += `* Action: ${data.metadata?.action} - ${data.reason}`
      configMessage += "\n```"
      return configMessage

    case 'system_enabled':
      let enableMessage = "```\n"
      enableMessage += `**System Enabled**\n`
      enableMessage += `* Client Type: System\n`
      enableMessage += `* UserID: ${data.moderator?.id} | Username: ${data.moderator?.username}\n`
      enableMessage += `* Action: System enabled by ${data.moderator?.username}`
      enableMessage += "\n```"
      return enableMessage

    case 'system_disabled':
      let disableMessage = "```\n"
      disableMessage += `**System Disabled**\n`
      disableMessage += `* Client Type: System\n`
      disableMessage += `* UserID: ${data.moderator?.id} | Username: ${data.moderator?.username}\n`
      disableMessage += `* Action: System disabled by ${data.moderator?.username}`
      disableMessage += "\n```"
      return disableMessage

    case 'bulk_action':
      let bulkMessage = "```\n"
      bulkMessage += `**Bulk Action Performed**\n`
      bulkMessage += `* Client Type: ${data.comment?.client_type}\n`
      bulkMessage += `* UserID: ${data.moderator?.id} | Username: ${data.moderator?.username}\n`
      bulkMessage += `* Action: ${data.metadata?.action} - ${data.reason}`
      bulkMessage += "\n```"
      return bulkMessage

    default:
      return "```\n**Unknown Notification Type: " + data.type + "**\n```"
  }
}
