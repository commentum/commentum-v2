import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7/denonext/supabase-js.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const url = new URL(req.url)
    const typeParam = url.searchParams.get('type') // 'decoration', 'banner', 'nameplate', 'effect', 'frame'
    const categoryParam = url.searchParams.get('category')
    const searchParam = url.searchParams.get('search')
    const limitParam = url.searchParams.get('limit')
    const offsetParam = url.searchParams.get('offset')

    let query = supabase
      .from('customizations_catalog')
      .select('id, type, title, category, url, asset_id, description, metadata, points_required, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })

    if (typeParam) {
      query = query.eq('type', typeParam)
    }

    if (categoryParam) {
      query = query.ilike('category', `%${categoryParam}%`)
    }

    if (searchParam) {
      query = query.or(`title.ilike.%${searchParam}%,description.ilike.%${searchParam}%`)
    }

    if (limitParam) {
      const limit = Math.min(Math.max(parseInt(limitParam) || 50, 1), 2000)
      const offset = Math.max(parseInt(offsetParam || '0') || 0, 0)
      query = query.range(offset, offset + limit - 1)
    }

    const { data, error } = await query

    if (error) {
      console.error('Database query error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Format response cleanly
    const items = (data || []).map((row) => {
      const meta = row.metadata || {}
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        category: row.category,
        url: row.url,
        file: meta.file || row.id,
        asset_id: row.asset_id,
        description: row.description,
        points_required: row.points_required || 0,
        // Nameplate specific attributes
        palette: meta.palette,
        static_url: meta.static_url,
        webm_url: row.type === 'nameplate' ? row.url : undefined,
        // Effect specific attributes
        thumbnail_url: meta.thumbnail_url,
        reduced_motion_url: meta.reduced_motion_url,
        effects: meta.effects,
        // Frame specific attributes
        layers: meta.layers,
      }
    })

    // If client requested banners without a specific format, also provide categorized list
    if (typeParam === 'banner' && url.searchParams.get('categorized') === 'true') {
      const categorized: Record<string, typeof items> = {}
      for (const item of items) {
        if (!categorized[item.category]) {
          categorized[item.category] = []
        }
        categorized[item.category].push(item)
      }
      return new Response(JSON.stringify(categorized), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        },
      })
    }

    return new Response(JSON.stringify(items), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    })
  } catch (err: any) {
    console.error('Customizations function error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
