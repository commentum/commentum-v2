// Enhanced Discord notification utilities for Commentum v2
// Updated to use Discord Bot API with Components V2 for interactive buttons
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

export interface DiscordNotificationData {
  type: 'comment_created' | 'comment_updated' | 'comment_deleted' | 'user_banned' | 'user_warned' | 'comment_pinned' | 'comment_locked' | 'report_filed' | 'report_resolved' | 'report_dismissed' | 
        'user_muted' | 'user_shadow_banned' | 'comment_unlocked' | 'moderation_action' | 'config_updated' | 'system_enabled' | 'system_disabled' | 'user_unbanned' | 'bulk_action' | 'vote_cast' | 'vote_removed' | 'announcement_published';
  comment?: {
    id: number | string;
    user_id?: string;
    username?: string;
    user_avatar?: string;
    client_type?: string;
    media_id?: string;
    media_type?: string;
    media_title?: string;
    content?: string;
    deleted?: boolean;
    deleted_by?: string;
    deleted_by_username?: string;
    user_banned?: boolean;
    user_muted_until?: string;
    user_warnings?: number;
    banned_by?: string;
    banned_by_username?: string;
    muted_by?: string;
    muted_by_username?: string;
    warned_by?: string;
    warned_by_username?: string;
    pinned?: boolean;
    locked?: boolean;
    url?: string;
  };
  user?: {
    id: string;
    username?: string;
    avatar?: string;
    banned?: boolean;
    banned_by?: string;
    banned_by_username?: string;
  };
  media?: {
    id?: string;
    type?: string;
    title?: string;
    year?: number;
    poster?: string;
    client_type?: string;
  };
  moderator?: {
    id?: string;
    username?: string;
  };
  reason?: string;
  reportReason?: string;
  actionedBy?: string;
  metadata?: any;
  voteType?: 'upvote' | 'downvote';
  voteScore?: number;
}

// ====================================
// DISCORD COMPONENTS V2 CONSTANTS
// ====================================

// Component types for Discord Components V2
const COMPONENT_TYPES = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_DISPLAY: 10,
  SEPARATOR: 14,
  CONTAINER: 17,
} as const

// Button styles
const BUTTON_STYLES = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const

// Components V2 flag (must be set in message flags)
const IS_COMPONENTS_V2 = 32768

// ====================================
// COMPONENTS V2 BUILDERS
// ====================================

interface ButtonComponent {
  type: number
  style: number
  label: string
  custom_id?: string
  url?: string
  disabled?: boolean
  emoji?: { name: string }
}

interface ActionRowComponent {
  type: number
  components: ButtonComponent[]
}

interface TextDisplayComponent {
  type: number
  content: string
}

interface SeparatorComponent {
  type: number
  divider?: boolean
  spacing?: number
}

interface ContainerComponent {
  type: number
  accent_color?: number
  components: any[]
  spoiler?: boolean
}

// Build a button component
function buildButton(
  label: string, 
  style: number, 
  customId?: string, 
  url?: string, 
  emoji?: string,
  disabled: boolean = false
): ButtonComponent {
  const button: ButtonComponent = {
    type: COMPONENT_TYPES.BUTTON,
    style,
    label,
    disabled
  }
  
  if (customId) button.custom_id = customId
  if (url) button.url = url
  if (emoji) button.emoji = { name: emoji }
  
  return button
}

// Build an action row with buttons
function buildActionRow(buttons: ButtonComponent[]): ActionRowComponent {
  return {
    type: COMPONENT_TYPES.ACTION_ROW,
    components: buttons
  }
}

// Build a text display component (markdown supported)
function buildTextDisplay(content: string): TextDisplayComponent {
  return {
    type: COMPONENT_TYPES.TEXT_DISPLAY,
    content
  }
}

// Build a separator
function buildSeparator(divider: boolean = true, spacing: number = 1): SeparatorComponent {
  return {
    type: COMPONENT_TYPES.SEPARATOR,
    divider,
    spacing
  }
}

// Build a container with accent color
function buildContainer(components: any[], accentColor?: number): ContainerComponent {
  const container: ContainerComponent = {
    type: COMPONENT_TYPES.CONTAINER,
    components
  }
  
  if (accentColor !== undefined) {
    container.accent_color = accentColor
  }
  
  return container
}

