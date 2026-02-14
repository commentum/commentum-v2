// Config cache to reduce database queries
// Uses stale-while-revalidate pattern for optimal performance
// Cache is stored globally and persists within the same Edge Function instance

interface ConfigCache {
  data: Record<string, any>
  lastFetch: number
  ttl: number // Time to live in ms
  fetching: boolean // Prevent duplicate fetches
}

const configCache: ConfigCache = {
  data: {},
  lastFetch: 0,
  ttl: 60000, // 1 minute cache
  fetching: false
}

// Store fetched configs for instant access on stale-while-revalidate
let cachedConfigs: Record<string, any> = {}
let cacheTimestamp = 0
let isRefreshing = false

// Commonly accessed configs with defaults
const DEFAULT_CONFIGS: Record<string, any> = {
  system_enabled: true,
  voting_enabled: true,
  reporting_enabled: true,
  max_comment_length: 10000,
  max_nesting_level: 10,
  banned_keywords: [],
  rate_limit_comments_per_hour: 30,
  rate_limit_votes_per_hour: 100,
  rate_limit_reports_per_hour: 10,
  auto_warn_threshold: 3,
  auto_mute_threshold: 5,
  auto_ban_threshold: 10,
  owner_users: [],
  super_admin_users: [],
  admin_users: [],
  moderator_users: [],
  discord_notifications_enabled: true,
  discord_notification_types: ['comment_created', 'comment_deleted', 'user_banned', 'user_warned']
}

// Get a single config value (uses stale-while-revalidate)
// Returns cached data immediately, triggers background refresh if stale
export async function getConfig(supabase: any, key: string): Promise<any> {
  const now = Date.now()
  const isStale = now - cacheTimestamp > 60000
  
  // Trigger background refresh if stale (non-blocking)
  if (isStale && !isRefreshing) {
    triggerBackgroundRefresh(supabase)
  }
  
  // Return cached value immediately (stale data is OK)
  if (cachedConfigs[key] !== undefined) {
    return cachedConfigs[key]
  }
  
  // If no cached data at all, fetch synchronously once
  if (Object.keys(cachedConfigs).length === 0) {
    await refreshCacheSync(supabase)
  }
  
  return cachedConfigs[key] ?? DEFAULT_CONFIGS[key] ?? null
}

// Get multiple config values at once (single query, stale-while-revalidate)
// FAST: Returns cached data immediately, never blocks on DB
export async function getConfigs(supabase: any, keys: string[]): Promise<Record<string, any>> {
  const now = Date.now()
  const isStale = now - cacheTimestamp > 60000
  
  // Trigger background refresh if stale (non-blocking)
  if (isStale && !isRefreshing) {
    triggerBackgroundRefresh(supabase)
  }
  
  // Check if we have NO cache at all (first request ever)
  if (Object.keys(cachedConfigs).length === 0) {
    // Fetch synchronously on first call only
    await refreshCacheSync(supabase)
  }
  
  // Build result from cache (instant)
  const result: Record<string, any> = {}
  for (const key of keys) {
    result[key] = cachedConfigs[key] ?? DEFAULT_CONFIGS[key] ?? null
  }
  
  return result
}

// Background refresh - non-blocking, fire and forget
function triggerBackgroundRefresh(supabase: any) {
  if (isRefreshing) return
  isRefreshing = true
  
  // Fire and forget - don't await
  refreshCacheSync(supabase).finally(() => {
    isRefreshing = false
  })
}

// Synchronous refresh - actually awaits the DB call
async function refreshCacheSync(supabase: any): Promise<void> {
  try {
    const { data: configs, error } = await supabase
      .from('config')
      .select('key, value')
    
    if (!error && configs) {
      const newCache: Record<string, any> = {}
      for (const config of configs) {
        try {
          newCache[config.key] = JSON.parse(config.value)
        } catch {
          newCache[config.key] = config.value
        }
      }
      // Atomic update
      cachedConfigs = newCache
      cacheTimestamp = Date.now()
    }
  } catch (error) {
    console.error('Failed to refresh config cache:', error)
  }
}

// Force refresh cache (call after config updates)
export async function forceRefreshCache(supabase: any): Promise<void> {
  cacheTimestamp = 0
  await refreshCacheSync(supabase)
}

// Check if user is in a role list
export async function isUserInRole(supabase: any, userId: string, roleKey: string): Promise<boolean> {
  const roleList = await getConfig(supabase, roleKey)
  if (!Array.isArray(roleList)) return false
  return roleList.includes(userId) || roleList.includes(parseInt(userId))
}

// Get user's highest role
export async function getUserRoleFromConfig(supabase: any, userId: string): Promise<string> {
  const roles = await getConfigs(supabase, ['owner_users', 'super_admin_users', 'admin_users', 'moderator_users'])
  
  const userIdStr = String(userId)
  const userIdNum = parseInt(userId)
  
  if (roles.owner_users?.includes(userIdStr) || roles.owner_users?.includes(userIdNum)) {
    return 'owner'
  }
  if (roles.super_admin_users?.includes(userIdStr) || roles.super_admin_users?.includes(userIdNum)) {
    return 'super_admin'
  }
  if (roles.admin_users?.includes(userIdStr) || roles.admin_users?.includes(userIdNum)) {
    return 'admin'
  }
  if (roles.moderator_users?.includes(userIdStr) || roles.moderator_users?.includes(userIdNum)) {
    return 'moderator'
  }
  
  return 'user'
}
