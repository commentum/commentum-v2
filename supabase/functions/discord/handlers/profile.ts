import { createErrorResponse, createEmbedResponse, createDiscordResponse } from '../utils.ts'
import { canModerate } from '../../shared/auth.ts'

// Rich read-only views and staff tools:
//   /user /comment /stats /queue /modlog /note /bans /leaderboard /mypoints
//   /purge /audit /sync_status /announcements /customizations
// Everything here reads straight from the DB. Counts use exact head-counts and
// paged reads so results are not silently capped at PostgREST's 1000 rows.

const ROLE_ORDER = ['user', 'moderator', 'admin', 'super_admin', 'app_owner', 'owner']
export const ADMIN_ROLES = ['admin', 'super_admin', 'app_owner', 'owner']
export const STAFF_ROLES = ['moderator', ...ADMIN_ROLES]
const isStaff = (r: string) => STAFF_ROLES.includes(r)
const isAdmin = (r: string) => ADMIN_ROLES.includes(r)

const opt = (options: any[], name: string) => options?.find((o: any) => o.name === name)?.value
const clip = (s: any, n = 200) => {
  const v = String(s ?? '')
  return v.length > n ? v.slice(0, n - 1) + '…' : v
}
const fmt = (n: any) => Number(n ?? 0).toLocaleString('en-US')
const normClient = (c: string) => {
  const v = String(c || '').toLowerCase().trim()
  return v === 'myanimelist' ? 'mal' : v
}
const aliases = (c: string) => (normClient(c) === 'mal' ? ['mal', 'myanimelist'] : [normClient(c)])
const platformLabel = (c: string) => ({ anilist: 'AniList', mal: 'MAL', myanimelist: 'MAL', simkl: 'SIMKL' } as any)[String(c).toLowerCase()] || String(c || '?')
const when = (d: any) => {
  if (!d) return 'never'
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? 'unknown' : `<t:${Math.floor(t / 1000)}:R>`
}
const whenFull = (d: any) => {
  if (!d) return 'never'
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? 'unknown' : `<t:${Math.floor(t / 1000)}:f>`
}
const safeJson = (v: any, fallback: any) => {
  if (v === null || v === undefined || v === '') return fallback
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return fallback }
}
const f = (name: string, value: any, inline = true) => ({ name, value: clip(value || '—', 1024), inline })
const highestRole = (roles: string[]) =>
  roles.reduce((a, b) => (ROLE_ORDER.indexOf(b) > ROLE_ORDER.indexOf(a) ? b : a), 'user')
const roleColor = (r: string) =>
  ({ owner: 0xFFD700, app_owner: 0xFFD700, super_admin: 0xFF0000, admin: 0xFF8C00, moderator: 0x00FF00 } as any)[r] || 0x5865F2
const activeUntil = (flag: boolean, until: any) => !!flag && (until === null || until === undefined || new Date(until) > new Date())
const untilText = (until: any) => (until ? `until ${whenFull(until)}` : 'permanent')