// ====================================
// MODERATION BUTTON GENERATORS
// ====================================

interface ModerationButtons {
  commentButtonsRow?: ActionRowComponent
  userButtonRow?: ActionRowComponent
}

// Generate moderation buttons based on notification type
function generateModerationButtons(data: DiscordNotificationData): ModerationButtons {
  const buttons: ModerationButtons = {}
  
  // Comment action buttons
  if (data.comment?.id) {
    const commentId = data.comment.id
    const userId = data.comment.user_id || data.user?.id
    
    buttons.commentButtonRow = buildActionRow([
      // Delete comment button
      buildButton('Delete', BUTTON_STYLES.DANGER, `mod_delete:${commentId}:${userId}`, undefined, '🗑️'),
      // View comment button (link to the comment if we have a URL)
      buildButton('View Context', BUTTON_STYLES.LINK, undefined, data.comment.url || `https://discord.com`, undefined),
    ])
  }
  
  // User action buttons (for moderation notifications)
  if (data.user?.id && ['report_filed', 'user_warned', 'comment_created'].includes(data.type)) {
    const userId = data.user.id
    
    buttons.userButtonRow = buildActionRow([
      buildButton('Warn', BUTTON_STYLES.SECONDARY, `mod_warn:${userId}`, undefined, '⚠️'),
      buildButton('Mute', BUTTON_STYLES.SECONDARY, `mod_mute:${userId}`, undefined, '🔇'),
      buildButton('Ban', BUTTON_STYLES.DANGER, `mod_ban:${userId}`, undefined, '🔨'),
    ])
  }
  
  return buttons
}

// Generate buttons for report notifications
function generateReportButtons(data: DiscordNotificationData): ActionRowComponent[] {
  const commentId = data.comment?.id
  const userId = data.comment?.user_id || data.user?.id
  
  const rows: ActionRowComponent[] = []
  
  // First row: Resolve/Dismiss report
  if (commentId) {
    rows.push(buildActionRow([
      buildButton('Approve Comment', BUTTON_STYLES.SUCCESS, `report_approve:${commentId}:${userId}`, undefined, '✅'),
      buildButton('Dismiss Report', BUTTON_STYLES.SECONDARY, `report_dismiss:${commentId}`, undefined, '❌'),
    ]))
    
    // Second row: Moderation actions
    rows.push(buildActionRow([
      buildButton('Delete & Warn', BUTTON_STYLES.DANGER, `mod_delete_warn:${commentId}:${userId}`, undefined, '🗑️⚠️'),
      buildButton('Delete & Ban', BUTTON_STYLES.DANGER, `mod_delete_ban:${commentId}:${userId}`, undefined, '🗑️🔨'),
    ]))
  }
  
  return rows
}

// ====================================
// DISCORD API HELPERS
// ====================================

// Bot API request helper
async function discordBotApi(
  endpoint: string, 
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: any,
  botToken?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const token = botToken || Deno.env.get('DISCORD_BOT_TOKEN')
    
    if (!token) {
      return { success: false, error: 'Discord bot token not configured' }
    }
    
    const response = await fetch(`https://discord.com/api/v10${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Discord API error (${response.status}):`, errorText)
      return { success: false, error: errorText }
    }
    
    // Handle empty responses
    const responseText = await response.text()
    let data = null
    if (responseText && responseText.trim()) {
      try {
        data = JSON.parse(responseText)
      } catch {
        // Response wasn't JSON, that's okay
      }
    }
    
    return { success: true, data }
    
  } catch (error) {
    console.error('Discord API request failed:', error)
    return { success: false, error: error.message }
  }
}

// Send message to channel with Components V2
async function sendComponentsV2Message(
  channelId: string,
  components: any[],
  botToken?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const body = {
    flags: IS_COMPONENTS_V2,
    components
  }
  
  const result = await discordBotApi(
    `/channels/${channelId}/messages`,
    'POST',
    body,
    botToken
  )
  
  if (result.success && result.data?.id) {
    return { success: true, messageId: result.data.id }
  }
  
  return { success: false, error: result.error }
}

// ====================================
// NOTIFICATION QUEUE SYSTEM
// ====================================

// Background notification queue - stores notifications for async processing
let notificationQueue: DiscordNotificationData[] = []
let isProcessingQueue = false

