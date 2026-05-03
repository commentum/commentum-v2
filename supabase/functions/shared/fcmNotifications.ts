import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

// ============================================
// FCM Push Notification System
// Sends push notifications to user devices via Firebase Cloud Messaging
// Works even when the app is completely closed/killed
// Uses FCM v1 API with Service Account (OAuth2)
// ============================================

// ── OAuth2 Access Token Cache ──
let cachedAccessToken: string | null = null
let tokenExpiryTime: number = 0

export type FcmNotificationType = 
  | 'comment_created'      // New comment on media user commented on
  | 'comment_reply'        // Someone replied to user's comment
  | 'comment_updated'      // User's comment was edited (their own)
  | 'comment_deleted'      // User's comment was deleted
  | 'comment_pinned'       // User's comment was pinned
  | 'comment_unpinned'     // User's comment was unpinned
  | 'comment_locked'       // Thread containing user's comment was locked
  | 'comment_unlocked'     // Thread was unlocked
  | 'vote_cast'            // Someone voted on user's comment
  | 'vote_removed'         // Someone removed vote on user's comment
  | 'report_filed'         // Someone reported user's comment
  | 'report_resolved'      // Report on user's comment was resolved
  | 'report_dismissed'     // Report on user's comment was dismissed
  | 'user_warned'          // User received a warning
  | 'user_muted'           // User was muted
  | 'user_unmuted'         // User was unmuted
  | 'user_banned'          // User was banned
  | 'user_unbanned'        // User was unbanned
  | 'user_shadow_banned'   // User was shadow banned
  | 'announcement_published' // New announcement
  | 'moderation_action'    // Generic moderation action

export interface FcmNotificationPayload {
  type: FcmNotificationType
  // The target user who should receive this notification
  targetUserId: string
  targetClientType: string
  // Comment info
  comment?: {
    id: number | string
    user_id?: string
    username?: string
    content?: string
    client_type?: string
    media_id?: string
    media_type?: string
    media_title?: string
    parent_id?: number | null
  }
  // The actor (who did the action)
  actor?: {
    id: string
    username?: string
    avatar?: string
  }
  // Media info
  media?: {
    id?: string
    type?: string
    title?: string
    year?: number
    poster?: string
    client_type?: string
  }
  // Moderator who performed the action
  moderator?: {
    id?: string
    username?: string
  }
  // Extra context
  reason?: string
  voteType?: 'upvote' | 'downvote'
  voteScore?: number
  reportReason?: string
  metadata?: any
  announcementTitle?: string
  announcementContent?: string
  duration?: string
}

// ============================================
// NOTIFICATION TITLE & BODY GENERATORS
// ============================================

