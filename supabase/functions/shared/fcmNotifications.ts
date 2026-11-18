import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { getPlainTextPreview } from './mentionUtils.ts'

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
  | 'user_mentioned'       // Someone @mentioned user in a comment
  | 'comment_locked'       // Thread containing user's comment was locked
  | 'comment_unlocked'     // Thread was unlocked
  | 'vote_cast'            // Someone voted on user's comment
  | 'vote_removed'         // Someone removed vote on user's comment
  | 'report_filed'         // Someone reported user's comment
  | 'report_resolved'      // Report on user's comment was resolved
  | 'report_dismissed'     // Report on user's comment was dismissed
  | 'user_warned'          // User received a warning
  | 'user_unwarned'        // User had a warning removed
  | 'user_muted'           // User was muted
  | 'user_unmuted'         // User was unmuted
  | 'user_banned'          // User was banned
  | 'user_unbanned'        // User was unbanned
  | 'user_shadow_banned'   // User was shadow banned
  | 'user_unshadow_banned' // User's shadow ban was removed
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
  announcementId?: string
  duration?: string
}

// ============================================
// NOTIFICATION TITLE & BODY GENERATORS
// ============================================

function getNotificationContent(payload: FcmNotificationPayload): { title: string; body: string } {
  const actorName = payload.actor?.username || 'Someone'
  const mediaTitle = payload.comment?.media_title || payload.media?.title || 'Unknown'
  const commentPreview = payload.comment?.content 
    ? getPlainTextPreview(payload.comment.content, 80)
    : ''
  const modName = payload.moderator?.username || 'A moderator'
  const voteEmoji = payload.voteType === 'upvote' ? '▲' : '▼'
  const duration = payload.duration || 'Not specified'

  switch (payload.type) {

    // ── COMMENT EVENTS ──
    case 'comment_created':
      return {
        title: '💬 New Comment',
        body: `${actorName} commented on ${mediaTitle}${commentPreview ? `: "${commentPreview}"` : ''}`
      }

    case 'comment_reply':
      return {
        title: 'New Reply',
        body: `${actorName} replied to your comment on ${mediaTitle}${commentPreview ? ': "' + commentPreview + '"' : ''}`
      }

    case 'user_mentioned':
      return {
        title: 'You Were Mentioned',
        body: `${actorName} mentioned you on ${mediaTitle}${commentPreview ? ': "' + commentPreview + '"' : ''}`
      }

    case 'comment_updated':
      return {
        title: 'Comment Edited',
        body: `Your comment on ${mediaTitle} was edited${commentPreview ? `: "${commentPreview}"` : ''}`
      }

    case 'comment_deleted':
      return {
        title: 'Comment Deleted',
        body: `Your comment on ${mediaTitle} was deleted by ${modName}.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    case 'comment_pinned':
      return {
        title: 'Comment Pinned',
        body: `${modName} pinned your comment on ${mediaTitle}!${commentPreview ? ` "${commentPreview}"` : ''}`
      }

    case 'comment_unpinned':
      return {
        title: 'Comment Unpinned',
        body: `${modName} unpinned your comment on ${mediaTitle}.`
      }

    case 'comment_locked':
      return {
        title: 'Thread Locked',
        body: `${modName} locked the comment thread on ${mediaTitle}.`
      }

    case 'comment_unlocked':
      return {
        title: 'Thread Unlocked',
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
        title: 'Vote Removed',
        body: `${actorName} removed their vote on your comment on ${mediaTitle} (Score: ${payload.voteScore ?? 0})`
      }

    // ── REPORT EVENTS ──
    case 'report_filed':
      return {
        title: 'Comment Reported',
        body: `Your comment on ${mediaTitle} was reported.${payload.reportReason ? ` Reason: ${payload.reportReason}` : ''}`
      }

    case 'report_resolved':
      return {
        title: 'Report Resolved',
        body: `The report on your comment on ${mediaTitle} was resolved.`
      }

    case 'report_dismissed':
      return {
        title: 'Report Dismissed',
        body: `The report on your comment on ${mediaTitle} was dismissed.`
      }

    // ── USER MODERATION EVENTS ──
    case 'user_warned':
      return {
        title: 'Warning Received',
        body: `${modName} issued you a warning.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    case 'user_muted':
      return {
        title: 'You Have Been Muted',
        body: `${modName} muted you for ${duration}.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    case 'user_unmuted':
      return {
        title: 'Unmuted',
        body: `${modName} has unmuted you. You can now post comments again.`
      }

    case 'user_banned':
      return {
        title: 'Banned',
        body: `${modName} banned you for ${duration}.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    case 'user_unbanned':
      return {
        title: 'Unbanned',
        body: `${modName} has unbanned you. Welcome back!`
      }

    case 'user_unwarned':
      return {
        title: 'Warning Removed',
        body: `${modName} has removed a warning from your account.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    case 'user_unshadow_banned':
      return {
        title: 'Restriction Lifted',
        body: `Your account restriction has been lifted by ${modName}. You can now interact normally.`
      }

    case 'user_shadow_banned':
      return {
        title: 'Restricted',
        body: `Your account has been restricted by ${modName}.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    // ── ANNOUNCEMENT ──
    case 'announcement_published':
      return {
        title: `${payload.announcementTitle || 'New Announcement'}`,
        body: payload.announcementContent 
          ? (payload.announcementContent.length > 120 
              ? payload.announcementContent.substring(0, 120) + '...' 
              : payload.announcementContent)
          : 'Tap to read more.'
      }

    // ── GENERIC MODERATION ──
    case 'moderation_action':
      return {
        title: 'Moderation Action',
        body: `${modName} performed an action on your account.${payload.reason ? ` Reason: ${payload.reason}` : ''}`
      }

    default:
      return {
        title: 'Notification',
        body: 'Something happened. Tap to view details.'
      }
  }
}

// ============================================
// NOTIFICATION PREFERENCES MAP
// Maps notification types to the preference key that controls them
// ============================================

const NOTIFICATION_PREF_MAP: Record<FcmNotificationType, string> = {
  'comment_created': 'notify_on_recent_comment',  // New comments on media you interacted with
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
  'user_mentioned': 'notify_on_mention',
  'user_warned': 'notify_on_mod_action',
  'user_unwarned': 'notify_on_mod_action',
  'user_muted': 'notify_on_mod_action',
  'user_unmuted': 'notify_on_mod_action',
  'user_banned': 'notify_on_mod_action',
  'user_unbanned': 'notify_on_mod_action',
  'user_shadow_banned': 'notify_on_mod_action',
  'user_unshadow_banned': 'notify_on_mod_action',
  'announcement_published': 'notify_on_announcement',
  'moderation_action': 'notify_on_mod_action',
}

// Notification types that should ALWAYS be sent (user can't disable)
const FORCE_SEND_TYPES: FcmNotificationType[] = [
  'user_warned',
  'user_unwarned',
  'user_muted',
  'user_unmuted',
  'user_banned',
  'user_unbanned',
  'user_shadow_banned',
  'user_unshadow_banned',
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
    // client_type-agnostic: a user may hold anilist/mal/simkl identities, so
    // match preferences by user_id only; if ANY row explicitly disables this
    // type, skip the send.
    if (!FORCE_SEND_TYPES.includes(payload.type)) {
      const prefKey = NOTIFICATION_PREF_MAP[payload.type]
      const { data: prefsRows } = await supabase
        .from('notification_preferences')
        .select(prefKey)
        .eq('user_id', payload.targetUserId)

      if (prefsRows && prefsRows.some((row: any) => row[prefKey] === false)) {
        return
      }
    }

    // 4. Get all active FCM tokens for this user
    // client_type-agnostic: tokens can be registered under any client
    // (anilist/mal/simkl/...), so deliver to every ACTIVE token of the user
    const { data: tokens } = await supabase
      .from('fcm_tokens')
      .select('fcm_token')
      .eq('user_id', payload.targetUserId)
      .eq('is_active', true)

    if (!tokens || tokens.length === 0) {
      return // User has no registered devices
    }

    // 5. Build notification message
    const { title, body } = getNotificationContent(payload)

    // Resolve effective actor: use actor if available, fall back to moderator
    const effectiveActor = payload.actor || (payload.moderator ? {
      id: payload.moderator.id || '',
      username: payload.moderator.username || '',
      avatar: (payload.moderator as any).avatar || '',
    } : null)
    const actorAvatar = effectiveActor?.avatar || undefined
    const actorUsername = effectiveActor?.username || ''

    // Build click action (deep link into the app)
    const clickAction = buildClickAction(payload)

    // Determine the correct service type (from the comment/media, NOT the target user)
    const serviceClientType = payload.comment?.client_type || payload.media?.client_type || payload.targetClientType || 'anilist'

    // Announcement pushes carry the id so the client can fetch the full
    // announcement (GET /announcements/{id}) and render it in a bottom sheet.
    const announcementId = payload.announcementId
      || (typeof payload.metadata?.announcement_id === 'string' ? payload.metadata.announcement_id : '')
      || ''

    // Build DATA-ONLY FCM message (like WhatsApp/Discord)
    // No 'notification' field — the app handles everything including largeIcon avatar
    // title and body are passed via data so the app can show them in a custom notification
    const messageData = {
      type: payload.type,
      title,
      body,
      announcement_id: announcementId,
      comment_id: payload.comment?.id?.toString() || '',
      media_id: payload.comment?.media_id || payload.media?.id || '',
      media_type: payload.comment?.media_type || payload.media?.type || '',
      media_title: payload.comment?.media_title || payload.media?.title || '',
      client_type: serviceClientType,
      actor_id: effectiveActor?.id || '',
      actor_username: actorUsername,
      actor_avatar: actorAvatar || '',
      click_action: clickAction,
      timestamp: new Date().toISOString(),
      channel_id: getAndroidChannelId(payload.type),
    }

    // 6. Send via FCM v1 API
    let accessToken: string
    try {
      accessToken = await getFcmAccessToken()
    } catch (err) {
      console.error('Failed to get FCM access token:', err)
      return
    }

    // 6. Send via FCM v1 API (multicast: one request per token)
    const projectId = Deno.env.get('FCM_PROJECT_ID')!
    let totalSuccess = 0
    let totalFailure = 0
    const invalidTokens: string[] = []

    const sentTokensInThisRun = new Set<string>()
    for (const tokenRecord of tokens) {
      if (sentTokensInThisRun.has(tokenRecord.fcm_token)) {
        continue
      }
      sentTokensInThisRun.add(tokenRecord.fcm_token)
      const fcmMessage: any = {
        message: {
          token: tokenRecord.fcm_token,
          notification: {
            title,
            body,
          },
          data: messageData,
          android: {
            priority: 'HIGH' as const,
            notification: {
              channel_id: getAndroidChannelId(payload.type),
              sound: 'default',
              default_vibrate_timings: true,
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
        }
      }

      const fcmResponse = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fcmMessage),
        }
      )

      if (!fcmResponse.ok) {
        const errData = await fcmResponse.json().catch(() => ({}))
        const errMsg = errData?.error?.message || await fcmResponse.text()
        console.error(`FCM v1 error for token ${tokenRecord.fcm_token.substring(0, 20)}...: (${fcmResponse.status}) ${errMsg}`)
        totalFailure++

        // Mark token as invalid if unregistered
        if (fcmResponse.status === 404 || errMsg.includes('NotRegistered') || errMsg.includes('registration-token-not-registered')) {
          invalidTokens.push(tokenRecord.fcm_token)
        }
      } else {
        totalSuccess++
      }
    }

    // 7. Clean up invalid tokens
    if (invalidTokens.length > 0) {
      await supabase
        .from('fcm_tokens')
        .update({ is_active: false })
        .in('fcm_token', invalidTokens)
    }

    // 8. Update last_used_at for active tokens (client_type-agnostic)
    await supabase
      .from('fcm_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', payload.targetUserId)
      .eq('is_active', true)

    // 9. Store notification in history table
    const fcmSent = true
    const fcmDelivered = totalSuccess >= 1
    const fcmError = totalFailure > 0 ? `success: ${totalSuccess}, failure: ${totalFailure}` : null

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
      actor_id: payload.actor?.id || payload.moderator?.id || null,
      actor_username: payload.actor?.username || payload.moderator?.username || null,
      actor_avatar: payload.actor?.avatar || (payload.moderator as any)?.avatar || null,
      moderator_id: payload.moderator?.id || null,
      moderator_username: payload.moderator?.username || null,
      reason: payload.reason || payload.reportReason || null,
      metadata: {
        ...(payload.metadata || {}),
        raw_comment_content: payload.comment?.content || null,
      },
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
  if (['user_warned', 'user_unwarned', 'user_muted', 'user_unmuted', 'user_banned', 'user_unbanned', 'user_shadow_banned', 'user_unshadow_banned', 'moderation_action'].includes(type)) return 'moderation'
  if (['report_filed', 'report_resolved', 'report_dismissed'].includes(type)) return 'reports'
  if (type === 'announcement_published') return 'announcements'
  if (type === 'user_mentioned') return 'mentions'
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
  const userActionTypes = ['user_warned', 'user_unwarned', 'user_muted', 'user_unmuted', 'user_banned', 'user_unbanned', 'user_shadow_banned', 'user_unshadow_banned', 'moderation_action']
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

// ============================================
// ANNOUNCEMENT BROADCAST
// Built for thousands of devices: ONE access token, ONE DB client, bounded
// concurrency, bulk history inserts. The per-user queue above starts a send
// for every user at once (thousands of DB clients in one 512MB worker), which
// kills the worker before any history row is written ("Pushed 0").
// Any fatal problem is written to the notifications table so the dashboard
// shows the reason instead of a silent zero.
// ============================================

const FCM_CONCURRENCY = 25
const DB_INSERT_CHUNK = 500
const URL_FILTER_CHUNK = 20 // fcm tokens are long; keep PostgREST URLs short

export interface AnnouncementBroadcastInput {
  announcement: {
    id: number | string
    app_id: string
    title: string
    short_description?: string | null
    full_content?: string | null
    category?: string
    pinned?: boolean
    author_id?: string
  }
  tokens: { user_id: string; fcm_token: string }[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      await worker(items[i])
    }
  })
  await Promise.all(runners)
}

export async function broadcastAnnouncementFcm(
  input: AnnouncementBroadcastInput
): Promise<{ users: number; sent: number; failed: number }> {
  const { announcement, tokens } = input
  const announcementId = String(announcement.id)
  const result = { users: 0, sent: 0, failed: 0 }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const payload: FcmNotificationPayload = {
    type: 'announcement_published',
    targetUserId: '',
    targetClientType: announcement.app_id,
    announcementTitle: announcement.title,
    announcementContent: announcement.short_description || announcement.full_content || '',
    announcementId,
  }
  const { title, body } = getNotificationContent(payload)
  const clickAction = 'anymex://notifications'

  const baseRow = (userId: string, fcmSent: boolean, fcmDelivered: boolean, fcmError: string | null, isRead = false) => ({
    client_type: announcement.app_id,
    user_id: userId,
    type: 'announcement_published',
    title,
    body,
    comment_id: null,
    media_id: null,
    media_type: null,
    media_title: null,
    actor_id: null,
    actor_username: null,
    actor_avatar: null,
    moderator_id: null,
    moderator_username: null,
    reason: null,
    metadata: {
      announcement_id: announcementId,
      category: announcement.category ?? null,
      pinned: String(announcement.pinned ?? false),
      raw_comment_content: null,
    },
    click_action: clickAction,
    is_read: isRead,
    fcm_sent: fcmSent,
    fcm_delivered: fcmDelivered,
    fcm_error: fcmError,
  })

  // Record a fatal problem as one history row so the dashboard shows WHY.
  const recordFatal = async (reason: string) => {
    console.error(`[FCM] announcement ${announcementId} broadcast aborted: ${reason}`)
    if (!announcement.author_id) return
    const { error } = await supabase
      .from('notifications')
      .insert(baseRow(String(announcement.author_id), false, false, reason.slice(0, 500), true))
    if (error) console.error('[FCM] failed to record failure row:', error)
  }

  try {
    // 1. Global switches (same rules as the per-user path)
    const { data: enabledRow } = await supabase.from('config').select('value').eq('key', 'fcm_notifications_enabled').single()
    if (!enabledRow || JSON.parse(enabledRow.value) !== true) {
      await recordFatal('FCM disabled: config.fcm_notifications_enabled is not true')
      return result
    }
    const { data: typesRow } = await supabase.from('config').select('value').eq('key', 'fcm_notification_types').single()
    const enabledTypes: string[] = typesRow ? JSON.parse(typesRow.value) : []
    if (!enabledTypes.includes('announcement_published')) {
      await recordFatal('announcement_published is missing from config.fcm_notification_types')
      return result
    }

    // 2. Users who opted out of announcements
    const optedOut = new Set<string>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('user_id')
        .eq('notify_on_announcement', false)
        .range(from, from + 999)
      if (error) { console.error('[FCM] prefs lookup failed:', error); break }
      for (const r of data || []) optedOut.add(String(r.user_id))
      if (!data || data.length < 1000) break
    }
    const eligible = tokens.filter((t) => t.fcm_token && !optedOut.has(String(t.user_id)))
    if (eligible.length === 0) {
      await recordFatal(`No eligible devices (${tokens.length} tokens, ${optedOut.size} opted-out users)`)
      return result
    }

    // 3. One OAuth token for the whole broadcast
    let accessToken: string
    try {
      accessToken = await getFcmAccessToken()
    } catch (err: any) {
      await recordFatal(`Could not get FCM access token: ${err?.message || err}`)
      return result
    }

    const projectId = Deno.env.get('FCM_PROJECT_ID')!
    const sendUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`
    const data = {
      type: 'announcement_published',
      title,
      body,
      announcement_id: announcementId,
      comment_id: '',
      media_id: '',
      media_type: '',
      media_title: '',
      client_type: announcement.app_id,
      actor_id: '',
      actor_username: '',
      actor_avatar: '',
      click_action: clickAction,
      timestamp: new Date().toISOString(),
      channel_id: 'announcements',
    }
    const buildMessage = (token: string) => ({
      message: {
        token,
        notification: { title, body },
        data,
        android: {
          priority: 'HIGH' as const,
          notification: { channel_id: 'announcements', sound: 'default', default_vibrate_timings: true },
        },
        apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      },
    })

    const sendOne = async (token: string): Promise<{ ok: boolean; invalid?: boolean; error?: string }> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const resp = await fetch(sendUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildMessage(token)),
          })
          if (resp.ok) {
            await resp.body?.cancel()
            return { ok: true }
          }
          const errData = await resp.json().catch(() => ({}))
          const errMsg: string = errData?.error?.message || `HTTP ${resp.status}`
          const errStatus: string = errData?.error?.status || ''
          if (resp.status === 401 && attempt === 0) {
            cachedAccessToken = null
            accessToken = await getFcmAccessToken()
            continue
          }
          if (resp.status === 404 || errStatus === 'NOT_FOUND' || errStatus === 'UNREGISTERED' || /NotRegistered|not-registered|UNREGISTERED/.test(errMsg)) {
            return { ok: false, invalid: true, error: `(${resp.status}) ${errMsg}` }
          }
          if ((resp.status === 429 || resp.status >= 500) && attempt === 0) {
            await sleep(500)
            continue
          }
          return { ok: false, error: `(${resp.status}) ${errMsg}` }
        } catch (e: any) {
          if (attempt === 0) { await sleep(300); continue }
          return { ok: false, error: String(e?.message || e) }
        }
      }
      return { ok: false, error: 'unknown error' }
    }

    // 4. Send with bounded concurrency
    const perUser = new Map<string, { ok: number; fail: number; err: string | null }>()
    const invalidTokens: string[] = []
    await runPool(eligible, FCM_CONCURRENCY, async (t) => {
      const uid = String(t.user_id)
      let entry = perUser.get(uid)
      if (!entry) { entry = { ok: 0, fail: 0, err: null }; perUser.set(uid, entry) }
      const res = await sendOne(t.fcm_token)
      if (res.ok) { entry.ok++; result.sent++ }
      else {
        entry.fail++; result.failed++; entry.err = res.error || 'send failed'
        if (res.invalid) invalidTokens.push(t.fcm_token)
      }
    })
    result.users = perUser.size

    // 5. Deactivate dead tokens (short URL chunks)
    for (let i = 0; i < invalidTokens.length; i += URL_FILTER_CHUNK) {
      const { error } = await supabase
        .from('fcm_tokens')
        .update({ is_active: false })
        .in('fcm_token', invalidTokens.slice(i, i + URL_FILTER_CHUNK))
      if (error) console.error('[FCM] token deactivation failed:', error)
    }

    // 6. Bulk-write history (one row per user) so the dashboard counts are real
    const rows = Array.from(perUser.entries()).map(([uid, e]) =>
      baseRow(
        uid,
        true,
        e.ok > 0,
        e.fail > 0 ? `success: ${e.ok}, failure: ${e.fail}: ${e.err}`.slice(0, 500) : null
      )
    )
    for (let i = 0; i < rows.length; i += DB_INSERT_CHUNK) {
      const { error } = await supabase.from('notifications').insert(rows.slice(i, i + DB_INSERT_CHUNK))
      if (error) console.error('[FCM] history insert failed:', error)
    }

    console.log(`[FCM] announcement ${announcementId}: ${result.sent} sent, ${result.failed} failed, ${result.users} users, ${invalidTokens.length} dead tokens`)
    return result
  } catch (err: any) {
    await recordFatal(`Unexpected error: ${err?.message || err}`)
    return result
  }
}
