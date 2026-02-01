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
      let message = `**New Comment (ID: ${data.comment?.id || 'Unknown'})**\n`
      message += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      message += `* UserID: ${data.comment?.user_id || 'Unknown'}                      Username: ${data.comment?.username || 'Unknown'}\n`
      message += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      message += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      message += `* Content: ${data.comment?.content || 'No content'}`
      return message

    case 'comment_updated':
      let updateMessage = `**Comment Updated (ID: ${data.comment?.id || 'Unknown'})**\n`
      updateMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      updateMessage += `* UserID: ${data.comment?.user_id || 'Unknown'}                      Username: ${data.comment?.username || 'Unknown'}\n`
      updateMessage += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      updateMessage += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      updateMessage += `* Content: ${data.comment?.content || 'No content'}`
      return updateMessage

    case 'comment_deleted':
      let deleteMessage = `**Comment Deleted (ID: ${data.comment?.id || 'Unknown'})**\n`
      deleteMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      deleteMessage += `* UserID: ${data.comment?.user_id || 'Unknown'}                      Username: ${data.comment?.username || 'Unknown'}\n`
      deleteMessage += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      deleteMessage += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      deleteMessage += `* Deleted By: ${data.moderator?.username || data.comment?.username || 'Unknown'}`
      return deleteMessage

    case 'user_banned':
      let banMessage = `**User Banned**\n`
      banMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      banMessage += `* UserID: ${data.user?.id || 'Unknown'}                      Username: ${data.user?.username || 'Unknown'}\n`
      banMessage += `* Media ID: N/A                  Media Type: N/A\n`
      banMessage += `* Media Name: N/A\n`
      banMessage += `* Reason: ${data.reason || 'No reason provided'}`
      return banMessage

    case 'user_warned':
      let warnMessage = `**User Warned**\n`
      warnMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      warnMessage += `* UserID: ${data.user?.id || 'Unknown'}                      Username: ${data.user?.username || 'Unknown'}\n`
      warnMessage += `* Media ID: N/A                  Media Type: N/A\n`
      warnMessage += `* Media Name: N/A\n`
      warnMessage += `* Reason: ${data.reason || 'No reason provided'}`
      return warnMessage

    case 'comment_pinned':
      let pinMessage = `**Comment Pinned (ID: ${data.comment?.id || 'Unknown'})**\n`
      pinMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      pinMessage += `* UserID: ${data.comment?.user_id || 'Unknown'}                      Username: ${data.comment?.username || 'Unknown'}\n`
      pinMessage += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      pinMessage += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      pinMessage += `* Pinned By: ${data.moderator?.username || 'Unknown'}`
      return pinMessage

    case 'comment_locked':
      let lockMessage = `**Comment Locked (ID: ${data.comment?.id || 'Unknown'})**\n`
      lockMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      lockMessage += `* UserID: ${data.comment?.user_id || 'Unknown'}                      Username: ${data.comment?.username || 'Unknown'}\n`
      lockMessage += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      lockMessage += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      lockMessage += `* Locked By: ${data.moderator?.username || 'Unknown'}`
      return lockMessage

    case 'vote_cast':
      let voteMessage = `**Vote Cast (Comment ID: ${data.comment?.id || 'Unknown'})**\n`
      voteMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      voteMessage += `* UserID: ${data.user?.id || 'Unknown'}                      Username: ${data.user?.username || 'Unknown'}\n`
      voteMessage += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      voteMessage += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      voteMessage += `* Vote Type: ${data.voteType || 'Unknown'}`
      return voteMessage

    case 'report_filed':
      let reportMessage = `**Report Filed (Comment ID: ${data.comment?.id || 'Unknown'})**\n`
      reportMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      reportMessage += `* UserID: ${data.user?.id || 'Unknown'}                      Username: ${data.user?.username || 'Unknown'}\n`
      reportMessage += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      reportMessage += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      reportMessage += `* Report Reason: ${data.reportReason || 'Unknown'}`
      return reportMessage

    case 'report_resolved':
      let resolveMessage = `**Report Resolved (Comment ID: ${data.comment?.id || 'Unknown'})**\n`
      resolveMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      resolveMessage += `* UserID: ${data.moderator?.id || 'Unknown'}                      Username: ${data.moderator?.username || 'Unknown'}\n`
      resolveMessage += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      resolveMessage += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      resolveMessage += `* Resolved By: ${data.moderator?.username || 'Unknown'}`
      return resolveMessage

    case 'user_muted':
      let muteMessage = `**User Muted**\n`
      muteMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      muteMessage += `* UserID: ${data.user?.id || 'Unknown'}                      Username: ${data.user?.username || 'Unknown'}\n`
      muteMessage += `* Media ID: N/A                  Media Type: N/A\n`
      muteMessage += `* Media Name: N/A\n`
      muteMessage += `* Reason: ${data.reason || 'No reason provided'}`
      return muteMessage

    case 'user_shadow_banned':
      let shadowBanMessage = `**User Shadow Banned**\n`
      shadowBanMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      shadowBanMessage += `* UserID: ${data.user?.id || 'Unknown'}                      Username: ${data.user?.username || 'Unknown'}\n`
      shadowBanMessage += `* Media ID: N/A                  Media Type: N/A\n`
      shadowBanMessage += `* Media Name: N/A\n`
      shadowBanMessage += `* Reason: ${data.reason || 'No reason provided'}`
      return shadowBanMessage

    case 'comment_unlocked':
      let unlockMessage = `**Comment Unlocked (ID: ${data.comment?.id || 'Unknown'})**\n`
      unlockMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      unlockMessage += `* UserID: ${data.comment?.user_id || 'Unknown'}                      Username: ${data.comment?.username || 'Unknown'}\n`
      unlockMessage += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      unlockMessage += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      unlockMessage += `* Unlocked By: ${data.moderator?.username || 'Unknown'}`
      return unlockMessage

    case 'moderation_action':
      let modMessage = `**Moderation Action**\n`
      modMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      modMessage += `* UserID: ${data.moderator?.id || 'Unknown'}                      Username: ${data.moderator?.username || 'Unknown'}\n`
      modMessage += `* Media ID: N/A                  Media Type: N/A\n`
      modMessage += `* Media Name: N/A\n`
      modMessage += `* Action: ${data.metadata?.action || 'Unknown'} - ${data.reason || 'No reason provided'}`
      return modMessage

    case 'user_unbanned':
      let unbanMessage = `**User Unbanned**\n`
      unbanMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      unbanMessage += `* UserID: ${data.user?.id || 'Unknown'}                      Username: ${data.user?.username || 'Unknown'}\n`
      unbanMessage += `* Media ID: N/A                  Media Type: N/A\n`
      unbanMessage += `* Media Name: N/A\n`
      unbanMessage += `* Reason: ${data.reason || 'No reason provided'}`
      return unbanMessage

    case 'report_dismissed':
      let dismissMessage = `**Report Dismissed (Comment ID: ${data.comment?.id || 'Unknown'})**\n`
      dismissMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      dismissMessage += `* UserID: ${data.moderator?.id || 'Unknown'}                      Username: ${data.moderator?.username || 'Unknown'}\n`
      dismissMessage += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      dismissMessage += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      dismissMessage += `* Dismissed By: ${data.moderator?.username || 'Unknown'}`
      return dismissMessage

    case 'vote_removed':
      let removeVoteMessage = `**Vote Removed (Comment ID: ${data.comment?.id || 'Unknown'})**\n`
      removeVoteMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      removeVoteMessage += `* UserID: ${data.user?.id || 'Unknown'}                      Username: ${data.user?.username || 'Unknown'}\n`
      removeVoteMessage += `* Media ID: ${data.comment?.media_id || 'Unknown'}                  Media Type: ${data.media?.type || 'Unknown'}\n`
      removeVoteMessage += `* Media Name: ${data.media?.title || 'Unknown'}\n`
      removeVoteMessage += `* Vote Type Removed: ${data.voteType || 'Unknown'}`
      return removeVoteMessage

    case 'config_updated':
      let configMessage = `**Configuration Updated**\n`
      configMessage += `* Client Type: System\n`
      configMessage += `* UserID: ${data.moderator?.id || 'Unknown'}                      Username: ${data.moderator?.username || 'Unknown'}\n`
      configMessage += `* Media ID: N/A                  Media Type: N/A\n`
      configMessage += `* Media Name: N/A\n`
      configMessage += `* Action: ${data.metadata?.action || 'Unknown'} - ${data.reason || 'No reason provided'}`
      return configMessage

    case 'system_enabled':
      let enableMessage = `**System Enabled**\n`
      enableMessage += `* Client Type: System\n`
      enableMessage += `* UserID: ${data.moderator?.id || 'Unknown'}                      Username: ${data.moderator?.username || 'Unknown'}\n`
      enableMessage += `* Media ID: N/A                  Media Type: N/A\n`
      enableMessage += `* Media Name: N/A\n`
      enableMessage += `* Action: System enabled by ${data.moderator?.username || 'Unknown'}`
      return enableMessage

    case 'system_disabled':
      let disableMessage = `**System Disabled**\n`
      disableMessage += `* Client Type: System\n`
      disableMessage += `* UserID: ${data.moderator?.id || 'Unknown'}                      Username: ${data.moderator?.username || 'Unknown'}\n`
      disableMessage += `* Media ID: N/A                  Media Type: N/A\n`
      disableMessage += `* Media Name: N/A\n`
      disableMessage += `* Action: System disabled by ${data.moderator?.username || 'Unknown'}`
      return disableMessage

    case 'bulk_action':
      let bulkMessage = `**Bulk Action Performed**\n`
      bulkMessage += `* Client Type: ${data.comment?.client_type || 'Unknown'}\n`
      bulkMessage += `* UserID: ${data.moderator?.id || 'Unknown'}                      Username: ${data.moderator?.username || 'Unknown'}\n`
      bulkMessage += `* Media ID: N/A                  Media Type: N/A\n`
      bulkMessage += `* Media Name: N/A\n`
      bulkMessage += `* Action: ${data.metadata?.action || 'Unknown'} - ${data.reason || 'No reason provided'}`
      return bulkMessage

    default:
      return `**Unknown Notification Type: ${data.type}**`
  }
}