function getNotificationContent(payload: FcmNotificationPayload): { title: string; body: string } {
  const actorName = payload.actor?.username || 'Someone'
  const mediaTitle = payload.comment?.media_title || payload.media?.title || 'Unknown'
  const commentPreview = payload.comment?.content 
    ? (payload.comment.content.length > 80 
        ? payload.comment.content.substring(0, 80) + '...' 
        : payload.comment.content)
    : ''
  const modName = payload.moderator?.username || 'A moderator'
  const voteEmoji = payload.voteType === 'upvote' ? '▲' : '▼'
  const duration = payload.duration || 'Not specified'

  switch (payload.type) {

    // ── COMMENT EVENTS ──
    case 'comment_created':
      return {
        title: '💬 New Comment',
        body: `${actorName} commented on ${mediaTitle}${commentPreview ? ': "${commentPreview}"' : ''}`
      }

    case 'comment_reply':
      return {
        title: '↩️ New Reply',
        body: `${actorName} replied to your comment on ${mediaTitle}${commentPreview ? ': "${commentPreview}"' : ''}`
      }

    case 'comment_updated':
      return {
        title: '✏️ Comment Edited',
        body: `Your comment on ${mediaTitle} was edited${commentPreview ? ': "${commentPreview}"' : ''}`
      }

    case 'comment_deleted':
      return {
        title: '🗑️ Comment Deleted',
        body: `Your comment on ${mediaTitle} was deleted by ${modName}.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    case 'comment_pinned':
      return {
        title: '📌 Comment Pinned',
        body: `${modName} pinned your comment on ${mediaTitle}!${commentPreview ? ` "${commentPreview}"` : ''}`
      }

    case 'comment_unpinned':
      return {
        title: '📍 Comment Unpinned',
        body: `${modName} unpinned your comment on ${mediaTitle}.`
      }

    case 'comment_locked':
      return {
        title: '🔒 Thread Locked',
        body: `${modName} locked the comment thread on ${mediaTitle}.`
      }

    case 'comment_unlocked':
      return {
        title: '🔓 Thread Unlocked',
        body: `${modName} unlocked the comment thread on ${mediaTitle}.`
      }

    // ── VOTE EVENTS ──
    case 'vote_cast':
      return {
        title: `${voteEmoji} New Vote`,
        body: `${actorName} ${payload.voteType || 'voted on'} your comment on ${mediaTitle} (Score: ${payload.voteScore ?? 0})`
      }

    case 'vote_removed':
      return {
        title: '➖ Vote Removed',
        body: `${actorName} removed their vote on your comment on ${mediaTitle} (Score: ${payload.voteScore ?? 0})`
      }

    // ── REPORT EVENTS ──
    case 'report_filed':
      return {
        title: '🚨 Comment Reported',
        body: `Your comment on ${mediaTitle} was reported.${payload.reportReason ? ` Reason: ${payload.reportReason}` : ''}`
      }

    case 'report_resolved':
      return {
        title: '✅ Report Resolved',
        body: `The report on your comment on ${mediaTitle} was resolved.`
      }

    case 'report_dismissed':
      return {
        title: '❌ Report Dismissed',
        body: `The report on your comment on ${mediaTitle} was dismissed.`
      }

    // ── USER MODERATION EVENTS ──
    case 'user_warned':
      return {
        title: '⚠️ Warning Received',
        body: `${modName} issued you a warning.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    case 'user_muted':
      return {
        title: '🔇 You Have Been Muted',
        body: `${modName} muted you for ${duration}.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    case 'user_unmuted':
      return {
        title: '🔊 Unmuted',
        body: `${modName} has unmuted you. You can now post comments again.`
      }

    case 'user_banned':
      return {
        title: '⛔ Banned',
        body: `${modName} banned you for ${duration}.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    case 'user_unbanned':
      return {
        title: '♻️ Unbanned',
        body: `${modName} has unbanned you. Welcome back!`
      }

    case 'user_shadow_banned':
      return {
        title: '👻 Restricted',
        body: `Your account has been restricted by ${modName}.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    // ── ANNOUNCEMENT ──
    case 'announcement_published':
      return {
        title: `📢 ${payload.announcementTitle || 'New Announcement'}`,
        body: payload.announcementContent 
          ? (payload.announcementContent.length > 120 
              ? payload.announcementContent.substring(0, 120) + '...' 
              : payload.announcementContent)
          : 'Tap to read more.'
      }

    // ── GENERIC MODERATION ──
    case 'moderation_action':
      return {
        title: '⚙️ Moderation Action',
        body: `${modName} performed an action on your account.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    default:
      return {
        title: '🔔 Notification',
        body: 'Something happened. Tap to view details.'
      }
  }
}

// ============================================
// NOTIFICATION PREFERENCES MAP
// Maps notification types to the preference key that controls them
// ============================================

const NOTIFICATION_PREF_MAP: Record<FcmNotificationType, string> = {
  'comment_created': 'notify_on_reply',    // New comments on media you interacted with
  'comment_reply': 'notify_on_reply',
  'comment_updated': 'notify_on_mod_action',
  'comment_deleted': 'notify_on_comment_delete',
  'comment_pinned': 'notify_on_mod_action',
  'comment_unpinned': 'notify_on_mod_action',
  'comment_locked': 'notify_on_mod_action',
  'comment_unlocked': 'notify_on_mod_action',
  'vote_cast': 'notify_on_vote',
  'vote_removed': 'notify_on_vote',
  'report_filed': 'notify_on_mod_action',
  'report_resolved': 'notify_on_mod_action',
  'report_dismissed': 'notify_on_mod_action',
  'user_warned': 'notify_on_mod_action',
  'user_muted': 'notify_on_mod_action',
  'user_unmuted': 'notify_on_mod_action',
  'user_banned': 'notify_on_mod_action',
  'user_unbanned': 'notify_on_mod_action',
  'user_shadow_banned': 'notify_on_mod_action',
  'announcement_published': 'notify_on_mod_action',
  'moderation_action': 'notify_on_mod_action',
}

// Notification types that should ALWAYS be sent (user can't disable)
const FORCE_SEND_TYPES: FcmNotificationType[] = [
  'user_warned',
  'user_muted',
  'user_banned',
  'user_shadow_banned',
]

// ============================================
// BACKGROUND QUEUE SYSTEM (same pattern as Discord notifications)
// ============================================

let fcmQueue: FcmNotificationPayload[] = []
let isProcessingFcmQueue = false

// Queue an FCM notification - NON-BLOCKING
export function queueFcmNotification(payload: FcmNotificationPayload) {
  fcmQueue.push(payload)
  if (!isProcessingFcmQueue) {
    processFcmQueue()
  }
}

// Process queue in background
async function processFcmQueue() {
  if (isProcessingFcmQueue || fcmQueue.length === 0) return

  isProcessingFcmQueue = true
  try {
    while (fcmQueue.length > 0) {
      const payload = fcmQueue.shift()
      if (payload) {
        sendFcmNotification(payload).catch(err => {
          console.error('FCM notification failed in background:', err)
        })
      }
    }
  } finally {
    isProcessingFcmQueue = false
  }
}

// ============================================
// OAUTH2: Get Access Token from Service Account
// ============================================

export async function getFcmAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedAccessToken && Date.now() < tokenExpiryTime - 300000) {
    return cachedAccessToken
  }

  const clientEmail = Deno.env.get('FCM_CLIENT_EMAIL')!
  const privateKey = Deno.env.get('FCM_PRIVATE_KEY')!
  const projectId = Deno.env.get('FCM_PROJECT_ID')!

  if (!clientEmail || !privateKey || !projectId) {
    throw new Error('Missing FCM_SERVICE_ACCOUNT env vars (FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY, FCM_PROJECT_ID)')
  }

  // Build JWT header + payload
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600, // 1 hour
  }

  // Base64url encode
  const encode = (obj: any) => btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const unsignedJwt = `${encode(header)}.${encode(payload)}`

  // Sign JWT with private key using Web Crypto API
  // Parse PEM: strip headers, base64-decode to get raw DER bytes
  const privateKeyClean = privateKey.replace(/\\n/g, '\n')
  const pemContents = privateKeyClean
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .trim()
  const binaryKey = atob(pemContents)
  const keyData = new Uint8Array(binaryKey.length)
  for (let i = 0; i < binaryKey.length; i++) {
    keyData[i] = binaryKey.charCodeAt(i)
  }
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedJwt)
  )

  // Convert ArrayBuffer to base64url
  const sigArray = new Uint8Array(signature)
  let sigBase64 = ''
  for (let i = 0; i < sigArray.length; i++) {
    sigBase64 += String.fromCharCode(sigArray[i])
  }
  sigBase64 = btoa(sigBase64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const jwt = `${unsignedJwt}.${sigBase64}`

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text()
    throw new Error(`Failed to get FCM access token: ${err}`)
  }

  const tokenData = await tokenResponse.json()
  cachedAccessToken = tokenData.access_token
  tokenExpiryTime = Date.now() + (tokenData.expires_in * 1000)

  return cachedAccessToken!
}

