import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { verifyClientToken } from '../shared/clientAuth.ts'
import { sendDiscordNotificationBlocking } from '../shared/discordNotifications.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
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
    const pathSegments = url.pathname.split('/').filter(Boolean)
    
    const method = req.method

    // Route handling - check special routes first
    // GET /announcements/unread-count - Get unread count (check before ID parsing)
    if (method === 'GET' && pathSegments[1] === 'unread-count') {
      return await handleGetUnreadCount(supabase, url)
    }

    // Extract ID from path if present
    const announcementId = pathSegments[1] ? parseInt(pathSegments[1]) : null
    const action = pathSegments[2] // 'view', 'read', 'publish', 'archive'

    // Route handling
    if (method === 'GET' && !announcementId) {
      // GET /announcements - List announcements
      return await handleListAnnouncements(supabase, url)
    }
    
    if (method === 'GET' && announcementId && !action) {
      // GET /announcements/:id - Get single announcement
      return await handleGetAnnouncement(supabase, announcementId, url)
    }
    
    if (method === 'POST' && !announcementId) {
      // POST /announcements - Create announcement (admin only)
      return await handleCreateAnnouncement(supabase, req)
    }
    
    if (method === 'POST' && announcementId && action === 'view') {
      // POST /announcements/:id/view - Mark as viewed
      return await handleMarkViewed(supabase, announcementId, req)
    }
    
    if (method === 'POST' && announcementId && action === 'read') {
      // POST /announcements/:id/read - Mark as read
      return await handleMarkRead(supabase, announcementId, req)
    }
    
    if (method === 'POST' && announcementId && action === 'publish') {
      // POST /announcements/:id/publish - Publish draft (admin only)
      return await handlePublishAnnouncement(supabase, announcementId, req)
    }
    
    if (method === 'POST' && announcementId && action === 'archive') {
      // POST /announcements/:id/archive - Archive announcement (admin only)
      return await handleArchiveAnnouncement(supabase, announcementId, req)
    }
    
    if (method === 'PATCH' && announcementId) {
      // PATCH /announcements/:id - Update announcement (admin only)
      return await handleUpdateAnnouncement(supabase, announcementId, req)
    }
    
    if (method === 'DELETE' && announcementId) {
      // DELETE /announcements/:id - Delete announcement (admin only)
      return await handleDeleteAnnouncement(supabase, announcementId, req)
    }

    return new Response(
      JSON.stringify({ error: 'Endpoint not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Announcements API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ====================================
// ADMIN VERIFICATION
// ====================================

async function verifyAdmin(supabase: any, req: Request) {
  const body = await req.clone().json().catch(() => ({}))
  const { client_type, access_token } = body

  if (!client_type || !access_token) {
    return { valid: false, error: 'client_type and access_token are required for admin actions' }
  }

  // Verify the client token
  const verifiedUser = await verifyClientToken(client_type, access_token)
  if (!verifiedUser) {
    return { valid: false, error: 'Invalid or expired access token' }
  }

  const userId = verifiedUser.provider_user_id

  // Check if user is owner or super_admin
  const { data: owners } = await supabase
    .from('config')
    .select('value')
    .eq('key', 'owner_users')
    .single()

  const { data: superAdmins } = await supabase
    .from('config')
    .select('value')
    .eq('key', 'super_admin_users')
    .single()

  const ownerList = owners ? JSON.parse(owners.value) : []
  const superAdminList = superAdmins ? JSON.parse(superAdmins.value) : []

  if (!ownerList.includes(userId) && !superAdminList.includes(userId)) {
    return { valid: false, error: 'Owner or Super Admin access required' }
  }

  const role = ownerList.includes(userId) ? 'owner' : 'super_admin'

  return { valid: true, userId, role, username: verifiedUser.username }
}

// ====================================
// PUBLIC ENDPOINTS
// ====================================

async function handleListAnnouncements(supabase: any, url: URL) {
  const appId = url.searchParams.get('app_id')
  const status = url.searchParams.get('status') || 'published'
  const category = url.searchParams.get('category')
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
  const userId = url.searchParams.get('user_id')
  const includeRead = url.searchParams.get('include_read') === 'true'

  if (!appId) {
    return new Response(
      JSON.stringify({ error: 'app_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const validAppIds = ['anymex', 'shonenx', 'animestream']
  if (!validAppIds.includes(appId)) {
    return new Response(
      JSON.stringify({ error: 'Invalid app_id. Must be one of: anymex, shonenx, animestream' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Build query
  let query = supabase
    .from('announcements')
    .select('id, title, short_description, category, pinned, featured, priority, published_at, author_name, view_count, expires_at', { count: 'exact' })
    .eq('app_id', appId)
    .eq('status', status)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

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

  // Get read status if requested
  let readStatus: Record<number, boolean> = {}
  if (includeRead && userId) {
    const { data: reads } = await supabase
      .from('announcement_reads')
      .select('announcement_id')
      .eq('user_id', userId)
      .eq('app_id', appId)
    
    reads?.forEach((r: any) => {
      readStatus[r.announcement_id] = true
    })
  }

  // Get unread count
  let unreadCount = 0
  if (userId) {
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

    unreadCount = (totalPublished || 0) - (readCount || 0)
  }

  // Add is_read to each announcement
  const announcementsWithReadStatus = announcements?.map((a: any) => ({
    ...a,
    is_read: readStatus[a.id] || false
  }))

  return new Response(
    JSON.stringify({
      success: true,
      announcements: announcementsWithReadStatus,
      pagination: {
        page,
        limit,
        total: count,
        total_pages: Math.ceil((count || 0) / limit)
      },
      unread_count: Math.max(0, unreadCount)
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleGetAnnouncement(supabase: any, announcementId: number, url: URL) {
  const { data: announcement, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', announcementId)
    .single()

  if (error || !announcement) {
    return new Response(
      JSON.stringify({ error: 'Announcement not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
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

  return new Response(
    JSON.stringify({
      success: true,
      announcement: {
        ...announcement,
        view_count: (announcement.view_count || 0) + 1,
        is_read: isRead
      }
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleMarkViewed(supabase: any, announcementId: number, req: Request) {
  const body = await req.json()
  const { user_id, app_id } = body

  if (!app_id) {
    return new Response(
      JSON.stringify({ error: 'app_id is required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check announcement exists
  const { data: announcement } = await supabase
    .from('announcements')
    .select('id')
    .eq('id', announcementId)
    .single()

  if (!announcement) {
    return new Response(
      JSON.stringify({ error: 'Announcement not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Record view
  await supabase
    .from('announcement_views')
    .insert({
      announcement_id: announcementId,
      user_id: user_id || null,
      app_id
    })

  return new Response(
    JSON.stringify({ success: true, message: 'View recorded' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleMarkRead(supabase: any, announcementId: number, req: Request) {
  const body = await req.json()
  const { user_id, app_id } = body

  if (!user_id || !app_id) {
    return new Response(
      JSON.stringify({ error: 'user_id and app_id are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check announcement exists
  const { data: announcement } = await supabase
    .from('announcements')
    .select('id')
    .eq('id', announcementId)
    .single()

  if (!announcement) {
    return new Response(
      JSON.stringify({ error: 'Announcement not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Mark as read (upsert to handle duplicates)
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

  return new Response(
    JSON.stringify({ success: true, message: 'Marked as read' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleGetUnreadCount(supabase: any, url: URL) {
  const userId = url.searchParams.get('user_id')
  const appId = url.searchParams.get('app_id')

  if (!userId || !appId) {
    return new Response(
      JSON.stringify({ error: 'user_id and app_id are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get total published count
  const { count: totalPublished } = await supabase
    .from('announcements')
    .select('*', { count: 'exact', head: true })
    .eq('app_id', appId)
    .eq('status', 'published')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

  // Get read count
  const { count: readCount } = await supabase
    .from('announcement_reads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('app_id', appId)

  const unreadCount = Math.max(0, (totalPublished || 0) - (readCount || 0))

  return new Response(
    JSON.stringify({
      success: true,
      total_published: totalPublished || 0,
      read_count: readCount || 0,
      unread_count: unreadCount
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// ====================================
// ADMIN ENDPOINTS
// ====================================

async function handleCreateAnnouncement(supabase: any, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  
  if (!adminCheck.valid) {
    return new Response(
      JSON.stringify({ error: adminCheck.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
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
    publish = false // Auto-publish if true
  } = body

  // Validation
  if (!app_id || !title || !short_description || !full_content) {
    return new Response(
      JSON.stringify({ error: 'app_id, title, short_description, and full_content are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const validAppIds = ['anymex', 'shonenx', 'animestream']
  if (!validAppIds.includes(app_id)) {
    return new Response(
      JSON.stringify({ error: 'Invalid app_id. Must be one of: anymex, shonenx, animestream' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (title.length > 200) {
    return new Response(
      JSON.stringify({ error: 'Title must be 200 characters or less' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (short_description.length > 500) {
    return new Response(
      JSON.stringify({ error: 'Short description must be 500 characters or less' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Create announcement
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
    author_name: adminCheck.username || 'Dev Team',
    status: publish ? 'published' : 'draft',
    published_at: publish ? new Date().toISOString() : null
  }

  const { data: announcement, error } = await supabase
    .from('announcements')
    .insert(insertData)
    .select()
    .single()

  if (error) throw error

  // Send Discord notification if published
  if (publish) {
    await sendDiscordNotificationBlocking(supabase, {
      type: 'announcement_published' as any,
      comment: {
        id: announcement.id,
        content: full_content, // Pass full content for Discord
        client_type: app_id
      },
      moderator: {
        id: adminCheck.userId,
        username: announcement.author_name
      },
      reason: title
    })
  }

  return new Response(
    JSON.stringify({
      success: true,
      announcement,
      message: publish ? 'Announcement published successfully' : 'Announcement created as draft'
    }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleUpdateAnnouncement(supabase: any, announcementId: number, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  
  if (!adminCheck.valid) {
    return new Response(
      JSON.stringify({ error: adminCheck.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check if exists
  const { data: existing } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', announcementId)
    .single()

  if (!existing) {
    return new Response(
      JSON.stringify({ error: 'Announcement not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
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

  // Validate title length if provided
  if (body.title && body.title.length > 200) {
    return new Response(
      JSON.stringify({ error: 'Title must be 200 characters or less' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Validate short_description length if provided
  if (body.short_description && body.short_description.length > 500) {
    return new Response(
      JSON.stringify({ error: 'Short description must be 500 characters or less' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: announcement, error } = await supabase
    .from('announcements')
    .update(updateData)
    .eq('id', announcementId)
    .select()
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({ success: true, announcement }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleDeleteAnnouncement(supabase: any, announcementId: number, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  
  if (!adminCheck.valid) {
    return new Response(
      JSON.stringify({ error: adminCheck.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', announcementId)

  if (error) throw error

  return new Response(
    JSON.stringify({ success: true, message: 'Announcement deleted' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handlePublishAnnouncement(supabase: any, announcementId: number, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  
  if (!adminCheck.valid) {
    return new Response(
      JSON.stringify({ error: adminCheck.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check if exists
  const { data: existing } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', announcementId)
    .single()

  if (!existing) {
    return new Response(
      JSON.stringify({ error: 'Announcement not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (existing.status === 'published') {
    return new Response(
      JSON.stringify({ error: 'Announcement is already published' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
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

  // Send Discord notification
  await sendDiscordNotificationBlocking(supabase, {
    type: 'announcement_published' as any,
    comment: {
      id: announcement.id,
      content: announcement.full_content, // Pass full content for Discord
      client_type: announcement.app_id
    },
    moderator: {
      id: adminCheck.userId,
      username: announcement.author_name
    },
    reason: announcement.title
  })

  return new Response(
    JSON.stringify({ success: true, announcement, message: 'Announcement published' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleArchiveAnnouncement(supabase: any, announcementId: number, req: Request) {
  const adminCheck = await verifyAdmin(supabase, req)
  
  if (!adminCheck.valid) {
    return new Response(
      JSON.stringify({ error: adminCheck.error }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
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
      return new Response(
        JSON.stringify({ error: 'Announcement not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    throw error
  }

  return new Response(
    JSON.stringify({ success: true, announcement, message: 'Announcement archived' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
