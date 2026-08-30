import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

// ====================================
// CONSTANTS
// ====================================

const DANTOTSU_API = 'https://api.dantotsu.app'
const APP_AUTH_KEY = '6*45Qp%W2RS@t38jkXoSKY588Ynj%n'
const CSV_URL = 'https://raw.githubusercontent.com/itsmechinmoy/dantotsu-comment-db/refs/heads/main/dantotsu_global_db.csv'
const ANILIST_GRAPHQL = 'https://graphql.anilist.co'
const BATCH_SIZE = 500
const ANILIST_BATCH_SIZE = 25
const ANILIST_DELAY_MS = 350
const TIME_BUDGET_MS = 100_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
}

// ====================================
// TYPES
// ====================================

interface ParsedComment {
  dantotsu_id: number
  user_id: string
  media_id: number
  parent_comment_id: number | null
  content: string
  timestamp: string
  deleted: boolean
  tag: number | null
  upvotes: number
  downvotes: number
  username: string
  avatar_url: string | null
}

interface AniListMedia {
  media_type: string
  media_title: string
  media_year: number | null
  media_poster: string | null
}

interface SyncResult {
  success: boolean
  mode: string
  processed: number
  inserted: number
  skipped: number
  errors: number
  remaining: number
  duration_ms: number
  message: string
}

// ====================================
// TSV PARSER (RFC 4180 state machine)
// ====================================

function parseTSV(raw: string): Record<string, string>[] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < raw.length) {
    const ch = raw[i]
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === '\t') { currentRow.push(field); field = ''; i++; continue }
    if (ch === '\r' && raw[i + 1] === '\n') {
      currentRow.push(field); field = ''; rows.push(currentRow); currentRow = []
      i += 2; continue
    }
    if (ch === '\n') {
      currentRow.push(field); field = ''; rows.push(currentRow); currentRow = []
      i++; continue
    }
    field += ch; i++
  }
  if (field !== '' || currentRow.length > 0) {
    currentRow.push(field); rows.push(currentRow)
  }

  if (rows.length < 2) return []
  const headers = rows[0]
  return rows.slice(1).map(row => {
    const obj: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = row[j] || ''
    return obj
  })
}

function parseCommentRow(row: Record<string, string>): ParsedComment | null {
  const dantotsu_id = parseInt(row['comment_id'])
  if (!dantotsu_id || isNaN(dantotsu_id)) return null

  const rawParent = (row['parent_comment_id'] || '').trim()
  const parentCommentId = (rawParent && rawParent !== 'NULL' && rawParent !== '0') ? parseInt(rawParent) : null

  const rawTag = (row['tag'] || '').trim()
  const tag = (rawTag && rawTag !== 'NULL' && rawTag !== '0') ? parseInt(rawTag) : null

  let avatarUrl: string | null = (row['profile_picture_url'] || '').trim()
  if (!avatarUrl || avatarUrl === 'NULL') avatarUrl = null

  const content = (row['content'] || '').trim()
  if (!content) return null

  return {
    dantotsu_id,
    user_id: String(row['user_id'] || '').trim(),
    media_id: parseInt(row['media_id']),
    parent_comment_id: parentCommentId,
    content,
    timestamp: (row['timestamp'] || '').trim(),
    deleted: row['deleted'] === '1',
    tag,
    upvotes: parseInt(row['upvotes']) || 0,
    downvotes: parseInt(row['downvotes']) || 0,
    username: (row['username'] || '').trim(),
    avatar_url: avatarUrl,
  }
}

// ====================================
// ANILIST RESOLVER
// ====================================

async function fetchAniListBatch(ids: number[]): Promise<Map<number, AniListMedia>> {
  const result = new Map<number, AniListMedia>()
  const query = `query($ids: [Int]) { Page(page:1, perPage:25) { media(id_in:$ids) { id type title{english romaji} coverImage{medium} startDate{year} } } }`
  try {
    const res = await fetch(ANILIST_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { ids } }),
    })
    if (!res.ok) return result
    const data = await res.json()
    for (const m of (data?.data?.Page?.media || [])) {
      result.set(m.id, {
        media_type: m.type || 'ANIME',
        media_title: m.title?.english || m.title?.romaji || 'Unknown Media',
        media_year: m.startDate?.year || null,
        media_poster: m.coverImage?.medium || null,
      })
    }
  } catch (e) { console.error(`[anilist] Batch failed:`, e) }
  return result
}