// ============================================
// CORE: SEND FCM NOTIFICATION
// ============================================

async function sendFcmNotification(payload: FcmNotificationPayload): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Check if FCM notifications are globally enabled
    const { data: fcmEnabled } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'fcm_notifications_enabled')
      .single()

    if (!fcmEnabled || JSON.parse(fcmEnabled.value) !== true) {
      return
    }

    // 2. Check if this notification type is enabled
    const { data: typesConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'fcm_notification_types')
      .single()

    const enabledTypes: string[] = typesConfig ? JSON.parse(typesConfig.value) : []
    if (!enabledTypes.includes(payload.type)) {
      return
    }

    // 3. Check user preferences (skip for forced types like bans/warnings)
    if (!FORCE_SEND_TYPES.includes(payload.type)) {
      const prefKey = NOTIFICATION_PREF_MAP[payload.type]
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select(prefKey)
        .eq('client_type', payload.targetClientType)
        .eq('user_id', payload.targetUserId)
        .single()

      // If user has explicitly disabled this type, skip
      if (prefs && prefs[prefKey] === false) {
        return
      }
    }

    // 4. Get all active FCM tokens for this user
    const { data: tokens } = await supabase
      .from('fcm_tokens')
      .select('fcm_token')
      .eq('client_type', payload.targetClientType)
      .eq('user_id', payload.targetUserId)
      .eq('is_active', true)

    if (!tokens || tokens.length === 0) {
      return // User has no registered devices
    }

    // 5. Build notification message
    const { title, body } = getNotificationContent(payload)

    // Build click action (deep link into the app)
    const clickAction = buildClickAction(payload)

    // Build the FCM message
    const message: any = {
      notification: {
        title,
        body,
        sound: 'default',
        badge: '1',
      },
      data: {
        type: payload.type,
        comment_id: payload.comment?.id?.toString() || '',
        media_id: payload.comment?.media_id || payload.media?.id || '',
        media_type: payload.comment?.media_type || payload.media?.type || '',
        media_title: payload.comment?.media_title || payload.media?.title || '',
        client_type: payload.targetClientType,
        click_action: clickAction,
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          default_sound: true,
          default_vibrate_timings: true,
          channel_id: getAndroidChannelId(payload.type),
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          }
        }
      },
      tokens: tokens.map(t => t.fcm_token),
    }

    // 6. Send via FCM v1 API
    let accessToken: string
    try {
      accessToken = await getFcmAccessToken()
    } catch (err) {
      console.error('Failed to get FCM access token:', err)
      return
    }

    const fcmResponse = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    })

    if (!fcmResponse.ok) {
      const errText = await fcmResponse.text()
      console.error(`FCM API error (${fcmResponse.status}):`, errText)
      return
    }

    const result = await fcmResponse.json()
    
    // 7. Clean up invalid tokens
    if (result.results) {
      const invalidTokens: string[] = []
      for (let i = 0; i < result.results.length; i++) {
        if (result.results[i].error === 'NotRegistered' || 
            result.results[i].error === 'InvalidRegistration') {
          invalidTokens.push(tokens[i].fcm_token)
        }
      }
      
      if (invalidTokens.length > 0) {
        await supabase
          .from('fcm_tokens')
          .update({ is_active: false })
          .in('fcm_token', invalidTokens)
      }
    }

    // 8. Update last_used_at for active tokens
    await supabase
      .from('fcm_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('client_type', payload.targetClientType)
      .eq('user_id', payload.targetUserId)
      .eq('is_active', true)

    // 9. Store notification in history table
    const fcmSent = true
    const fcmDelivered = result.success >= 1
    const fcmError = (!result.success || result.failure > 0) ? `success: ${result.success}, failure: ${result.failure}` : null

    storeNotificationToDb(supabase, payload, title, body, clickAction, fcmSent, fcmDelivered, fcmError).catch(err => {
      console.error('Failed to store notification history:', err)
    })

  } catch (error) {
    console.error('Error sending FCM notification:', error)
  }
}

