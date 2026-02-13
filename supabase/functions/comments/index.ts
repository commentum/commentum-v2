import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { validateUserInfo, validateMediaInfo, UserInfo, MediaInfo } from '../shared/clientAPIs.ts'
import { verifyAdminAccess, getUserRole, getDisplayRole } from '../shared/auth.ts'
import { verifyClientToken } from '../shared/clientAuth.ts'
import { queueDiscordNotification } from '../shared/discordNotifications.ts'

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

    const { action, client_type, content, comment_id, parent_id, token, tag, user_info, media_info, access_token } = await req.json()

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
        // Original delete - for own comments only, uses user_info
        if (!comment_id || !user_info) {
          return new Response(
            JSON.stringify({ error: 'comment_id and user_info are required for delete action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break

      case 'mod_delete':
        // Mod delete - for deleting other users' comments, requires token auth
        if (!comment_id || !client_type || !access_token) {
          return new Response(
            JSON.stringify({ error: 'comment_id, client_type, and access_token are required for mod_delete action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        break
        
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Must be create, edit, delete, or mod_delete' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    if (comment_id && (!Number.isInteger(comment_id) || comment_id <= 0)) {
      return new Response(
        JSON.stringify({ error: 'comment_id must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (parent_id && (!Number.isInteger(parent_id) || parent_id <= 0)) {
      return new Response(
        JSON.stringify({ error: 'parent_id must be a positive integer' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (content && (content.length < 1 || content.length > 10000)) {
      return new Response(
        JSON.stringify({ error: 'Content must be between 1 and 10000 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (tag !== undefined) {
      if (typeof tag !== 'string' && typeof tag !== 'number') {
        return new Response(
          JSON.stringify({ error: 'Tag must be a string or number (episode identifier)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      if (typeof tag === 'number' && tag < 0) {
        return new Response(
          JSON.stringify({ error: 'Tag number must be non-negative' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      if (typeof tag === 'string' && tag.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: 'Tag string cannot be empty' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

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

    let userInfo: UserInfo | null = null
    let mediaInfo: MediaInfo | null = null
    let verifiedUserFromToken = null
    
    if (action === 'create') {
      if (!validateUserInfo(user_info)) {
        return new Response(
          JSON.stringify({ error: 'Invalid user_info format. Required: user_id, username (1-50 chars), optional: avatar' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userInfo = user_info

      if (!validateMediaInfo(media_info)) {
        return new Response(
          JSON.stringify({ error: 'Invalid media_info format. Required: media_id, type (any string), title (1-200 chars), optional: year, poster' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      mediaInfo = media_info
    } else if (action === 'edit' || action === 'delete') {
      if (!validateUserInfo(user_info)) {
        return new Response(
          JSON.stringify({ error: 'Invalid user_info format. Required: user_id, username (1-50 chars), optional: avatar' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userInfo = user_info
    } else if (action === 'mod_delete') {
      // Verify token for mod_delete
      verifiedUserFromToken = await verifyClientToken(client_type, access_token)
      if (!verifiedUserFromToken) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired access token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userInfo = {
        user_id: verifiedUserFromToken.provider_user_id,
        username: verifiedUserFromToken.username,
        avatar: verifiedUserFromToken.avatar_url
      }
    }

    const user_id = userInfo?.user_id
    const media_id = mediaInfo?.media_id

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

    let userRole = 'user'
    if (action === 'delete') {
      // Original delete - check if user owns the comment
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

      if (comment.user_id !== user_id) {
        return new Response(
          JSON.stringify({ error: 'You can only delete your own comments. Use mod_delete for moderation.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userRole = await getUserRole(supabase, user_id)
    } else if (action === 'mod_delete') {
      // Mod delete - verify admin access
      const adminVerification = await verifyAdminAccess(supabase, user_id)
      if (!adminVerification.valid) {
        return new Response(
          JSON.stringify({ error: adminVerification.reason || 'Insufficient permissions' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      userRole = adminVerification.role
    } else {
      userRole = await getUserRole(supabase, user_id)
    }

    // Check user restrictions from commentum_users table
    if (action === 'create') {
      const { data: userStatus } = await supabase
        .from('commentum_users')
        .select('commentum_user_banned, commentum_user_muted_until, commentum_user_shadow_banned, commentum_user_warnings')
        .eq('commentum_client_type', client_type)
        .eq('commentum_user_id', user_id)
        .single()

      if (userStatus?.commentum_user_banned) {
        return new Response(
          JSON.stringify({ error: 'User is banned' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (userStatus?.commentum_user_muted && new Date(userStatus.commentum_user_muted_until) > new Date()) {
        return new Response(
          JSON.stringify({ error: 'User is muted' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
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

      case 'mod_delete':
        return await handleModDeleteComment(supabase, {
          comment_id,
          user_id,
          userRole,
          req,
          verifiedUserFromToken
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
      user_role: getDisplayRole(userRole), // Store as super_admin to hide owner role
      media_type: mediaInfo.type,
      media_title: mediaInfo.title,
      media_year: mediaInfo.year,
      media_poster: mediaInfo.poster,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
      user_agent: req.headers.get('user-agent')
    })
    .select(`
      id, client_type, user_id, media_id, content, username, user_avatar, user_role,
      media_type, media_title, media_year, media_poster, parent_id, created_at, updated_at,
      deleted, pinned, locked, edited, edit_count, upvotes, downvotes, vote_score,
      user_banned, user_shadow_banned, user_warnings, reported, report_count, tags
    `)
    .single()

  if (error) throw error

  // Queue Discord notification in background - NON-BLOCKING
  queueDiscordNotification({
    type: 'comment_created',
    comment: {
      id: comment.id,
      username: comment.username,
      user_id: comment.user_id,
      content: comment.content,
      client_type: comment.client_type,
      media_id: comment.media_id,
      media_type: comment.media_type,
      parent_id: comment.parent_id
    },
    user: userInfo,
    media: {
      id: mediaInfo.media_id,
      title: mediaInfo.title,
      year: mediaInfo.year,
      poster: mediaInfo.poster,
      type: mediaInfo.type,
      client_type: comment.client_type
    }
  })

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

  if (comment.user_id !== user_id) {
    return new Response(
      JSON.stringify({ error: 'You can only edit your own comments' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

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

  // Queue Discord notification in background - NON-BLOCKING
  queueDiscordNotification({
    type: 'comment_updated',
    comment: {
      id: updatedComment.id,
      username: updatedComment.username,
      user_id: updatedComment.user_id,
      content: updatedComment.content,
      client_type: updatedComment.client_type,
      media_id: updatedComment.media_id,
      media_type: updatedComment.media_type
    },
    user: {
      id: updatedComment.user_id,
      username: updatedComment.username,
      avatar: updatedComment.user_avatar
    },
    media: {
      id: updatedComment.media_id,
      title: updatedComment.media_title,
      type: updatedComment.media_type,
      year: updatedComment.media_year,
      poster: updatedComment.media_poster,
      client_type: updatedComment.client_type
    }
  })

  return new Response(
    JSON.stringify({ success: true, comment: updatedComment }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Original delete - for own comments only
async function handleDeleteComment(supabase: any, params: any) {
  const { comment_id, user_id, userRole, req } = params

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

  if (comment.user_id !== user_id) {
    return new Response(
      JSON.stringify({ error: 'You can only delete your own comments. Use mod_delete for moderation.' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

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

  // Queue Discord notification in background - NON-BLOCKING
  queueDiscordNotification({
    type: 'comment_deleted',
    comment: {
      id: deletedComment.id,
      username: deletedComment.username,
      user_id: deletedComment.user_id,
      content: comment.content,
      client_type: deletedComment.client_type,
      media_id: deletedComment.media_id,
      media_type: deletedComment.media_type
    },
    moderator: null,
    user: {
      id: deletedComment.user_id,
      username: deletedComment.username,
      avatar: deletedComment.user_avatar
    },
    media: {
      id: deletedComment.media_id,
      title: deletedComment.media_title,
      type: deletedComment.media_type,
      year: deletedComment.media_year,
      poster: deletedComment.media_poster,
      client_type: deletedComment.client_type
    }
  })

  return new Response(
    JSON.stringify({ success: true, comment: deletedComment }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Mod delete - for moderators to delete other users' comments
async function handleModDeleteComment(supabase: any, params: any) {
  const { comment_id, user_id, userRole, req, verifiedUserFromToken } = params

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

  const { data: deletedComment, error } = await supabase
    .from('comments')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: user_id,
      moderated: true,
      moderated_at: new Date().toISOString(),
      moderated_by: user_id,
      moderation_action: 'mod_delete'
    })
    .eq('id', comment_id)
    .select()
    .single()

  if (error) throw error

  // Queue Discord notification in background - NON-BLOCKING
  queueDiscordNotification({
    type: 'comment_deleted',
    comment: {
      id: deletedComment.id,
      username: deletedComment.username,
      user_id: deletedComment.user_id,
      content: comment.content,
      client_type: deletedComment.client_type,
      media_id: deletedComment.media_id,
      media_type: deletedComment.media_type
    },
    moderator: {
      id: user_id,
      username: verifiedUserFromToken?.username || `Moderator ${user_id}`
    },
    user: {
      id: deletedComment.user_id,
      username: deletedComment.username,
      avatar: deletedComment.user_avatar
    },
    media: {
      id: deletedComment.media_id,
      title: deletedComment.media_title,
      type: deletedComment.media_type,
      year: deletedComment.media_year,
      poster: deletedComment.media_poster,
      client_type: deletedComment.client_type
    }
  })

  return new Response(
    JSON.stringify({ 
      success: true, 
      comment: deletedComment,
      moderator: {
        id: user_id,
        username: verifiedUserFromToken?.username,
        role: userRole
      }
    }),
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
