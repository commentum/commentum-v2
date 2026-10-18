import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { getAuthUser, hasRoleLevel } from '../shared/authMiddleware.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function normalizeClientType(provider?: string, explicit?: string): string {
  const raw = (explicit || provider || 'anilist').toLowerCase().trim()
  if (raw === 'mal') return 'myanimelist'
  return raw
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Mandatory JWT Authentication
    const auth = await getAuthUser(req, supabase, { requireAuth: true })
    if (!auth.isAuthenticated || !auth.user) {
      return new Response(
        JSON.stringify({ error: auth.error || 'Authentication required to access notifications' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Parse request input (supports both GET query parameters and POST JSON body)
    let action = ''
    let params: any = {}

    if (req.method === 'GET') {
      const url = new URL(req.url)
      action = url.searchParams.get('action') || 'get_history'
      url.searchParams.forEach((val, key) => {
        params[key] = val
      })
      if (params.unreadOnly !== undefined) {
        params.unreadOnly = params.unreadOnly === 'true' || params.unreadOnly === '1'
      }
    } else {
      params = await req.json().catch(() => ({}))
      action = params.action
    }

    switch (action) {
      case 'register_token':
        return await handleRegisterToken(supabase, auth.user, params)
      case 'unregister_token':
        return await handleUnregisterToken(supabase, auth.user, params)
      case 'get_preferences':
        return await handleGetPreferences(supabase, auth.user, params)
      case 'update_preferences':
        return await handleUpdatePreferences(supabase, auth.user, params)
      case 'get_tokens':
        return await handleGetTokens(supabase, auth.user, params)
      case 'get_history':
        return await handleGetHistory(supabase, auth.user, params)
      case 'mark_read':
        return await handleMarkRead(supabase, auth.user, params)
      case 'mark_all_read':
        return await handleMarkAllRead(supabase, auth.user, params)
      case 'get_unread_count':
        return await handleGetUnreadCount(supabase, auth.user, params)
      default:
        return new Response(
          JSON.stringify({
            error: `Invalid action: ${action}. Must be register_token, unregister_token, get_preferences, update_preferences, get_tokens, get_history, mark_read, mark_all_read, or get_unread_count`,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
  } catch (error: any) {
    console.error('Notifications API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error?.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ── REGISTER FCM TOKEN ──
async function handleRegisterToken(supabase: any, user: any, body: any) {
  const { fcm_token, device_info, platform, app_version } = body
  const client_type = normalizeClientType(user.provider, body.client_type)
  const user_id = user.uid

  if (!fcm_token) {
    return new Response(
      JSON.stringify({ error: 'fcm_token is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Upsert: if token exists for this user, reactivate it and update info
  const { error } = await supabase
    .from('fcm_tokens')
    .upsert(
      {
        client_type,
        user_id,
        fcm_token,
        device_info: device_info || null,
        platform: platform || 'android',
        app_version: app_version || null,
        is_active: true,
        last_used_at: new Date().toISOString(),
      },
      {
        onConflict: 'client_type,user_id,fcm_token',
      }
    )

  if (error) {
    console.error('Token registration error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to register token' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, message: 'Token registered' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ── UNREGISTER FCM TOKEN ──
async function handleUnregisterToken(supabase: any, user: any, body: any) {
  const { fcm_token } = body
  const client_type = normalizeClientType(user.provider, body.client_type)
  const user_id = user.uid

  if (!fcm_token) {
    return new Response(
      JSON.stringify({ error: 'fcm_token is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Mark token as inactive (soft delete, keeps history)
  const { error } = await supabase
    .from('fcm_tokens')
    .update({ is_active: false })
    .eq('client_type', client_type)
    .eq('user_id', user_id)
    .eq('fcm_token', fcm_token)

  if (error) {
    console.error('Token unregistration error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to unregister token' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, message: 'Token unregistered' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ── GET NOTIFICATION PREFERENCES ──
async function handleGetPreferences(supabase: any, user: any, body: any) {
  const client_type = normalizeClientType(user.provider, body.client_type)
  const user_id = user.uid

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('client_type', client_type)
    .eq('user_id', user_id)
    .single()

  const defaultPrefs = {
    notify_on_reply: true,
    notify_on_vote: true,
    notify_on_mention: true,
    notify_on_announcement: true,
    notify_on_recent_comment: true,
    notify_on_comment_delete: false,
    notify_on_mod_action: true,
  }

  if (!prefs) {
    return new Response(
      JSON.stringify({ success: true, preferences: defaultPrefs }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      success: true,
      preferences: {
        notify_on_reply: prefs.notify_on_reply ?? true,
        notify_on_vote: prefs.notify_on_vote ?? true,
        notify_on_mention: prefs.notify_on_mention ?? true,
        notify_on_announcement: prefs.notify_on_announcement ?? true,
        notify_on_recent_comment: prefs.notify_on_recent_comment ?? true,
        notify_on_comment_delete: prefs.notify_on_comment_delete ?? false,
        notify_on_mod_action: prefs.notify_on_mod_action ?? true,
      },
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ── UPDATE NOTIFICATION PREFERENCES ──
async function handleUpdatePreferences(supabase: any, user: any, body: any) {
  const client_type = normalizeClientType(user.provider, body.client_type)
  const user_id = user.uid
  const preferences = body.preferences

  if (!preferences || typeof preferences !== 'object') {
    return new Response(
      JSON.stringify({ error: 'preferences object is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const validKeys = [
    'notify_on_reply',
    'notify_on_vote',
    'notify_on_mention',
    'notify_on_announcement',
    'notify_on_recent_comment',
    'notify_on_comment_delete',
    'notify_on_mod_action',
  ]
  const updates: any = { updated_at: new Date().toISOString() }

  for (const [key, value] of Object.entries(preferences)) {
    if (validKeys.includes(key) && typeof value === 'boolean') {
      updates[key] = value
    }
  }

  const { error } = await supabase
    .from('notification_preferences')
    .upsert(
      {
        client_type,
        user_id,
        ...updates,
      },
      {
        onConflict: 'client_type,user_id',
      }
    )

  if (error) {
    console.error('Preference update error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to update preferences' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, message: 'Preferences updated' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ── GET REGISTERED TOKENS (for debugging / admin) ──
async function handleGetTokens(supabase: any, user: any, body: any) {
  // Only allow querying another user's tokens if user is moderator+
  let targetUserId = user.uid
  let client_type = normalizeClientType(user.provider, body.client_type)

  if (body.user_id && body.user_id !== user.uid) {
    if (!hasRoleLevel(user.role, 'moderator')) {
      return new Response(
        JSON.stringify({ error: 'Moderator permission required to view other user tokens' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    targetUserId = body.user_id
    if (body.client_type) {
      client_type = normalizeClientType(undefined, body.client_type)
    }
  }

  const { data: tokens, error } = await supabase
    .from('fcm_tokens')
    .select('id, fcm_token, platform, device_info, app_version, is_active, created_at, last_used_at')
    .eq('client_type', client_type)
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false })

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch tokens' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, tokens: tokens || [] }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ── GET NOTIFICATION HISTORY ──
async function handleGetHistory(supabase: any, user: any, body: any) {
  const client_type = normalizeClientType(user.provider, body.client_type)
  const user_id = user.uid
  const { page = 1, limit = 30, type, unreadOnly } = body

  const safeLimit = Math.min(Math.max(parseInt(limit) || 30, 1), 100)
  const safePage = Math.max(parseInt(page) || 1, 1)
  const offset = (safePage - 1) * safeLimit

  // Build query
  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', user_id)

  if (type === 'announcement' || (type && type.startsWith('announcement'))) {
    query = query.eq('client_type', 'anymex').like('type', `${type}%`)
  } else if (type) {
    query = query.eq('client_type', client_type).like('type', `${type}%`)
  } else {
    // Include both user's client_type and broadcast app announcements
    query = query.or(`client_type.eq.${client_type},client_type.eq.anymex`)
  }

  if (unreadOnly === true) {
    query = query.eq('is_read', false)
  }

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + safeLimit - 1)

  const { data: notifications, error, count } = await query

  if (error) {
    console.error('Failed to fetch notification history:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch notification history' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let filteredNotifications = notifications || []

  // Filter out and clean up any orphaned announcement notifications whose announcement was deleted
  const announcementNotifs = filteredNotifications.filter(
    (n: any) => n.type === 'announcement_published' && n.metadata?.announcement_id
  )

  if (announcementNotifs.length > 0) {
    const annIds = [
      ...new Set(
        announcementNotifs
          .map((n: any) => parseInt(n.metadata.announcement_id))
          .filter(Boolean)
      ),
    ]
    if (annIds.length > 0) {
      const { data: existingAnns } = await supabase
        .from('announcements')
        .select('id')
        .in('id', annIds)

      const existingIdSet = new Set((existingAnns || []).map((a: any) => String(a.id)))
      const orphanedIds = annIds.filter((id: number) => !existingIdSet.has(String(id)))

      if (orphanedIds.length > 0) {
        for (const orphanId of orphanedIds) {
          supabase
            .from('notifications')
            .delete()
            .eq('type', 'announcement_published')
            .eq('metadata->>announcement_id', String(orphanId))
            .then(() => {})
        }

        filteredNotifications = filteredNotifications.filter(
          (n: any) =>
            n.type !== 'announcement_published' ||
            existingIdSet.has(String(n.metadata?.announcement_id))
        )
      }
    }
  }

  // Get unread count
  let unreadQuery = supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user_id)
    .eq('is_read', false)

  if (type === 'announcement' || (type && type.startsWith('announcement'))) {
    unreadQuery = unreadQuery.eq('client_type', 'anymex').like('type', `${type}%`)
  } else if (type) {
    unreadQuery = unreadQuery.eq('client_type', client_type).like('type', `${type}%`)
  } else {
    unreadQuery = unreadQuery.or(`client_type.eq.${client_type},client_type.eq.anymex`)
  }

  const { count: unreadCount } = await unreadQuery

  return new Response(
    JSON.stringify({
      success: true,
      notifications: filteredNotifications,
      total: count || 0,
      unread_count: unreadCount || 0,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / safeLimit),
      },
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ── MARK SINGLE NOTIFICATION AS READ ──
async function handleMarkRead(supabase: any, user: any, body: any) {
  const user_id = user.uid
  const notification_id = body.notification_id

  if (!notification_id) {
    return new Response(
      JSON.stringify({ error: 'notification_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { error } = await supabase
    .from('notifications')
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
    })
    .eq('id', notification_id)
    .eq('user_id', user_id)

  if (error) {
    console.error('Failed to mark notification as read:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to mark notification as read' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, message: 'Notification marked as read' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ── MARK ALL NOTIFICATIONS AS READ ──
async function handleMarkAllRead(supabase: any, user: any, body: any) {
  const client_type = normalizeClientType(user.provider, body.client_type)
  const user_id = user.uid
  const type = body.type

  let query = supabase
    .from('notifications')
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
    })
    .eq('user_id', user_id)
    .eq('is_read', false)

  if (type === 'announcement' || (type && type.startsWith('announcement'))) {
    query = query.eq('client_type', 'anymex').like('type', `${type}%`)
  } else if (type) {
    query = query.eq('client_type', client_type).like('type', `${type}%`)
  } else {
    query = query.or(`client_type.eq.${client_type},client_type.eq.anymex`)
  }

  const { data: updatedRows, error } = await query

  if (error) {
    console.error('Failed to mark all notifications as read:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to mark all notifications as read' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, marked_count: updatedRows?.length || 0 }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ── GET UNREAD COUNT ──
async function handleGetUnreadCount(supabase: any, user: any, body: any) {
  const client_type = normalizeClientType(user.provider, body.client_type)
  const user_id = user.uid

  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user_id)
    .or(`client_type.eq.${client_type},client_type.eq.anymex`)
    .eq('is_read', false)

  if (error) {
    console.error('Failed to get unread count:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to get unread count' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ success: true, unread_count: count || 0 }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
