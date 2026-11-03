import { createErrorResponse, createEmbedResponse } from '../utils.ts'
import { canModerate } from '../../shared/auth.ts'

// /points_give, /points_deduct, /points_check, /points_undo
// Backed by user_point_adjustments + adjust_user_points() (migration 052).
// Adjustments are added AFTER the normal 0-floor, so a deduction can take a
// balance below zero and it survives every points refresh.

const ADMIN_ROLES = ['admin', 'super_admin', 'app_owner', 'owner']
const STAFF_ROLES = ['moderator', ...ADMIN_ROLES]
const MAX_AMOUNT = 10_000_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const opt = (options: any[], name: string) => options?.find((o: any) => o.name === name)?.value
const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const fmt = (n: number) => Number(n).toLocaleString('en-US')
// 'myanimelist' and 'mal' are the same platform
const normClient = (c: string) => {
  const v = String(c || '').toLowerCase().trim()
  return v === 'myanimelist' ? 'mal' : v
}
const aliases = (c: string) => (normClient(c) === 'mal' ? ['mal', 'myanimelist'] : [normClient(c)])

interface Target {
  userId: string
  clientType: string
  username: string
  role: string
}

// Find the user and the platform they are on. The same numeric id can exist on
// more than one platform, in which case the caller must pass `platform`.
async function resolveTarget(supabase: any, userId: string, platform?: string): Promise<Target | { error: string }> {
  let q = supabase
    .from('commentum_users')
    .select('commentum_client_type, commentum_username, commentum_user_role')
    .eq('commentum_user_id', userId)
  if (platform) q = q.in('commentum_client_type', aliases(platform))
  const { data } = await q

  let rows: Array<{ client: string; username: string; role: string }> = (data || []).map((r: any) => ({
    client: normClient(r.commentum_client_type),
    username: r.commentum_username,
    role: r.commentum_user_role || 'user',
  }))

  if (rows.length === 0) {
    let cq = supabase.from('comments').select('client_type, username').eq('user_id', userId).limit(10)
    if (platform) cq = cq.in('client_type', aliases(platform))
    const { data: c } = await cq
    rows = (c || []).map((r: any) => ({ client: normClient(r.client_type), username: r.username, role: 'user' }))
  }

  const clients = [...new Set(rows.map((r) => r.client))]
  if (clients.length === 0) return { error: 'User not found in the system.' }
  if (clients.length > 1) {
    return { error: `ID ${userId} exists on several platforms (${clients.join(', ')}). Re-run with the \`platform\` option.` }
  }
  const row = rows[0]
  return { userId, clientType: row.client, username: row.username || 'Unknown', role: row.role }
}

async function adjust(supabase: any, t: Target, points: number, reason: string, by: string) {
  const { data, error } = await supabase.rpc('adjust_user_points', {
    p_client_type: t.clientType,
    p_user_id: t.userId,
    p_points: points,
    p_reason: reason,
    p_by: by,
  })
  if (error) throw new Error(error.message || 'adjust_user_points failed')
  return data
}

async function giveOrDeduct(
  kind: 'give' | 'deduct',
  supabase: any,
  moderatorId: string,
  moderatorName: string,
  options: any[],
  userRole: string
) {
  try {
    if (!ADMIN_ROLES.includes(userRole)) {
      return createErrorResponse(`Only admins can ${kind} points.`)
    }
    const userId = opt(options, 'user_id')
    const amount = Math.trunc(Number(opt(options, 'amount')))
    const reason = opt(options, 'reason')
    const platform = opt(options, 'platform')

    if (!userId || !reason) return createErrorResponse('user_id and reason are required.')
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return createErrorResponse(`amount must be a whole number between 1 and ${fmt(MAX_AMOUNT)}.`)
    }

    const t = await resolveTarget(supabase, String(userId), platform)
    if ('error' in t) return createErrorResponse(t.error)

    if (kind === 'deduct' && !canModerate(userRole, t.role)) {
      return createErrorResponse('Cannot deduct points from a user with equal or higher role.')
    }

    const signed = kind === 'give' ? amount : -amount
    const result = await adjust(supabase, t, signed, clip(String(reason)), `${moderatorName} (${moderatorId})`)

    return createEmbedResponse(
      kind === 'give' ? '➕ Points Given' : '➖ Points Deducted',
      `${kind === 'give' ? 'Added' : 'Removed'} **${fmt(amount)}** points ${kind === 'give' ? 'to' : 'from'} **${t.username}**.`,
      [
        { name: 'User', value: `${t.username} (\`${t.userId}\` · ${t.clientType})`, inline: true },
        { name: 'New balance', value: fmt(result?.points ?? 0), inline: true },
        { name: 'Tier', value: String(result?.tier ?? 'n/a'), inline: true },
        { name: 'Reason', value: clip(String(reason)), inline: false },
        { name: 'Adjustment ID', value: `\`${result?.adjustment_id ?? 'n/a'}\``, inline: false },
      ],
      kind === 'give' ? 0x00C853 : 0xD50000,
      { text: `By ${moderatorName} | ${new Date().toLocaleString()}` }
    )
  } catch (error) {
    console.error(`points ${kind} error:`, error)
    return createErrorResponse(`Failed to ${kind} points: ${(error as Error).message}`)
  }
}