// Add notification to background queue - NON-BLOCKING
export function queueDiscordNotification(data: DiscordNotificationData) {
  // Add to queue without waiting
  notificationQueue.push(data)
  
  // Start background processing if not already running
  if (!isProcessingQueue) {
    processNotificationQueue()
  }
  
  // Immediately return success - don't wait for Discord
  return { success: true, queued: true, message: 'Notification queued for background processing' }
}

// Legacy function for backward compatibility - now just queues the notification
export async function sendDiscordNotification(supabase: any, data: DiscordNotificationData) {
  // Just queue it and return immediately - don't block the main flow
  return queueDiscordNotification(data)
}

// Background queue processor - runs independently
async function processNotificationQueue() {
  if (isProcessingQueue || notificationQueue.length === 0) {
    return
  }
  
  isProcessingQueue = true
  
  try {
    while (notificationQueue.length > 0) {
      const notification = notificationQueue.shift()
      if (notification) {
        // Process each notification without blocking the main flow
        processNotificationInBackground(notification).catch(error => {
          console.error('Background notification processing failed:', error)
        })
      }
    }
  } finally {
    isProcessingQueue = false
  }
}

// Individual notification processing - runs in background
async function processNotificationInBackground(data: DiscordNotificationData) {
  try {
    // Create a temporary Supabase client for background processing
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    await sendDiscordNotificationInternal(supabase, data)
  } catch (error) {
    console.error('Background notification error:', error)
  }
}

// ====================================
// CORE NOTIFICATION SENDING LOGIC
// ====================================

