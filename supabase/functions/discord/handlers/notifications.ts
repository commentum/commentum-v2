import { createDiscordResponse, createErrorResponse } from '../utils.ts'

// ─────────────────────────────────────────────────────────────
// /notifications  –  turn each PUSH notification type on or off
//
// Master switch  : config.fcm_notifications_enabled   ("true"/"false")
// Per-type list  : config.fcm_notification_types      (JSON array)
// Vote direction : config.fcm_vote_up_enabled / fcm_vote_down_enabled
//                  (missing key = enabled)
// Push code reads these straight from the DB on every send, so changes
// apply immediately (no restart, no cache).
// ─────────────────────────────────────────────────────────────

const MASTER_KEY = 'fcm_notifications_enabled'
const TYPES_KEY = 'fcm_notification_types'

interface Toggle {
  value: string          // dropdown value
  label: string          // dropdown label
  group: string          // heading in /notifications status
  types?: string[]       // entries in fcm_notification_types
  flag?: string          // OR a boolean config key (vote up/down)
}

export const NOTIFICATION_TOGGLES: Toggle[] = [
  { value: 'vote_up', label: 'Upvote', group: 'Votes', flag: 'fcm_vote_up_enabled' },
  { value: 'vote_down', label: 'Downvote', group: 'Votes', flag: 'fcm_vote_down_enabled' },
  { value: 'vote_removed', label: 'Vote removed', group: 'Votes', types: ['vote_removed'] },

  { value: 'comment_created', label: 'New comment', group: 'Comments', types: ['comment_created'] },
  { value: 'comment_reply', label: 'Reply', group: 'Comments', types: ['comment_reply'] },
  { value: 'user_mentioned', label: 'Mention', group: 'Comments', types: ['user_mentioned'] },
  { value: 'comment_updated', label: 'Comment edited', group: 'Comments', types: ['comment_updated'] },
  { value: 'comment_deleted', label: 'Comment deleted', group: 'Comments', types: ['comment_deleted'] },
  { value: 'comment_pin', label: 'Pinned / unpinned', group: 'Comments', types: ['comment_pinned', 'comment_unpinned'] },
  { value: 'comment_lock', label: 'Locked / unlocked', group: 'Comments', types: ['comment_locked', 'comment_unlocked'] },

  { value: 'report_filed', label: 'Report filed', group: 'Reports', types: ['report_filed'] },
  { value: 'report_resolved', label: 'Report resolved', group: 'Reports', types: ['report_resolved'] },
  { value: 'report_dismissed', label: 'Report dismissed', group: 'Reports', types: ['report_dismissed'] },

  { value: 'user_warn', label: 'Warned / unwarned', group: 'Moderation', types: ['user_warned', 'user_unwarned'] },
  { value: 'user_mute', label: 'Muted / unmuted', group: 'Moderation', types: ['user_muted', 'user_unmuted'] },
  { value: 'user_ban', label: 'Banned / unbanned', group: 'Moderation', types: ['user_banned', 'user_unbanned'] },
  { value: 'user_shadowban', label: 'Shadow-banned / removed', group: 'Moderation', types: ['user_shadow_banned', 'user_unshadow_banned'] },
  { value: 'moderation_action', label: 'Other moderation action', group: 'Moderation', types: ['moderation_action'] },

  { value: 'announcement_published', label: 'Announcement', group: 'Announcements', types: ['announcement_published'] },
]

// Dropdown choices for the command definition (Discord allows max 25)
export const NOTIFICATION_TYPE_CHOICES = [
  { name: 'ALL notifications (master switch)', value: 'all' },
  ...NOTIFICATION_TOGGLES.map((t) => ({ name: t.label, value: t.value })),
]