async function resolveAniListMedia(supabase: any, mediaIds: Set<number>): Promise<Map<number, AniListMedia>> {
  const result = new Map<number, AniListMedia>()

  const { data: cached } = await supabase.from('dantotsu_media_cache').select('*').in('media_id', Array.from(mediaIds))
  if (cached) for (const row of cached) {
    result.set(row.media_id, { media_type: row.media_type, media_title: row.media_title, media_year: row.media_year, media_poster: row.media_poster })
  }

  const uncached = Array.from(mediaIds).filter(id => !result.has(id))
  if (uncached.length === 0) return result

  console.log(`[anilist] ${result.size} cached, ${uncached.length} to fetch`)

  const toCache: any[] = []
  for (let i = 0; i < uncached.length; i += ANILIST_BATCH_SIZE) {
    const batch = uncached.slice(i, i + ANILIST_BATCH_SIZE)
    const batchResult = await fetchAniListBatch(batch)
    for (const [id, media] of batchResult) {
      result.set(id, media)
      toCache.push({ media_id: id, media_type: media.media_type, media_title: media.media_title, media_year: media.media_year, media_poster: media.media_poster })
    }
    if (toCache.length >= ANILIST_BATCH_SIZE) {
      await supabase.from('dantotsu_media_cache').upsert(toCache, { onConflict: 'media_id' })
      toCache.length = 0
    }
    if (i + ANILIST_BATCH_SIZE < uncached.length) await sleep(ANILIST_DELAY_MS)
  }
  if (toCache.length > 0) await supabase.from('dantotsu_media_cache').upsert(toCache, { onConflict: 'media_id' })

  // Fallback for not-found media
  for (const id of uncached) {
    if (!result.has(id)) {
      result.set(id, { media_type: 'ANIME', media_title: 'Unknown Media', media_year: null, media_poster: null })
      await supabase.from('dantotsu_media_cache').upsert({ media_id: id, media_type: 'ANIME', media_title: 'Unknown Media', media_year: null, media_poster: null }, { onConflict: 'media_id' })
    }
  }
  return result
}

// ====================================
// ROLE MAP (from your config table)
// ====================================

async function buildRoleMap(supabase: any): Promise<Map<string, string>> {
  const { data: configs } = await supabase.from('config').select('key, value').in('key', ['owner_users', 'super_admin_users', 'admin_users', 'moderator_users'])
  const map = new Map<string, string>()
  for (const c of (configs || [])) {
    let users: unknown[] = []
    try { users = JSON.parse(c.value || '[]') } catch { users = [] }
    const role = c.key.replace('_users', '')
    for (const uid of users) {
      if (uid != null) { map.set(String(uid), role); map.set(String(Number(uid)), role) }
    }
  }
  return map
}

function getRole(roleMap: Map<string, string>, userId: string): string {
  return roleMap.get(userId) || 'user'
}

// ====================================
// SYNC META HELPERS
// ====================================

async function getMeta(supabase: any, key: string): Promise<string | null> {
  const { data } = await supabase.from('dantotsu_sync_meta').select('value').eq('key', key).single()
  return data?.value || null
}

