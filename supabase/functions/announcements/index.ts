import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifyClientToken } from '../shared/clientAuth.ts'
import { sendDiscordNotificationBlocking } from '../shared/discordNotifications.ts'
import { queueFcmNotification } from '../shared/fcmNotifications.ts'
import { renderAnnouncementDashboard } from './dashboard.ts'
import {
  getDashboardUsers,
  getDashboardUserByUsername,
  saveDashboardUser,
  deleteDashboardUser,
  createSession,
  getSession,
  revokeSession,
  hashPassword,
  verifyPassword,
  syncCommentumRole,
  DashboardUser
} from './staffAuth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-admin-key, x-session-token, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim()
  }
  return req.headers.get('x-session-token')
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

    const url = new URL(req.url)
    const rawSegments = url.pathname.split('/').filter(Boolean)
    const annIdx = rawSegments.indexOf('announcements')
    const pathSegments = annIdx !== -1 ? rawSegments.slice(annIdx + 1) : rawSegments
    
    const method = req.method

    // 1. Web Dashboard route
    if (method === 'GET' && (pathSegments.includes('dashboard') || pathSegments.includes('admin') || url.searchParams.get('view') === 'dashboard')) {
      return new Response(renderAnnouncementDashboard(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      })
    }

    // 2. Auth Routes
    if (pathSegments[0] === 'auth') {
      const authAction = pathSegments[1]
      if (method === 'GET' && authAction === 'status') {
        return await handleAuthStatus(supabase, req)
      }
      if (method === 'POST' && authAction === 'setup') {
        return await handleAuthSetup(supabase, req)
      }
      if (method === 'POST' && authAction === 'login') {
        return await handleAuthLogin(supabase, req)
      }
      if (method === 'POST' && authAction === 'logout') {
        return await handleAuthLogout(supabase, req)
      }
      if (method === 'GET' && authAction === 'me') {
        return await handleAuthMe(supabase, req)
      }
      return jsonResponse({ error: 'Auth action not found' }, 404)
    }

    // 3. Staff Management Routes
    if (pathSegments[0] === 'staff') {
      const staffId = pathSegments[1] ? parseInt(pathSegments[1]) : null
      if (method === 'GET' && !staffId) {
        return await handleListStaff(supabase, req)
      }
      if (method === 'POST' && !staffId) {
        return await handleCreateStaff(supabase, req)
      }
      if (method === 'PATCH' && staffId) {
        return await handleUpdateStaff(supabase, staffId, req)
      }
      if (method === 'DELETE' && staffId) {
        return await handleDeleteStaff(supabase, staffId, req)
      }
      return jsonResponse({ error: 'Staff endpoint not found' }, 404)
    }

    // 4. Unread count route
    if (method === 'GET' && pathSegments[0] === 'unread-count') {
      return await handleGetUnreadCount(supabase, url)
    }

    // 5. Announcements CRUD routes
    const announcementId = pathSegments[0] && !isNaN(parseInt(pathSegments[0])) ? parseInt(pathSegments[0]) : null
    const action = pathSegments[1] // 'view', 'read', 'publish', 'archive'

    if (method === 'GET' && !announcementId) {
      return await handleListAnnouncements(supabase, url)
    }
    
    if (method === 'GET' && announcementId && !action) {
      return await handleGetAnnouncement(supabase, announcementId, url)
    }
    
    if (method === 'POST' && !announcementId) {
      return await handleCreateAnnouncement(supabase, req)
    }
    
    if (method === 'POST' && announcementId && action === 'view') {
      return await handleMarkViewed(supabase, announcementId, req)
    }
    
    if (method === 'POST' && announcementId && action === 'read') {
      return await handleMarkRead(supabase, announcementId, req)
    }
    
    if (method === 'POST' && announcementId && action === 'publish') {
      return await handlePublishAnnouncement(supabase, announcementId, req)
    }
    
    if (method === 'POST' && announcementId && action === 'archive') {
      return await handleArchiveAnnouncement(supabase, announcementId, req)
    }
    
    if (method === 'PATCH' && announcementId) {
      return await handleUpdateAnnouncement(supabase, announcementId, req)
    }
    
    if (method === 'DELETE' && announcementId) {
      return await handleDeleteAnnouncement(supabase, announcementId, req)
    }

    return jsonResponse({ error: 'Endpoint not found' }, 404)

  } catch (error) {
    console.error('Announcements API error:', error)
    return jsonResponse({ error: 'Internal server error', details: error.message }, 500)
  }
})

