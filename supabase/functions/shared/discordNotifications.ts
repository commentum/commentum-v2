// Discord notification utilities for Commentum v2

export interface DiscordNotificationData {
  type: 'comment_created' | 'comment_updated' | 'comment_deleted' | 'user_banned' | 'user_warned' | 'comment_pinned' | 'comment_locked' | 'vote_cast' | 'report_filed';
  comment?: any;
  user?: any;
  media?: any;
  moderator?: any;
  reason?: string;
  voteType?: string;
  reportReason?: string;
}

export async function sendDiscordNotification(supabase: any, data: DiscordNotificationData) {
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

    // Get webhook URL
    const { data: webhookConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'discord_webhook_url')
      .single()

    const webhookUrl = webhookConfig?.value || null
    if (!webhookUrl) {
      return { success: false, reason: 'Discord webhook URL not configured' }
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

    // Log notification for tracking
    const { error: logError } = await supabase
      .from('discord_notifications')
      .insert({
        notification_type: data.type,
        target_id: data.comment?.id?.toString() || data.user?.id,
        target_type: data.comment ? 'comment' : data.user ? 'user' : 'unknown',
        comment_data: data.comment ? JSON.stringify(data.comment) : null,
        user_data: data.user ? JSON.stringify(data.user) : null,
        media_data: data.media ? JSON.stringify(data.media) : null,
        webhook_url: webhookUrl,
        delivery_status: 'pending'
      })

    if (logError) {
      console.error('Failed to log Discord notification:', logError)
    }

    // Send to Discord
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'Commentum Bot',
        avatar_url: 'https://i.imgur.com/3Z1jw3T.png', // Commentum logo
        embeds: [embed]
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Discord webhook error:', errorText)
      
      // Update notification log with error
      await supabase
        .from('discord_notifications')
        .update({
          delivery_status: 'failed',
          delivery_error: errorText,
          retry_count: 1,
          next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() // Retry in 5 minutes
        })
        .eq('notification_type', data.type)
        .eq('created_at', new Date().toISOString())
        .is('delivery_status', 'pending')

      return { success: false, reason: `Discord API error: ${errorText}` }
    }

    const result = await response.json()
    
    // Update notification log with success
    await supabase
      .from('discord_notifications')
      .update({
        delivery_status: 'sent',
        message_id: result.id,
        delivered_at: new Date().toISOString()
      })
      .eq('notification_type', data.type)
      .eq('created_at', new Date().toISOString())
      .is('delivery_status', 'pending')

    return { success: true, messageId: result.id }

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
      icon_url: 'https://i.imgur.com/3Z1jw3T.png'
    }
  }

  switch (data.type) {
    case 'comment_created':
      embed.title = '💬 New Comment Posted'
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

      if (data.media) {
        embed.fields = embed.fields || []
        embed.fields.push({
          name: '📺 Media',
          value: `**${data.media.title}** (${data.media.year || 'Unknown Year'})`,
          inline: true
        })

        if (data.media.poster) {
          embed.thumbnail = {
            url: data.media.poster
          }
        }
      }

      embed.fields = embed.fields || []
      embed.fields.push({
        name: '👤 User',
        value: `${data.comment.username} (${data.comment.client_type})`,
        inline: true
      })

      if (data.comment.parent_id) {
        embed.fields.push({
          name: '🔗 Reply To',
          value: `Comment #${data.comment.parent_id}`,
          inline: true
        })
      }
      break

    case 'comment_updated':
      embed.title = '✏️ Comment Edited'
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
      break

    case 'comment_deleted':
      embed.title = '🗑️ Comment Deleted'
      embed.color = 0xff0000 // Red
      embed.description = `**${data.comment.username}** deleted their comment`
      embed.fields = [{
        name: 'Deleted By',
        value: data.moderator ? `${data.moderator.username} (Mod)` : `${data.comment.username} (Self)`,
        inline: true
      }]
      break

    case 'user_banned':
      embed.title = '🚫 User Banned'
      embed.color = 0xff0000 // Red
      embed.description = `**${data.user?.username || data.user?.id}** has been banned`
      embed.fields = [
        {
          name: '👤 Banned User',
          value: data.user?.username || data.user?.id,
          inline: true
        },
        {
          name: '🔨 Banned By',
          value: data.moderator?.username || 'System',
          inline: true
        }
      ]

      if (data.reason) {
        embed.fields.push({
          name: '📝 Reason',
          value: data.reason
        })
      }
      break

    case 'user_warned':
      embed.title = '⚠️ User Warned'
      embed.color = 0xffa500 // Orange
      embed.description = `**${data.user?.username || data.user?.id}** has been warned`
      embed.fields = [
        {
          name: '⚠️ Warned User',
          value: data.user?.username || data.user?.id,
          inline: true
        },
        {
          name: '🛡️ Warned By',
          value: data.moderator?.username || 'System',
          inline: true
        }
      ]

      if (data.reason) {
        embed.fields.push({
          name: '📝 Reason',
          value: data.reason
        })
      }
      break

    case 'comment_pinned':
      embed.title = '📌 Comment Pinned'
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

      if (data.reason) {
        embed.fields = embed.fields || []
        embed.fields.push({
          name: '📝 Reason',
          value: data.reason,
          inline: true
        })
      }
      break

    case 'comment_locked':
      embed.title = '🔒 Comment Thread Locked'
      embed.color = 0x808080 // Gray
      embed.description = `**${data.moderator?.username}** locked a comment thread by **${data.comment.username}**`
      
      if (data.reason) {
        embed.fields = [{
          name: '📝 Reason',
          value: data.reason
        }]
      }
      break

    case 'vote_cast':
      embed.title = data.voteType === 'upvote' ? '👍 Upvote Cast' : '👎 Downvote Cast'
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
      break

    case 'report_filed':
      embed.title = '🚨 Comment Reported'
      embed.color = 0xff4500 // Orange Red
      embed.description = `A comment by **${data.comment.username}** was reported`
      embed.fields = [
        {
          name: '🚨 Report Reason',
          value: data.reportReason || 'Unknown',
          inline: true
        },
        {
          name: '👤 Reported User',
          value: data.comment.username,
          inline: true
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
  }

  // Add media info if available
  if (data.media && data.type !== 'comment_created') {
    embed.fields = embed.fields || []
    embed.fields.push({
      name: '📺 Media',
      value: `**${data.media.title}** (${data.media.year || 'Unknown Year'})`,
      inline: true
    })

    if (data.media.poster) {
      embed.thumbnail = {
        url: data.media.poster
      }
    }
  }

  return embed
}

export async function retryFailedNotifications(supabase: any) {
  try {
    const { data: failedNotifications, error } = await supabase
      .from('discord_notifications')
      .select('*')
      .eq('delivery_status', 'failed')
      .lt('next_retry_at', new Date().toISOString())
      .lt('retry_count', 3) // Max 3 retries
      .order('created_at', { ascending: true })
      .limit(10)

    if (error || !failedNotifications.length) {
      return { success: true, retried: 0 }
    }

    let retried = 0

    for (const notification of failedNotifications) {
      try {
        const response = await fetch(notification.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: 'Commentum Bot',
            avatar_url: 'https://i.imgur.com/3Z1jw3T.png',
            embeds: [JSON.parse(notification.comment_data || '{}')]
          })
        })

        if (response.ok) {
          await supabase
            .from('discord_notifications')
            .update({
              delivery_status: 'sent',
              delivered_at: new Date().toISOString()
            })
            .eq('id', notification.id)

          retried++
        } else {
          await supabase
            .from('discord_notifications')
            .update({
              retry_count: notification.retry_count + 1,
              next_retry_at: new Date(Date.now() + Math.pow(2, notification.retry_count + 1) * 60 * 1000).toISOString() // Exponential backoff
            })
            .eq('id', notification.id)
        }
      } catch (error) {
        console.error(`Retry failed for notification ${notification.id}:`, error)
      }
    }

    return { success: true, retried }

  } catch (error) {
    console.error('Error retrying notifications:', error)
    return { success: false, error: error.message }
  }
}