export const handlePointsGiveCommand = (supabase: any, id: string, name: string, options: any[], _reg: any, role: string) =>
  giveOrDeduct('give', supabase, id, name, options, role)

export const handlePointsDeductCommand = (supabase: any, id: string, name: string, options: any[], _reg: any, role: string) =>
  giveOrDeduct('deduct', supabase, id, name, options, role)

export async function handlePointsCheckCommand(supabase: any, options: any[], userRole: string) {
  try {
    if (!STAFF_ROLES.includes(userRole)) return createErrorResponse('Only moderators can check points.')

    const userId = opt(options, 'user_id')
    if (!userId) return createErrorResponse('user_id is required.')

    const t = await resolveTarget(supabase, String(userId), opt(options, 'platform'))
    if ('error' in t) return createErrorResponse(t.error)

    const { data: pts, error } = await supabase.rpc('get_user_points', {
      p_client_type: t.clientType,
      p_user_id: t.userId,
    })
    if (error) throw new Error(error.message)

    const { data: adjustments } = await supabase
      .from('user_point_adjustments')
      .select('id, points, reason, created_by, created_at')
      .eq('user_id', t.userId)
      .eq('client_type', normClient(t.clientType))
      .order('created_at', { ascending: false })
      .limit(5)

    const history = (adjustments || []).length
      ? (adjustments as any[])
          .map((a) => `${a.points > 0 ? '+' : ''}${fmt(a.points)} · ${clip(a.reason || 'no reason', 60)}\n\`${a.id}\``)
          .join('\n')
      : 'None'

    return createEmbedResponse(
      '📊 Points',
      `**${t.username}** (\`${t.userId}\` · ${t.clientType})`,
      [
        { name: 'Balance', value: fmt(pts?.points ?? 0), inline: true },
        { name: 'Tier', value: String(pts?.tier ?? 'n/a'), inline: true },
        { name: 'Adjustments total', value: fmt(pts?.adjustments ?? 0), inline: true },
        { name: 'Last adjustments', value: history.slice(0, 1000), inline: false },
      ],
      0x5865F2,
      undefined,
      undefined,
      true // ephemeral
    )
  } catch (error) {
    console.error('points check error:', error)
    return createErrorResponse(`Failed to check points: ${(error as Error).message}`)
  }
}

// Undo = add an offsetting entry, so the audit history is never erased.
export async function handlePointsUndoCommand(
  supabase: any,
  moderatorId: string,
  moderatorName: string,
  options: any[],
  _registration: any,
  userRole: string
) {
  try {
    if (!ADMIN_ROLES.includes(userRole)) return createErrorResponse('Only admins can undo point adjustments.')

    const adjustmentId = String(opt(options, 'adjustment_id') || '').trim()
    if (!UUID_RE.test(adjustmentId)) return createErrorResponse('adjustment_id must be the UUID shown by /points_check.')

    const { data: row } = await supabase
      .from('user_point_adjustments')
      .select('id, user_id, client_type, points, reason')
      .eq('id', adjustmentId)
      .maybeSingle()
    if (!row) return createErrorResponse('Adjustment not found.')
    if (String(row.reason || '').startsWith('undo:')) return createErrorResponse('That entry is already an undo.')

    const { data: already } = await supabase
      .from('user_point_adjustments')
      .select('id')
      .eq('reason', `undo:${adjustmentId}`)
      .limit(1)
    if (already && already.length > 0) return createErrorResponse('That adjustment was already undone.')

    const t: Target = { userId: row.user_id, clientType: row.client_type, username: row.user_id, role: 'user' }
    const result = await adjust(supabase, t, -Number(row.points), `undo:${adjustmentId}`, `${moderatorName} (${moderatorId})`)

    return createEmbedResponse(
      '↩ Adjustment Undone',
      `Reversed ${row.points > 0 ? '+' : ''}${fmt(row.points)} for \`${row.user_id}\` (${row.client_type}).`,
      [
        { name: 'New balance', value: fmt(result?.points ?? 0), inline: true },
        { name: 'Adjustment', value: `\`${adjustmentId}\``, inline: false },
      ],
      0xFFA500,
      { text: `By ${moderatorName} | ${new Date().toLocaleString()}` }
    )
  } catch (error) {
    console.error('points undo error:', error)
    return createErrorResponse(`Failed to undo adjustment: ${(error as Error).message}`)
  }
}