async function setMeta(supabase: any, key: string, value: string): Promise<void> {
  await supabase.from('dantotsu_sync_meta').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

// ====================================
// CSV SYNC
// ====================================

async function csvSync(supabase: any): Promise<SyncResult> {
  const startTime = Date.now()
  let processed = 0, inserted = 0, skipped = 0, errors = 0

  // 1. Fetch CSV
  console.log('[csv] Fetching CSV...')
  let csvText: string
  try {
    const res = await fetch(CSV_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    csvText = await res.text()
  } catch (e) {
    return { success: false, mode: 'csv', processed: 0, inserted: 0, skipped: 0, errors: 1, remaining: -1, duration_ms: 0, message: `CSV fetch failed: ${e}` }
  }
  console.log(`[csv] Fetched ${(csvText.length / 1024 / 1024).toFixed(1)}MB`)

  // 2. Hash check
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csvText))
  const csvHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
  const lastHash = await getMeta(supabase, 'csv_hash')
  if (lastHash === csvHash) {
    const lastSync = await getMeta(supabase, 'last_sync_at')
    return { success: true, mode: 'csv', processed: 0, inserted: 0, skipped: 0, errors: 0, remaining: 0, duration_ms: Date.now() - startTime, message: `CSV unchanged (last: ${lastSync})` }
  }

  // 3. Parse
  console.log('[csv] Parsing...')
  const rows = parseTSV(csvText)
  const comments: ParsedComment[] = []
  for (const row of rows) { const c = parseCommentRow(row); if (c) comments.push(c) }
  console.log(`[csv] ${comments.length} valid comments`)

  // 4. Load existing mappings
  const { data: existingMappings } = await supabase.from('dantotsu_id_mappings').select('dantotsu_comment_id, commentum_id')
  const mappingMap = new Map<number, number>()
  if (existingMappings) for (const m of existingMappings) mappingMap.set(m.dantotsu_comment_id, m.commentum_id)

  // 5. Filter unimported, sort ASC (parents before children)
  const unimported = comments.filter(c => !mappingMap.has(c.dantotsu_id)).sort((a, b) => a.dantotsu_id - b.dantotsu_id)
  skipped = comments.length - unimported.length
  console.log(`[csv] ${unimported.length} new, ${skipped} already synced`)

  if (unimported.length === 0) {
    await setMeta(supabase, 'csv_hash', csvHash)
    await setMeta(supabase, 'last_sync_at', new Date().toISOString())
    return { success: true, mode: 'csv', processed: comments.length, inserted: 0, skipped, errors: 0, remaining: 0, duration_ms: Date.now() - startTime, message: 'All already synced' }
  }

  // 6. Resolve AniList media
  const uniqueMediaIds = new Set(unimported.map(c => c.media_id))
  console.log(`[csv] Resolving ${uniqueMediaIds.size} media from AniList...`)
  const mediaMap = await resolveAniListMedia(supabase, uniqueMediaIds)

  // 7. Build role map
  const roleMap = await buildRoleMap(supabase)

  // 8. Batch insert with time budget
  let idx = 0
  const loopStart = Date.now()

  while (idx < unimported.length) {
    if (Date.now() - loopStart > TIME_BUDGET_MS) {
      console.log(`[csv] Time budget reached at ${idx}/${unimported.length}`)
      break
    }

    const batch = unimported.slice(idx, idx + BATCH_SIZE)
    const insertRows: any[] = []
    const batchDantotsuIds: number[] = []

    for (const c of batch) {
      let parentId: number | null = null
      if (c.parent_comment_id) {
        parentId = mappingMap.get(c.parent_comment_id) || null
        if (!parentId) console.log(`[csv] Orphan: ${c.dantotsu_id} → parent ${c.parent_comment_id} not found`)
      }

      const media = mediaMap.get(c.media_id) || { media_type: 'ANIME', media_title: 'Unknown Media', media_year: null, media_poster: null }
      let tags: string | null = null
      if (c.tag) tags = JSON.stringify(['spoiler', `episode:${c.tag}`])

      insertRows.push({
        client_type: 'anilist',
        user_id: c.user_id,
        media_id: String(c.media_id),
        content: c.content.length > 10000 ? c.content.slice(0, 10000) : c.content,
        username: c.username.slice(0, 50),
        user_avatar: c.avatar_url,
        user_role: getRole(roleMap, c.user_id),
        media_type: media.media_type,
        media_title: media.media_title,
        media_year: media.media_year,
        media_poster: media.media_poster,
        parent_id: parentId,
        deleted: c.deleted,
        deleted_at: c.deleted ? c.timestamp || null : null,
        upvotes: c.upvotes,
        downvotes: c.downvotes,
        vote_score: c.upvotes - c.downvotes,
        tags,
        created_at: c.timestamp || null,
        updated_at: c.timestamp || null,
      })
      batchDantotsuIds.push(c.dantotsu_id)
    }

    try {
      const { data: insertedRows, error } = await supabase.from('comments').insert(insertRows).select('id')
      if (error) {
        console.error(`[csv] Insert error at ${idx}:`, error)
        errors += batch.length; idx += BATCH_SIZE; continue
      }
      if (insertedRows && insertedRows.length > 0) {
        const mappingEntries = insertedRows.map((row: any, i: number) => ({
          dantotsu_comment_id: batchDantotsuIds[i], commentum_id: row.id, media_id: batch[i].media_id,
        }))
        for (const entry of mappingEntries) mappingMap.set(entry.dantotsu_comment_id, entry.commentum_id)
        const mapResult = await supabase.from('dantotsu_id_mappings').upsert(mappingEntries, { onConflict: 'dantotsu_comment_id' })
        if (mapResult.error) { console.error('[csv] Mapping error:', mapResult.error); errors += mappingEntries.length }
        else inserted += insertedRows.length
      }
      processed += batch.length
    } catch (e) {
      console.error(`[csv] Batch error at ${idx}:`, e)
      errors += batch.length
    }
    idx += BATCH_SIZE
  }

  if (inserted > 0) {
    await setMeta(supabase, 'csv_hash', csvHash)
    await setMeta(supabase, 'last_sync_at', new Date().toISOString())
  }

  const remaining = unimported.length - idx
  const message = remaining > 0
    ? `Imported ${inserted}, ${remaining} remaining (call again)`
    : `Done! ${inserted} new, ${skipped} already synced`
  console.log(`[csv] ${message}`)
  return { success: errors === 0, mode: 'csv', processed, inserted, skipped, errors, remaining, duration_ms: Date.now() - startTime, message }
}

