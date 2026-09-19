import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'
import { getLanguageName } from '../shared/translate.ts'
import { resolveUserBadges } from '../shared/badges.ts'

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

    const url = new URL(req.url)
    const media_id = url.searchParams.get('media_id')
    const client_type = url.searchParams.get('client_type')
    const pageParam = url.searchParams.get('page')
    const limitParam = url.searchParams.get('limit')
    const page = pageParam ? parseInt(pageParam) : null
    const limit = limitParam ? parseInt(limitParam) : null
    const sort = url.searchParams.get('sort') || 'newest'

    // Validate required parameters
    if (!media_id || !client_type) {
      return new Response(
        JSON.stringify({ error: 'media_id and client_type are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ====================================
    // Cross-client merge (media_id_map)
    // The same show lives under different ids per client (anilist 21 =
    // mal 21 = simkl 38636 for One Piece). If a mapping exists, match
    // comments from ALL equivalent (client_type, media_id) pairs so
    // everyone sees one shared thread. Read-time merge only — comments
    // are still stored per-client and unmapped media behaves exactly
    // as before. ?merge=false restores the old single-client read.
    // ====================================
    const SAFE_OR_ID = /^[A-Za-z0-9_.-]+$/ // PostgREST .or() value safety
    let mediaFilter: { client_type: string; media_id: string }[] = [
      { client_type, media_id },
    ]
    let merged = false
    if (url.searchParams.get('merge') !== 'false') {
      try {
        const { data: selfMap } = await supabase
          .from('media_id_map')
          .select('map_key')
          .eq('client_type', client_type)
          .eq('media_id', media_id)
          .maybeSingle()
        if (selfMap?.map_key) {
          const { data: equivs } = await supabase
            .from('media_id_map')
            .select('client_type, media_id')
            .eq('map_key', selfMap.map_key)
          const resolved = (equivs || [])
            .map((e: any) => ({ client_type: String(e.client_type), media_id: String(e.media_id) }))
            .filter((e: any) => SAFE_OR_ID.test(e.client_type) && SAFE_OR_ID.test(e.media_id))
          if (resolved.length > 1) {
            mediaFilter = resolved
            merged = true
          }
        }
      } catch (_) {
        // Mapping lookup failed — fall back to single-client behavior
      }
    }

    const applyMediaFilter = (q: any) =>
      merged
        ? q.or(
            mediaFilter
              .map((p) => `and(client_type.eq.${p.client_type},media_id.eq.${p.media_id})`)
              .join(',')
          )
        : q.eq('media_id', media_id).eq('client_type', client_type)

    // Build order by
    let orderBy = { created_at: 'desc' }
    switch (sort) {
      case 'oldest':
        orderBy = { created_at: 'asc' }
        break
      case 'top':
        orderBy = { vote_score: 'desc' }
        break
      case 'controversial':
        orderBy = { upvotes: 'desc' }
        break
    }

    // Get comments for this media
    // Include deleted comments (soft-deleted) so replies to deleted parents are preserved
    // Reddit-style: deleted comments show as "[deleted]" with no content
    // Note: We do NOT filter out banned users' comments — banned status doesn't hide their existing comments
    let commentsQuery = applyMediaFilter(
      supabase
        .from('comments')
        .select('*')
    )
      // Pinned comments always come first (newest pin first), then the
      // requested sort. Every client already floats pinned comments to the
      // top client-side, so this puts pins on page 1 for everyone without
      // any frontend change. Response shape/totals are unchanged.
      .order('pinned', { ascending: false })
      .order('pinned_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: sort === 'oldest' })

    // Only paginate if the caller explicitly asked for page/limit.
    // Omitting both returns everything (capped by Supabase's db-max-rows setting).
    const noPagination = page === null || limit === null

    if (!noPagination) {
      const offset = (page! - 1) * limit!
      commentsQuery = commentsQuery.range(offset, offset + limit! - 1)
    }

    const { data: comments, error } = await commentsQuery

    if (error) throw error

    // Get user points + customizations for all unique users in this page.
    // With cross-client merge a page can contain users from DIFFERENT
    // clients, and the batch RPCs are per-client — so group the ids by
    // each comment's own client_type and key results as "client:user_id"
    // (user_id alone can collide across clients: anilist 123 ≠ mal 123).
    const byClient = new Map<string, string[]>()
    for (const c of comments || []) {
      if (c.deleted || !c.user_id || !c.client_type) continue
      const list = byClient.get(c.client_type) || []
      if (!list.includes(c.user_id)) list.push(c.user_id)
      byClient.set(c.client_type, list)
    }

    const userPointsMap: Record<string, any> = {}
    const userCustomizationsMap: Record<string, any> = {}
    if (byClient.size > 0) {
      await Promise.all([...byClient.entries()].map(async ([ct, ids]) => {
        const [pointsRes, customRes] = await Promise.all([
          supabase.rpc('get_batch_user_points_cached', {
            p_client_type: ct,
            p_user_ids: ids
          }),
          supabase.rpc('get_batch_user_customizations', {
            p_client_type: ct,
            p_user_ids: ids
          }).then((res: any) => res, () => ({ data: null }))
        ])
        if (pointsRes.data) {
          for (const [uid, val] of Object.entries(pointsRes.data)) {
            userPointsMap[`${ct}:${uid}`] = val
          }
        }
        if (customRes.data) {
          for (const [uid, val] of Object.entries(customRes.data)) {
            userCustomizationsMap[`${ct}:${uid}`] = val
          }
        }
      }))
    }

    const FIELDS_TO_STRIP = ['ip_address', 'user_agent']

    const sanitizedComments = (comments || []).map((comment: any) => {
      const stripped: any = {}
      for (const [key, value] of Object.entries(comment)) {
        if (!FIELDS_TO_STRIP.includes(key)) {
          stripped[key] = value
        }
      }

      if (comment.deleted) {
        stripped.content = '[deleted]'
        stripped.username = '[deleted]'
        stripped.user_avatar = null
        stripped.user_role = null
        stripped.translated_content = null
        stripped.original_language = null
        stripped.translated_at = null
        stripped.avatar_decoration = null
        stripped.banner_url = null
        stripped.linked_accounts = null
        stripped.badges = []
      } else {
        const points = userPointsMap[`${comment.client_type}:${comment.user_id}`]
        stripped.user_tier = points?.tier || null
        stripped.user_points = points?.total_points || null
        stripped.badges = resolveUserBadges({
          role: comment.user_role,
          tier: stripped.user_tier,
          points: stripped.user_points
        })
        // Add human-readable language name for convenience
        stripped.language_name = stripped.original_language ? getLanguageName(stripped.original_language) : null

        // Customizations & linked accounts
        const custom = userCustomizationsMap[`${comment.client_type}:${comment.user_id}`]
        stripped.avatar_decoration = custom?.avatar_decoration || comment.avatar_decoration || null
        stripped.banner_url = custom?.banner_url || comment.banner_url || null
        stripped.banner_theme = custom?.banner_theme || null
        stripped.nameplate_theme = custom?.nameplate_theme || null
        stripped.linked_accounts = custom?.linked_accounts || null
      }

      return stripped
    })

    // Get total count (exclude deleted for count) — honors the merge filter
    const { count } = await applyMediaFilter(
      supabase
        .from('comments')
        .select('*', { count: 'exact', head: true })
        .eq('deleted', false)
    )

    // Build nested structure
    const nestedComments = buildNestedStructure(sanitizedComments)

    // Prune deleted comments that have no visible (non-deleted) replies
    // Keep [deleted] only when it has live replies underneath to preserve thread structure
    const prunedComments = pruneDeletedComments(nestedComments)

    // Get media statistics (exclude deleted)
    const { data: stats } = await applyMediaFilter(
      supabase
        .from('comments')
        .select('upvotes, downvotes')
        .eq('deleted', false)
    )

    const totalUpvotes = stats?.reduce((sum: number, comment: any) => sum + comment.upvotes, 0) || 0
    const totalDownvotes = stats?.reduce((sum: number, comment: any) => sum + comment.downvotes, 0) || 0

    // Get media info — prefer a row from the REQUESTING client so the
    // header shows the title/poster the user knows, fall back to any row
    // (merged pages may come entirely from other clients).
    const firstNonDeleted = (comments || []).find(
      (c: any) => !c.deleted && c.client_type === client_type && c.media_id === media_id
    ) || (comments || []).find((c: any) => !c.deleted)
    let mediaInfo = firstNonDeleted ? {
      mediaId: firstNonDeleted.media_id,
      mediaType: firstNonDeleted.media_type,
      mediaTitle: firstNonDeleted.media_title,
      mediaYear: firstNonDeleted.media_year,
      mediaPoster: firstNonDeleted.media_poster
    } : null

    // Fallback: If mediaTitle is 'Unknown Media' or missing, check dantotsu_media_cache
    if (mediaInfo && (!mediaInfo.mediaTitle || mediaInfo.mediaTitle === 'Unknown Media' || mediaInfo.mediaTitle === 'Unknown')) {
      const midNum = parseInt(media_id)
      if (!isNaN(midNum)) {
        const { data: cached } = await supabase
          .from('dantotsu_media_cache')
          .select('media_type, media_title, media_year, media_poster')
          .eq('media_id', midNum)
          .maybeSingle()
        if (cached && cached.media_title && cached.media_title !== 'Unknown Media') {
          mediaInfo.mediaTitle = cached.media_title
          mediaInfo.mediaType = cached.media_type || mediaInfo.mediaType
          mediaInfo.mediaYear = cached.media_year || mediaInfo.mediaYear
          mediaInfo.mediaPoster = cached.media_poster || mediaInfo.mediaPoster
        }
      }
    }

    return new Response(
      JSON.stringify({
        media: mediaInfo,
        comments: prunedComments,
        merged,
        stats: {
          commentCount: count || 0,
          totalUpvotes,
          totalDownvotes,
          netScore: totalUpvotes - totalDownvotes
        },
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: limit ? Math.ceil((count || 0) / limit) : 1
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Media API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function buildNestedStructure(comments: any[]) {
  const commentMap: { [key: number]: any } = {}
  const roots: any[] = []
  
  // Create map of all comments
  comments.forEach(comment => {
    commentMap[comment.id] = { 
      ...comment, 
      replies: [],
      // Parse JSON fields
      user_votes: comment.user_votes ? JSON.parse(comment.user_votes) : {},
      reports: comment.reports ? JSON.parse(comment.reports) : [],
      tags: comment.tags ? JSON.parse(comment.tags) : []
    }
  })
  
  // Build nested structure
  comments.forEach(comment => {
    if (comment.parent_id) {
      const parent = commentMap[comment.parent_id]
      if (parent) {
        parent.replies.push(commentMap[comment.id])
      } else {
        // Parent not in current page (could be deleted or on different page)
        // Still show as root so reply isn't lost
        roots.push(commentMap[comment.id])
      }
    } else {
      roots.push(commentMap[comment.id])
    }
  })
  
  return roots
}

// Recursively prune deleted comments that have no visible (non-deleted) replies.
// Keep [deleted] placeholder only when it has at least one live reply underneath,
// so the thread structure is preserved. Otherwise, completely hide it.
function pruneDeletedComments(comments: any[]): any[] {
  return comments
    .map(comment => {
      // Recursively prune children first (bottom-up)
      const prunedReplies = comment.replies && comment.replies.length > 0
        ? pruneDeletedComments(comment.replies)
        : []
      return { ...comment, replies: prunedReplies }
    })
    .filter(comment => {
      // Non-deleted comments always stay
      if (!comment.deleted) return true
      // Deleted comment with visible replies → keep as [deleted] placeholder
      if (comment.replies && comment.replies.length > 0) return true
      // Deleted comment with no visible replies → hide completely
      return false
    })
}