// ============================================
// STORE NOTIFICATION TO DATABASE
// ============================================

async function storeNotificationToDb(
  supabase: any,
  payload: FcmNotificationPayload,
  title: string,
  body: string,
  clickAction: string,
  fcmSent: boolean,
  fcmDelivered: boolean,
  fcmError: string | null
): Promise<void> {
  try {
    const row = {
      client_type: payload.targetClientType,
      user_id: payload.targetUserId,
      type: payload.type,
      title,
      body,
      comment_id: payload.comment?.id?.toString() || null,
      media_id: payload.comment?.media_id || payload.media?.id || null,
      media_type: payload.comment?.media_type || payload.media?.type || null,
      media_title: payload.comment?.media_title || payload.media?.title || null,
      actor_id: payload.actor?.id || null,
      actor_username: payload.actor?.username || null,
      moderator_id: payload.moderator?.id || null,
      moderator_username: payload.moderator?.username || null,
      reason: payload.reason || payload.reportReason || null,
      metadata: payload.metadata || {},
      click_action: clickAction,
      is_read: false,
      fcm_sent: fcmSent,
      fcm_delivered: fcmDelivered,
      fcm_error: fcmError,
    }

    const { error } = await supabase
      .from('notifications')
      .insert(row)

    if (error) {
      console.error('Failed to insert notification history:', error)
    }
  } catch (err) {
    console.error('storeNotificationToDb error:', err)
  }
}

