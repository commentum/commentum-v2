import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const DANTOTSU_API = 'https://api.dantotsu.app'
const APP_AUTH_KEY = '6*45Qp%W2RS@t38jkXoSKY588Ynj%n'

interface DanAuthResult {
  authToken: string
  userId: string
  username: string
  isMod: boolean
  isAdmin: boolean
}

// In-memory cache for Dantotsu auth tokens (avoids re-authenticating on every comment action)
const tokenCache = new Map<string, { data: DanAuthResult; expiresAt: number }>()

function getSupabaseClient(supabase?: any) {
  if (supabase) return supabase
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (url && key) {
    try {
      return createClient(url, key)
    } catch (_) {}
  }
  return null
}

/**
 * Exchange an AniList OAuth access token for a Dantotsu AuthToken.
 * Automatically stores & updates the token in `dantotsu_mod_tokens` so it can
 * be reused for staff actions (e.g. Discord bot buttons, AnymeX mod deletes).
 */
export async function danAuthenticate(
  anilistToken: string,
  supabase?: any
): Promise<DanAuthResult | null> {
  if (!anilistToken) return null

  const cached = tokenCache.get(anilistToken)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data
  }

  try {
    const res = await fetch(`${DANTOTSU_API}/authenticate`, {
      method: 'POST',
      headers: {
        'appauth': APP_AUTH_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: anilistToken }),
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) {
      console.warn(`[danAuth] Dantotsu auth failed HTTP ${res.status}`)
      return null
    }

    const data = await res.json()
    if (!data?.authToken || !data?.user) {
      console.warn('[danAuth] Dantotsu auth returned invalid body')
      return null
    }

    // Dantotsu /authenticate does NOT return is_mod/is_admin.
    // Fetch /user with Authorization header to accurately check mod & admin permissions.
    let rawMod = data.user.is_mod
    let rawAdmin = data.user.is_admin

    try {
      const userRes = await fetch(`${DANTOTSU_API}/user`, {
        headers: {
          'appauth': APP_AUTH_KEY,
          'Authorization': data.authToken,
        },
        signal: AbortSignal.timeout(4000),
      })
      if (userRes.ok) {
        const userData = await userRes.json()
        if (userData?.user) {
          rawMod = userData.user.is_mod ?? rawMod
          rawAdmin = userData.user.is_admin ?? rawAdmin
        }
      }
    } catch (e) {
      console.warn('[danAuth] Failed to fetch /user permissions:', e)
    }

    const isMod = rawMod === true || rawMod === 1 || rawMod === '1' || rawAdmin === true || rawAdmin === 1 || rawAdmin === '1'
    const isAdmin = rawAdmin === true || rawAdmin === 1 || rawAdmin === '1' || rawMod === true || rawMod === 1 || rawMod === '1'

    const result: DanAuthResult = {
      authToken: data.authToken,
      userId: String(data.user.user_id || data.user.id),
      username: data.user.username || '',
      isMod: isMod,
      isAdmin: isAdmin,
    }

    // Cache for 12 hours (Dantotsu tokens typically last 6 days)
    tokenCache.set(anilistToken, {
      data: result,
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    })

    // Store & update token in DB (awaited properly for Deno runtime)
    const db = getSupabaseClient(supabase)
    if (db) {
      try {
        const { error: upsertErr } = await db
          .from('dantotsu_mod_tokens')
          .upsert({
            user_id: result.userId,
            username: result.username,
            anilist_token: anilistToken,
            dantotsu_auth_token: result.authToken,
            is_mod: result.isMod,
            is_admin: result.isAdmin,
            last_verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })

        if (upsertErr) {
          console.error('[danAuth] Error upserting Dantotsu token to DB:', upsertErr)
        } else {
          console.log(`[danAuth] Stored Dantotsu token for user: ${result.username} (${result.userId}, mod: ${result.isMod}, admin: ${result.isAdmin})`)
        }
      } catch (err) {
        console.error('[danAuth] Exception saving token to DB:', err)
      }
    }

    return result
  } catch (err) {
    console.error('[danAuth] Exception authenticating with Dantotsu:', err)
    return null
  }
}

/**
 * Get Dantotsu moderator credentials for executing staff actions.
 * 1. Checks `dantotsu_mod_tokens` table for the most recent active Dantotsu mod.
 * 2. Uses their stored token (or auto-refreshes using their stored AniList token).
 * 3. Falls back to environment variable DANTOTSU_MOD_AL_TOKEN / DANTOTSU_AL_TOKEN.
 */
