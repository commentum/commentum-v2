import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { validateUserInfo, validateMediaInfo, UserInfo, MediaInfo } from '../shared/clientAPIs.ts'
import { verifyAdminAccess, getUserRole, canModerate } from '../shared/auth.ts'
import { sendDiscordNotification } from '../shared/discordNotifications.ts'

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

    const { action, client_type, content, comment_id, parent_id, token, tag, user_info, media_info } = await req.json()

    // Validate action-specific required fields
    switch (action) {
      case 'create':
        if (!client_type || !content || !user_info || !media_info) {
          return new Response(
            JSON.stringify({ error: 'client_type, content, user_info, and media_info are required for create action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break
        
      case 'edit':
        if (!comment_id || !user_info || !content) {
          return new Response(
            JSON.stringify({ error: 'comment_id, user_info, and content are required for edit action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break
        
      case 'delete':
        if (!comment_id || !user_info) {
          return new Response(
            JSON.stringify({ error: 'comment_id and user_info are required for delete action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break
        
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Must be create, edit, or delete' }),
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

    // Validate content length only if content is provided
    if (content && (content.length < 1 || content.length > 10000)) {
      return new Response(
        JSON.stringify({ error: 'Content must be between 1 and 10000 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate tag (episode identifier) if provided
    if (tag !== undefined) {
      // Tag can be string or number (episode identifier)
      if (typeof tag !== 'string' && typeof tag !== 'number') {
        return new Response(
          JSON.stringify({ error: 'Tag must be a string or number (episode identifier)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      // If number, ensure it's non-negative
      if (typeof tag === 'number' && tag < 0) {
        return new Response(
          JSON.stringify({ error: 'Tag number must be non-negative' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      // If string, ensure it's not empty
      if (typeof tag === 'string' && tag.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: 'Tag string cannot be empty' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
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

    // Extract user_id and media_id from info objects
    const user_id = user_info?.user_id
    const media_id = media_info?.media_id

    // Validate extracted IDs
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_info.user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'create' && !media_id) {
      return new Response(
        JSON.stringify({ error: 'media_info.media_id is required for create action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // For delete action, check if user owns the comment first
    let userRole = 'user'
    if (action === 'delete') {
      // First check if comment exists and get ownership info
      const { data: comment } = await supabase
        .from('comments')
        .select('user_id, user_role, client_type')
        .eq('id', comment_id)
        .single()

      if (!comment) {
        return new Response(
          JSON.stringify({ error: 'Comment not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // If user owns the comment, no admin check needed
      if (comment.user_id === user_id) {
        userRole = await getUserRole(supabase, user_id)
      } else {
        // User is trying to delete someone else's comment - check admin permissions
        const adminVerification = await verifyAdminAccess(supabase, user_id)
        if (!adminVerification.valid) {
          return new Response(
            JSON.stringify({ error: adminVerification.reason || 'Insufficient permissions' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        userRole = adminVerification.role
      }
    } else {
      // For regular actions (create, edit), just get user role without token verification
      userRole = await getUserRole(supabase, user_id)
    }

    // Validate user and media information only for create action
    let userInfo: UserInfo | null = null
    let mediaInfo: MediaInfo | null = null
    
    if (action === 'create') {
      // Validate user info provided by frontend
      if (!validateUserInfo(user_info)) {
        return new Response(
          JSON.stringify({ error: 'Invalid user_info format. Required: user_id, username (1-50 chars), optional: avatar' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userInfo = user_info

      // Validate media info provided by frontend
      if (!validateMediaInfo(media_info)) {
        return new Response(
          JSON.stringify({ error: 'Invalid media_info format. Required: media_id, type (any string), title (1-200 chars), optional: year, poster' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      mediaInfo = media_info
    } else if (action === 'edit' || action === 'delete') {
      // For edit and delete, just validate user_info structure
      if (!validateUserInfo(user_info)) {
        return new Response(
          JSON.stringify({ error: 'Invalid user_info format. Required: user_id, username (1-50 chars), optional: avatar' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userInfo = user_info
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
          tag,
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
  const { client_type, user_id, media_id, content, parent_id, tag, userInfo, mediaInfo, userRole, req } = params

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
      user_id: userInfo.user_id,
      media_id: mediaInfo.media_id,
      content,
      parent_id,
      tags: tag !== undefined ? JSON.stringify([tag]) : null,
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

  // Send Discord notification for new comment
  try {
    await sendDiscordNotification(supabase, {
      type: 'comment_created',
      comment: {
        id: comment.id,
        username: comment.username,
        user_id: comment.user_id,
        content: comment.content,
        client_type: comment.client_type,
        media_id: comment.media_id,
        parent_id: comment.parent_id
      },
      user: userInfo,
      media: {
        id: mediaInfo.media_id,
        title: mediaInfo.title,
        year: mediaInfo.year,
        poster: mediaInfo.poster
      }
    })
  } catch (notificationError) {
    console.error('Failed to send Discord notification:', notificationError)
    // Don't fail the request if notification fails
  }

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

  // Send Discord notification for edited comment
  try {
    await sendDiscordNotification(supabase, {
      type: 'comment_updated',
      comment: {
        id: updatedComment.id,
        username: updatedComment.username,
        user_id: updatedComment.user_id,
        content: updatedComment.content,
        client_type: updatedComment.client_type,
        media_id: updatedComment.media_id
      }
    })
  } catch (notificationError) {
    console.error('Failed to send Discord notification:', notificationError)
    // Don't fail the request if notification fails
  }

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
    const isAdmin = userRole === 'admin' || userRole === 'super_admin' || userRole === 'owner'
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Only admins and super admins can delete other users comments' }),
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

  // Send Discord notification for deleted comment
  try {
    const moderator = comment.user_id !== user_id ? {
      username: user_id,
      id: user_id
    } : null

    await sendDiscordNotification(supabase, {
      type: 'comment_deleted',
      comment: {
        id: deletedComment.id,
        username: deletedComment.username,
        user_id: deletedComment.user_id,
        content: comment.content, // Original content before deletion
        client_type: deletedComment.client_type,
        media_id: deletedComment.media_id
      },
      moderator
    })
  } catch (notificationError) {
    console.error('Failed to send Discord notification:', notificationError)
    // Don't fail the request if notification fails
  }

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