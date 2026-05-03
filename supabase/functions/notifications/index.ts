import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'register_token':
        return await handleRegisterToken(supabase, body)
      case 'unregister_token':
        return await handleUnregisterToken(supabase, body)
      case 'get_preferences':
        return await handleGetPreferences(supabase, body)
      case 'update_preferences':
        return await handleUpdatePreferences(supabase, body)
      case 'get_tokens':
        return await handleGetTokens(supabase, body)
      case 'get_history':
        return await handleGetHistory(supabase, body)
      case 'mark_read':
        return await handleMarkRead(supabase, body)
      case 'mark_all_read':
        return await handleMarkAllRead(supabase, body)
      case 'get_unread_count':
        return await handleGetUnreadCount(supabase, body)
      default:
        return new Response(
          JSON.stringify({ error: `Invalid action: ${action}. Must be register_token, unregister_token, get_preferences, update_preferences, get_tokens, get_history, mark_read, mark_all_read, or get_unread_count` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
  } catch (error) {
    console.error('Notifications API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ── REGISTER FCM TOKEN ──
async function handleRegisterToken(supabase: any, body: any) {
  const { client_type, user_id, fcm_token, device_info, platform, app_version } = body

  if (!client_type || !user_id || !fcm_token) {
    return new Response(
      JSON.stringify({ error: 'client_type, user_id, and fcm_token are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Upsert: if token exists for this user, reactivate it and update info
  // If new token, insert it
  const { error } = await supabase
    .from('fcm_tokens')
    .upsert({
      client_type,
      user_id,
      fcm_token,
      device_info: device_info || null,
      platform: platform || 'android',
      app_version: app_version || null,
      is_active: true,
      last_used_at: new Date().toISOString(),
    }, {
      onConflict: 'client_type,user_id,fcm_token'
    })

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
async function handleUnregisterToken(supabase: any, body: any) {
  const { client_type, user_id, fcm_token } = body

  if (!client_type || !user_id || !fcm_token) {
    return new Response(
      JSON.stringify({ error: 'client_type, user_id, and fcm_token are required' }),
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
async function handleGetPreferences(supabase: any, body: any) {
  const { client_type, user_id } = body

  if (!client_type || !user_id) {
    return new Response(
      JSON.stringify({ error: 'client_type and user_id are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('client_type', client_type)
    .eq('user_id', user_id)
    .single()

  // Return defaults if no preferences exist yet
  const defaultPrefs = {
    notify_on_reply: true,
    notify_on_vote: true,
    notify_on_mention: true,
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
        notify_on_comment_delete: prefs.notify_on_comment_delete ?? false,
        notify_on_mod_action: prefs.notify_on_mod_action ?? true,
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ── UPDATE NOTIFICATION PREFERENCES ──
async function handleUpdatePreferences(supabase: any, body: any) {
  const { client_type, user_id, preferences } = body

  if (!client_type || !user_id || !preferences) {
    return new Response(
      JSON.stringify({ error: 'client_type, user_id, and preferences are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const validKeys = ['notify_on_reply', 'notify_on_vote', 'notify_on_mention', 'notify_on_comment_delete', 'notify_on_mod_action']
  const updates: any = { updated_at: new Date().toISOString() }

  for (const [key, value] of Object.entries(preferences)) {
    if (validKeys.includes(key) && typeof value === 'boolean') {
      updates[key] = value
    }
  }

  const { error } = await supabase
    .from('notification_preferences')
    .upsert({
      client_type,
      user_id,
      ...updates,
    }, {
      onConflict: 'client_type,user_id'
    })

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
async function handleGetTokens(supabase: any, body: any) {
  const { client_type, user_id } = body

  if (!client_type || !user_id) {
    return new Response(
      JSON.stringify({ error: 'client_type and user_id are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: tokens, error } = await supabase
    .from('fcm_tokens')
    .select('id, fcm_token, platform, device_info, app_version, is_active, created_at, last_used_at')
    .eq('client_type', client_type)
    .eq('user_id', user_id)
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
async function handleGetHistory(supabase: any, body: any) {
  const { client_type, user_id, page = 1, limit = 30, type, unreadOnly } = body

  if (!client_type || !user_id) {
    return new Response(
      JSON.stringify({ error: 'client_type and user_id are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const safeLimit = Math.min(Math.max(parseInt(limit) || 30, 1), 100)
  const safePage = Math.max(parseInt(page) || 1, 1)
  const offset = (safePage - 1) * safeLimit

  // Build query
  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('client_type', client_type)
    .eq('user_id', user_id)

  if (type) {
    // Use LIKE with prefix match so 'comment' matches 'comment_reply', 'comment_pinned', etc.
    query = query.like('type', `${type}%`)
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

  // Get unread count
  const { count: unreadCount } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('client_type', client_type)
    .eq('user_id', user_id)
    .eq('is_read', false)

  return new Response(
    JSON.stringify({
      success: true,
      notifications: notifications || [],
      total: count || 0,
      unread_count: unreadCount || 0,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / safeLimit)
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ── MARK SINGLE NOTIFICATION AS READ ──
async function handleMarkRead(supabase: any, body: any) {
  const { client_type, user_id, notification_id } = body

  if (!client_type || !user_id || !notification_id) {
    return new Response(
      JSON.stringify({ error: 'client_type, user_id, and notification_id are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { error } = await supabase
    .from('notifications')
    .update({
      is_read: true,
      read_at: new Date().toISOString()
    })
    .eq('id', notification_id)
    .eq('client_type', client_type)
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
async function handleMarkAllRead(supabase: any, body: any) {
  const { client_type, user_id, type } = body

  if (!client_type || !user_id) {
    return new Response(
      JSON.stringify({ error: 'client_type and user_id are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let query = supabase
    .from('notifications')
    .update({
      is_read: true,
      read_at: new Date().toISOString()
    })
    .eq('client_type', client_type)
    .eq('user_id', user_id)
    .eq('is_read', false)

  if (type) {
    // Use LIKE with prefix match so 'comment' matches 'comment_reply', 'comment_pinned', etc.
    query = query.like('type', `${type}%`)
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
async function handleGetUnreadCount(supabase: any, body: any) {
  const { client_type, user_id } = body

  if (!client_type || !user_id) {
    return new Response(
      JSON.stringify({ error: 'client_type and user_id are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('client_type', client_type)
    .eq('user_id', user_id)
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