export async function getDanModAuth(supabase?: any): Promise<DanAuthResult | null> {
  const db = getSupabaseClient(supabase)
  // 1. Try to load an active moderator token from the database
  if (db) {
    try {
      const { data: storedMod } = await db
        .from('dantotsu_mod_tokens')
        .select('*')
        .order('is_mod', { ascending: false })
        .order('is_admin', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (storedMod?.anilist_token) {
        // Re-authenticate using the stored AniList token to ensure it's fresh
        const freshAuth = await danAuthenticate(storedMod.anilist_token, db)
        if (freshAuth) {
          return freshAuth
        }
        // If re-auth failed, return cached dantotsu_auth_token as fallback
        if (storedMod.dantotsu_auth_token) {
          return {
            authToken: storedMod.dantotsu_auth_token,
            userId: storedMod.user_id,
            username: storedMod.username,
            isMod: storedMod.is_mod,
            isAdmin: storedMod.is_admin,
          }
        }
      }
    } catch (err) {
      console.warn('[getDanModAuth] Error querying dantotsu_mod_tokens table:', err)
    }
  }

  // 2. Fallback to configured environment token
  const modToken = Deno.env.get('DANTOTSU_MOD_AL_TOKEN') || Deno.env.get('DANTOTSU_AL_TOKEN')
  if (!modToken) {
    console.warn('[danAuth] No moderator token available in DB or environment')
    return null
  }
  return await danAuthenticate(modToken, supabase)
}

/**
 * Post a new comment to Dantotsu API
 */
export async function danPostComment(params: {
  authToken: string
  userId: string
  mediaId: number
  content: string
  tag?: number | null
  parentCommentId?: number | null
}): Promise<number | null> {
  const { authToken, userId, mediaId, content, tag, parentCommentId } = params

  try {
    const body = new URLSearchParams()
    body.append('user_id', String(userId))
    body.append('media_id', String(mediaId))
    body.append('content', content)
    if (tag != null && !isNaN(tag)) {
      body.append('tag', String(tag))
    }
    if (parentCommentId != null && parentCommentId > 0) {
      body.append('parent_comment_id', String(parentCommentId))
    }

    const res = await fetch(`${DANTOTSU_API}/comments`, {
      method: 'POST',
      headers: {
        'appauth': APP_AUTH_KEY,
        'Authorization': authToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.warn(`[danPostComment] Failed HTTP ${res.status}: ${errText}`)
      return null
    }

    const data = await res.json()
    const danId = data?.id || data?.comment_id
    return typeof danId === 'number' ? danId : parseInt(danId, 10) || null
  } catch (err) {
    console.error('[danPostComment] Exception posting to Dantotsu:', err)
    return null
  }
}

/**
 * Edit an existing comment on Dantotsu API
 */
export async function danEditComment(params: {
  authToken: string
  danCommentId: number
  content: string
}): Promise<boolean> {
  const { authToken, danCommentId, content } = params

  try {
    const body = new URLSearchParams()
    body.append('content', content)

    const res = await fetch(`${DANTOTSU_API}/comments/${danCommentId}`, {
      method: 'PUT',
      headers: {
        'appauth': APP_AUTH_KEY,
        'Authorization': authToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.warn(`[danEditComment] Failed HTTP ${res.status}: ${errText}`)
      return false
    }

    return true
  } catch (err) {
    console.error('[danEditComment] Exception editing on Dantotsu:', err)
    return false
  }
}

/**
 * Delete a comment on Dantotsu API (works for author self-delete or moderator delete)
 */
export async function danDeleteComment(params: {
  authToken: string
  danCommentId: number
}): Promise<boolean> {
  const { authToken, danCommentId } = params

  try {
    const res = await fetch(`${DANTOTSU_API}/comments/${danCommentId}`, {
      method: 'DELETE',
      headers: {
        'appauth': APP_AUTH_KEY,
        'Authorization': authToken,
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.warn(`[danDeleteComment] Failed HTTP ${res.status}: ${errText}`)
      return false
    }

    return true
  } catch (err) {
    console.error('[danDeleteComment] Exception deleting on Dantotsu:', err)
    return false
  }
}

/**
 * Vote on a Dantotsu comment (voteType: 1 for upvote, -1 for downvote, 0 for remove)
 */
export async function danVoteComment(params: {
  authToken: string
  danCommentId: number
  voteType: number
}): Promise<boolean> {
  const { authToken, danCommentId, voteType } = params

  try {
    const res = await fetch(`${DANTOTSU_API}/comments/vote/${danCommentId}/${voteType}`, {
      method: 'POST',
      headers: {
        'appauth': APP_AUTH_KEY,
        'Authorization': authToken,
      },
      signal: AbortSignal.timeout(6000),
    })

    return res.ok
  } catch (err) {
    console.error('[danVoteComment] Exception voting on Dantotsu:', err)
    return false
  }
}

/**
 * Report a Dantotsu comment
 */
export async function danReportComment(params: {
  authToken: string
  danCommentId: number
  username: string
  mediaTitle: string
  reporter: string
  reportedId: string
}): Promise<boolean> {
  const { authToken, danCommentId, username, mediaTitle, reporter, reportedId } = params

  try {
    const body = new URLSearchParams()
    body.append('username', username)
    body.append('mediaName', mediaTitle)
    body.append('reporter', reporter)
    body.append('reportedId', reportedId)

    const res = await fetch(`${DANTOTSU_API}/report/${danCommentId}`, {
      method: 'POST',
      headers: {
        'appauth': APP_AUTH_KEY,
        'Authorization': authToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    })

    return res.ok
  } catch (err) {
    console.error('[danReportComment] Exception reporting on Dantotsu:', err)
    return false
  }
}

/**
 * Fetch comments for a specific media directly from Dantotsu API
 */
export async function danFetchComments(
  mediaId: number,
  page = 1,
  tag?: number,
  sort?: string
): Promise<any | null> {
  try {
    let url = `${DANTOTSU_API}/comments/${mediaId}/${page}`
    const params = new URLSearchParams()
    if (tag != null) params.append('tag', String(tag))
    if (sort) params.append('sort', sort)
    const qs = params.toString()
    if (qs) url += `?${qs}`

    const res = await fetch(url, {
      headers: {
        'appauth': APP_AUTH_KEY,
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.error('[danFetchComments] Exception fetching comments from Dantotsu:', err)
    return null
  }
}

/**
 * Fetch replies for a parent comment from Dantotsu API
 */
export async function danFetchReplies(
  parentCommentId: number,
  page = 1
): Promise<any | null> {
  try {
    const res = await fetch(`${DANTOTSU_API}/comments/parent/${parentCommentId}/${page}`, {
      headers: {
        'appauth': APP_AUTH_KEY,
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.error(`[danFetchReplies] Exception fetching replies for ${parentCommentId}:`, err)
    return null
  }
}

// Media sync rate limiter: avoids spamming Dantotsu on every single page load of the same anime
const mediaSyncCooldown = new Map<string, number>()

/**
 * On-demand sync for a media from Dantotsu:
 * 1. Fetches pages starting from requestedPage (or page 1..totalPages).
 * 2. Ingests all unmapped comments across pages.
 * 3. Ingests replies for comments that have reply_count > 0.
 * 4. Stops early if it encounters a page where all comments are already synced.
 */
export async function syncMediaFromDantotsu(
  supabase: any,
  mediaId: number,
  requestedPage = 1
): Promise<void> {
  const cooldownKey = `${mediaId}:${requestedPage}`
  const lastSync = mediaSyncCooldown.get(cooldownKey)
  if (lastSync && Date.now() - lastSync < 20_000) {
    return // Cooldown of 20 seconds
  }
  mediaSyncCooldown.set(cooldownKey, Date.now())

  try {
    // Get media title from cache if available
    const { data: cachedMedia } = await supabase
      .from('dantotsu_media_cache')
      .select('media_title, media_type, media_year, media_poster')
      .eq('media_id', mediaId)
      .maybeSingle()

    const mediaTitle = cachedMedia?.media_title || 'Unknown Media'
    const mediaType = cachedMedia?.media_type || 'anime'

    // We fetch starting from requestedPage up to totalPages (capped at 5 pages per request for performance)
    let currentPage = requestedPage
    let maxPages = requestedPage

    while (currentPage <= maxPages && currentPage <= requestedPage + 4) {
      const data = await danFetchComments(mediaId, currentPage)
      const danComments = data?.comments
      if (!Array.isArray(danComments) || danComments.length === 0) break

      if (data?.totalPages && typeof data.totalPages === 'number') {
        maxPages = data.totalPages
      }

      const danIds = danComments.map((c: any) => c.comment_id).filter(Boolean)
      if (danIds.length === 0) break

      // Find which are already mapped
      const { data: existingMappings } = await supabase
        .from('dantotsu_id_mappings')
        .select('dantotsu_comment_id, commentum_id')
        .in('dantotsu_comment_id', danIds)

      const mappedSet = new Set<number>()
      const idMap = new Map<number, number>()
      if (existingMappings) {
        for (const m of existingMappings) {
          mappedSet.add(m.dantotsu_comment_id)
          idMap.set(m.dantotsu_comment_id, m.commentum_id)
        }
      }

      const unmapped = danComments.filter((c: any) => !mappedSet.has(c.comment_id))

      // Ingest unmapped top-level comments
      for (const c of unmapped) {
        const isDel = !!c.deleted
        let pid: number | null = null
        if (c.parent_comment_id && c.parent_comment_id !== 0) {
          pid = idMap.get(c.parent_comment_id) || null
        }

        const { data: inserted, error } = await supabase
          .from('comments')
          .insert({
            client_type: 'anilist',
            user_id: String(c.user_id),
            media_id: String(mediaId),
            content: isDel ? '[deleted]' : (c.content || ''),
            username: (c.username || 'unknown').slice(0, 50),
            user_avatar: c.profile_picture_url || null,
            user_role: (c.is_admin || c.is_mod) ? 'moderator' : 'user',
            media_type: mediaType,
            media_title: mediaTitle,
            media_year: cachedMedia?.media_year || null,
            media_poster: cachedMedia?.media_poster || null,
            parent_id: pid,
            deleted: isDel,
            deleted_at: isDel ? c.timestamp || null : null,
            upvotes: c.upvotes || 0,
            downvotes: c.downvotes || 0,
            vote_score: (c.upvotes || 0) - (c.downvotes || 0),
            tags: c.tag ? JSON.stringify(['spoiler', `episode:${c.tag}`]) : null,
            created_at: c.timestamp || null,
            updated_at: c.timestamp || null,
          })
          .select('id')
          .single()

        if (!error && inserted?.id) {
          idMap.set(c.comment_id, inserted.id)
          await supabase.from('dantotsu_id_mappings').upsert({
            dantotsu_comment_id: c.comment_id,
            commentum_id: inserted.id,
            media_id: mediaId,
          }, { onConflict: 'dantotsu_comment_id' })
          console.log(`[DantotsuSync] Ingested Dantotsu comment ${c.comment_id} -> commentum ${inserted.id}`)
        }
      }

      // Check for replies on comments that report reply_count > 0
      for (const c of danComments) {
        if (c.reply_count && c.reply_count > 0) {
          const parentCommentumId = idMap.get(c.comment_id)
          if (parentCommentumId) {
            const repliesData = await danFetchReplies(c.comment_id, 1)
            const replies = repliesData?.comments
            if (Array.isArray(replies) && replies.length > 0) {
              const replyIds = replies.map((r: any) => r.comment_id).filter(Boolean)
              const { data: existingReplies } = await supabase
                .from('dantotsu_id_mappings')
                .select('dantotsu_comment_id')
                .in('dantotsu_comment_id', replyIds)

              const mappedReplies = new Set((existingReplies || []).map((r: any) => r.dantotsu_comment_id))
              const unmappedReplies = replies.filter((r: any) => !mappedReplies.has(r.comment_id))

              for (const r of unmappedReplies) {
                const isReplyDel = !!r.deleted
                const { data: insertedReply } = await supabase
                  .from('comments')
                  .insert({
                    client_type: 'anilist',
                    user_id: String(r.user_id),
                    media_id: String(mediaId),
                    content: isReplyDel ? '[deleted]' : (r.content || ''),
                    username: (r.username || 'unknown').slice(0, 50),
                    user_avatar: r.profile_picture_url || null,
                    user_role: (r.is_admin || r.is_mod) ? 'moderator' : 'user',
                    media_type: mediaType,
                    media_title: mediaTitle,
                    media_year: cachedMedia?.media_year || null,
                    media_poster: cachedMedia?.media_poster || null,
                    parent_id: parentCommentumId,
                    deleted: isReplyDel,
                    deleted_at: isReplyDel ? r.timestamp || null : null,
                    upvotes: r.upvotes || 0,
                    downvotes: r.downvotes || 0,
                    vote_score: (r.upvotes || 0) - (r.downvotes || 0),
                    tags: r.tag ? JSON.stringify(['spoiler', `episode:${r.tag}`]) : null,
                    created_at: r.timestamp || null,
                    updated_at: r.timestamp || null,
                  })
                  .select('id')
                  .single()

                if (insertedReply?.id) {
                  await supabase.from('dantotsu_id_mappings').upsert({
                    dantotsu_comment_id: r.comment_id,
                    commentum_id: insertedReply.id,
                    media_id: mediaId,
                  }, { onConflict: 'dantotsu_comment_id' })
                }
              }
            }
          }
        }
      }

      // If every comment on this page was already mapped and we're scanning page 1,
      // we know older pages are already in DB so we don't need to paginate further!
      if (unmapped.length === 0 && currentPage === 1) {
        break
      }

      currentPage++
    }
  } catch (err) {
    console.error(`[syncMediaFromDantotsu] Error syncing media ${mediaId}:`, err)
  }
}


