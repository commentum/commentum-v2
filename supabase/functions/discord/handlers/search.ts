import { createAutocompleteResponse, createEmbedWithComponentsResponse, createErrorResponse } from '../utils.ts'

// Helper to escape PostgreSQL LIKE special characters (% and _)
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&')
}

// ─────────────────────────────────────────────────────────────────────────────
// Autocomplete Handler (Interaction Type 4 -> Type 8)
// ─────────────────────────────────────────────────────────────────────────────
export async function handleAutocomplete(supabase: any, interaction: any): Promise<Response> {
  try {
    const commandName = interaction.data?.name || ''
    const options = interaction.data?.options || []
    const focused = options.find((opt: any) => opt.focused === true)

    if (!focused) {
      return createAutocompleteResponse([])
    }

    const fieldName = focused.name
    const rawVal = (focused.value || '').toString().trim()

    // ── 1. User Autocomplete (for search_comments `user` & mod commands `user_id`) ──
    if (fieldName === 'user' || fieldName === 'user_id') {
      const choices: Array<{ name: string; value: string }> = []
      const seen = new Set<string>()

      // Search in commentum_users table
      let userQuery = supabase
        .from('commentum_users')
        .select('commentum_user_id, commentum_username, commentum_client_type, commentum_user_role')
        .limit(20)

      if (rawVal.length > 0) {
        userQuery = userQuery.or(`commentum_username.ilike.%${escapeLike(rawVal)}%,commentum_user_id.ilike.%${escapeLike(rawVal)}%`)
      }

      const { data: users } = await userQuery

      for (const u of users || []) {
        if (!u.commentum_user_id) continue
        const client = (u.commentum_client_type || 'anilist').toUpperCase()
        const name = u.commentum_username || 'Unknown'
        const uid = String(u.commentum_user_id)
        const key = `${client}:${uid}`

        if (!seen.has(key)) {
          seen.add(key)
          // For search_comments we can pass client:uid, for raw user_id commands pass uid
          const val = commandName === 'search_comments' ? `${u.commentum_client_type || 'anilist'}:${uid}` : uid
          choices.push({
            name: `👤 [${client}] ${name} (ID: ${uid})`.slice(0, 100),
            value: val
          })
        }
      }

      // If fewer than 20 choices, also look up active commenters from comments table
      if (choices.length < 20 && rawVal.length > 0) {
        const { data: commentUsers } = await supabase
          .from('comments')
          .select('user_id, username, client_type')
          .or(`username.ilike.%${escapeLike(rawVal)}%,user_id.ilike.%${escapeLike(rawVal)}%`)
          .limit(20)

        for (const cu of commentUsers || []) {
          if (!cu.user_id) continue
          const client = (cu.client_type || 'anilist').toUpperCase()
          const name = cu.username || 'Unknown'
          const uid = String(cu.user_id)
          const key = `${client}:${uid}`

          if (!seen.has(key)) {
            seen.add(key)
            const val = commandName === 'search_comments' ? `${cu.client_type || 'anilist'}:${uid}` : uid
            choices.push({
              name: `👤 [${client}] ${name} (ID: ${uid})`.slice(0, 100),
              value: val
            })
          }
          if (choices.length >= 25) break
        }
      }

      return createAutocompleteResponse(choices)
    }

    // ── 2. Media Autocomplete (for search_comments `media`) ──
    if (fieldName === 'media') {
      const choices: Array<{ name: string; value: string }> = []
      const seenMedia = new Set<string>()

      let mediaQuery = supabase
        .from('comments')
        .select('media_id, media_title, media_type')
        .limit(50)

      if (rawVal.length > 0) {
        mediaQuery = mediaQuery.or(`media_title.ilike.%${escapeLike(rawVal)}%,media_id.ilike.%${escapeLike(rawVal)}%`)
      }

      const { data: mediaItems } = await mediaQuery

      for (const m of mediaItems || []) {
        if (!m.media_id) continue
        const mid = String(m.media_id)
        if (!seenMedia.has(mid)) {
          seenMedia.add(mid)
          const type = (m.media_type || 'media').toUpperCase()
          const title = m.media_title || `Media #${mid}`
          choices.push({
            name: `🎬 ${title} [${type}] (ID: ${mid})`.slice(0, 100),
            value: mid
          })
        }
        if (choices.length >= 25) break
      }

      return createAutocompleteResponse(choices)
    }

    return createAutocompleteResponse([])
  } catch (error) {
    console.error('Autocomplete error:', error)
    return createAutocompleteResponse([])
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slash Command Handler: /search_comments
// ─────────────────────────────────────────────────────────────────────────────
export async function handleSearchCommentsCommand(
  supabase: any,
  userId: string,
  username: string,
  options: any[] = [],
  userRole: string
): Promise<Response> {
  try {
    // Role check: Only moderators, admins, super_admins, and owners
    if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
      return createErrorResponse('Only moderators and administrators can search comments.')
    }

    // Extract options
    const queryOpt = options.find((o: any) => o.name === 'query')?.value?.toString()
    const matchType = (options.find((o: any) => o.name === 'match_type')?.value?.toString() || 'contains').toLowerCase()
    const userOpt = options.find((o: any) => o.name === 'user')?.value?.toString()
    const mediaOpt = options.find((o: any) => o.name === 'media')?.value?.toString()
    const platformOpt = (options.find((o: any) => o.name === 'platform')?.value?.toString() || 'all').toLowerCase()
    const statusOpt = (options.find((o: any) => o.name === 'status')?.value?.toString() || 'active').toLowerCase()
    const limitOpt = Number(options.find((o: any) => o.name === 'limit')?.value) || 5

    // Prevent unrestricted full-database dumps
    if (!queryOpt && !userOpt && !mediaOpt) {
      return createErrorResponse(
        'Please specify at least one search filter: `query`, `user`, or `media`.\nExample: `/search_comments query:spoiler`'
      )
    }

    // Build Supabase Query
    let dbQuery = supabase
      .from('comments')
      .select('id, content, username, user_id, user_role, client_type, media_id, media_title, media_type, deleted, pinned, locked, report_count, created_at, upvotes, downvotes, vote_score', { count: 'exact' })

    // 1. Content & Match Type Filter
    if (queryOpt) {
      const q = queryOpt.trim()
      if (matchType === 'exact') {
        dbQuery = dbQuery.eq('content', q)
      } else if (matchType === 'prefix') {
        dbQuery = dbQuery.ilike('content', `${escapeLike(q)}%`)
      } else if (matchType === 'suffix') {
        dbQuery = dbQuery.ilike('content', `%${escapeLike(q)}`)
      } else if (matchType === 'regex') {
        // Postgres regex match (~*)
        dbQuery = dbQuery.filter('content', 'match', q)
      } else {
        // Default: wildcard contains (%query%)
        dbQuery = dbQuery.ilike('content', `%${escapeLike(q)}%`)
      }
    }

    // 2. User Filter (format: "client:userId" or "userId" or username)
    if (userOpt) {
      const u = userOpt.trim()
      if (u.includes(':')) {
        const [client, uid] = u.split(':')
        dbQuery = dbQuery.eq('client_type', client).eq('user_id', uid)
      } else if (/^\d+$/.test(u)) {
        dbQuery = dbQuery.eq('user_id', u)
      } else {
        dbQuery = dbQuery.ilike('username', `%${escapeLike(u)}%`)
      }
    }

    // 3. Media Filter (media ID or media title)
    if (mediaOpt) {
      const m = mediaOpt.trim()
      if (/^\d+$/.test(m)) {
        dbQuery = dbQuery.eq('media_id', m)
      } else {
        dbQuery = dbQuery.ilike('media_title', `%${escapeLike(m)}%`)
      }
    }

    // 4. Platform Filter
    if (platformOpt && platformOpt !== 'all') {
      dbQuery = dbQuery.eq('client_type', platformOpt)
    }

    // 5. Status Filter
    if (statusOpt === 'deleted') {
      dbQuery = dbQuery.eq('deleted', true)
    } else if (statusOpt === 'reported') {
      dbQuery = dbQuery.gt('report_count', 0)
    } else if (statusOpt === 'pinned') {
      dbQuery = dbQuery.eq('pinned', true)
    } else if (statusOpt === 'locked') {
      dbQuery = dbQuery.eq('locked', true)
    } else if (statusOpt === 'all') {
      // Show all (including deleted)
    } else {
      // Default: Active comments only
      dbQuery = dbQuery.eq('deleted', false)
    }

    // Limit (clamped between 1 and 10)
    const limit = Math.min(Math.max(limitOpt, 1), 10)
    dbQuery = dbQuery.order('created_at', { ascending: false }).limit(limit)

    // Execute query
    const { data: comments, count, error } = await dbQuery

    if (error) {
      console.error('Comment search query error:', error)
      return createErrorResponse(`Search failed: ${error.message}`)
    }

    // No results found
    if (!comments || comments.length === 0) {
      const filterSummary = [
        queryOpt ? `• Query: \`${queryOpt}\` (Match: ${matchType})` : null,
        userOpt ? `• User: \`${userOpt}\`` : null,
        mediaOpt ? `• Media: \`${mediaOpt}\`` : null,
        platformOpt !== 'all' ? `• Platform: \`${platformOpt}\`` : null,
        statusOpt !== 'active' ? `• Status: \`${statusOpt}\`` : null,
      ].filter(Boolean).join('\n')

      const noResultEmbed = {
        title: '🔍 Comment Search Results',
        description: `❌ **No comments found matching your filters.**\n\n**Filters applied:**\n${filterSummary || 'None'}`,
        color: 0xED4245,
        timestamp: new Date().toISOString(),
        footer: { text: `Searched by ${username}` }
      }

      return createEmbedWithComponentsResponse(noResultEmbed, [], true)
    }

    // Build Result Embed
    const totalMatches = count ?? comments.length
    const filterInfo = [
      queryOpt ? `Query: \`${queryOpt}\` (${matchType})` : null,
      userOpt ? `User: \`${userOpt}\`` : null,
      mediaOpt ? `Media: \`${mediaOpt}\`` : null,
      platformOpt !== 'all' ? `Platform: \`${platformOpt}\`` : null,
      statusOpt !== 'active' ? `Status: \`${statusOpt}\`` : null,
    ].filter(Boolean).join(' · ')

    const embedFields = comments.map((c: any, index: number) => {
      const cleanContent = (c.content || '').replace(/[\r\n]+/g, ' ')
      const snippet = cleanContent.length > 150 ? cleanContent.substring(0, 150) + '...' : cleanContent
      const clientUpper = (c.client_type || 'platform').toUpperCase()
      const mediaTitle = c.media_title || `Media #${c.media_id || 'N/A'}`
      const mediaType = (c.media_type || 'anime').toUpperCase()

      const flags: string[] = []
      if (c.deleted) flags.push('🗑️ `[DELETED]`')
      if (c.pinned) flags.push('📌 `[PINNED]`')
      if (c.locked) flags.push('🔒 `[LOCKED]`')
      if ((c.report_count || 0) > 0) flags.push(`🚩 \`[${c.report_count} REPORTS]\``)

      const flagStr = flags.length > 0 ? ` · ${flags.join(' ')}` : ''

      return {
        name: `[${index + 1}] #️⃣ ID: ${c.id} · ${c.username} (${clientUpper}:${c.user_id})`,
        value: `📺 **${mediaTitle}** [${mediaType}]\n💬 "${snippet}"\n📅 ${new Date(c.created_at).toLocaleDateString()} · 👍 ${c.upvotes || 0} · 👎 ${c.downvotes || 0}${flagStr}`,
        inline: false
      }
    })

    const resultEmbed = {
      title: '🔍 Comment Search Results',
      description: `Found **${totalMatches}** matching comment${totalMatches === 1 ? '' : 's'} (showing top **${comments.length}**):\n*Filters: ${filterInfo || 'None'}*`,
      fields: embedFields,
      color: 0x5865F2,
      timestamp: new Date().toISOString(),
      footer: { text: `Executed by ${username} (${userRole})` }
    }

    // Build Components (Select Menu Dropdown + 1-Click Delete Buttons)
    const components: any[] = []

    // 1. Select Menu Dropdown: Quick dropdown to delete any comment with snippet preview
    const selectOptions = comments.map((c: any) => {
      const cleanSnippet = (c.content || '').replace(/[\r\n]+/g, ' ')
      const desc = cleanSnippet.length > 80 ? cleanSnippet.substring(0, 80) + '...' : cleanSnippet
      const clientUpper = (c.client_type || '').toUpperCase()

      return {
        label: `#${c.id} · ${c.username} [${clientUpper}]`.slice(0, 100),
        value: String(c.id),
        description: (desc || 'No content snippet').slice(0, 100),
        emoji: { name: c.deleted ? '✔️' : '🗑️' }
      }
    })

    components.push({
      type: 1, // Action row
      components: [
        {
          type: 3, // String select
          custom_id: `select_delete_comment:${userId}`,
          placeholder: '🗑️ Select a comment to delete...',
          options: selectOptions
        }
      ]
    })

    // 2. Buttons Row 1: Direct 1-click Delete Buttons for comments 1 to 5
    const row1Buttons = comments.slice(0, 5).map((c: any) => ({
      type: 2, // Button
      style: c.deleted ? 2 : 4, // 4 = Danger (Red), 2 = Secondary (Grey)
      label: c.deleted ? `#${c.id} (Deleted)` : `Del #${c.id}`,
      custom_id: `mod_delete:${c.id}:${userId}`,
      emoji: { name: c.deleted ? '✔️' : '🗑️' },
      disabled: c.deleted ? true : false
    }))

    if (row1Buttons.length > 0) {
      components.push({
        type: 1,
        components: row1Buttons
      })
    }

    // 3. Buttons Row 2: Direct 1-click Delete Buttons for comments 6 to 10 (if any)
    const row2Buttons = comments.slice(5, 10).map((c: any) => ({
      type: 2,
      style: c.deleted ? 2 : 4,
      label: c.deleted ? `#${c.id} (Deleted)` : `Del #${c.id}`,
      custom_id: `mod_delete:${c.id}:${userId}`,
      emoji: { name: c.deleted ? '✔️' : '🗑️' },
      disabled: c.deleted ? true : false
    }))

    if (row2Buttons.length > 0) {
      components.push({
        type: 1,
        components: row2Buttons
      })
    }

    return createEmbedWithComponentsResponse(resultEmbed, components)
  } catch (error) {
    console.error('handleSearchCommentsCommand error:', error)
    return createErrorResponse(`Error searching comments: ${error.message}`)
  }
}
