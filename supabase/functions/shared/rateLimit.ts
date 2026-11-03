// Shared rate limiting for the edge functions.
// Backed by the public.check_rate_limit() SQL function (migration 051), so the
// counters are shared across all function instances. Keyed by user id.
//
// FAIL-OPEN: if the DB call errors (e.g. migration not applied yet) the request
// is allowed and the error is logged - rate limiting must never take the API down.

export interface RateRule {
  /** Unique bucket, e.g. `vote:min:<user_id>` */
  key: string
  limit: number
  windowSec: number
}

export interface RateResult {
  allowed: boolean
  retryAfter: number
}

export async function checkRateLimits(supabase: any, rules: RateRule[]): Promise<RateResult> {
  for (const rule of rules) {
    if (!rule.limit || rule.limit <= 0) continue // 0 / unset = disabled
    try {
      const { data, error } = await supabase.rpc('check_rate_limit', {
        p_key: rule.key,
        p_limit: rule.limit,
        p_window_seconds: rule.windowSec,
      })
      if (error) {
        console.error('[rateLimit] RPC error (allowing request):', error.message || error)
        return { allowed: true, retryAfter: 0 }
      }
      const row = Array.isArray(data) ? data[0] : data
      if (row && row.allowed === false) {
        return { allowed: false, retryAfter: Number(row.retry_after) || rule.windowSec }
      }
    } catch (err) {
      console.error('[rateLimit] exception (allowing request):', err)
      return { allowed: true, retryAfter: 0 }
    }
  }
  return { allowed: true, retryAfter: 0 }
}

export function rateLimitedResponse(message: string, retryAfter: number, corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: message, retry_after: retryAfter }),
    {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
    }
  )
}
