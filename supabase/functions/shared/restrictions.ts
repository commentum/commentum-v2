// Single source of truth for "is this user currently banned / shadow banned / muted?"
//
// State lives in commentum_users, one row per (client_type, user_id). Rows are created
// on demand by get_or_create_commentum_user() using the client_type string the request
// sends, so a different spelling ('mal' vs 'myanimelist', 'AniList' vs 'anilist')
// silently creates a fresh, unbanned row next to the banned one.
//
// The /ban command already treats a user id as one person across every platform, so the
// check does the same: it looks at EVERY row for the id and ignores client_type.
// Expired bans are ignored (the *_until timestamp is the truth, the boolean only resets
// when the 5-minute cron runs). Never use .single() here: 0 or 2+ rows is an error that
// used to read as "not banned".

export interface Restriction {
  type: 'banned' | 'shadow_banned' | 'muted'
  until: string | null
  reason: string | null
}

const isActive = (flag: boolean | null, until: string | null, now: Date) =>
  !!flag && (until === null || new Date(until) > now)

export async function getActiveRestriction(
  supabase: any,
  userId: string | number,
  _clientType?: string | null // accepted for call-site clarity, intentionally unused
): Promise<Restriction | null> {
  try {
    const q = supabase
      .from('commentum_users')
      .select(
        'commentum_user_banned, commentum_user_banned_until, commentum_user_banned_reason, ' +
        'commentum_user_shadow_banned, commentum_user_shadow_banned_until, commentum_user_shadow_banned_reason, ' +
        'commentum_user_muted, commentum_user_muted_until, commentum_user_muted_reason'
      )
      .eq('commentum_user_id', String(userId))

    const { data, error } = await q
    if (error) {
      console.error('getActiveRestriction query failed:', error.message)
      return null // fail open on a DB error, but it is logged
    }

    const now = new Date()
    let mute: Restriction | null = null
    for (const r of (data || [])) {
      if (isActive(r.commentum_user_banned, r.commentum_user_banned_until, now)) {
        return { type: 'banned', until: r.commentum_user_banned_until, reason: r.commentum_user_banned_reason }
      }
      if (isActive(r.commentum_user_shadow_banned, r.commentum_user_shadow_banned_until, now)) {
        return { type: 'shadow_banned', until: r.commentum_user_shadow_banned_until, reason: r.commentum_user_shadow_banned_reason }
      }
      if (!mute && isActive(r.commentum_user_muted, r.commentum_user_muted_until, now)) {
        mute = { type: 'muted', until: r.commentum_user_muted_until, reason: r.commentum_user_muted_reason }
      }
    }
    return mute
  } catch (e) {
    console.error('getActiveRestriction error:', e)
    return null
  }
}

// Shadow bans deliberately look like normal bans to the client.
export function restrictionResponse(r: Restriction, corsHeaders: Record<string, string>): Response {
  const message = r.type === 'muted' ? 'User is muted' : 'User is banned'
  return new Response(
    JSON.stringify({ error: message, until: r.type === 'shadow_banned' ? null : r.until }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