// Read every row of a query, 1000 at a time (PostgREST caps a single read).
async function fetchAll(build: () => any, maxPages = 50): Promise<any[]> {
  const out: any[] = []
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await build().range(p * 1000, p * 1000 + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

async function count(q: any): Promise<number> {
  const { count: c, error } = await q
  if (error) { console.error('count error:', error.message); return 0 }
  return c || 0
}

// ── user lookup (id first, then exact username, then comments fallback) ──
async function findUserRows(supabase: any, input: string, platform?: string): Promise<{ rows: any[]; error?: string }> {
  const raw = String(input).trim()
  const base = () => {
    let q = supabase.from('commentum_users').select('*')
    if (platform) q = q.in('commentum_client_type', aliases(platform))
    return q
  }
  let { data } = await base().eq('commentum_user_id', raw)
  let rows: any[] = data || []
  if (rows.length === 0) {
    const esc = raw.replace(/[\\%_]/g, (m) => '\\' + m)
    const { data: named } = await base().ilike('commentum_username', esc).limit(10)
    rows = named || []
    const ids = [...new Set(rows.map((r) => r.commentum_user_id))]
    if (ids.length > 1) return { rows: [], error: `Several users are named "${raw}" (${ids.join(', ')}). Use the ID.` }
  }
  if (rows.length === 0) {
    // Commenter that never got a commentum_users row
    let cq = supabase.from('comments').select('user_id, client_type, username, user_avatar, user_role, created_at').eq('user_id', raw).order('created_at', { ascending: false }).limit(1)
    if (platform) cq = cq.in('client_type', aliases(platform))
    const { data: c } = await cq
    if (c && c.length) {
      rows = [{
        commentum_user_id: String(c[0].user_id), commentum_client_type: c[0].client_type,
        commentum_username: c[0].username, commentum_user_avatar: c[0].user_avatar,
        commentum_user_role: c[0].user_role || 'user', _partial: true,
      }]
    }
  }
  if (rows.length === 0) return { rows: [], error: `User not found: "${raw}". Pick from the autocomplete list or paste the numeric ID.` }
  return { rows }
}

async function pointsFor(supabase: any, row: any) {
  try {
    const { data } = await supabase.rpc('get_user_points', { p_client_type: row.commentum_client_type, p_user_id: row.commentum_user_id })
    return data || null
  } catch { return null }
}

// ═════════════════════════════ /user ═════════════════════════════
export async function handleUserCommand(supabase: any, options: any[], userRole: string) {
  try {
    const input = opt(options, 'user_id')
    if (!input) return createErrorResponse('user_id is required.')
    const section = String(opt(options, 'section') || 'all')
    const staff = isStaff(userRole)
    if (section === 'moderation' && !staff) return createErrorResponse('Only moderators can view moderation details.')

    const { rows, error } = await findUserRows(supabase, String(input), opt(options, 'platform'))
    if (error) return createErrorResponse(error)

    const uid = String(rows[0].commentum_user_id)
    const username = rows[0].commentum_username || 'Unknown'
    const avatar = rows.find((r) => r.commentum_user_avatar)?.commentum_user_avatar
    const role = highestRole(rows.map((r) => (r.commentum_user_role || 'user').toLowerCase()))
    // 'all' (default) shows every section; moderation only for staff
    const want = (k: string) => (section === 'all' ? (k !== 'moderation' || staff) : section === k)
    const groups: { key: string; fields: any[] }[] = []
    let desc = `${rows.map((r) => platformLabel(r.commentum_client_type)).join(' · ')} · ID \`${uid}\``

    if (want('overview')) {
      const fields: any[] = []
      groups.push({ key: 'overview', fields })
      const [total, deleted, replies] = await Promise.all([
        count(supabase.from('comments').select('id', { count: 'exact', head: true }).eq('user_id', uid)),
        count(supabase.from('comments').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('deleted', true)),
        count(supabase.from('comments').select('id', { count: 'exact', head: true }).eq('user_id', uid).not('parent_id', 'is', null)),
      ])
      const rowsC = await fetchAll(() => supabase.from('comments').select('upvotes, downvotes, report_count, created_at, id').eq('user_id', uid).order('created_at', { ascending: false }), 20)
      const up = rowsC.reduce((s, c) => s + (c.upvotes || 0), 0)
      const down = rowsC.reduce((s, c) => s + (c.downvotes || 0), 0)
      const reported = rowsC.reduce((s, c) => s + (c.report_count || 0), 0)

      const { data: dc } = await supabase.from('discord_users').select('discord_user_id, discord_username, is_verified, registered_at, user_role').eq('platform_user_id', uid).eq('is_active', true)
      const pts = await pointsFor(supabase, rows[0])

      fields.push(f('Role', role))
      fields.push(f('Comments', `${fmt(total)} total · ${fmt(total - deleted)} live · ${fmt(deleted)} deleted · ${fmt(replies)} replies`, false))
      fields.push(f('Votes received', `▲ ${fmt(up)}  ▼ ${fmt(down)}`))
      fields.push(f('Votes cast', fmt(Math.max(...rows.map((r) => r.commentum_user_vote_count || 0)))))
      fields.push(f('Reports', `on their comments: ${fmt(reported)} · filed by them: ${fmt(Math.max(...rows.map((r) => r.commentum_user_report_count || 0)))}`, false))
      const firstAt = rows.map((r) => r.commentum_user_first_comment_at).filter(Boolean).sort()[0] || (rowsC.length ? rowsC[rowsC.length - 1].created_at : null)
      const lastAt = rowsC[0]?.created_at || rows.map((r) => r.commentum_user_last_comment_at).filter(Boolean).sort().pop()
      fields.push(f('First comment', when(firstAt)))
      fields.push(f('Last comment', when(lastAt)))
      fields.push(f('Joined', when(rows.map((r) => r.created_at).filter(Boolean).sort()[0])))
      if (pts) fields.push(f('Points', `${pts.display_points ?? pts.points ?? 0} · tier ${pts.tier ?? 'n/a'}${pts.rank ? ` · rank #${pts.rank}` : ''}`))
      fields.push(f('Discord', dc && dc.length ? dc.map((d: any) => `<@${d.discord_user_id}> (${d.discord_username})${d.is_verified ? ' ✅' : ''}`).join('\n') : 'Not registered', false))

      const flags: string[] = []
      if (rows.some((r) => r.commentum_user_verified)) flags.push('Verified')
      if (rows.some((r) => r.commentum_user_premium)) flags.push('Premium')
      if (rows.some((r) => r.commentum_user_active === false)) flags.push('Inactive')
      if (flags.length) fields.push(f('Flags', flags.join(' · ')))

      // Status per platform (no more "worst of all" merge)
      const status = rows.map((r) => {
        const s: string[] = []
        if (activeUntil(r.commentum_user_banned, r.commentum_user_banned_until)) s.push('🔨 banned')
        if (activeUntil(r.commentum_user_shadow_banned, r.commentum_user_shadow_banned_until)) s.push('👻 shadow-banned')
        if (activeUntil(r.commentum_user_muted, r.commentum_user_muted_until)) s.push(`🔇 muted ${untilText(r.commentum_user_muted_until)}`)
        if ((r.commentum_user_warnings || 0) > 0) s.push(`⚠️ ${r.commentum_user_warnings} warning(s)`)
        return `**${platformLabel(r.commentum_client_type)}**: ${s.length ? s.join(', ') : '✅ clean'}`
      }).join('\n')
      fields.push(f('Status', status, false))
      if (rows[0]._partial) desc += '\n*No commentum profile row yet, only comment data exists.*'
    }

    if (want('moderation')) {
      const fields: any[] = []
      groups.push({ key: 'moderation', fields })
      for (const r of rows) {
        const lines: string[] = []
        if (activeUntil(r.commentum_user_banned, r.commentum_user_banned_until))
          lines.push(`🔨 **Banned** ${untilText(r.commentum_user_banned_until)}\nby \`${r.commentum_user_banned_by || '?'}\` ${when(r.commentum_user_banned_at)}\n${clip(r.commentum_user_banned_reason || 'no reason', 200)}`)
        if (activeUntil(r.commentum_user_shadow_banned, r.commentum_user_shadow_banned_until))
          lines.push(`👻 **Shadow banned** ${untilText(r.commentum_user_shadow_banned_until)}\nby \`${r.commentum_user_shadow_banned_by || '?'}\` ${when(r.commentum_user_shadow_banned_at)}\n${clip(r.commentum_user_shadow_banned_reason || 'no reason', 200)}`)
        if (activeUntil(r.commentum_user_muted, r.commentum_user_muted_until))
          lines.push(`🔇 **Muted** ${untilText(r.commentum_user_muted_until)}\nby \`${r.commentum_user_muted_by || '?'}\`\n${clip(r.commentum_user_muted_reason || 'no reason', 200)}`)
        lines.push(`⚠️ Warnings: **${r.commentum_user_warnings || 0}**${r.commentum_user_last_warning_at ? ` · last ${when(r.commentum_user_last_warning_at)} by \`${r.commentum_user_last_warning_by || '?'}\`: ${clip(r.commentum_user_last_warning_reason || '', 150)}` : ''}`)
        lines.push(`🛠 Moderated ${fmt(r.commentum_user_moderated_count)}×${r.commentum_user_last_moderation_action ? ` · last: ${r.commentum_user_last_moderation_action} ${when(r.commentum_user_last_moderated_at)}` : ''}`)
        lines.push(`🚩 Reported ${fmt(r.commentum_user_reported_count)}× ${r.commentum_user_last_reported_at ? `(last ${when(r.commentum_user_last_reported_at)})` : ''}`)
        fields.push(f(`${platformLabel(r.commentum_client_type)} moderation`, lines.join('\n'), false))
      }
      const notes = rows.map((r) => r.commentum_user_notes).filter(Boolean)[0]
      if (notes) fields.push(f('📝 Notes', clip(notes, 1000), false))
      desc += '\nUse `/modlog` for the full history.'
    }

    if (want('points')) {
      const fields: any[] = []
      groups.push({ key: 'points', fields })
      const pts = await pointsFor(supabase, rows[0])
      const al = aliases(rows[0].commentum_client_type)
      const { data: up } = await supabase.from('user_points').select('*').eq('user_id', uid).in('client_type', al).limit(1)
      const { data: spends } = await supabase.from('user_point_spends').select('points').eq('user_id', uid).in('client_type', al)
      const { data: ads } = await supabase.from('user_ad_rewards').select('points').eq('user_id', uid).in('client_type', al)
      const { data: adj } = await supabase.from('user_point_adjustments').select('id, points, reason, created_by, created_at').eq('user_id', uid).in('client_type', al).order('created_at', { ascending: false }).limit(5)
      if (pts) {
        fields.push(f('Balance', pts.display_points ?? pts.points ?? 0))
        fields.push(f('Real points', fmt(pts.real_points ?? pts.points ?? 0)))
        fields.push(f('Tier', `${pts.tier ?? 'n/a'}${pts.points_to_next_tier != null ? ` (${fmt(pts.points_to_next_tier)} to next)` : ''}`))
        if (pts.breakdown && typeof pts.breakdown === 'object')
          fields.push(f('Breakdown', Object.entries(pts.breakdown).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${fmt(v)}`).join('\n'), false))
      } else fields.push(f('Balance', 'No points data', false))
      const u0 = up?.[0]
      fields.push(f('Streak', u0 ? `${u0.current_streak} (best ${u0.longest_streak}) · last active ${u0.last_activity_date || 'n/a'}` : 'n/a', false))
      fields.push(f('Spent', fmt((spends || []).reduce((s: number, x: any) => s + x.points, 0)) + ` (${(spends || []).length} purchases)`))
      fields.push(f('Ad rewards', fmt((ads || []).reduce((s: number, x: any) => s + x.points, 0)) + ` (${(ads || []).length} claims)`))
      if (isStaff(userRole) && adj?.length)
        fields.push(f('Recent adjustments', adj.map((a: any) => `${a.points > 0 ? '+' : ''}${fmt(a.points)} · ${clip(a.reason, 50)}`).join('\n'), false))
    }

    if (want('customization')) {
      const fields: any[] = []
      groups.push({ key: 'customization', fields })
      for (const r of rows) {
        fields.push(f(`${platformLabel(r.commentum_client_type)} equipped`,
          [`Decoration: ${r.avatar_decoration || 'none'}`, `Banner: ${r.banner_url || r.banner_theme || 'none'}`, `Nameplate: ${r.nameplate_theme || 'none'}`, `Effect: ${r.profile_effect_url || 'none'}`].join('\n'), false))
      }
      const unlocked = [...new Set(rows.flatMap((r) => r.unlocked_customizations || []))]
      fields.push(f(`Unlocked (${unlocked.length})`, unlocked.length ? clip(unlocked.join(', '), 1000) : 'none', false))
    }

    if (want('linked')) {
      const fields: any[] = []
      groups.push({ key: 'linked', fields })
      for (const r of rows) {
        fields.push(f(`${platformLabel(r.commentum_client_type)} account`, `\`${r.commentum_user_id}\` · ${r.commentum_username}`, false))
      }
      const link = (label: string, id: string, name: string) => id ? f(label, `\`${id}\` · ${name || '?'}`) : null
      const l = rows.find((r) => r.linked_anilist_id || r.linked_mal_id || r.linked_simkl_id) || rows[0]
      for (const x of [link('Linked AniList', l.linked_anilist_id, l.linked_anilist_username), link('Linked MAL', l.linked_mal_id, l.linked_mal_username), link('Linked SIMKL', l.linked_simkl_id, l.linked_simkl_username)]) if (x) fields.push(x)
      const { data: dan } = await supabase.from('dantotsu_id_mappings').select('dantotsu_comment_id').limit(1)
      if (isStaff(userRole) && dan !== null) fields.push(f('Dantotsu sync', 'Mappings table available. See `/sync_status`.', false))
    }

    const titles: Record<string, string> = { overview: 'Overview', moderation: '🛡️ Moderation (staff)', points: '⭐ Points', customization: '🎨 Customization', linked: '🔗 Linked accounts' }
    const embeds: any[] = groups.map((g, i) => ({
      title: i === 0 ? `👤 ${username}${groups.length === 1 && g.key !== 'overview' ? ' — ' + g.key : ''}` : `${username} — ${titles[g.key] || g.key}`,
      description: i === 0 ? desc : undefined,
      color: roleColor(role),
      fields: g.fields.filter((x) => x && x.name && x.value).slice(0, 25),
      thumbnail: i === 0 && avatar ? { url: avatar } : undefined,
      footer: i === groups.length - 1 ? { text: `ID ${uid} · /user section:<one part> to view a single section` } : undefined,
    }))
    if (groups.length > 1 && groups[0].key === 'overview') embeds[0].title = `👤 ${username}`
    // Discord allows 6000 characters across all embeds of a message: shrink values until it fits
    const size = () => embeds.reduce((t, e) => t + (e.title || '').length + (e.description || '').length + (e.footer?.text || '').length + e.fields.reduce((a: number, x: any) => a + x.name.length + x.value.length, 0), 0)
    for (let cap = 900; size() > 5800 && cap >= 100; cap -= 100) {
      for (const e of embeds) for (const x of e.fields) x.value = clip(x.value, cap)
    }
    // Staff-only moderation details must never be posted to the channel
    const includesModeration = groups.some((g) => g.key === 'moderation')
    return new Response(
      JSON.stringify({ type: 4, data: { embeds, flags: includesModeration ? 64 : 0 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    console.error('User command error:', error)
    return createErrorResponse(`Failed to get user information: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /comment ═════════════════════════════
export async function handleCommentCommand(supabase: any, options: any[], userRole: string) {
  try {
    const id = opt(options, 'comment_id')
    if (!id) return createErrorResponse('comment_id is required.')
    const { data: c, error } = await supabase.from('comments').select('*').eq('id', id).single()
    if (error || !c) return createErrorResponse('Comment not found.')
    const staff = isStaff(userRole)

    const replies = await count(supabase.from('comments').select('id', { count: 'exact', head: true }).eq('parent_id', c.id).eq('deleted', false))
    const reports = safeJson(c.reports, [])
    const tags = safeJson(c.tags, [])
    const status: string[] = []
    if (c.deleted) status.push('🗑 Deleted')
    if (c.pinned) status.push('📌 Pinned')
    if (c.locked) status.push('🔒 Locked')
    if (c.edited) status.push(`✏️ Edited ×${c.edit_count || 1}`)
    if (c.user_shadow_banned) status.push('👻 author shadow-banned')

    const fields: any[] = [
      f('Author', `${c.username} (\`${c.user_id}\`)`),
      f('Role', c.user_role || 'user'),
      f('Platform', platformLabel(c.client_type)),
      f('Votes', `▲ ${fmt(c.upvotes)}  ▼ ${fmt(c.downvotes)}  = ${fmt(c.vote_score)}`),
      f('Replies', fmt(replies)),
      f('Posted', whenFull(c.created_at)),
      f('Media', `${c.media_title || 'Unknown'} (${c.media_type || '?'}${c.media_year ? ' ' + c.media_year : ''}) · ID \`${c.media_id}\``, false),
    ]
    if (c.parent_id) fields.push(f('Reply to', `#${c.parent_id}`))
    if (tags.length) fields.push(f('Tags', clip(Array.isArray(tags) ? tags.join(', ') : String(tags), 200)))
    if (status.length) fields.push(f('Status', status.join(' · '), false))
    if (c.edited) fields.push(f('Last edited', when(c.edited_at)))
    if (c.pinned) fields.push(f('Pinned', `by \`${c.pinned_by || '?'}\` ${when(c.pinned_at)}`))
    if (c.locked) fields.push(f('Locked', `by \`${c.locked_by || '?'}\` ${when(c.locked_at)}`))
    if (c.deleted) fields.push(f('Deleted', `by \`${c.deleted_by || '?'}\` ${when(c.deleted_at)}`))
    if (c.original_language) fields.push(f('Language', `${c.original_language}${c.translated_content ? ' (translated copy stored)' : ''}`))

    if (staff) {
      fields.push(f('Reports', `${fmt(c.report_count)} · ${c.report_status || 'none'}`))
      if (Array.isArray(reports) && reports.length) {
        fields.push(f('Report details', reports.slice(-5).map((r: any) => `• \`${r.reporter_id}\` **${r.reason}** [${r.status}] ${when(r.created_at)}${r.notes ? ` — ${clip(r.notes, 80)}` : ''}`).join('\n'), false))
      }
      if (c.moderated) fields.push(f('Moderation', `${c.moderation_action || 'action'} by \`${c.moderated_by || '?'}\` ${when(c.moderated_at)}\n${clip(c.moderation_reason || 'no reason', 200)}`, false))
    } else {
      fields.push(f('Reports', fmt(c.report_count)))
    }

    let body = c.content || ''
    if (c.deleted) body = staff ? `||${clip(body, 1500)}||` : '*[This comment has been deleted]*'
    else body = clip(body, 1800)
    return createEmbedResponse(`💬 Comment #${c.id}`, body, fields,
      c.deleted ? 0xFF0000 : c.pinned ? 0xFFD700 : c.report_status === 'pending' ? 0xFF8C00 : 0x5865F2,
      { text: `ID ${c.id}` }, c.user_avatar || undefined, false)
  } catch (error) {
    console.error('Comment command error:', error)
    return createErrorResponse(`Failed to get comment information: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /stats ═════════════════════════════
export async function handleStatsCommand(supabase: any, userRole: string, options: any[] = []) {
  try {
    const staff = isStaff(userRole)
    const nowIso = new Date().toISOString()
    const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
    const head = (t: string) => supabase.from(t).select('*', { count: 'exact', head: true })
    const notExpired = (col: string) => `${col}.is.null,${col}.gt.${nowIso}`

    const [
      cTotal, cDeleted, cPinned, cLocked, c24, c7, c30, pending,
      uTotal, bans, shadows, mutes,
      rUser, rMod, rAdmin, rSuper, rApp, rOwner,
      pAni, pMal, pSimkl, discordActive, servers, cfg,
    ] = await Promise.all([
      count(head('comments')),
      count(head('comments').eq('deleted', true)),
      count(head('comments').eq('pinned', true)),
      count(head('comments').eq('locked', true)),
      count(head('comments').gte('created_at', ago(24))),
      count(head('comments').gte('created_at', ago(24 * 7))),
      count(head('comments').gte('created_at', ago(24 * 30))),
      count(head('comments').eq('reported', true).eq('report_status', 'pending')),
      count(head('commentum_users')),
      count(head('commentum_users').eq('commentum_user_banned', true).or(notExpired('commentum_user_banned_until'))),
      count(head('commentum_users').eq('commentum_user_shadow_banned', true).or(notExpired('commentum_user_shadow_banned_until'))),
      count(head('commentum_users').eq('commentum_user_muted', true).or(notExpired('commentum_user_muted_until'))),
      count(head('commentum_users').eq('commentum_user_role', 'user')),
      count(head('commentum_users').eq('commentum_user_role', 'moderator')),
      count(head('commentum_users').eq('commentum_user_role', 'admin')),
      count(head('commentum_users').eq('commentum_user_role', 'super_admin')),
      count(head('commentum_users').eq('commentum_user_role', 'app_owner')),
      count(head('commentum_users').eq('commentum_user_role', 'owner')),
      count(head('commentum_users').eq('commentum_client_type', 'anilist')),
      count(head('commentum_users').in('commentum_client_type', ['mal', 'myanimelist'])),
      count(head('commentum_users').eq('commentum_client_type', 'simkl')),
      count(head('discord_users').eq('is_active', true)),
      count(head('server_configs').eq('is_active', true)),
      supabase.from('config').select('key, value').in('key', ['system_enabled', 'voting_enabled', 'reporting_enabled', 'discord_notifications_enabled', 'points_enabled']),
    ])

    // Vote totals need row values; paged so >1000 comments are included
    let up = 0, down = 0, reps = 0
    const rows = await fetchAll(() => supabase.from('comments').select('upvotes, downvotes, report_count').order('id'), 100)
    for (const r of rows) { up += r.upvotes || 0; down += r.downvotes || 0; reps += r.report_count || 0 }

    const flag = (k: string) => (cfg.data || []).find((c: any) => c.key === k)?.value === 'true'
    const onoff = (b: boolean) => (b ? '🟢' : '🔴')

    const { data: top } = await supabase.from('commentum_users').select('commentum_username, commentum_user_id, commentum_client_type, commentum_user_comment_count').order('commentum_user_comment_count', { ascending: false }).limit(5)

    const fields: any[] = [
      f('Comments', `${fmt(cTotal)} total · ${fmt(cTotal - cDeleted)} live · ${fmt(cDeleted)} deleted`, false),
      f('New comments', `24h: ${fmt(c24)} · 7d: ${fmt(c7)} · 30d: ${fmt(c30)}`, false),
      f('Engagement', `▲ ${fmt(up)}  ▼ ${fmt(down)}`),
      f('Reports', `${fmt(reps)} total · ${fmt(pending)} pending`),
      f('Pinned / Locked', `${fmt(cPinned)} / ${fmt(cLocked)}`),
      f('Users', `${fmt(uTotal)} total · AniList ${fmt(pAni)} · MAL ${fmt(pMal)} · SIMKL ${fmt(pSimkl)}`, false),
      f('Staff', `Mods ${rMod} · Admins ${rAdmin} · Super ${rSuper} · App owners ${rApp} · Owners ${rOwner}`, false),
      f('Discord', `${fmt(discordActive)} registered · ${servers} servers`),
      f('Top commenters', (top || []).map((u: any, i: number) => `${i + 1}. ${u.commentum_username} (${platformLabel(u.commentum_client_type)}) — ${fmt(u.commentum_user_comment_count)}`).join('\n') || 'n/a', false),
      f('System', `${onoff(flag('system_enabled'))} system ${onoff(flag('voting_enabled'))} voting ${onoff(flag('reporting_enabled'))} reporting ${onoff(flag('discord_notifications_enabled'))} discord ${onoff(flag('points_enabled'))} points`, false),
    ]

    if (staff) {
      const [fcm, notif24, adjustments, ads, annPub, mapped] = await Promise.all([
        count(head('fcm_tokens').eq('is_active', true)),
        count(head('notifications').gte('created_at', ago(24))),
        count(head('user_point_adjustments')),
        count(head('user_ad_rewards')),
        count(head('announcements').eq('status', 'published')),
        count(head('dantotsu_id_mappings')),
      ])
      const { data: pendingDiscord } = await supabase.from('discord_notifications').select('delivery_status').in('delivery_status', ['pending', 'failed']).limit(500)
      const failed = (pendingDiscord || []).filter((n: any) => n.delivery_status === 'failed').length
      fields.push(f('Active restrictions', `🔨 ${bans} bans · 👻 ${shadows} shadow · 🔇 ${mutes} muted`, false))
      fields.push(f('Points economy', `${fmt(adjustments)} manual adjustments · ${fmt(ads)} ad rewards`))
      fields.push(f('Push / notifications', `${fmt(fcm)} devices · ${fmt(notif24)} in 24h`))
      fields.push(f('Discord queue', `${(pendingDiscord || []).length - failed} pending · ${failed} failed`))
      fields.push(f('Content', `${fmt(annPub)} announcements · ${fmt(mapped)} Dantotsu mappings`))
    }

    return createEmbedResponse('📊 Commentum Statistics', 'Live numbers from the database', fields, 0x00B894, { text: staff ? 'Staff view' : 'Public view' }, undefined, false)
  } catch (error) {
    console.error('Stats command error:', error)
    return createErrorResponse(`Failed to fetch statistics: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /queue ═════════════════════════════
export async function handleQueueCommand(supabase: any, options: any[], userRole: string) {
  try {
    if (!isStaff(userRole)) return createErrorResponse('Only moderators can view the moderation queue.')
    const page = Math.max(1, Number(opt(options, 'page') || 1))
    const per = 6
    const total = await count(supabase.from('comments').select('id', { count: 'exact', head: true }).eq('reported', true).eq('report_status', 'pending'))
    if (total === 0) return createDiscordResponse('📋 **Moderation Queue**\n\n✅ No pending reports to review.', true)
    const { data: comments, error } = await supabase.from('comments').select('*').eq('reported', true).eq('report_status', 'pending').order('created_at', { ascending: true }).range((page - 1) * per, page * per - 1)
    if (error) throw error
    const pages = Math.ceil(total / per)
    if (!comments || comments.length === 0) return createErrorResponse(`Page ${page} is empty. There are ${pages} page(s).`)

    const fields = comments.map((c: any) => {
      const reports = safeJson(c.reports, []).filter((r: any) => r.status === 'pending')
      const detail = reports.slice(0, 3).map((r: any) => `\`${r.reporter_id}\` ${r.reason}${r.notes ? ` "${clip(r.notes, 40)}"` : ''}`).join('; ')
      return f(`#${c.id} · ${c.username} (${c.user_id})`,
        `🚩 ${reports.length} pending: ${detail || '—'}\n📄 ${clip(c.content || '', 150)}\n🎬 ${clip(c.media_title || '', 40)} · ${when(c.created_at)}`, false)
    })
    return createEmbedResponse(`📋 Moderation Queue (${total} pending)`, 'Oldest first. Handle with `/resolve`, or `/comment` for full details.',
      fields, 0xFF8C00, { text: `Page ${page}/${pages} · /queue page:<n>` }, undefined, true)
  } catch (error) {
    console.error('Queue command error:', error)
    return createErrorResponse(`Failed to fetch moderation queue: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /modlog ═════════════════════════════
export async function handleModlogCommand(supabase: any, options: any[], userRole: string) {
  try {
    if (!isStaff(userRole)) return createErrorResponse('Only moderators can view the moderation log.')
    const input = opt(options, 'user_id')
    if (!input) return createErrorResponse('user_id is required.')
    const { rows, error } = await findUserRows(supabase, String(input), opt(options, 'platform'))
    if (error) return createErrorResponse(error)
    const uid = String(rows[0].commentum_user_id)

    type Ev = { t: number; line: string }
    const ev: Ev[] = []
    const add = (d: any, line: string) => { const t = d ? new Date(d).getTime() : 0; ev.push({ t: Number.isNaN(t) ? 0 : t, line }) }

    for (const r of rows) {
      const p = platformLabel(r.commentum_client_type)
      for (const w of safeJson(r.commentum_user_warning_details, []))
        add(w.warned_at, `⚠️ **Warning #${w.warning_number}** [${p}] by \`${w.warned_by}\` ${when(w.warned_at)}\n  ${clip(w.reason, 150)}`)
      if (r.commentum_user_banned_at) add(r.commentum_user_banned_at, `🔨 **Ban** [${p}] by \`${r.commentum_user_banned_by || '?'}\` ${when(r.commentum_user_banned_at)} (${untilText(r.commentum_user_banned_until)}${r.commentum_user_banned ? ', active' : ', lifted'})\n  ${clip(r.commentum_user_banned_reason || 'no reason', 150)}`)
      if (r.commentum_user_shadow_banned_at) add(r.commentum_user_shadow_banned_at, `👻 **Shadow ban** [${p}] by \`${r.commentum_user_shadow_banned_by || '?'}\` ${when(r.commentum_user_shadow_banned_at)}${r.commentum_user_shadow_banned ? ' (active)' : ' (lifted)'}\n  ${clip(r.commentum_user_shadow_banned_reason || 'no reason', 150)}`)
      if (r.commentum_user_muted_by) add(r.commentum_user_last_moderated_at, `🔇 **Mute** [${p}] by \`${r.commentum_user_muted_by}\` ${untilText(r.commentum_user_muted_until)}${r.commentum_user_muted ? ' (active)' : ''}\n  ${clip(r.commentum_user_muted_reason || 'no reason', 150)}`)
      if (r.commentum_user_last_moderation_action && r.commentum_user_last_moderated_at)
        add(r.commentum_user_last_moderated_at, `🛠 Last action [${p}]: **${r.commentum_user_last_moderation_action}** by \`${r.commentum_user_last_moderated_by || '?'}\` ${when(r.commentum_user_last_moderated_at)}\n  ${clip(r.commentum_user_last_moderation_reason || '', 150)}`)
    }
    const { data: moderated } = await supabase.from('comments').select('id, moderation_action, moderated_by, moderated_at, moderation_reason').eq('user_id', uid).eq('moderated', true).order('moderated_at', { ascending: false }).limit(10)
    for (const m of moderated || []) add(m.moderated_at, `💬 Comment #${m.id} **${m.moderation_action || 'moderated'}** by \`${m.moderated_by || '?'}\` ${when(m.moderated_at)}\n  ${clip(m.moderation_reason || '', 150)}`)
    const { data: deleted } = await supabase.from('comments').select('id, deleted_by, deleted_at').eq('user_id', uid).eq('deleted', true).order('deleted_at', { ascending: false }).limit(10)
    for (const d of deleted || []) add(d.deleted_at, `🗑 Comment #${d.id} deleted by \`${d.deleted_by || 'author'}\` ${when(d.deleted_at)}`)

    ev.sort((a, b) => b.t - a.t)
    const seen = new Set<string>()
    const lines = ev.filter((e) => (seen.has(e.line) ? false : (seen.add(e.line), true))).slice(0, 15).map((e) => e.line)
    return createEmbedResponse(`📜 Mod log: ${rows[0].commentum_username}`, lines.length ? clip(lines.join('\n\n'), 4000) : 'No moderation history.', [], 0xE17055,
      { text: `ID ${uid} · newest first` }, rows[0].commentum_user_avatar || undefined, true)
  } catch (error) {
    console.error('Modlog error:', error)
    return createErrorResponse(`Failed to build mod log: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /note ═════════════════════════════
export async function handleNoteCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], userRole: string) {
  try {
    if (!isStaff(userRole)) return createErrorResponse('Only moderators can use notes.')
    const input = opt(options, 'user_id')
    const action = String(opt(options, 'action') || 'view')
    const text = String(opt(options, 'text') || '').trim()
    if (!input) return createErrorResponse('user_id is required.')
    const { rows, error } = await findUserRows(supabase, String(input), opt(options, 'platform'))
    if (error) return createErrorResponse(error)
    if (rows[0]._partial) return createErrorResponse('That user has no profile row yet, so notes cannot be stored.')
    const uid = String(rows[0].commentum_user_id)

    if (action === 'view') {
      const lines = [...new Set(rows.flatMap((r) => String(r.commentum_user_notes || '').split('\n')).filter(Boolean))]
      return createEmbedResponse(`📝 Notes: ${rows[0].commentum_username}`, lines.length ? clip(lines.join('\n'), 4000) : 'No notes.', [], 0xFDCB6E, { text: `ID ${uid}` }, undefined, true)
    }
    for (const r of rows) {
      if (!canModerate(userRole, r.commentum_user_role || 'user')) return createErrorResponse('Cannot edit notes on a user with equal or higher role.')
    }
    if (action === 'add') {
      if (!text) return createErrorResponse('text is required to add a note.')
      const line = `[${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${moderatorName} (${moderatorId})] ${text.replace(/\n/g, ' ')}`
      for (const r of rows) {
        const next = (r.commentum_user_notes ? r.commentum_user_notes + '\n' : '') + line
        const { error: e } = await supabase.from('commentum_users').update({ commentum_user_notes: next.slice(-8000) }).eq('id', r.id)
        if (e) throw e
      }
      return createDiscordResponse(`📝 Note added to **${rows[0].commentum_username}** (\`${uid}\`).`, true)
    }
    if (action === 'clear') {
      if (!isAdmin(userRole)) return createErrorResponse('Only admins can clear notes.')
      for (const r of rows) {
        const { error: e } = await supabase.from('commentum_users').update({ commentum_user_notes: null }).eq('id', r.id)
        if (e) throw e
      }
      return createDiscordResponse(`🧹 Notes cleared for **${rows[0].commentum_username}**.`, true)
    }
    return createErrorResponse('Unknown action.')
  } catch (error) {
    console.error('Note error:', error)
    return createErrorResponse(`Note failed: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /bans ═════════════════════════════
export async function handleBansCommand(supabase: any, options: any[], userRole: string) {
  try {
    if (!isStaff(userRole)) return createErrorResponse('Only moderators can list restrictions.')
    const type = String(opt(options, 'type') || 'all')
    const page = Math.max(1, Number(opt(options, 'page') || 1))
    const nowIso = new Date().toISOString()
    const items: { t: number; line: string }[] = []

    if (type === 'all' || type === 'bans') {
      const { data } = await supabase.from('commentum_users').select('*').eq('commentum_user_banned', true).or(`commentum_user_banned_until.is.null,commentum_user_banned_until.gt.${nowIso}`).limit(200)
      for (const r of data || []) items.push({ t: new Date(r.commentum_user_banned_at || 0).getTime(), line: `🔨 **${r.commentum_username}** (\`${r.commentum_user_id}\`, ${platformLabel(r.commentum_client_type)}) ${untilText(r.commentum_user_banned_until)} · by \`${r.commentum_user_banned_by || '?'}\` — ${clip(r.commentum_user_banned_reason || 'no reason', 80)}` })
    }
    if (type === 'all' || type === 'shadowbans') {
      const { data } = await supabase.from('commentum_users').select('*').eq('commentum_user_shadow_banned', true).or(`commentum_user_shadow_banned_until.is.null,commentum_user_shadow_banned_until.gt.${nowIso}`).limit(200)
      for (const r of data || []) items.push({ t: new Date(r.commentum_user_shadow_banned_at || 0).getTime(), line: `👻 **${r.commentum_username}** (\`${r.commentum_user_id}\`, ${platformLabel(r.commentum_client_type)}) ${untilText(r.commentum_user_shadow_banned_until)} · by \`${r.commentum_user_shadow_banned_by || '?'}\` — ${clip(r.commentum_user_shadow_banned_reason || 'no reason', 80)}` })
    }
    if (type === 'all' || type === 'mutes') {
      const { data } = await supabase.from('commentum_users').select('*').eq('commentum_user_muted', true).or(`commentum_user_muted_until.is.null,commentum_user_muted_until.gt.${nowIso}`).limit(200)
      for (const r of data || []) items.push({ t: new Date(r.commentum_user_muted_until || 0).getTime(), line: `🔇 **${r.commentum_username}** (\`${r.commentum_user_id}\`, ${platformLabel(r.commentum_client_type)}) ${untilText(r.commentum_user_muted_until)} · by \`${r.commentum_user_muted_by || '?'}\` — ${clip(r.commentum_user_muted_reason || 'no reason', 80)}` })
    }
    items.sort((a, b) => b.t - a.t)
    const per = 10
    const pages = Math.max(1, Math.ceil(items.length / per))
    const slice = items.slice((page - 1) * per, page * per)
    return createEmbedResponse(`🚫 Active restrictions (${items.length})`, slice.length ? slice.map((i) => i.line).join('\n') : 'Nothing active.', [], 0xD63031, { text: `Page ${page}/${pages} · filter: ${type}` }, undefined, true)
  } catch (error) {
    console.error('Bans error:', error)
    return createErrorResponse(`Failed to list restrictions: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /leaderboard ═════════════════════════════
export async function handleLeaderboardCommand(supabase: any, options: any[]) {
  try {
    const platform = opt(options, 'platform')
    const page = Math.max(1, Number(opt(options, 'page') || 1))
    const { data, error } = await supabase.rpc('get_points_leaderboard', { p_client_type: platform ? normClient(platform) : null, p_page: page, p_limit: 10 })
    if (error) throw new Error(error.message)
    if (data?.enabled === false) return createErrorResponse('The leaderboard is disabled.')
    const list: any[] = data?.leaderboard || []
    if (!list.length) return createDiscordResponse('🏆 Nothing on this page yet.', true)
    const medal = (r: number) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `**${r}.**`)
    const lines = list.map((e) => `${medal(e.rank)} ${e.username} (${platformLabel(e.client_type)}) — ${e.is_infinite ? '∞' : fmt(e.points)} · ${e.tier} · ${fmt(e.comment_count)} comments`)
    const total = data?.pagination?.total || 0
    return createEmbedResponse('🏆 Points Leaderboard', lines.join('\n'), [], 0xFDCB6E, { text: `Page ${page}/${Math.max(1, Math.ceil(total / 10))} · ${fmt(total)} ranked${platform ? ' · ' + platformLabel(platform) : ''}` })
  } catch (error) {
    console.error('Leaderboard error:', error)
    return createErrorResponse(`Failed to load leaderboard: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /mypoints ═════════════════════════════
export async function handleMyPointsCommand(supabase: any, discordUserId: string, registration: any) {
  try {
    if (!registration) return createErrorResponse('You are not registered yet. Use `/register` first.')
    const row = { commentum_client_type: registration.platform_type, commentum_user_id: registration.platform_user_id }
    const pts = await pointsFor(supabase, row)
    if (!pts) return createErrorResponse('No points data found for your account yet.')
    const al = aliases(registration.platform_type)
    const { data: up } = await supabase.from('user_points').select('current_streak, longest_streak, last_activity_date').eq('user_id', registration.platform_user_id).in('client_type', al).limit(1)
    const fields = [
      f('Balance', pts.display_points ?? pts.points ?? 0),
      f('Tier', `${pts.tier ?? 'n/a'}${pts.points_to_next_tier != null ? ` · ${fmt(pts.points_to_next_tier)} to next` : ''}`),
      pts.rank ? f('Rank', `#${pts.rank}`) : null,
      up?.[0] ? f('Streak', `${up[0].current_streak} (best ${up[0].longest_streak})`) : null,
      pts.breakdown ? f('Breakdown', Object.entries(pts.breakdown).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${fmt(v)}`).join('\n'), false) : null,
    ].filter(Boolean)
    return createEmbedResponse('⭐ Your points', `${platformLabel(registration.platform_type)} · \`${registration.platform_user_id}\``, fields, 0xFDCB6E, undefined, undefined, true)
  } catch (error) {
    return createErrorResponse(`Failed to load points: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /purge ═════════════════════════════
export async function handlePurgeCommand(supabase: any, moderatorId: string, moderatorName: string, options: any[], userRole: string) {
  try {
    if (!isAdmin(userRole)) return createErrorResponse('Only admins can bulk delete comments.')
    const input = opt(options, 'user_id')
    const reason = String(opt(options, 'reason') || '').trim()
    const confirm = opt(options, 'confirm') === true
    if (!input || !reason) return createErrorResponse('user_id and reason are required.')
    const { rows, error } = await findUserRows(supabase, String(input), opt(options, 'platform'))
    if (error) return createErrorResponse(error)
    const uid = String(rows[0].commentum_user_id)
    for (const r of rows) if (!canModerate(userRole, r.commentum_user_role || 'user')) return createErrorResponse('Cannot moderate a user with equal or higher role.')
    const n = await count(supabase.from('comments').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('deleted', false))
    if (n === 0) return createErrorResponse('This user has no live comments.')
    if (!confirm) return createDiscordResponse(`⚠️ This will delete **${fmt(n)}** comment(s) by **${rows[0].commentum_username}** (\`${uid}\`).\nRun again with \`confirm:true\` to proceed.`, true)
    const { error: e } = await supabase.from('comments').update({
      deleted: true, deleted_at: new Date().toISOString(), deleted_by: moderatorId,
      moderated: true, moderated_at: new Date().toISOString(), moderated_by: moderatorId,
      moderation_action: 'purge', moderation_reason: reason,
    }).eq('user_id', uid).eq('deleted', false)
    if (e) throw e
    for (const r of rows) {
      await supabase.from('commentum_users').update({
        commentum_user_moderated_count: (r.commentum_user_moderated_count || 0) + 1,
        commentum_user_last_moderated_at: new Date().toISOString(), commentum_user_last_moderated_by: moderatorId,
        commentum_user_last_moderation_action: 'purge', commentum_user_last_moderation_reason: reason,
      }).eq('id', r.id)
    }
    return createDiscordResponse(`🧹 Deleted **${fmt(n)}** comment(s) by **${rows[0].commentum_username}**. Reason: ${reason}`)
  } catch (error) {
    console.error('Purge error:', error)
    return createErrorResponse(`Purge failed: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /audit ═════════════════════════════
export async function handleAuditCommand(supabase: any, options: any[], userRole: string) {
  try {
    if (!isStaff(userRole)) return createErrorResponse('Only moderators can view the audit log.')
    const limit = Math.min(25, Math.max(5, Number(opt(options, 'limit') || 15)))
    const filterMod = opt(options, 'moderator_id') ? String(opt(options, 'moderator_id')) : null
    const ev: { t: number; line: string }[] = []

    let cq = supabase.from('comments').select('id, username, moderation_action, moderated_by, moderated_at, moderation_reason').eq('moderated', true).order('moderated_at', { ascending: false }).limit(limit * 2)
    if (filterMod) cq = cq.eq('moderated_by', filterMod)
    const { data: cm } = await cq
    for (const c of cm || []) ev.push({ t: new Date(c.moderated_at || 0).getTime(), line: `💬 \`${c.moderated_by}\` **${c.moderation_action}** on #${c.id} (${c.username}) ${when(c.moderated_at)} — ${clip(c.moderation_reason || '', 60)}` })

    let uq = supabase.from('commentum_users').select('commentum_username, commentum_user_id, commentum_user_last_moderation_action, commentum_user_last_moderated_by, commentum_user_last_moderated_at, commentum_user_last_moderation_reason').not('commentum_user_last_moderated_at', 'is', null).order('commentum_user_last_moderated_at', { ascending: false }).limit(limit * 2)
    if (filterMod) uq = uq.eq('commentum_user_last_moderated_by', filterMod)
    const { data: um } = await uq
    for (const u of um || []) ev.push({ t: new Date(u.commentum_user_last_moderated_at).getTime(), line: `👤 \`${u.commentum_user_last_moderated_by}\` **${u.commentum_user_last_moderation_action}** → ${u.commentum_username} (\`${u.commentum_user_id}\`) ${when(u.commentum_user_last_moderated_at)} — ${clip(u.commentum_user_last_moderation_reason || '', 60)}` })

    if (isAdmin(userRole)) {
      let pq = supabase.from('user_point_adjustments').select('points, reason, created_by, created_at, user_id, client_type').order('created_at', { ascending: false }).limit(limit)
      if (filterMod) pq = pq.eq('created_by', filterMod)
      const { data: pa } = await pq
      for (const p of pa || []) ev.push({ t: new Date(p.created_at).getTime(), line: `⭐ \`${p.created_by}\` points ${p.points > 0 ? '+' : ''}${fmt(p.points)} → \`${p.user_id}\` ${when(p.created_at)} — ${clip(p.reason, 50)}` })
    }
    ev.sort((a, b) => b.t - a.t)
    const lines = ev.slice(0, limit).map((e) => e.line)
    return createEmbedResponse('🗂 Audit log', lines.length ? clip(lines.join('\n'), 4000) : 'No recorded actions.', [], 0x636E72, { text: `Latest ${limit}${filterMod ? ` · moderator ${filterMod}` : ''} · derived from stored moderation fields` }, undefined, true)
  } catch (error) {
    console.error('Audit error:', error)
    return createErrorResponse(`Audit failed: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /sync_status ═════════════════════════════
export async function handleSyncStatusCommand(supabase: any, userRole: string) {
  try {
    if (!isStaff(userRole)) return createErrorResponse('Only moderators can view sync status.')
    const head = (t: string) => supabase.from(t).select('*', { count: 'exact', head: true })
    const [maps, media, cache] = await Promise.all([count(head('dantotsu_id_mappings')), count(head('media_id_map')), count(head('dantotsu_media_cache'))])
    const { data: meta } = await supabase.from('dantotsu_sync_meta').select('key, value, updated_at').order('updated_at', { ascending: false }).limit(10)
    // Never print token-like values
    const lines = (meta || []).map((m: any) => `\`${m.key}\`: ${/token|secret|key|auth/i.test(m.key) ? '••••' : clip(m.value, 60)} (${when(m.updated_at)})`)
    return createEmbedResponse('🔄 Dantotsu sync', lines.join('\n') || 'No sync metadata yet.', [
      f('Comment mappings', fmt(maps)), f('Media ID map', fmt(media)), f('Media cache', fmt(cache)),
    ], 0x0984E3, undefined, undefined, true)
  } catch (error) {
    return createErrorResponse(`Failed to read sync status: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /announcements ═════════════════════════════
export async function handleAnnouncementsCommand(supabase: any, options: any[]) {
  try {
    const nowIso = new Date().toISOString()
    const { data, error } = await supabase.from('announcements').select('id, app_id, title, short_description, category, pinned, published_at').eq('status', 'published').or(`expires_at.is.null,expires_at.gt.${nowIso}`).order('pinned', { ascending: false }).order('published_at', { ascending: false }).limit(5)
    if (error) throw error
    if (!data?.length) return createDiscordResponse('📢 No active announcements.', true)
    const fields = data.map((a: any) => f(`${a.pinned ? '📌 ' : ''}${a.title}`, `${clip(a.short_description, 200)}\n*${a.app_id} · ${a.category} · ${when(a.published_at)}*`, false))
    return createEmbedResponse('📢 Announcements', 'Latest published', fields, 0x6C5CE7)
  } catch (error) {
    return createErrorResponse(`Failed to load announcements: ${(error as Error).message}`)
  }
}

// ═════════════════════════════ /customizations ═════════════════════════════
export async function handleCustomizationsCommand(supabase: any, options: any[], userRole: string) {
  try {
    const input = opt(options, 'user_id')
    const { data: cat } = await supabase.from('customizations_catalog').select('type, points_required').eq('is_active', true).limit(2000)
    const byType: Record<string, number> = {}
    for (const c of cat || []) byType[c.type] = (byType[c.type] || 0) + 1
    const catalogLine = Object.entries(byType).map(([t, n]) => `${t}: ${n}`).join(' · ') || 'empty'
    if (!input) {
      return createEmbedResponse('🎨 Customizations', 'Catalog', [f('Items', catalogLine, false), f('Free / unlockable', `${(cat || []).filter((c: any) => !c.points_required).length} free · ${(cat || []).filter((c: any) => c.points_required > 0).length} with points`, false)], 0xE84393)
    }
    return await handleUserCommand(supabase, [{ name: 'user_id', value: input }, { name: 'platform', value: opt(options, 'platform') }, { name: 'section', value: 'customization' }], userRole)
  } catch (error) {
    return createErrorResponse(`Failed: ${(error as Error).message}`)
  }
}
