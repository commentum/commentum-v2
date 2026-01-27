// Discord notification utilities for Commentum v2

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
  serverKey?: string; // Use Supabase SERVICE_ROLE_KEY for server-side authentication
  metadata?: any;
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
          webhook_url: webhookUrl,
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
          webhook_url: webhookUrl,
          delivery_status: 'pending'
        }, {
          onConflict: 'id'
        })
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
      
      // Update notification record with error if we have an ID
      if (notificationId) {
        await supabase
          .from('discord_notifications')
          .update({
            delivery_status: 'failed',
            delivery_error: errorText
          })
          .eq('id', notificationId)
      }
      
      return { success: false, reason: `Discord API error: ${errorText}` }
    }

    const result = await response.json()
    
    // Update notification record with success if we have an ID
    if (notificationId) {
      await supabase
        .from('discord_notifications')
        .update({
          delivery_status: 'sent',
          message_id: result.id,
          delivered_at: new Date().toISOString()
        })
        .eq('id', notificationId)
    }

    return { success: true, messageId: result.id, notificationId }

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
          name: 'Resolution',
          value: data.reason || 'Report resolved',
          inline: true
        },
        {
          name: 'Resolved By',
          value: data.moderator?.username || 'Unknown Moderator',
          inline: true
        },
        {
          name: 'IDs (Click to Copy)',
          value: `**Comment ID:** \`${data.comment.id}\`\n**User ID:** \`${data.comment.user_id}\`\n**Media ID:** \`${data.comment.media_id}\`\n**Moderator ID:** \`${data.moderator?.id}\``,
          inline: false
        }
      ]

      if (data.comment.content) {
        embed.fields.push({
          name: 'Comment',
          value: data.comment.content.length > 200 
            ? data.comment.content.substring(0, 200) + '...' 
            : data.comment.content
        })
      }
      break

    case 'report_dismissed':
      embed.title = 'Report Dismissed'
      embed.color = 0x808080 // Gray
      embed.description = `**${data.moderator?.username}** dismissed a report on a comment by **${data.comment.username}**`
      embed.fields = [
        {
          name: 'Dismissal Reason',
          value: data.reason || 'Report dismissed',
          inline: true
        },
        {
          name: 'Dismissed By',
          value: data.moderator?.username || 'Unknown Moderator',
          inline: true
        },
        {
          name: 'IDs (Click to Copy)',
          value: `**Comment ID:** \`${data.comment.id}\`\n**User ID:** \`${data.comment.user_id}\`\n**Media ID:** \`${data.comment.media_id}\`\n**Moderator ID:** \`${data.moderator?.id}\``,
          inline: false
        }
      ]

      if (data.comment.content) {
        embed.fields.push({
          name: 'Comment',
          value: data.comment.content.length > 200 
            ? data.comment.content.substring(0, 200) + '...' 
            : data.comment.content
        })
      }
      break

    case 'vote_removed':
      embed.title = 'Vote Removed'
      embed.color = 0xffa500 // Orange
      embed.description = `A vote was removed from a comment by **${data.comment.username}**`
      
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

    case 'user_muted':
      embed.title = 'User Muted'
      embed.color = 0xffa500 // Orange
      embed.description = `**${data.user?.username || data.user?.id}** has been muted`
      embed.fields = [
        {
          name: 'Muted User',
          value: `${data.user?.username || data.user?.id} (\`${data.user?.id}\`)`,
          inline: true
        },
        {
          name: 'Muted By',
          value: `${data.moderator?.username || 'System'} (\`${data.moderator?.id}\`)`,
          inline: true
        },
        {
          name: 'Duration',
          value: data.metadata?.duration || 'Unknown',
          inline: true
        }
      ]

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason
        })
      }
      break

    case 'user_shadow_banned':
      embed.title = 'User Shadow Banned'
      embed.color = 0x8b0000 // Dark Red
      embed.description = `**${data.user?.username || data.user?.id}** has been shadow banned`
      embed.fields = [
        {
          name: 'Shadow Banned User',
          value: `${data.user?.username || data.user?.id} (\`${data.user?.id}\`)`,
          inline: true
        },
        {
          name: 'Banned By',
          value: `${data.moderator?.username || 'System'} (\`${data.moderator?.id}\`)`,
          inline: true
        }
      ]

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason
        })
      }
      break

    case 'user_unbanned':
      embed.title = 'User Unbanned'
      embed.color = 0x00ff00 // Green
      embed.description = `**${data.user?.username || data.user?.id}** has been unbanned`
      embed.fields = [
        {
          name: 'Unbanned User',
          value: `${data.user?.username || data.user?.id} (\`${data.user?.id}\`)`,
          inline: true
        },
        {
          name: 'Unbanned By',
          value: `${data.moderator?.username || 'System'} (\`${data.moderator?.id}\`)`,
          inline: true
        }
      ]

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason
        })
      }
      break

    case 'comment_unlocked':
      embed.title = 'Comment Thread Unlocked'
      embed.color = 0x00ff00 // Green
      embed.description = `**${data.moderator?.username}** unlocked a comment thread by **${data.comment.username}**`
      
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

    case 'moderation_action':
      embed.title = 'Moderation Action'
      embed.color = 0xffd700 // Gold
      embed.description = `**${data.moderator?.username}** performed a moderation action`
      embed.fields = [
        {
          name: 'Action',
          value: data.metadata?.action || 'Unknown',
          inline: true
        },
        {
          name: 'Moderator',
          value: `${data.moderator?.username} (\`${data.moderator?.id}\`)`,
          inline: true
        },
        {
          name: 'Target',
          value: data.user?.username || data.comment?.username || 'Unknown',
          inline: true
        }
      ]

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason
        })
      }
      break

    case 'config_updated':
      embed.title = 'Configuration Updated'
      embed.color = 0x4169e1 // Royal Blue
      embed.description = `**${data.moderator?.username}** updated system configuration`
      embed.fields = [
        {
          name: 'Config Key',
          value: data.metadata?.configKey || 'Unknown',
          inline: true
        },
        {
          name: 'Updated By',
          value: `${data.moderator?.username} (\`${data.moderator?.id}\`)`,
          inline: true
        }
      ]

      if (data.metadata?.oldValue && data.metadata?.newValue) {
        embed.fields.push({
          name: 'Changes',
          value: `**From:** ${data.metadata.oldValue}\n**To:** ${data.metadata.newValue}`,
          inline: false
        })
      }
      break

    case 'system_enabled':
      embed.title = 'System Enabled'
      embed.color = 0x00ff00 // Green
      embed.description = `**${data.moderator?.username}** enabled the comment system`
      embed.fields = [
        {
          name: 'Enabled By',
          value: `${data.moderator?.username} (\`${data.moderator?.id}\`)`,
          inline: true
        }
      ]
      break

    case 'system_disabled':
      embed.title = 'System Disabled'
      embed.color = 0xff0000 // Red
      embed.description = `**${data.moderator?.username}** disabled the comment system`
      embed.fields = [
        {
          name: 'Disabled By',
          value: `${data.moderator?.username} (\`${data.moderator?.id}\`)`,
          inline: true
        }
      ]

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason
        })
      }
      break

    case 'bulk_action':
      embed.title = 'Bulk Action Performed'
      embed.color = 0x9932cc // Dark Orchid
      embed.description = `**${data.moderator?.username}** performed a bulk action`
      embed.fields = [
        {
          name: 'Action Type',
          value: data.metadata?.actionType || 'Unknown',
          inline: true
        },
        {
          name: 'Items Affected',
          value: data.metadata?.count || 'Unknown',
          inline: true
        },
        {
          name: 'Performed By',
          value: `${data.moderator?.username} (\`${data.moderator?.id}\`)`,
          inline: true
        }
      ]

      if (data.reason) {
        embed.fields.push({
          name: 'Reason',
          value: data.reason
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

// Permission checking function for server key actions
async function checkActionPermissions(supabase: any, userId: string, actionType: string) {
  try {
    // Get user role
    const userRole = await getUserRole(supabase, userId)
    
    // Define permission matrix
    const permissions: { [key: string]: string[] } = {
      'user': [
        'comment_created', 'comment_updated', 'comment_deleted', 
        'vote_cast', 'vote_removed', 'report_filed'
      ],
      'moderator': [
        'comment_created', 'comment_updated', 'comment_deleted', 
        'vote_cast', 'vote_removed', 'report_filed', 'report_resolved', 'report_dismissed',
        'user_warned', 'user_muted', 'comment_pinned', 'comment_locked', 'comment_unlocked',
        'moderation_action'
      ],
      'admin': [
        'comment_created', 'comment_updated', 'comment_deleted', 
        'vote_cast', 'vote_removed', 'report_filed', 'report_resolved', 'report_dismissed',
        'user_warned', 'user_muted', 'user_banned', 'user_shadow_banned', 'user_unbanned',
        'comment_pinned', 'comment_locked', 'comment_unlocked', 'moderation_action',
        'system_enabled', 'system_disabled', 'bulk_action'
      ],
      'super_admin': [
        'comment_created', 'comment_updated', 'comment_deleted', 
        'vote_cast', 'vote_removed', 'report_filed', 'report_resolved', 'report_dismissed',
        'user_warned', 'user_muted', 'user_banned', 'user_shadow_banned', 'user_unbanned',
        'comment_pinned', 'comment_locked', 'comment_unlocked', 'moderation_action',
        'config_updated', 'system_enabled', 'system_disabled', 'bulk_action'
      ]
    }

    const allowedActions = permissions[userRole] || []
    
    if (allowedActions.includes(actionType)) {
      return { allowed: true }
    } else {
      return { 
        allowed: false, 
        reason: `User role '${userRole}' not allowed to perform action '${actionType}'` 
      }
    }
  } catch (error) {
    console.error('Permission check error:', error)
    return { allowed: false, reason: 'Permission check failed' }
  }
}

// Get user role from config (reuse from auth.ts)
async function getUserRole(supabase: any, userId: string) {
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
    console.error('Get user role error:', error)
    return 'user'
  }
}