// ============================================
// HELPERS
// ============================================

// Build click action / deep link for the notification
function buildClickAction(payload: FcmNotificationPayload): string {
  const clientType = payload.comment?.client_type || payload.media?.client_type || payload.targetClientType || 'anilist'
  const mediaType = payload.comment?.media_type || payload.media?.type || 'anime'
  const mediaId = payload.comment?.media_id || payload.media?.id || ''

  if (mediaId) {
    // Deep link: anymex://{clientType}/{mediaType}/{mediaId}#comment-{commentId}
    const commentSuffix = payload.comment?.id ? `#comment-${payload.comment.id}` : ''
    return `anymex://${clientType}/${mediaType}/${mediaId}${commentSuffix}`
  }
  return 'anymex://notifications'
}

// Android notification channel ID based on type
function getAndroidChannelId(type: FcmNotificationType): string {
  if (['vote_cast', 'vote_removed'].includes(type)) return 'votes'
  if (['user_warned', 'user_muted', 'user_banned', 'user_shadow_banned', 'moderation_action'].includes(type)) return 'moderation'
  if (['report_filed', 'report_resolved', 'report_dismissed'].includes(type)) return 'reports'
  if (type === 'announcement_published') return 'announcements'
  return 'comments' // default channel for comment events
}

// ============================================
// HELPER: Get the user ID to notify based on event type
// ============================================

export function getNotificationTargetUserId(
  type: string, 
  commentUserId: string | undefined, 
  parentCommentUserId?: string | undefined,
  targetUserIdOverride?: string
): string | null {
  if (targetUserIdOverride) return targetUserIdOverride

  // For moderation/user actions, the target is always the user being acted upon
  const userActionTypes = ['user_warned', 'user_muted', 'user_unmuted', 'user_banned', 'user_unbanned', 'user_shadow_banned', 'moderation_action']
  if (userActionTypes.includes(type) && commentUserId) {
    return commentUserId
  }

  // For votes and reports, notify the comment author
  if (['vote_cast', 'vote_removed', 'report_filed'].includes(type) && commentUserId) {
    return commentUserId
  }

  // For comment deletions, notify the comment author
  if (['comment_deleted'].includes(type) && commentUserId) {
    return commentUserId
  }

  // For pin/unpin/lock/unlock, notify the comment author
  if (['comment_pinned', 'comment_unpinned', 'comment_locked', 'comment_unlocked'].includes(type) && commentUserId) {
    return commentUserId
  }

  // For report resolved/dismissed, notify the comment author
  if (['report_resolved', 'report_dismissed'].includes(type) && commentUserId) {
    return commentUserId
  }

  // For replies, notify the parent comment author
  if (type === 'comment_reply' && parentCommentUserId) {
    return parentCommentUserId
  }

  return null
}
