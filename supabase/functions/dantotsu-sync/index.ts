import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const DANTOTSU_API = 'https://api.dantotsu.app'
const APP_AUTH_KEY = '6*45Qp%W2RS@t38jkXoSKY588Ynj%n'
const CSV_URL = 'https://raw.githubusercontent.com/itsmechinmoy/dantotsu-comment-db/refs/heads/main/dantotsu_global_db.csv'
const ANILIST_GRAPHQL = 'https://graphql.anilist.co'
const BUDGET_MS = 45_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// === HELPERS ===

async function getMeta(db: any, k: string) {
  const { data } = await db.from('dantotsu_sync_meta').select('value').eq('key', k).single()
  return data?.value || null
}
async function setMeta(db: any, k: string, v: string) {
  await db.from('dantotsu_sync_meta').upsert({ key: k, value: v, updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

// === TSV PARSER ===

function parseTSV(raw: string): Record<string, string>[] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = '', inQ = false, i = 0
  while (i < raw.length) {
    const c = raw[i]
    if (inQ) {
      if (c === '"') { if (raw[i + 1] === '"') { field += '"'; i += 2; continue } inQ = false; i++; continue }
      field += c; i++; continue
    }
    if (c === '"') { inQ = true; i++; continue }
    if (c === '\t') { cur.push(field); field = ''; i++; continue }
    if (c === '\r' && raw[i + 1] === '\n') { cur.push(field); field = ''; rows.push(cur); cur = []; i += 2; continue }
    if (c === '\n') { cur.push(field); field = ''; rows.push(cur); cur = []; i++; continue }
    field += c; i++
  }
  if (field || cur.length) { cur.push(field); rows.push(cur) }
  if (rows.length < 2) return []
  const h = rows[0]
  return rows.slice(1).map(r => { const o: Record<string, string> = {}; for (let j = 0; j < h.length; j++) o[h[j]] = r[j] || ''; return o })
}

// === ROLE MAP ===

async function buildRoleMap(db: any): Promise<Map<string, string>> {
  const { data: cfgs } = await db.from('config').select('key, value').in('key', ['owner_users', 'super_admin_users', 'admin_users', 'moderator_users'])
  const m = new Map<string, string>()
  for (const c of (cfgs || [])) {
    let users: any[] = []
    try { users = JSON.parse(c.value || '[]') } catch { users = [] }
    const role = c.key.replace('_users', '')
    for (const u of users) if (u != null) { m.set(String(u), role); m.set(String(Number(u)), role) }
  }
  return m
}

// === ANILIST ===

async function fetchAniListBatch(ids: number[]): Promise<Map<number, any>> {
  const r = new Map<number, any>()
  try {
    const res = await fetch(ANILIST_GRAPHQL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query($ids:[Int]){Page(page:1,perPage:25){media(id_in:$ids){id type title{english romaji}coverImage{medium}startDate{year}}}}', variables: { ids } })
    })
    if (!res.ok) return r
    const data = await res.json()
    for (const m of (data?.data?.Page?.media || [])) r.set(m.id, {
      media_type: (m.type || 'ANIME').toLowerCase(), media_title: m.title?.english || m.title?.romaji || 'Unknown Media',
      media_year: m.startDate?.year || null, media_poster: m.coverImage?.medium || null
    })
  } catch (e) { console.error('[al] err:', e) }
  return r
}

// === CSV IMPORT (no AniList — fast) ===

async function csvImport(db: any) {
  const t0 = Date.now()
  let processed = 0, inserted = 0, skipped = 0, errors = 0

  console.log('[csv] loading...')
  let csv: string
  try {
    csv = await Deno.readTextFile('/home/deno/functions/dantotsu-sync/data.csv')
    console.log('[csv] read local file')
  } catch {
    console.log('[csv] fetching from URL...')
    try {
      const res = await fetch(CSV_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      csv = await res.text()
    } catch (e) {
      return { success: false, mode: 'csv', processed: 0, inserted: 0, skipped: 0, errors: 1, remaining: -1, duration_ms: 0, message: `Fetch failed: ${e}` }
    }
  }
  console.log(`[csv] ${(csv.length / 1024 / 1024).toFixed(1)}MB`)

  const rows = parseTSV(csv)
  const comments: any[] = []
  for (const row of rows) {
    const id = parseInt(row['comment_id'])
    if (!id) continue
    const rp = (row['parent_comment_id'] || '').trim()
    const content = (row['content'] || '').trim()
    if (!content) continue
    const av = (row['profile_picture_url'] || '').trim()
    const rt = (row['tag'] || '').trim()
    comments.push({
      dantotsu_id: id, user_id: String(row['user_id'] || '').trim(), media_id: parseInt(row['media_id']),
      parent_comment_id: (rp && rp !== 'NULL' && rp !== '0') ? parseInt(rp) : null,
      content, timestamp: (row['timestamp'] || '').trim(), deleted: row['deleted'] === '1',
      tag: (rt && rt !== 'NULL' && rt !== '0') ? parseInt(rt) : null,
      upvotes: parseInt(row['upvotes']) || 0, downvotes: parseInt(row['downvotes']) || 0,
      username: (row['username'] || '').trim(), avatar_url: (!av || av === 'NULL') ? null : av,
    })
  }
  console.log(`[csv] ${comments.length} valid`)

  const { data: exist } = await db.from('dantotsu_id_mappings').select('dantotsu_comment_id, commentum_id')
  const map = new Map<number, number>()
  if (exist) for (const m of exist) map.set(m.dantotsu_comment_id, m.commentum_id)

  const unimported = comments.filter(c => !map.has(c.dantotsu_id)).sort((a, b) => a.dantotsu_id - b.dantotsu_id)
  skipped = comments.length - unimported.length
  console.log(`[csv] ${unimported.length} new, ${skipped} synced`)

  if (!unimported.length) {
    await setMeta(db, 'csv_done', '1')
    await setMeta(db, 'last_sync_at', new Date().toISOString())
    return { success: true, mode: 'csv', processed: comments.length, inserted: 0, skipped, errors: 0, remaining: 0, duration_ms: Date.now() - t0, message: 'All synced' }
  }

  const roleMap = await buildRoleMap(db)
  let idx = 0
  const deadline = Date.now() + BUDGET_MS

  while (idx < unimported.length && Date.now() < deadline) {
    const batch = unimported.slice(idx, idx + 200)
    const insertRows: any[] = [], danIds: number[] = []
    for (const c of batch) {
      let pid: number | null = null
      if (c.parent_comment_id) pid = map.get(c.parent_comment_id) || null
      insertRows.push({
        client_type: 'anilist', user_id: c.user_id, media_id: String(c.media_id),
        content: c.content.length > 10000 ? c.content.slice(0, 10000) : c.content,
        username: (c.username || 'unknown').slice(0, 50), user_avatar: c.avatar_url,
        user_role: roleMap.get(c.user_id) || 'user',
        media_type: 'anime', media_title: 'Unknown Media', media_year: null, media_poster: null,
        parent_id: pid, deleted: c.deleted, deleted_at: c.deleted ? c.timestamp || null : null,
        upvotes: c.upvotes, downvotes: c.downvotes, vote_score: c.upvotes - c.downvotes,
        tags: c.tag ? JSON.stringify(['spoiler', `episode:${c.tag}`]) : null,
        created_at: c.timestamp || null, updated_at: c.timestamp || null,
      })
      danIds.push(c.dantotsu_id)
    }

    try {
      const { data: ins, error } = await db.from('comments').insert(insertRows).select('id')
      if (error) { console.error(`[csv] err @${idx}:`, error.message); errors += batch.length; idx += 200; continue }
      if (ins?.length) {
        const mappings = ins.map((r: any, i: number) => ({ dantotsu_comment_id: danIds[i], commentum_id: r.id, media_id: batch[i].media_id }))
        for (const m of mappings) map.set(m.dantotsu_comment_id, m.commentum_id)
        const mr = await db.from('dantotsu_id_mappings').upsert(mappings, { onConflict: 'dantotsu_comment_id' })
        if (mr.error) { console.error('[csv] map err:', mr.error.message); errors += mappings.length }
        else inserted += ins.length
      }
      processed += batch.length
    } catch (e) { console.error(`[csv] batch err @${idx}:`, e); errors += batch.length }
    idx += 200
  }

  if (inserted > 0) await setMeta(db, 'last_sync_at', new Date().toISOString())
  if (unimported.length - idx === 0) await setMeta(db, 'csv_done', '1')

  const remaining = unimported.length - idx
  const msg = remaining > 0 ? `Imported ${inserted}, ${remaining} left (call again)` : `Done! ${inserted} new, ${skipped} synced`
  console.log(`[csv] ${msg}`)
  return { success: errors === 0, mode: 'csv', processed, inserted, skipped, errors, remaining, duration_ms: Date.now() - t0, message: msg }
}

// === RESOLVE MEDIA (separate step) ===

async function resolveMedia(db: any) {
  // Find unique media_ids from dantotsu mappings that aren't in cache yet
  const { data: mapped } = await db.from('dantotsu_id_mappings').select('media_id')
  if (!mapped?.length) return { success: true, resolved: 0, cached_total: 0, message: 'No mappings yet' }

  const uniqueIds = [...new Set(mapped.map((r: any) => r.media_id))]
  const { data: cached } = await db.from('dantotsu_media_cache').select('media_id').in('media_id', uniqueIds)
  const cachedSet = new Set((cached || []).map((r: any) => r.media_id))
  const uncached = uniqueIds.filter(id => !cachedSet.has(id))

  if (!uncached.length) return { success: true, resolved: 0, cached_total: cachedSet.size, message: 'All media cached' }

  // Process 25 per call
  const batch = uncached.slice(0, 25)
  console.log(`[media] resolving ${batch.length}/${uncached.length} uncached media...`)
  const fresh = await fetchAniListBatch(batch)
  let resolved = 0

  const toUpsert: any[] = []
  for (const id of batch) {
    const m = fresh.get(id) || { media_type: 'anime', media_title: 'Unknown Media', media_year: null, media_poster: null }
    toUpsert.push({ media_id: id, ...m })
    resolved++
  }
  if (toUpsert.length) await db.from('dantotsu_media_cache').upsert(toUpsert, { onConflict: 'media_id' })

  // Update comments that have default media info
  for (const id of batch) {
    const m = fresh.get(id)
    if (m) await db.from('comments').update({ media_type: m.media_type, media_title: m.media_title, media_year: m.media_year, media_poster: m.media_poster }).eq('media_id', String(id)).eq('media_title', 'Unknown Media')
  }

  return { success: true, resolved, remaining_uncached: uncached.length - batch.length, message: `Resolved ${batch.length} media (${uncached.length - batch.length} left)` }
}

// === DANTOTSU AUTH ===

async function danAuth(): Promise<string | null> {
  const t = Deno.env.get('DANTOTSU_AL_TOKEN')
  if (!t) return null
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${DANTOTSU_API}/authenticate`, {
        method: 'POST', headers: { 'appauth': APP_AUTH_KEY }, body: JSON.stringify({ token: t })
      })
      if (r.ok) return (await r.json()).authToken
      await sleep(5000 * (2 ** i))
    } catch { await sleep(5000 * (2 ** i)) }
  }
  return null
}

// === API SYNC ===

async function apiSync(db: any) {
  const t0 = Date.now()
  let inserted = 0, errors = 0, checked = 0

  const token = await danAuth()
  if (!token) return { success: false, mode: 'api', processed: 0, inserted: 0, skipped: 0, errors: 1, remaining: -1, duration_ms: 0, message: 'Auth failed' }

  const { data: maxM } = await db.from('dantotsu_id_mappings').select('dantotsu_comment_id').order('dantotsu_comment_id', { ascending: false }).limit(1).single()
  let curId = maxM?.dantotsu_comment_id ? maxM.dantotsu_comment_id + 1 : 242

  const { data: allM } = await db.from('dantotsu_id_mappings').select('dantotsu_comment_id, commentum_id')
  const map = new Map<number, number>()
  if (allM) for (const m of allM) map.set(m.dantotsu_comment_id, m.commentum_id)
  const roleMap = await buildRoleMap(db)

  let c404 = 0
  const newC: { row: any; danId: number; mid: number }[] = []
  const deadline = Date.now() + BUDGET_MS

  while (c404 < 50 && Date.now() < deadline) {
    let d: any = null
    try {
      const r = await fetch(`${DANTOTSU_API}/comments/${curId}`, { headers: { 'appauth': APP_AUTH_KEY, 'Authorization': token } })
      if (r.status === 429) { await sleep(30000); continue }
      if (r.status === 200) d = await r.json()
    } catch { }
    checked++
    if (!d) { c404++; curId++; await sleep(100); continue }
    c404 = 0
    if (map.has(d.comment_id)) { curId = d.comment_id + 1; await sleep(100); continue }

    const mid = parseInt(d.media_id)
    const isDel = !!d.deleted
    newC.push({
      row: {
        client_type: 'anilist', user_id: String(d.user_id), media_id: String(mid),
        content: isDel ? '[deleted]' : (d.content || ''),
        username: (d.username || 'unknown').slice(0, 50), user_avatar: d.profile_picture_url || null,
        user_role: roleMap.get(String(d.user_id)) || 'user',
        media_type: 'anime', media_title: 'Unknown Media', media_year: null, media_poster: null,
        parent_id: (d.parent_comment_id && d.parent_comment_id !== 0) ? (map.get(d.parent_comment_id) || null) : null,
        deleted: isDel, deleted_at: isDel ? d.timestamp || null : null,
        upvotes: d.upvotes || 0, downvotes: d.downvotes || 0, vote_score: (d.upvotes || 0) - (d.downvotes || 0),
        tags: null, created_at: d.timestamp || null, updated_at: d.timestamp || null,
      }, danId: d.comment_id, mid
    })
    curId = d.comment_id + 1
    await sleep(100)
  }

  if (newC.length) {
    for (let i = 0; i < newC.length; i += 200) {
      const b = newC.slice(i, i + 200)
      try {
        const { data: ins, error } = await db.from('comments').insert(b.map(x => x.row)).select('id')
        if (error) { errors += b.length; continue }
        if (ins?.length) {
          const mappings = ins.map((r: any, j: number) => ({ dantotsu_comment_id: b[j].danId, commentum_id: r.id, media_id: b[j].mid }))
          for (const m of mappings) map.set(m.dantotsu_comment_id, m.commentum_id)
          await db.from('dantotsu_id_mappings').upsert(mappings, { onConflict: 'dantotsu_comment_id' })
          inserted += ins.length
        }
      } catch { errors += b.length }
    }
  }

  if (inserted > 0) {
    await setMeta(db, 'last_sync_at', new Date().toISOString())
    await setMeta(db, 'last_api_scan_id', String(curId - 1))
  }

  const msg = inserted > 0 ? `Found ${newC.length} new, inserted ${inserted}` : `No new (checked ${checked})`
  return { success: errors === 0, mode: 'api', processed: checked, inserted, skipped: checked - newC.length, errors, remaining: -1, duration_ms: Date.now() - t0, message: msg }
}

// === MAIN ===

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const action = new URL(req.url).searchParams.get('action') || 'auto'

  try {
    switch (action) {
      case 'status': {
        const { count: cm } = await db.from('dantotsu_id_mappings').select('*', { count: 'exact', head: true })
        const { count: md } = await db.from('dantotsu_media_cache').select('*', { count: 'exact', head: true })
        return new Response(JSON.stringify({ synced_comments: cm || 0, cached_media: md || 0, last_sync_at: await getMeta(db, 'last_sync_at'), last_api_scan_id: await getMeta(db, 'last_api_scan_id'), has_al_token: !!Deno.env.get('DANTOTSU_AL_TOKEN') }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      case 'csv': {
        console.log('=== CSV IMPORT ===')
        const r = await csvImport(db)
        return new Response(JSON.stringify(r, null, 2), { status: r.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      case 'resolve-media': {
        console.log('=== RESOLVE MEDIA ===')
        const r = await resolveMedia(db)
        return new Response(JSON.stringify(r, null, 2), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      case 'api': {
        console.log('=== API SYNC ===')
        const r = await apiSync(db)
        return new Response(JSON.stringify(r, null, 2), { status: r.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      case 'auto': {
        const { count } = await db.from('dantotsu_id_mappings').select('*', { count: 'exact', head: true })
        const done = await getMeta(db, 'csv_done')
        if (!count || count === 0 || !done) {
          console.log('=== AUTO → CSV ===')
          const r = await csvImport(db)
          return new Response(JSON.stringify(r, null, 2), { status: r.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        console.log(`=== AUTO → API (${count} mapped) ===`)
        const r = await apiSync(db)
        return new Response(JSON.stringify(r, null, 2), { status: r.success ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      default:
        return new Response(JSON.stringify({ error: 'Use: status, csv, resolve-media, api, auto' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
  } catch (e) {
    console.error('err:', e)
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