// ====================================
// AUTH & STAFF HANDLERS
// ====================================

async function handleAuthStatus(supabase: any, req: Request) {
  const users = await getDashboardUsers(supabase)
  const needsSetup = users.length === 0

  const token = extractToken(req)
  let session = null
  if (token) {
    session = await getSession(supabase, token)
  }

  return jsonResponse({
    needs_setup: needsSetup,
    authenticated: !!session,
    user: session ? {
      id: session.user_id,
      username: session.username,
      role: session.role,
      display_name: session.display_name,
      avatar_url: session.avatar_url,
      linked_client_type: session.linked_client_type,
      linked_user_id: session.linked_user_id
    } : null
  })
}

async function handleAuthSetup(supabase: any, req: Request) {
  const users = await getDashboardUsers(supabase)
  if (users.length > 0) {
    return jsonResponse({ error: 'Master account has already been initialized' }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const {
    username = 'Sheby',
    password,
    display_name = 'Sheby',
    linked_client_type = 'anilist',
    linked_user_id = '5724017'
  } = body

  if (!password || password.length < 6) {
    return jsonResponse({ error: 'Password must be at least 6 characters' }, 400)
  }

  const { hash, salt } = await hashPassword(password)
  const masterUser = await saveDashboardUser(supabase, {
    username: username.trim(),
    password_hash: hash,
    salt,
    role: 'owner',
    display_name: display_name.trim(),
    linked_client_type,
    linked_user_id: String(linked_user_id),
    linked_username: display_name.trim(),
    is_active: true
  })

  // Sync to owner role in commentum config
  if (linked_user_id) {
    await syncCommentumRole(supabase, 'owner', String(linked_user_id))
  }

  const token = await createSession(supabase, masterUser)

  return jsonResponse({
    success: true,
    message: 'Master Owner account initialized successfully',
    token,
    user: {
      id: masterUser.id,
      username: masterUser.username,
      role: masterUser.role,
      display_name: masterUser.display_name,
      avatar_url: masterUser.avatar_url,
      linked_client_type: masterUser.linked_client_type,
      linked_user_id: masterUser.linked_user_id
    }
  }, 201)
}

async function handleAuthLogin(supabase: any, req: Request) {
  const body = await req.json().catch(() => ({}))
  const { username, password } = body

  if (!username || !password) {
    return jsonResponse({ error: 'Username and password are required' }, 400)
  }

  const user = await getDashboardUserByUsername(supabase, username)
  if (!user || !user.is_active) {
    return jsonResponse({ error: 'Invalid username or password' }, 401)
  }

  const matches = await verifyPassword(password, user.password_hash, user.salt)
  if (!matches) {
    return jsonResponse({ error: 'Invalid username or password' }, 401)
  }

  // Update last login timestamp
  await saveDashboardUser(supabase, { id: user.id, last_login_at: new Date().toISOString() })

  const token = await createSession(supabase, user)

  return jsonResponse({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name || user.username,
      avatar_url: user.avatar_url,
      linked_client_type: user.linked_client_type,
      linked_user_id: user.linked_user_id
    }
  })
}

async function handleAuthLogout(supabase: any, req: Request) {
  const token = extractToken(req)
  if (token) {
    await revokeSession(supabase, token)
  }
  return jsonResponse({ success: true, message: 'Logged out successfully' })
}

async function handleAuthMe(supabase: any, req: Request) {
  const token = extractToken(req)
  if (!token) {
    return jsonResponse({ error: 'Not authenticated' }, 401)
  }
  const session = await getSession(supabase, token)
  if (!session) {
    return jsonResponse({ error: 'Invalid or expired session' }, 401)
  }
  return jsonResponse({ success: true, user: session })
}

async function handleListStaff(supabase: any, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  if (!adminCheck.valid || (adminCheck.role !== 'owner' && adminCheck.role !== 'super_admin')) {
    return jsonResponse({ error: 'Super Admin or Owner permissions required' }, 403)
  }

  const users = await getDashboardUsers(supabase)
  const safeStaff = users.map(({ password_hash: _1, salt: _2, ...rest }) => rest)
  return jsonResponse({ success: true, staff: safeStaff })
}

async function handleCreateStaff(supabase: any, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  if (!adminCheck.valid || (adminCheck.role !== 'owner' && adminCheck.role !== 'super_admin')) {
    return jsonResponse({ error: 'Super Admin or Owner permissions required' }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const {
    username,
    password,
    role = 'moderator',
    display_name,
    avatar_url,
    linked_client_type,
    linked_user_id,
    linked_username
  } = body

  if (!username || !password) {
    return jsonResponse({ error: 'Username and password are required' }, 400)
  }

  if (password.length < 6) {
    return jsonResponse({ error: 'Password must be at least 6 characters' }, 400)
  }

  // Only owner can assign super_admin or owner
  if ((role === 'owner' || role === 'super_admin') && adminCheck.role !== 'owner') {
    return jsonResponse({ error: 'Only the Owner can assign Super Admin or Owner roles' }, 403)
  }

  const existing = await getDashboardUserByUsername(supabase, username)
  if (existing) {
    return jsonResponse({ error: 'Username is already taken' }, 400)
  }

  const { hash, salt } = await hashPassword(password)
  const newUser = await saveDashboardUser(supabase, {
    username: username.trim(),
    password_hash: hash,
    salt,
    role,
    display_name: (display_name || username).trim(),
    avatar_url: avatar_url || null,
    linked_client_type: linked_client_type || null,
    linked_user_id: linked_user_id ? String(linked_user_id) : null,
    linked_username: linked_username || null,
    is_active: true
  })

  // Sync to commentum role if linked
  if (linked_user_id) {
    await syncCommentumRole(supabase, role, String(linked_user_id))
  }

  const { password_hash: _1, salt: _2, ...safeUser } = newUser
  return jsonResponse({ success: true, staff: safeUser }, 201)
}

async function handleUpdateStaff(supabase: any, staffId: number, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  if (!adminCheck.valid || (adminCheck.role !== 'owner' && adminCheck.role !== 'super_admin')) {
    return jsonResponse({ error: 'Super Admin or Owner permissions required' }, 403)
  }

  const users = await getDashboardUsers(supabase)
  const target = users.find(u => u.id === staffId)
  if (!target) {
    return jsonResponse({ error: 'Staff member not found' }, 404)
  }

  // Only owner can edit owner or super_admin
  if ((target.role === 'owner' || target.role === 'super_admin') && adminCheck.role !== 'owner') {
    return jsonResponse({ error: 'Only the Owner can modify Super Admins or Owners' }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const updatePayload: Partial<DashboardUser> = { id: staffId }

  if (body.display_name !== undefined) updatePayload.display_name = body.display_name
  if (body.avatar_url !== undefined) updatePayload.avatar_url = body.avatar_url
  if (body.linked_client_type !== undefined) updatePayload.linked_client_type = body.linked_client_type
  if (body.linked_username !== undefined) updatePayload.linked_username = body.linked_username
  if (body.is_active !== undefined) updatePayload.is_active = body.is_active

  if (body.password) {
    if (body.password.length < 6) {
      return jsonResponse({ error: 'Password must be at least 6 characters' }, 400)
    }
    const { hash, salt } = await hashPassword(body.password)
    updatePayload.password_hash = hash
    updatePayload.salt = salt
  }

  // Handle role change and role syncing
  if (body.role && body.role !== target.role) {
    if ((body.role === 'owner' || body.role === 'super_admin') && adminCheck.role !== 'owner') {
      return jsonResponse({ error: 'Only the Owner can assign Super Admin or Owner roles' }, 403)
    }
    updatePayload.role = body.role

    const linkedId = body.linked_user_id !== undefined ? body.linked_user_id : target.linked_user_id
    if (linkedId) {
      await syncCommentumRole(supabase, body.role, String(linkedId))
    }
  }

  if (body.linked_user_id !== undefined) {
    updatePayload.linked_user_id = body.linked_user_id ? String(body.linked_user_id) : undefined
    if (body.linked_user_id) {
      const activeRole = updatePayload.role || target.role
      await syncCommentumRole(supabase, activeRole, String(body.linked_user_id))
    }
  }

  const updated = await saveDashboardUser(supabase, updatePayload)
  const { password_hash: _1, salt: _2, ...safeUser } = updated

  return jsonResponse({ success: true, staff: safeUser })
}

async function handleDeleteStaff(supabase: any, staffId: number, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  if (!adminCheck.valid || adminCheck.role !== 'owner') {
    return jsonResponse({ error: 'Only the Owner can delete staff members' }, 403)
  }

  const users = await getDashboardUsers(supabase)
  const target = users.find(u => u.id === staffId)
  if (!target) {
    return jsonResponse({ error: 'Staff member not found' }, 404)
  }

  if (target.role === 'owner') {
    const ownerCount = users.filter(u => u.role === 'owner').length
    if (ownerCount <= 1) {
      return jsonResponse({ error: 'Cannot delete the only Master Owner' }, 400)
    }
  }

  // Clean up role in commentum config
  if (target.linked_user_id) {
    await syncCommentumRole(supabase, target.role, target.linked_user_id, true)
  }

  await deleteDashboardUser(supabase, staffId)
  return jsonResponse({ success: true, message: 'Staff member removed successfully' })
}

// ====================================
// ADMIN VERIFICATION
// ====================================

async function verifyAdmin(supabase: any, req: Request) {
  // 1. Session Token (from Authorization header or x-session-token)
  const token = extractToken(req)
  if (token) {
    const session = await getSession(supabase, token)
    if (session) {
      return {
        valid: true,
        userId: session.linked_user_id || `staff_${session.user_id}`,
        role: session.role,
        username: session.display_name || session.username,
        avatarUrl: session.avatar_url,
        staffUserId: session.user_id
      }
    }
  }

  // 2. Direct Service Role Key or Custom Admin Secret
  const adminKeyHeader = req.headers.get('x-admin-key')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const customAdminSecret = Deno.env.get('ADMIN_SECRET')

  const isValidSecret = (k: string | null | undefined) =>
    !!k && (
      (serviceRoleKey && k === serviceRoleKey) ||
      (customAdminSecret && k === customAdminSecret)
    )

  if (isValidSecret(adminKeyHeader)) {
    return { valid: true, userId: 'admin', role: 'owner', username: 'Administrator' }
  }

  const body = await req.clone().json().catch(() => ({}))
  const { client_type, access_token, admin_key, session_token } = body

  if (session_token) {
    const session = await getSession(supabase, session_token)
    if (session) {
      return {
        valid: true,
        userId: session.linked_user_id || `staff_${session.user_id}`,
        role: session.role,
        username: session.display_name || session.username,
        avatarUrl: session.avatar_url,
        staffUserId: session.user_id
      }
    }
  }

  if (isValidSecret(admin_key)) {
    return { valid: true, userId: 'admin', role: 'owner', username: 'Administrator' }
  }

  // 3. Client token verification (OAuth from AniList/MAL/Simkl)
  if (client_type && access_token) {
    const verifiedUser = await verifyClientToken(client_type, access_token)
    if (!verifiedUser) {
      return { valid: false, error: 'Invalid or expired client token' }
    }

    const userId = verifiedUser.provider_user_id

    const { data: owners } = await supabase.from('config').select('value').eq('key', 'owner_users').single()
    const { data: superAdmins } = await supabase.from('config').select('value').eq('key', 'super_admin_users').single()
    const { data: admins } = await supabase.from('config').select('value').eq('key', 'admin_users').single()
    const { data: mods } = await supabase.from('config').select('value').eq('key', 'moderator_users').single()

    const ownerList = owners ? JSON.parse(owners.value) : []
    const superAdminList = superAdmins ? JSON.parse(superAdmins.value) : []
    const adminList = admins ? JSON.parse(admins.value) : []
    const modList = mods ? JSON.parse(mods.value) : []

    let role = ''
    if (ownerList.includes(userId)) role = 'owner'
    else if (superAdminList.includes(userId)) role = 'super_admin'
    else if (adminList.includes(userId)) role = 'admin'
    else if (modList.includes(userId)) role = 'moderator'
    else {
      return { valid: false, error: 'Admin or Staff access required' }
    }

    return { valid: true, userId, role, username: verifiedUser.username }
  }

  return { valid: false, error: 'Authentication required. Please log in.' }
}

// ====================================
// PUBLIC ENDPOINTS
// ====================================

async function handleListAnnouncements(supabase: any, url: URL) {
  const appId = url.searchParams.get('app_id') || 'anymex'
  const status = url.searchParams.get('status') || 'published'
  const category = url.searchParams.get('category')
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 50)
  const userId = url.searchParams.get('user_id')
  const includeRead = url.searchParams.get('include_read') === 'true'

  const validAppIds = ['anymex', 'shonenx', 'animestream']
  if (!validAppIds.includes(appId)) {
    return jsonResponse({ error: 'Invalid app_id. Must be one of: anymex, shonenx, animestream' }, 400)
  }

  // Build query
  let query = supabase
    .from('announcements')
    .select('id, title, short_description, category, pinned, featured, priority, published_at, author_name, view_count, expires_at', { count: 'exact' })
    .eq('app_id', appId)

  if (status !== 'all') {
    query = query
      .eq('status', status)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
  }

  if (category) {
    query = query.eq('category', category)
  }

  // Pagination
  const offset = (page - 1) * limit
  query = query
    .order('pinned', { ascending: false })
    .order('priority', { ascending: false })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1)

  const { data: announcements, error, count } = await query

  if (error) throw error

  // If user_id provided, fetch read status
  let announcementsWithReadStatus = announcements || []
  let unreadCount = 0

  if (userId && announcements && announcements.length > 0) {
    const announcementIds = announcements.map(a => a.id)
    
    const { data: reads } = await supabase
      .from('announcement_reads')
      .select('announcement_id')
      .eq('user_id', userId)
      .eq('app_id', appId)
      .in('announcement_id', announcementIds)

    const readIds = new Set((reads || []).map(r => r.announcement_id))

    announcementsWithReadStatus = announcements.map(a => ({
      ...a,
      is_read: readIds.has(a.id)
    }))

    if (!includeRead) {
      announcementsWithReadStatus = announcementsWithReadStatus.filter(a => !a.is_read)
    }

    const { count: totalPublished } = await supabase
      .from('announcements')
      .select('*', { count: 'exact', head: true })
      .eq('app_id', appId)
      .eq('status', 'published')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

    const { count: totalRead } = await supabase
      .from('announcement_reads')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('app_id', appId)

    unreadCount = (totalPublished || 0) - (totalRead || 0)
  }

  return jsonResponse({
    success: true,
    announcements: announcementsWithReadStatus,
    pagination: {
      page,
      limit,
      total: count,
      total_pages: Math.ceil((count || 0) / limit)
    },
    unread_count: Math.max(0, unreadCount)
  })
}

async function handleGetAnnouncement(supabase: any, announcementId: number, url: URL) {
  const { data: announcement, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', announcementId)
    .single()

  if (error || !announcement) {
    return jsonResponse({ error: 'Announcement not found' }, 404)
  }

  // Increment view count
  await supabase
    .from('announcements')
    .update({ view_count: (announcement.view_count || 0) + 1 })
    .eq('id', announcementId)

  // Check read status if user_id provided
  let isRead = false
  const userId = url.searchParams.get('user_id')
  const appId = url.searchParams.get('app_id')
  
  if (userId && appId) {
    const { data: readRecord } = await supabase
      .from('announcement_reads')
      .select('id')
      .eq('announcement_id', announcementId)
      .eq('user_id', userId)
      .eq('app_id', appId)
      .single()
    
    isRead = !!readRecord
  }

  return jsonResponse({
    success: true,
    announcement: {
      ...announcement,
      view_count: (announcement.view_count || 0) + 1,
      is_read: isRead
    }
  })
}

async function handleMarkViewed(supabase: any, announcementId: number, req: Request) {
  const body = await req.json()
  const { user_id, app_id } = body

  if (!app_id) {
    return jsonResponse({ error: 'app_id is required' }, 400)
  }

  const { data: announcement } = await supabase
    .from('announcements')
    .select('id')
    .eq('id', announcementId)
    .single()

  if (!announcement) {
    return jsonResponse({ error: 'Announcement not found' }, 404)
  }

  await supabase
    .from('announcement_views')
    .insert({
      announcement_id: announcementId,
      user_id: user_id || null,
      app_id
    })

  return jsonResponse({ success: true, message: 'View tracked' })
}

async function handleMarkRead(supabase: any, announcementId: number, req: Request) {
  const body = await req.json()
  const { user_id, app_id } = body

  if (!user_id || !app_id) {
    return jsonResponse({ error: 'user_id and app_id are required' }, 400)
  }

  const { data: announcement } = await supabase
    .from('announcements')
    .select('id')
    .eq('id', announcementId)
    .single()

  if (!announcement) {
    return jsonResponse({ error: 'Announcement not found' }, 404)
  }

  await supabase
    .from('announcement_reads')
    .upsert({
      announcement_id: announcementId,
      user_id,
      app_id,
      read_at: new Date().toISOString()
    }, {
      onConflict: 'announcement_id,user_id,app_id'
    })

  return jsonResponse({ success: true, message: 'Marked as read' })
}

async function handleGetUnreadCount(supabase: any, url: URL) {
  const userId = url.searchParams.get('user_id')
  const appId = url.searchParams.get('app_id')

  if (!userId || !app_id) {
    return jsonResponse({ error: 'user_id and app_id are required' }, 400)
  }

  const { count: totalPublished } = await supabase
    .from('announcements')
    .select('*', { count: 'exact', head: true })
    .eq('app_id', appId)
    .eq('status', 'published')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

  const { count: readCount } = await supabase
    .from('announcement_reads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('app_id', appId)

  const unreadCount = Math.max(0, (totalPublished || 0) - (readCount || 0))

  return jsonResponse({
    success: true,
    total_published: totalPublished || 0,
    read_count: readCount || 0,
    unread_count: unreadCount
  })
}

// ====================================
// ANNOUNCEMENT CRUD (ADMIN / STAFF)
// ====================================

async function handleCreateAnnouncement(supabase: any, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  
  if (!adminCheck.valid) {
    return jsonResponse({ error: adminCheck.error }, 401)
  }

  const body = await req.json()
  const {
    app_id,
    title,
    short_description,
    full_content,
    category = 'general',
    priority = 0,
    pinned = false,
    featured = false,
    target_roles,
    target_platforms,
    expires_at,
    publish = false
  } = body

  if (!app_id || !title || !short_description || !full_content) {
    return jsonResponse({ error: 'app_id, title, short_description, and full_content are required' }, 400)
  }

  const validAppIds = ['anymex', 'shonenx', 'animestream']
  if (!validAppIds.includes(app_id)) {
    return jsonResponse({ error: 'Invalid app_id. Must be one of: anymex, shonenx, animestream' }, 400)
  }

  if (title.length > 200) {
    return jsonResponse({ error: 'Title must be 200 characters or less' }, 400)
  }

  if (short_description.length > 500) {
    return jsonResponse({ error: 'Short description must be 500 characters or less' }, 400)
  }

  // Moderator role can create drafts but cannot publish directly
  const canPublish = adminCheck.role === 'owner' || adminCheck.role === 'super_admin' || adminCheck.role === 'admin'
  const isPublishing = publish && canPublish

  const insertData: any = {
    app_id,
    title,
    short_description,
    full_content,
    category,
    priority,
    pinned,
    featured,
    target_roles: target_roles || null,
    target_platforms: target_platforms || null,
    expires_at: expires_at || null,
    author_id: adminCheck.userId,
    author_name: adminCheck.username || 'Staff',
    status: isPublishing ? 'published' : 'draft',
    published_at: isPublishing ? new Date().toISOString() : null
  }

  const { data: announcement, error } = await supabase
    .from('announcements')
    .insert(insertData)
    .select()
    .single()

  if (error) throw error

  // Send Discord & FCM if published
  if (isPublishing) {
    await sendDiscordNotificationBlocking(supabase, {
      type: 'announcement_published' as any,
      comment: {
        id: announcement.id,
        content: full_content,
        client_type: app_id
      },
      moderator: {
        id: adminCheck.userId,
        username: announcement.author_name
      },
      reason: title
    })

    await sendAnnouncementFcmNotifications(supabase, announcement, adminCheck)
  }

  return jsonResponse({
    success: true,
    announcement,
    message: isPublishing ? 'Announcement published successfully' : 'Announcement created as draft'
  }, 201)
}

async function handleUpdateAnnouncement(supabase: any, announcementId: number, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  
  if (!adminCheck.valid) {
    return jsonResponse({ error: adminCheck.error }, 401)
  }

  const { data: existing } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', announcementId)
    .single()

  if (!existing) {
    return jsonResponse({ error: 'Announcement not found' }, 404)
  }

  const body = await req.json()
  const updateFields = [
    'title', 'short_description', 'full_content', 'category',
    'priority', 'pinned', 'featured', 'target_roles', 'target_platforms', 'expires_at'
  ]

  const updateData: any = { updated_at: new Date().toISOString() }
  
  updateFields.forEach(field => {
    if (body[field] !== undefined) {
      updateData[field] = body[field]
    }
  })

  if (body.title && body.title.length > 200) {
    return jsonResponse({ error: 'Title must be 200 characters or less' }, 400)
  }

  if (body.short_description && body.short_description.length > 500) {
    return jsonResponse({ error: 'Short description must be 500 characters or less' }, 400)
  }

  const { data: announcement, error } = await supabase
    .from('announcements')
    .update(updateData)
    .eq('id', announcementId)
    .select()
    .single()

  if (error) throw error

  return jsonResponse({ success: true, announcement })
}

async function handleDeleteAnnouncement(supabase: any, announcementId: number, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  
  if (!adminCheck.valid) {
    return jsonResponse({ error: adminCheck.error }, 401)
  }

  // Moderator cannot delete announcements
  if (adminCheck.role === 'moderator') {
    return jsonResponse({ error: 'Admin or Super Admin permission required to delete announcements' }, 403)
  }

  const { error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', announcementId)

  if (error) throw error

  return jsonResponse({ success: true, message: 'Announcement deleted' })
}

async function handlePublishAnnouncement(supabase: any, announcementId: number, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  
  if (!adminCheck.valid) {
    return jsonResponse({ error: adminCheck.error }, 401)
  }

  if (adminCheck.role === 'moderator') {
    return jsonResponse({ error: 'Admin or Super Admin permission required to publish' }, 403)
  }

  const { data: existing } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', announcementId)
    .single()

  if (!existing) {
    return jsonResponse({ error: 'Announcement not found' }, 404)
  }

  if (existing.status === 'published') {
    return jsonResponse({ error: 'Announcement is already published' }, 400)
  }

  const { data: announcement, error } = await supabase
    .from('announcements')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', announcementId)
    .select()
    .single()

  if (error) throw error

  // Discord notification
  await sendDiscordNotificationBlocking(supabase, {
    type: 'announcement_published' as any,
    comment: {
      id: announcement.id,
      content: announcement.full_content,
      client_type: announcement.app_id
    },
    moderator: {
      id: adminCheck.userId,
      username: announcement.author_name
    },
    reason: announcement.title
  })

  // FCM broadcast
  await sendAnnouncementFcmNotifications(supabase, announcement, adminCheck)

  return jsonResponse({ success: true, announcement, message: 'Announcement published' })
}

async function handleArchiveAnnouncement(supabase: any, announcementId: number, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  
  if (!adminCheck.valid) {
    return jsonResponse({ error: adminCheck.error }, 401)
  }

  const { data: announcement, error } = await supabase
    .from('announcements')
    .update({
      status: 'archived',
      pinned: false,
      featured: false,
      updated_at: new Date().toISOString()
    })
    .eq('id', announcementId)
    .select()
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return jsonResponse({ error: 'Announcement not found' }, 404)
    }
    throw error
  }

  return jsonResponse({ success: true, announcement, message: 'Announcement archived' })
}

// ====================================
// FCM PUSH NOTIFICATIONS
// ====================================

async function sendAnnouncementFcmNotifications(supabase: any, announcement: any, adminCheck: any) {
  try {
    const targetRoles = announcement.target_roles
    const targetPlatforms = announcement.target_platforms

    // client_type-agnostic: tokens register under whatever client the user is
    // on (anilist/mal/simkl/...), never under the announcement's app_id, so
    // filtering by client_type=app_id matched nothing and every broadcast
    // silently sent zero pushes ("[FCM] No active tokens found for
    // app_id=anymex"). Same policy as the per-user send path: deliver to
    // every ACTIVE token; platform/role targeting still applies; per-user
    // notification preferences are enforced in the send path; dead tokens
    // are auto-deactivated by the FCM error handler.
    let query = supabase
      .from('fcm_tokens')
      .select('id, user_id, fcm_token, platform, last_used_at')
      .eq('is_active', true)

    if (targetPlatforms && targetPlatforms.length > 0) {
      query = query.in('platform', targetPlatforms)
    }

    const { data: activeTokens, error: tokensError } = await query

    if (tokensError || !activeTokens || activeTokens.length === 0) {
      console.log(`[FCM] No active tokens found (announcement ${announcement.id}), tokensError=${JSON.stringify(tokensError)}`)
      return
    }

    let eligibleTokens = activeTokens
    if (targetRoles && targetRoles.length > 0) {
      const userIds = activeTokens.map(t => t.user_id)
      const { data: userRoles } = await supabase
        .from('commentum_users')
        .select('commentum_user_id, commentum_user_role')
        .in('commentum_user_id', userIds)

      const userRoleMap = new Map(
        (userRoles || []).map(u => [u.commentum_user_id, u.commentum_user_role])
      )

      eligibleTokens = activeTokens.filter(token => {
        const userRole = userRoleMap.get(token.user_id) || 'user'
        return targetRoles.includes(userRole)
      })
    }

    // Deduplicate by user_id so we don't queue duplicate notifications for multi-device users
    const uniqueEligibleUsers = Array.from(new Set(eligibleTokens.map(t => t.user_id)))

    for (const userId of uniqueEligibleUsers) {
      try {
        queueFcmNotification({
          type: 'announcement_published',
          targetUserId: userId,
          targetClientType: announcement.app_id,
          announcementTitle: announcement.title,
          announcementContent: announcement.short_description || announcement.full_content,
          announcementId: String(announcement.id),
          metadata: {
            announcement_id: String(announcement.id),
            category: announcement.category,
            pinned: String(announcement.pinned),
          }
        })
      } catch (err) {
        console.error(`Failed to queue FCM notification for user ${userId}:`, err)
      }
    }
    console.log(`[FCM] Queued announcement notifications for ${uniqueEligibleUsers.length} users`)
  } catch (error) {
    console.error('Error broadcasting FCM announcement notifications:', error)
  }
}