// ====================================
// API INCREMENTAL SYNC
// ====================================

async function dantotsuAuth(): Promise<string | null> {
  const alToken = Deno.env.get('DANTOTSU_AL_TOKEN')
  if (!alToken) { console.error('[api] DANTOTSU_AL_TOKEN not set'); return null }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${DANTOTSU_API}/authenticate`, {
        method: 'POST',
        headers: { 'appauth': APP_AUTH_KEY },
        body: JSON.stringify({ token: alToken }),
      })
      if (res.ok) { const data = await res.json(); return data.authToken }
      console.error(`[api] Auth ${res.status}, attempt ${attempt + 1}/3`)
      await sleep(5000 * (2 ** attempt))
    } catch (e) { console.error(`[api] Auth error ${attempt + 1}/3:`, e); await sleep(5000 * (2 ** attempt)) }
  }
  return null
}

async function apiSync(supabase: any): Promise<SyncResult> {
  const startTime = Date.now()
  let inserted = 0, errors = 0, checked = 0

  const token = await dantotsuAuth()
  if (!token) return { success: false, mode: 'api', processed: 0, inserted: 0, skipped: 0, errors: 1, remaining: -1, duration_ms: 0, message: 'Dantotsu auth failed' }
  console.log('[api] Authenticated')

  // Get max mapped ID
  const { data: maxMapping } = await supabase.from('dantotsu_id_mappings').select('dantotsu_comment_id').order('dantotsu_comment_id', { ascending: false }).limit(1).single()
  let currentId = maxMapping?.dantotsu_comment_id ? maxMapping.dantotsu_comment_id + 1 : 242
  console.log(`[api] Scanning from ID ${currentId}...`)

  // Load mappings + role map + media cache
  const { data: allMappings } = await supabase.from('dantotsu_id_mappings').select('dantotsu_comment_id, commentum_id')
  const mappingMap = new Map<number, number>()
  if (allMappings) for (const m of allMappings) mappingMap.set(m.dantotsu_comment_id, m.commentum_id)

  const roleMap = await buildRoleMap(supabase)
  const { data: cachedMedia } = await supabase.from('dantotsu_media_cache').select('*')
  const mediaMap = new Map<number, AniListMedia>()
  if (cachedMedia) for (const m of cachedMedia) {
    mediaMap.set(m.media_id, { media_type: m.media_type, media_title: m.media_title, media_year: m.media_year, media_poster: m.media_poster })
  }

  let consecutive404s = 0
  const newMediaIds = new Set<number>()
  const newComments: { comment: any; dantotsuId: number; mediaId: number }[] = []

  while (consecutive404s < 50) {
    if (Date.now() - startTime > TIME_BUDGET_MS) { console.log('[api] Time budget reached'); break }

    let commentData: any = null
    try {
      const res = await fetch(`${DANTOTSU_API}/comments/${currentId}`, {
        headers: { 'appauth': APP_AUTH_KEY, 'Authorization': token },
      })
      if (res.status === 429) { console.log('[api] Rate limited, waiting 30s...'); await sleep(30000); continue }
      if (res.status === 200) commentData = await res.json()
    } catch (e) { console.error(`[api] Error on ${currentId}:`, e) }

    checked++
    if (!commentData) { consecutive404s++; currentId++; await sleep(100); continue }
    consecutive404s = 0

    const dId = commentData.comment_id
    if (mappingMap.has(dId)) { currentId = dId + 1; await sleep(100); continue }

    const rawParent = commentData.parent_comment_id
    const parentId = (rawParent && rawParent !== 0) ? (mappingMap.get(rawParent) || null) : null
    const mediaId = parseInt(commentData.media_id)
    const isDeleted = !!commentData.deleted
    const content = isDeleted ? '[deleted]' : (commentData.content || '')

    newMediaIds.add(mediaId)
    newComments.push({
      comment: {
        client_type: 'anilist',
        user_id: String(commentData.user_id),
        media_id: String(mediaId),
        content,
        username: (commentData.username || 'unknown').slice(0, 50),
        user_avatar: commentData.profile_picture_url || null,
        user_role: getRole(roleMap, String(commentData.user_id)),
        media_type: 'ANIME', media_title: 'Unknown Media', media_year: null, media_poster: null,
        parent_id: parentId,
        deleted: isDeleted,
        deleted_at: isDeleted ? commentData.timestamp || null : null,
        upvotes: commentData.upvotes || 0,
        downvotes: commentData.downvotes || 0,
        vote_score: (commentData.upvotes || 0) - (commentData.downvotes || 0),
        tags: null,
        created_at: commentData.timestamp || null,
        updated_at: commentData.timestamp || null,
      },
      dantotsuId: dId, mediaId,
    })
    currentId = dId + 1
    await sleep(100)
  }

  // Resolve new media from AniList
  if (newMediaIds.size > 0) {
    const fresh = await resolveAniListMedia(supabase, newMediaIds)
    for (const [id, media] of fresh) mediaMap.set(id, media)
  }
  for (const item of newComments) {
    const media = mediaMap.get(item.mediaId)
    if (media) { item.comment.media_type = media.media_type; item.comment.media_title = media.media_title; item.comment.media_year = media.media_year; item.comment.media_poster = media.media_poster }
  }

  // Batch insert
  for (let i = 0; i < newComments.length; i += BATCH_SIZE) {
    const batch = newComments.slice(i, i + BATCH_SIZE)
    try {
      const { data: insertedRows, error } = await supabase.from('comments').insert(batch.map(b => b.comment)).select('id')
      if (error) { console.error('[api] Insert error:', error); errors += batch.length; continue }
      if (insertedRows && insertedRows.length > 0) {
        const mappingEntries = insertedRows.map((row: any, j: number) => ({
          dantotsu_comment_id: batch[j].dantotsuId, commentum_id: row.id, media_id: batch[j].mediaId,
        }))
        for (const entry of mappingEntries) mappingMap.set(entry.dantotsu_comment_id, entry.commentum_id)
        const mapResult = await supabase.from('dantotsu_id_mappings').upsert(mappingEntries, { onConflict: 'dantotsu_comment_id' })
        if (mapResult.error) { console.error('[api] Mapping error:', mapResult.error); errors += mappingEntries.length }
        else inserted += insertedRows.length
      }
    } catch (e) { console.error('[api] Batch error:', e); errors += batch.length }
  }

  if (inserted > 0) {
    await setMeta(supabase, 'last_sync_at', new Date().toISOString())
    await setMeta(supabase, 'last_api_scan_id', String(currentId - 1))
  }

  const message = inserted > 0 ? `Found ${newComments.length} new, inserted ${inserted}` : `No new comments (checked ${checked} IDs)`
  console.log(`[api] ${message}`)
  return { success: errors === 0, mode: 'api', processed: checked, inserted, skipped: checked - newComments.length, errors, remaining: -1, duration_ms: Date.now() - startTime, message }
}

// ====================================
// STATUS
// ====================================

async function getStatus(supabase: any): Promise<any> {
  const { count: totalMappings } = await supabase.from('dantotsu_id_mappings').select('*', { count: 'exact', head: true })
  const { count: totalMedia } = await supabase.from('dantotsu_media_cache').select('*', { count: 'exact', head: true })
  return {
    synced_comments: totalMappings || 0,
    cached_media: totalMedia || 0,
    last_sync_at: await getMeta(supabase, 'last_sync_at'),
    last_api_scan_id: await getMeta(supabase, 'last_api_scan_id'),
    has_al_token: !!Deno.env.get('DANTOTSU_AL_TOKEN'),
  }
}

function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)) }

// ====================================
// MAIN HANDLER
// ====================================

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const action = new URL(req.url).searchParams.get('action') || 'auto'

  try {
    switch (action) {
      case 'status': {
        const status = await getStatus(supabase)
        return new Response(JSON.stringify(status, null, 2), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      case 'csv': {
        console.log('=== CSV SYNC ===')
        const r = await csvSync(supabase)
        console.log('=== DONE ===', r.message)
        return new Response(JSON.stringify(r, null, 2), { status: r.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      case 'api': {
        console.log('=== API SYNC ===')
        const r = await apiSync(supabase)
        console.log('=== DONE ===', r.message)
        return new Response(JSON.stringify(r, null, 2), { status: r.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      case 'auto': {
        const { count } = await supabase.from('dantotsu_id_mappings').select('*', { count: 'exact', head: true })
        if (!count || count === 0) {
          console.log('=== AUTO → CSV ===')
          const r = await csvSync(supabase)
          return new Response(JSON.stringify(r, null, 2), { status: r.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        console.log(`=== AUTO → API (${count} mapped) ===`)
        const r = await apiSync(supabase)
        return new Response(JSON.stringify(r, null, 2), { status: r.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      default:
        return new Response(JSON.stringify({ error: 'Use: status, csv, api, or auto' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
  } catch (e) {
    console.error('Sync error:', e)
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
