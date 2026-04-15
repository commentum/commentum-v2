import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const BASE_URL = 'http://anymex.duckdns.org:8000/functions/v1'

const ENDPOINTS = [
  {
    name: 'ping',
    path: '/ping',
    method: 'GET',
    body: null,
    // Returns 200 always - it's a simple health check
  },
  {
    name: 'comments',
    path: '/comments',
    method: 'POST',
    // Sending empty action → will hit default case → returns 400 "Invalid action"
    // If it returns 400 = function is ALIVE. If 500 = crashed.
    body: { action: '' },
  },
  {
    name: 'votes',
    path: '/votes',
    method: 'POST',
    // Missing comment_id, user_info, vote_type → returns 400
    body: {},
  },
  {
    name: 'reports',
    path: '/reports',
    method: 'POST',
    // Missing action → hits default switch → returns 400
    body: { action: '' },
  },
  {
    name: 'moderation',
    path: '/moderation',
    method: 'POST',
    // Missing client_type and access_token → returns 401 immediately (before any DB call)
    body: {},
  },
  {
    name: 'users',
    path: '/users',
    method: 'POST',
    // Missing client_type and access_token → returns 401 immediately (before any DB call)
    body: {},
  },
  {
    name: 'media',
    path: '/media',
    method: 'GET',
    // Missing media_id and client_type query params → returns 400
    body: null,
  },
  {
    name: 'announcements',
    path: '/announcements',
    method: 'GET',
    // GET /announcements with no params → returns list (200) or 400
    body: null,
  },
  {
    name: 'discord',
    path: '/discord',
    method: 'POST',
    // Missing Discord signature headers → returns 401 immediately (no DB call)
    body: {},
  },
]

serve(async (_req) => {
  const results = await Promise.all(
    ENDPOINTS.map(async (ep) => {
      const start = Date.now()
      try {
        const res = await fetch(`${BASE_URL}${ep.path}`, {
          method: ep.method,
          headers: { 'Content-Type': 'application/json' },
          body: ep.body !== null ? JSON.stringify(ep.body) : undefined,
          signal: AbortSignal.timeout(5000),
        })
        const latency = Date.now() - start

        // 2xx, 4xx = function is UP and responding correctly
        // 5xx = function crashed = DOWN
        const up = res.status < 500

        return {
          name: ep.name,
          status: up ? 'up' : 'down',
          http_status: res.status,
          latency_ms: latency,
        }
      } catch (err) {
        return {
          name: ep.name,
          status: 'down',
          http_status: null,
          latency_ms: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    })
  )

  const allUp = results.every((r) => r.status === 'up')
  const downCount = results.filter((r) => r.status === 'down').length

  const payload = {
    overall: allUp ? 'healthy' : 'degraded',
    checked_at: new Date().toISOString(),
    summary: {
      total: results.length,
      up: results.length - downCount,
      down: downCount,
    },
    endpoints: results,
  }

  // Returns 200 if all up, 207 if some down (Uptime Kuma treats non-200 as alert)
  return new Response(JSON.stringify(payload, null, 2), {
    status: allUp ? 200 : 207,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
})
