import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchUserInfo, fetchMediaInfo } from '../shared/clientAPIs.ts'
import { verifyAdminAccess, getUserRole, canModerate } from '../shared/auth.ts'
import { validateActionPermission } from '../shared/permissions.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
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

    const { action, client_type, user_id, media_id, content, comment_id, parent_id, token } = await req.json()

    // Validate required fields
    if (!client_type || !user_id || !media_id || !content) {
      return new Response(
        JSON.stringify({ error: 'client_type, user_id, media_id, and content are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate comment_id if provided (must be integer)
    if (comment_id && (!Number.isInteger(comment_id) || comment_id <= 0)) {
      return new Response(
        JSON.stringify({ error: 'comment_id must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate parent_id if provided (must be integer)
    if (parent_id && (!Number.isInteger(parent_id) || parent_id <= 0)) {
      return new Response(
        JSON.stringify({ error: 'parent_id must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate content length
    if (content.length < 1 || content.length > 10000) {
      return new Response(
        JSON.stringify({ error: 'Content must be between 1 and 10000 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if system is enabled
    const { data: systemConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'system_enabled')
      .single()

    if (systemConfig && JSON.parse(systemConfig.value) === false) {
      return new Response(
        JSON.stringify({ error: 'Comment system is disabled' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

      // For delete action, check if user owns the comment first
    let userRole = 'user'
    if (action === 'delete') {
      // First check if comment exists and get ownership info
      const { data: comment } = await supabase
        .from('comments')
        .select('user_id, user_role')
        .eq('id', comment_id)
        .single()

      if (!comment) {
        return new Response(
          JSON.stringify({ error: 'Comment not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // If user owns the comment, no token needed
      if (comment.user_id === user_id) {
        userRole = await getUserRole(supabase, user_id)
      } else {
        // User is trying to delete someone else's comment - require token
        if (!token) {
          return new Response(
            JSON.stringify({ error: 'Token required to delete other users comments' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const tokenVerification = await verifyAdminAccess(supabase, client_type, user_id, token)
        if (!tokenVerification.valid) {
          return new Response(
            JSON.stringify({ error: tokenVerification.reason || 'Authentication failed' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        userRole = tokenVerification.role
      }
    } else {
      // For regular actions (create, edit), just get user role without token verification
      userRole = await getUserRole(supabase, user_id)
    }

    // Fetch user and media information
    const [userInfo, mediaInfo] = await Promise.all([
      fetchUserInfo(client_type, user_id),
      fetchMediaInfo(client_type, media_id)
    ])

    if (!userInfo) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch user information' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!mediaInfo) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch media information' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check user status
    const { data: existingUserComments } = await supabase
      .from('comments')
      .select('user_banned, user_muted_until, user_shadow_banned, user_warnings')
      .eq('user_id', user_id)
      .eq('client_type', client_type)
      .single()

    if (existingUserComments?.user_banned) {
      return new Response(
        JSON.stringify({ error: 'User is banned' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (existingUserComments?.user_muted_until && new Date(existingUserComments.user_muted_until) > new Date()) {
      return new Response(
        JSON.stringify({ error: 'User is muted' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    switch (action) {
      case 'create':
        return await handleCreateComment(supabase, {
          client_type,
          user_id,
          media_id,
          content,
          parent_id,
          userInfo,
          mediaInfo,
          userRole,
          req
        })

      case 'edit':
        return await handleEditComment(supabase, {
          comment_id,
          user_id,
          content,
          userRole,
          req
        })

      case 'delete':
        return await handleDeleteComment(supabase, {
          comment_id,
          user_id,
          userRole,
          req
        })

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Comments API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function handleCreateComment(supabase: any, params: any) {
  const { client_type, user_id, media_id, content, parent_id, userInfo, mediaInfo, userRole, req } = params

  // Validate nesting level if parent_id is provided
  if (parent_id) {
    const { data: parentComment } = await supabase
      .from('comments')
      .select('locked, media_id, media_type')
      .eq('id', parent_id)
      .single()

    if (!parentComment) {
      return new Response(
        JSON.stringify({ error: 'Parent comment not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (parentComment.locked) {
      return new Response(
        JSON.stringify({ error: 'Comment thread is locked' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check nesting level
    const nestingLevel = await getNestingLevel(supabase, parent_id)
    const { data: maxNestingConfig } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'max_nesting_level')
      .single()

    const maxNesting = maxNestingConfig ? parseInt(JSON.parse(maxNestingConfig.value)) : 10
    if (nestingLevel >= maxNesting) {
      return new Response(
        JSON.stringify({ error: 'Maximum nesting level exceeded' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  // Check for banned keywords
  const { data: bannedKeywordsConfig } = await supabase
    .from('config')
    .select('value')
    .eq('key', 'banned_keywords')
    .single()

  const bannedKeywords = bannedKeywordsConfig ? JSON.parse(bannedKeywordsConfig.value) : []
  const hasBannedKeyword = bannedKeywords.some((keyword: string) => 
    content.toLowerCase().includes(keyword.toLowerCase())
  )

  if (hasBannedKeyword) {
    return new Response(
      JSON.stringify({ error: 'Comment contains prohibited content' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Create comment (ID will be auto-generated as integer)
  const { data: comment, error } = await supabase
    .from('comments')
    .insert({
      client_type,
      user_id,
      media_id,
      content,
      parent_id,
      username: userInfo.username,
      user_avatar: userInfo.avatar,
      user_role: userRole,
      media_type: mediaInfo.type,
      media_title: mediaInfo.title,
      media_year: mediaInfo.year,
      media_poster: mediaInfo.poster,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
      user_agent: req.headers.get('user-agent')
    })
    .select()
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({ success: true, comment }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleEditComment(supabase: any, params: any) {
  const { comment_id, user_id, content, userRole, req } = params

  const { data: comment } = await supabase
    .from('comments')
    .select('*')
    .eq('id', comment_id)
    .single()

  if (!comment) {
    return new Response(
      JSON.stringify({ error: 'Comment not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (comment.deleted) {
    return new Response(
      JSON.stringify({ error: 'Cannot edit deleted comment' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (comment.locked) {
    return new Response(
      JSON.stringify({ error: 'Comment thread is locked' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check permissions - ONLY users can edit their own comments
  if (comment.user_id !== user_id) {
    return new Response(
      JSON.stringify({ error: 'You can only edit your own comments' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Additional permission validation using the new system
  const permissionCheck = validateActionPermission(userRole, 'edit', comment.user_id, comment.user_role)
  if (!permissionCheck.valid) {
    return new Response(
      JSON.stringify({ error: permissionCheck.reason || 'Permission denied' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Update comment with edit history
  const editHistory = comment.edit_history ? JSON.parse(comment.edit_history) : []
  editHistory.push({
    oldContent: comment.content,
    newContent: content,
    editedAt: new Date().toISOString(),
    editedBy: user_id
  })

  const { data: updatedComment, error } = await supabase
    .from('comments')
    .update({
      content,
      edited: true,
      edited_at: new Date().toISOString(),
      edit_count: comment.edit_count + 1,
      edit_history: JSON.stringify(editHistory)
    })
    .eq('id', comment_id)
    .select()
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({ success: true, comment: updatedComment }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function handleDeleteComment(supabase: any, params: any) {
  const { comment_id, user_id, userRole, req } = params

  // Get full comment data for validation
  const { data: comment } = await supabase
    .from('comments')
    .select('*')
    .eq('id', comment_id)
    .single()

  if (!comment) {
    return new Response(
      JSON.stringify({ error: 'Comment not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (comment.deleted) {
    return new Response(
      JSON.stringify({ error: 'Comment already deleted' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check permissions - user can delete own comment, only admins and super admins can delete others
  if (comment.user_id !== user_id) {
    const permissionCheck = validateActionPermission(userRole, 'delete_others', comment.user_id, comment.user_role)
    if (!permissionCheck.valid) {
      return new Response(
        JSON.stringify({ error: permissionCheck.reason || 'Only admins and super admins can delete other users comments' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  // Soft delete
  const { data: deletedComment, error } = await supabase
    .from('comments')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: user_id
    })
    .eq('id', comment_id)
    .select()
    .single()

  if (error) throw error

  return new Response(
    JSON.stringify({ success: true, comment: deletedComment }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getNestingLevel(supabase: any, parentId: number) {
  let level = 0
  let currentId = parentId

  while (currentId && level < 10) {
    const { data: parent } = await supabase
      .from('comments')
      .select('parent_id')
      .eq('id', currentId)
      .single()

    if (!parent || !parent.parent_id) break
    currentId = parent.parent_id
    level++
  }

  return level
}