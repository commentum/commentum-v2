import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Complete column order aligned with Commentum v2 database schema
const CSV_COLUMNS = [
  'id',
  'created_at',
  'updated_at',
  'client_type',
  'user_id',
  'media_id',
  'content',
  'username',
  'user_avatar',
  'avatar_decoration',
  'banner_url',
  'user_role',
  'media_type',
  'media_title',
  'media_year',
  'media_poster',
  'parent_id',
  'deleted',
  'deleted_at',
  'deleted_by',
  'pinned',
  'pinned_at',
  'pinned_by',
  'locked',
  'locked_at',
  'locked_by',
  'edited',
  'edited_at',
  'edit_count',
  'edit_history',
  'upvotes',
  'downvotes',
  'vote_score',
  'user_votes',
  'reported',
  'report_count',
  'reports',
  'report_status',
  'tags',
  'tagged_by',
  'moderated',
  'moderated_at',
  'moderated_by',
  'moderation_reason',
  'moderation_action',
  'translated_content',
  'original_language',
  'translated_at',
]

/**
 * Format a single value for RFC 4180 CSV compliance
 */
function formatCsvValue(val: any): string {
  if (val === null || val === undefined) {
    return ''
  }

  let str: string
  if (typeof val === 'object') {
    str = JSON.stringify(val)
  } else {
    str = String(val)
  }

  // If string contains comma, quote, or newline, escape quotes and wrap in quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }

  return str
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const backupTokenEnv = Deno.env.get('BACKUP_TOKEN')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Authenticate request: accept Bearer token matching BACKUP_TOKEN or SUPABASE_SERVICE_ROLE_KEY
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    const isValidToken =
      (backupTokenEnv && token === backupTokenEnv) ||
      (serviceRoleKey && token === serviceRoleKey)

    if (!isValidToken) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid or missing backup token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Stream/paginate all comments in batches of 1000 to prevent row truncation
    const allComments: any[] = []
    const batchSize = 1000
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('comments')
        .select('*')
        .order('id', { ascending: true })
        .range(offset, offset + batchSize - 1)

      if (error) {
        console.error('Error fetching comments batch:', error)
        throw error
      }

      if (!data || data.length === 0) {
        break
      }

      allComments.push(...data)
      offset += data.length

      if (data.length < batchSize) {
        hasMore = false
      }
    }

    // Build CSV header and rows
    const headerRow = CSV_COLUMNS.join(',')
    const dataRows = allComments.map((row) =>
      CSV_COLUMNS.map((col) => formatCsvValue(row[col])).join(',')
    )

    const csvContent = [headerRow, ...dataRows].join('\n')

    return new Response(csvContent, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="anymex_global_db.csv"',
        'X-Total-Count': String(allComments.length),
      },
    })
  } catch (err: any) {
    console.error('Backup table error:', err)
    return new Response(
      JSON.stringify({ error: 'Failed to generate comments backup', details: err?.message || String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