// Internal Discord notification implementation - uses Bot API with Components V2
async function sendDiscordNotificationInternal(supabase: any, data: DiscordNotificationData) {
  try {
    // Get bot token from environment variable
    const botToken = Deno.env.get('DISCORD_BOT_TOKEN')

    if (!botToken) {
      return { success: false, reason: 'Discord bot token not configured in DISCORD_BOT_TOKEN env' }
    }

    // Check if Discord notifications are enabled
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
    
    // Get ALL appropriate channel IDs from ALL active servers
    const channelConfigs = await getChannelConfigs(supabase, channelType)
    
    if (channelConfigs.length === 0) {
      return { success: false, reason: `No channel IDs configured for ${channelType} channel in any active server` }
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

    // Build Components V2 message
    const components = createComponentsV2Message(data)

    // Log notification for tracking using comment ID if available
    let notificationId = null
    
    // For comment notifications, use comment ID; for others, create new record
    if (data.comment?.id) {
      notificationId = data.comment.id
    } else {
      const { data: newNotification } = await supabase
        .from('discord_notifications')
        .insert({
          notification_type: data.type,
          target_id: data.comment?.id?.toString() || data.user?.id,
          target_type: data.comment ? 'comment' : data.user ? 'user' : 'unknown',
          comment_data: data.comment ? JSON.stringify(data.comment) : null,
          user_data: data.user ? JSON.stringify(data.user) : null,
          media_data: data.media ? JSON.stringify(data.media) : null,
          delivery_status: 'pending'
        })
        .select('id')
        .single()

      if (newNotification) {
        notificationId = newNotification.id
      }
    }

    // Send to ALL configured channels
    const sendResults = []
    
    for (const channelConfig of channelConfigs) {
      const sendResult = await sendComponentsV2Message(
        channelConfig.channelId,
        components,
        botToken
      )
      
      sendResults.push({
        guildId: channelConfig.guildId,
        channelId: channelConfig.channelId,
        success: sendResult.success,
        messageId: sendResult.messageId,
        error: sendResult.error
      })

      // Update notification record with message ID for each server
      if (sendResult.success && sendResult.messageId && notificationId) {
        await supabase
          .from('discord_notifications')
          .upsert({
            id: notificationId,
            notification_type: data.type,
            target_id: data.comment?.id?.toString() || data.user?.id,
            target_type: data.comment ? 'comment' : data.user ? 'user' : 'unknown',
            comment_data: data.comment ? JSON.stringify(data.comment) : null,
            user_data: data.user ? JSON.stringify(data.user) : null,
            media_data: data.media ? JSON.stringify(data.media) : null,
            channel_id: channelConfig.channelId,
            guild_id: channelConfig.guildId,
            message_id: sendResult.messageId,
            delivery_status: 'sent',
            delivered_at: new Date().toISOString()
          }, {
            onConflict: 'id'
          })
      }
    }

    const successfulSends = sendResults.filter(r => r.success)
    const failedSends = sendResults.filter(r => !r.success)

    // Update notification record with overall status
    if (notificationId) {
      await supabase
        .from('discord_notifications')
        .update({
          delivery_status: failedSends.length === 0 ? 'sent' : 'partial',
          delivery_error: failedSends.length > 0 ? JSON.stringify(failedSends.map(f => f.error)) : null,
          delivered_at: failedSends.length === 0 ? new Date().toISOString() : null
        })
        .eq('id', notificationId)
    }

    return { 
      success: failedSends.length === 0, 
      channel: channelType,
      totalChannels: channelConfigs.length,
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
    'vote_removed',
    'announcement_published'
  ]
  
  return commentsChannelTypes.includes(notificationType) ? 'comments' : 'moderation'
}

// Get the channel IDs for a specific channel type from ALL active servers
async function getChannelConfigs(
  supabase: any, 
  channelType: 'comments' | 'moderation'
): Promise<{ guildId: string; channelId: string }[]> {
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

    const channels: { guildId: string; channelId: string }[] = []

    // For each server, get the appropriate channel ID
    for (const serverConfig of serverConfigs) {
      const channelId = channelType === 'comments' 
        ? serverConfig.channel_id 
        : serverConfig.moderation_channel_id

      if (channelId) {
        channels.push({
          guildId: serverConfig.guild_id,
          channelId
        })
      }
    }

    return channels
  } catch (error) {
    console.error('Error fetching channel IDs from server_configs:', error)
    return []
  }
}

// ====================================
// COMPONENTS V2 MESSAGE BUILDERS
// ====================================

// Create Components V2 message based on notification type
function createComponentsV2Message(data: DiscordNotificationData): any[] {
  const components: any[] = []
  
  // Build the container with content
  const containerContent = buildNotificationContent(data)
  
  // Add container with content
  components.push(containerContent)
  
  // Add separator
  components.push(buildSeparator(true, 1))
  
  // Add interactive buttons based on notification type
  const buttons = buildInteractiveButtons(data)
  if (buttons.length > 0) {
    components.push(...buttons)
  }
  
  return components
}

// Build notification content as Components V2 container
function buildNotificationContent(data: DiscordNotificationData): ContainerComponent {
  const lines: string[] = []
  let accentColor: number | undefined
  
  // Get the main username for display
  const mainUsername = data.comment?.username || data.user?.username || 'Unknown'
  const mainUserId = data.comment?.user_id || data.user?.id || ''
  const clientType = data.comment?.client_type || 'anilist'
  
  // Build header based on type
  switch (data.type) {
    case 'comment_created':
      lines.push('## 💬 New Comment Posted')
      lines.push(`**${mainUsername}** posted a new comment`)
      accentColor = 0x00FF00 // Green
      break
      
    case 'comment_updated':
      lines.push('## ✏️ Comment Edited')
      lines.push(`**${mainUsername}** edited their comment`)
      accentColor = 0x9B59B6 // Purple
      break
      
    case 'comment_deleted':
      const deleterName = data.moderator?.username || data.comment?.username || 'Unknown'
      lines.push('## 🗑️ Comment Deleted')
      lines.push(`**${deleterName}** deleted a comment`)
      accentColor = 0xFF0000 // Red
      break
      
    case 'vote_cast':
      const voteEmoji = data.voteType === 'upvote' ? '👍' : '👎'
      lines.push(`## ${voteEmoji} ${data.voteType === 'upvote' ? 'Upvote' : 'Downvote'} Cast`)
      lines.push(`**${mainUsername}** voted on comment \`${data.comment?.id}\``)
      accentColor = 0xFFA500 // Orange
      break
      
    case 'vote_removed':
      lines.push('## ↩️ Vote Removed')
      lines.push(`**${mainUsername}** removed their vote from comment \`${data.comment?.id}\``)
      accentColor = 0xFFA500 // Orange
      break
      
    case 'report_filed':
      const reporterName = data.user?.username || 'Unknown'
      lines.push('## 🚨 Comment Reported')
      lines.push(`**${reporterName}** reported a comment`)
      accentColor = 0xFF8C00 // Dark Orange
      break
      
    case 'user_banned':
      const bannerName = data.moderator?.username || 'System'
      lines.push('## 🔨 User Banned')
      lines.push(`**${mainUsername}** was banned by **${bannerName}**`)
      accentColor = 0x8B0000 // Dark Red
      break
      
    case 'user_warned':
      const warnerName = data.moderator?.username || 'System'
      lines.push('## ⚠️ User Warned')
      lines.push(`**${mainUsername}** was warned by **${warnerName}**`)
      accentColor = 0xFFD700 // Gold
      break
      
    case 'user_muted':
      const muterName = data.moderator?.username || 'System'
      lines.push('## 🔇 User Muted')
      lines.push(`**${mainUsername}** was muted by **${muterName}**`)
      accentColor = 0x808080 // Gray
      break
      
    case 'user_shadow_banned':
      const shadowBannerName = data.moderator?.username || 'System'
      lines.push('## 👻 User Shadow Banned')
      lines.push(`**${mainUsername}** was shadow banned by **${shadowBannerName}**`)
      accentColor = 0x4B0082 // Indigo
      break
      
    case 'comment_pinned':
      const pinnerName = data.moderator?.username || 'Moderator'
      lines.push('## 📌 Comment Pinned')
      lines.push(`**${pinnerName}** pinned a comment`)
      accentColor = 0x00BFFF // Deep Sky Blue
      break
      
    case 'comment_locked':
      const lockerName = data.moderator?.username || 'Moderator'
      lines.push('## 🔒 Thread Locked')
      lines.push(`**${lockerName}** locked a comment thread`)
      accentColor = 0x8B4513 // Saddle Brown
      break
      
    case 'comment_unlocked':
      const unlockerName = data.moderator?.username || 'Moderator'
      lines.push('## 🔓 Thread Unlocked')
      lines.push(`**${unlockerName}** unlocked a comment thread`)
      accentColor = 0x32CD32 // Lime Green
      break
      
    case 'report_resolved':
      const resolverName = data.moderator?.username || 'Moderator'
      lines.push('## ✅ Report Resolved')
      lines.push(`**${resolverName}** resolved a report`)
      accentColor = 0x00FA9A // Medium Spring Green
      break
      
    case 'report_dismissed':
      const dismisserName = data.moderator?.username || 'Moderator'
      lines.push('## ❌ Report Dismissed')
      lines.push(`**${dismisserName}** dismissed a report`)
      accentColor = 0xDC143C // Crimson
      break
      
    case 'announcement_published':
      const appName = data.comment?.client_type || 'App'
      const appDisplayName = appName === 'anymex' ? 'AnymeX' : appName === 'shonenx' ? 'ShonenX' : appName === 'animestream' ? 'Animestream' : appName
      lines.push('## 📢 New Announcement')
      lines.push(`**${appDisplayName}** - New developer announcement!`)
      accentColor = 0x5865F2 // Discord Blurple
      break
      
    default:
      lines.push('## 📢 System Notification')
      lines.push(`Event: ${data.type}`)
      accentColor = 0x808080 // Gray
  }
  
  lines.push('')
  
  // Add user info (compact format) - skip for announcements
  if (mainUserId && data.type !== 'announcement_published') {
    lines.push(`### 👤 User Info`)
    lines.push(`- **ID:** \`${mainUserId}\` (${mainUsername})`)
    lines.push(`- **Client:** ${clientType}`)
    lines.push('')
  }
  
  // Add media info (compact format) - skip for announcements
  if (data.media && data.type !== 'announcement_published') {
    lines.push(`### 🎬 Media Info`)
    const mediaId = data.comment?.media_id || data.media?.id || ''
    const mediaType = data.media.type || 'anime'
    const yearStr = data.media.year ? ` | ${data.media.year}` : ''
    lines.push(`- **ID:** \`${mediaId}\` | ${mediaType}${yearStr}`)
    if (data.media.title) {
      lines.push(`- **Title:** ${data.media.title}`)
    }
    lines.push('')
  }
  
  // Add announcement-specific content
  if (data.type === 'announcement_published' && data.reason) {
    lines.push(`### 📝 Announcement`)
    lines.push(`**${data.reason}**`) // Title
    lines.push('')
    if (data.comment?.content) {
      const content = data.comment.content.substring(0, 300)
      lines.push(`${content}${data.comment.content.length > 300 ? '...' : ''}`)
      lines.push('')
    }
    if (data.moderator?.username) {
      lines.push(`— **${data.moderator.username}**`)
      lines.push('')
    }
  }
  
  // Add comment content (compact) - skip for announcements
  if (data.comment?.content && data.type !== 'announcement_published') {
    lines.push(`### 💭 Comment`)
    const content = data.comment.content.substring(0, 200)
    lines.push(`> ${content}${data.comment.content.length > 200 ? '...' : ''}`)
    lines.push('')
  }
  
  // Add reason (compact)
  if (data.reason) {
    lines.push(`### 📝 Reason`)
    lines.push(data.reason)
    lines.push('')
  }
  
  // Add report reason (compact)
  if (data.reportReason) {
    lines.push(`### 🚨 Report Reason`)
    lines.push(data.reportReason)
    lines.push('')
  }
  
  // Add timestamp footer
  lines.push(`---`)
  lines.push(`<t:${Math.floor(Date.now() / 1000)}:R> • Commentum v2`)
  
  return buildContainer([buildTextDisplay(lines.join('\n'))], accentColor)
}

// Build View URL for View button
// Uses actual platform URLs with #comment tab anchor
function buildDeepLinkUrl(data: DiscordNotificationData): string {
  const clientType = data.comment?.client_type || data.media?.client_type || 'anilist'
  const mediaType = data.comment?.media_type || data.media?.type || 'anime'
  const mediaId = data.comment?.media_id || data.media?.id || ''
  
  // Build platform-specific URLs
  switch (clientType) {
    case 'anilist':
      // https://anilist.co/anime/20958#comment
      return `https://anilist.co/${mediaType}/${mediaId}#comment`
    
    case 'myanimelist':
    case 'mal':
      // https://myanimelist.net/anime/5114#comment
      return `https://myanimelist.net/${mediaType}/${mediaId}#comment`
    
    case 'simkl':
      // https://simkl.com/anime/40991#comment
      return `https://simkl.com/${mediaType}/${mediaId}#comment`
    
    default:
      // Fallback to AniList
      return `https://anilist.co/${mediaType}/${mediaId}#comment`
  }
}

// Build interactive buttons based on notification type
function buildInteractiveButtons(data: DiscordNotificationData): ActionRowComponent[] {
  const rows: ActionRowComponent[] = []
  
  // Generate deep link URL for View button
  const deepLinkUrl = buildDeepLinkUrl(data)
  
  switch (data.type) {
    case 'comment_created':
    case 'comment_updated':
      // Comment notifications: Delete and View buttons
      if (data.comment?.id) {
        const isDeleted = data.comment?.deleted === true
        const deletedBy = data.comment?.deleted_by_username || data.comment?.deleted_by || null
        
        rows.push(buildActionRow([
          buildButton(
            isDeleted ? `Already deleted by ${deletedBy || 'Unknown'}` : 'Delete', 
            BUTTON_STYLES.DANGER, 
            isDeleted ? undefined : `mod_delete:${data.comment.id}:${data.comment.user_id}`, 
            undefined, 
            '🗑️',
            isDeleted // Disable button if already deleted
          ),
          buildButton('View', BUTTON_STYLES.LINK, undefined, deepLinkUrl, '👁️'),
        ]))
        
        // User action buttons - check user status
        if (data.comment?.user_id) {
          const isBanned = data.comment?.user_banned === true
          const isMuted = data.comment?.user_muted_until && new Date(data.comment.user_muted_until) > new Date()
          const warningCount = data.comment?.user_warnings || 0
          const bannedBy = data.comment?.banned_by_username || data.comment?.banned_by || null
          const mutedBy = data.comment?.muted_by_username || data.comment?.muted_by || null
          const warnedBy = data.comment?.warned_by_username || data.comment?.warned_by || null
          
          rows.push(buildActionRow([
            buildButton(
              warningCount > 0 ? `Already warned by ${warnedBy || 'Mod'} (${warningCount}x)` : 'Warn User', 
              BUTTON_STYLES.SECONDARY, 
              warningCount > 0 ? undefined : `mod_warn:${data.comment.user_id}`, 
              undefined, 
              '⚠️',
              warningCount > 0
            ),
            buildButton(
              isMuted ? `Already muted by ${mutedBy || 'Mod'}` : 'Mute User', 
              BUTTON_STYLES.SECONDARY, 
              isMuted ? undefined : `mod_mute:${data.comment.user_id}`, 
              undefined, 
              '🔇',
              isMuted
            ),
          ]))
          
          // Add ban button in a separate row if not already banned
          rows.push(buildActionRow([
            buildButton(
              isBanned ? `Already banned by ${bannedBy || 'Mod'}` : 'Ban User', 
              BUTTON_STYLES.DANGER, 
              isBanned ? undefined : `mod_ban:${data.comment.user_id}`, 
              undefined, 
              '🔨',
              isBanned
            ),
          ]))
        }
      }
      break
      
    case 'report_filed':
      // Report notifications: Quick action buttons
      if (data.comment?.id) {
        const userId = data.comment.user_id || data.user?.id
        const isDeleted = data.comment?.deleted === true
        const isBanned = data.comment?.user_banned === true
        const deletedBy = data.comment?.deleted_by_username || data.comment?.deleted_by || null
        const bannedBy = data.comment?.banned_by_username || data.comment?.banned_by || null
        const warnedBy = data.comment?.warned_by_username || data.comment?.warned_by || null
        const warningCount = data.comment?.user_warnings || 0
        
        rows.push(buildActionRow([
          buildButton('Approve', BUTTON_STYLES.SUCCESS, `report_approve:${data.comment.id}:${userId}`, undefined, '✅'),
          buildButton('Dismiss', BUTTON_STYLES.SECONDARY, `report_dismiss:${data.comment.id}`, undefined, '❌'),
          buildButton('View', BUTTON_STYLES.LINK, undefined, deepLinkUrl, '👁️'),
        ]))
        rows.push(buildActionRow([
          buildButton(
            isDeleted ? `Deleted by ${deletedBy || 'Mod'}` : 'Delete & Warn', 
            BUTTON_STYLES.DANGER, 
            isDeleted ? undefined : `mod_del_warn:${data.comment.id}:${userId}`, 
            undefined, 
            '⚠️',
            isDeleted
          ),
          buildButton(
            (isDeleted && isBanned) ? `Already handled` : 'Delete & Ban', 
            BUTTON_STYLES.DANGER, 
            (isDeleted || isBanned) ? undefined : `mod_del_ban:${data.comment.id}:${userId}`, 
            undefined, 
            '🔨',
            isDeleted || isBanned
          ),
        ]))
      }
      break
      
    case 'user_warned':
    case 'user_muted':
      // User moderation: Additional actions
      if (data.user?.id) {
        const isBanned = data.user?.banned === true
        const bannedBy = data.user?.banned_by_username || data.user?.banned_by || null
        
        rows.push(buildActionRow([
          buildButton(
            isBanned ? `Already banned by ${bannedBy || 'Mod'}` : 'Ban User', 
            BUTTON_STYLES.DANGER, 
            isBanned ? undefined : `mod_ban:${data.user.id}`, 
            undefined, 
            '🔨',
            isBanned
          ),
          buildButton('View History', BUTTON_STYLES.SECONDARY, `mod_history:${data.user.id}`, undefined, '📋'),
        ]))
      }
      break
      
    case 'comment_pinned':
    case 'comment_locked':
      // Pin/Lock: Unpin/Unlock buttons
      if (data.comment?.id) {
        if (data.type === 'comment_pinned') {
          rows.push(buildActionRow([
            buildButton('Unpin', BUTTON_STYLES.SECONDARY, `mod_unpin:${data.comment.id}`, undefined, '📍'),
            buildButton('View', BUTTON_STYLES.LINK, undefined, deepLinkUrl, '👁️'),
          ]))
        } else {
          rows.push(buildActionRow([
            buildButton('Unlock', BUTTON_STYLES.SUCCESS, `mod_unlock:${data.comment.id}`, undefined, '🔓'),
            buildButton('View', BUTTON_STYLES.LINK, undefined, deepLinkUrl, '👁️'),
          ]))
        }
      }
      break
      
    default:
      // No buttons for other notification types
      break
  }
  
  return rows
}