function parseTypes(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function isTrue(raw: string | undefined): boolean {
  if (raw === undefined) return false
  try { return JSON.parse(raw) === true } catch { return false }
}

// vote direction flags: a missing key means enabled
function flagOn(raw: string | undefined): boolean {
  if (raw === undefined) return true
  return String(raw).trim().toLowerCase() !== 'false'
}

async function loadState(supabase: any) {
  const keys = [MASTER_KEY, TYPES_KEY, ...NOTIFICATION_TOGGLES.filter((t) => t.flag).map((t) => t.flag!)]
  const { data, error } = await supabase.from('config').select('key, value').in('key', keys)
  if (error) throw error
  const map = new Map<string, string>()
  for (const row of data || []) map.set(row.key, row.value)
  return { map, master: isTrue(map.get(MASTER_KEY)), types: parseTypes(map.get(TYPES_KEY)) }
}

async function writeConfig(supabase: any, key: string, value: string) {
  const { error } = await supabase
    .from('config')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}

function toggleState(t: Toggle, map: Map<string, string>, types: string[]): '✅' | '❌' | '🔸' {
  if (t.flag) return flagOn(map.get(t.flag)) ? '✅' : '❌'
  const on = (t.types || []).filter((x) => types.includes(x)).length
  if (on === 0) return '❌'
  return on === (t.types || []).length ? '✅' : '🔸'
}

function buildStatus(map: Map<string, string>, master: boolean, types: string[]): string {
  let out = `🔔 **Push Notifications**\n\n` +
    `**Master switch:** ${master ? '✅ ON' : '❌ OFF — nothing is sent to users'}\n`
  let group = ''
  for (const t of NOTIFICATION_TOGGLES) {
    if (t.group !== group) {
      group = t.group
      out += `\n**${group}**\n`
    }
    out += `${toggleState(t, map, types)} ${t.label}\n`
  }
  out += `\n✅ on  ❌ off  🔸 partly on\nChange with \`/notifications\` → pick ON or OFF, then the type.`
  return out
}

export async function handleNotificationsCommand(
  supabase: any,
  moderatorId: string,
  moderatorName: string,
  options: any[],
  registration: any,
  userRole: string
) {
  try {
    const action = options?.find((o: any) => o.name === 'action')?.value || 'status'
    const target = options?.find((o: any) => o.name === 'type')?.value

    const canView = ['admin', 'super_admin', 'app_owner', 'owner'].includes(userRole)
    const canChange = ['super_admin', 'app_owner', 'owner'].includes(userRole)

    if (action === 'status') {
      if (!canView) return createErrorResponse('Only admins can view notification settings.')
      const { map, master, types } = await loadState(supabase)
      return createDiscordResponse(buildStatus(map, master, types))
    }

    if (!canChange) {
      return createErrorResponse('Only super administrators can turn notifications on or off.')
    }
    if (action !== 'on' && action !== 'off') {
      return createErrorResponse('Action must be Status, Turn ON or Turn OFF.')
    }
    if (!target) {
      return createErrorResponse('Pick which notification type to change.')
    }

    const turnOn = action === 'on'
    const { map, master, types } = await loadState(supabase)
    let changedLabel: string

    if (target === 'all') {
      await writeConfig(supabase, MASTER_KEY, turnOn ? 'true' : 'false')
      changedLabel = 'ALL push notifications'
      map.set(MASTER_KEY, turnOn ? 'true' : 'false')
    } else {
      const toggle = NOTIFICATION_TOGGLES.find((t) => t.value === target)
      if (!toggle) return createErrorResponse('Unknown notification type.')
      changedLabel = toggle.label

      if (toggle.flag) {
        await writeConfig(supabase, toggle.flag, turnOn ? 'true' : 'false')
        // votes only send if the base type is enabled; make sure it is when turning on
        if (turnOn && !types.includes('vote_cast')) {
          await writeConfig(supabase, TYPES_KEY, JSON.stringify([...types, 'vote_cast']))
        }
      } else {
        let next = [...types]
        for (const type of toggle.types || []) {
          if (turnOn && !next.includes(type)) next.push(type)
          if (!turnOn) next = next.filter((x) => x !== type)
        }
        await writeConfig(supabase, TYPES_KEY, JSON.stringify(next))
      }
    }

    const fresh = await loadState(supabase)
    let msg =
      `🔔 **${changedLabel}: ${turnOn ? '✅ ON' : '❌ OFF'}**\n` +
      `🛡️ Changed by <@${moderatorId}> (${moderatorName})\n` +
      `⚡ Applies immediately. Turn it back with \`/notifications\` → ${turnOn ? 'Turn OFF' : 'Turn ON'}.`
    if (target !== 'all' && turnOn && !fresh.master) {
      msg += `\n\n⚠️ The master switch is OFF, so nothing is sent until you turn ALL back on.`
    }
    return createDiscordResponse(msg)
  } catch (error: any) {
    console.error('Notifications command error:', error)
    return createErrorResponse(`Failed to update notifications: ${error.message}`)
  }
}
