// Staff authentication and user management for Announcement Studio
// Supports PBKDF2 password hashing (100,000 iterations SHA-256)
// Provides dual storage: PostgreSQL dashboard_users table with config fallback

export interface DashboardUser {
  id: number
  username: string
  password_hash: string
  salt: string
  role: 'owner' | 'super_admin' | 'admin' | 'moderator'
  display_name: string
  avatar_url?: string
  linked_client_type?: string
  linked_user_id?: string
  linked_username?: string
  is_active: boolean
  created_at: string
  updated_at: string
  last_login_at?: string
}

export interface DashboardSession {
  token: string
  user_id: number
  username: string
  role: 'owner' | 'super_admin' | 'admin' | 'moderator'
  display_name: string
  avatar_url?: string
  linked_client_type?: string
  linked_user_id?: string
  expires_at: string
  created_at: string
}

// ------------------------------------
// Cryptographic Helpers (PBKDF2)
// ------------------------------------

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16))
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )
  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: bytesToHex(salt),
  }
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const computed = await hashPassword(password, salt)
  return computed.hash === hash
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return bytesToHex(bytes)
}

// ------------------------------------
// Dual Storage: Table with Config Fallback
// ------------------------------------

export async function getDashboardUsers(supabase: any): Promise<DashboardUser[]> {
  try {
    const { data, error } = await supabase
      .from('dashboard_users')
      .select('*')
      .order('id', { ascending: true })

    if (!error && Array.isArray(data)) {
      return data
    }
  } catch (_) {
    // Fall back to config table
  }

  try {
    const { data } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'dashboard_staff_users')
      .single()

    if (data?.value) {
      return JSON.parse(data.value)
    }
  } catch (_) {}

  return []
}

export async function getDashboardUserByUsername(supabase: any, username: string): Promise<DashboardUser | null> {
  const users = await getDashboardUsers(supabase)
  const norm = username.trim().toLowerCase()
  return users.find(u => u.username.toLowerCase() === norm) || null
}

export async function saveDashboardUser(supabase: any, user: Partial<DashboardUser>): Promise<DashboardUser> {
  const now = new Date().toISOString()
  
  // Try database table first
  try {
    // Partial updates (e.g. login only passes id + last_login_at) must NOT
    // overwrite unspecified columns with defaults — otherwise every login
    // demotes role to 'moderator' and wipes linked_* fields.
    const dbPayload: Record<string, any> = { updated_at: now }
    if (user.username !== undefined) dbPayload.username = user.username
    if (user.password_hash !== undefined) dbPayload.password_hash = user.password_hash
    if (user.salt !== undefined) dbPayload.salt = user.salt
    if (user.role !== undefined) dbPayload.role = user.role
    if (user.display_name !== undefined) dbPayload.display_name = user.display_name
    if (user.avatar_url !== undefined) dbPayload.avatar_url = user.avatar_url
    if (user.linked_client_type !== undefined) dbPayload.linked_client_type = user.linked_client_type
    if (user.linked_user_id !== undefined) dbPayload.linked_user_id = String(user.linked_user_id)
    if (user.linked_username !== undefined) dbPayload.linked_username = user.linked_username
    if (user.is_active !== undefined) dbPayload.is_active = user.is_active

    if (user.id) {
      const { data, error } = await supabase
        .from('dashboard_users')
        .update(dbPayload)
        .eq('id', user.id)
        .select()
        .single()
      if (!error && data) return data
    } else {
      // Creating a new user: apply defaults for any unspecified fields
      const insertPayload: Record<string, any> = {
        username: user.username,
        password_hash: user.password_hash,
        salt: user.salt,
        role: user.role || 'moderator',
        display_name: user.display_name || user.username,
        avatar_url: user.avatar_url || null,
        linked_client_type: user.linked_client_type || null,
        linked_user_id: user.linked_user_id ? String(user.linked_user_id) : null,
        linked_username: user.linked_username || null,
        is_active: user.is_active !== undefined ? user.is_active : true,
        created_at: now,
        ...dbPayload
      }
      const { data, error } = await supabase
        .from('dashboard_users')
        .insert(insertPayload)
        .select()
        .single()
      if (!error && data) return data
    }
  } catch (_) {
    // Fall back to config
  }

  // Config table fallback
  const users = await getDashboardUsers(supabase)
  let saved: DashboardUser

  if (user.id) {
    const idx = users.findIndex(u => u.id === user.id)
    if (idx !== -1) {
      saved = { ...users[idx], ...user, updated_at: now } as DashboardUser
      users[idx] = saved
    } else {
      saved = { ...user, updated_at: now } as DashboardUser
      users.push(saved)
    }
  } else {
    const nextId = users.length > 0 ? Math.max(...users.map(u => u.id || 0)) + 1 : 1
    saved = {
      id: nextId,
      username: user.username!,
      password_hash: user.password_hash!,
      salt: user.salt!,
      role: user.role || 'moderator',
      display_name: user.display_name || user.username!,
      avatar_url: user.avatar_url,
      linked_client_type: user.linked_client_type,
      linked_user_id: user.linked_user_id ? String(user.linked_user_id) : undefined,
      linked_username: user.linked_username,
      is_active: user.is_active !== undefined ? user.is_active : true,
      created_at: now,
      updated_at: now
    }
    users.push(saved)
  }

  await supabase
    .from('config')
    .upsert({ key: 'dashboard_staff_users', value: JSON.stringify(users) }, { onConflict: 'key' })

  return saved
}

export async function deleteDashboardUser(supabase: any, id: number): Promise<boolean> {
  let deletedFromTable = false
  try {
    const { error } = await supabase
      .from('dashboard_users')
      .delete()
      .eq('id', id)
    if (!error) deletedFromTable = true
  } catch (_) {}

  // Also clean config fallback
  try {
    const users = await getDashboardUsers(supabase)
    const filtered = users.filter(u => u.id !== id)
    await supabase
      .from('config')
      .upsert({ key: 'dashboard_staff_users', value: JSON.stringify(filtered) }, { onConflict: 'key' })
  } catch (_) {}

  return true
}

// ------------------------------------
// Session Management
// ------------------------------------

export async function createSession(supabase: any, user: DashboardUser): Promise<string> {
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
  const now = new Date().toISOString()

  // Try sessions table
  try {
    await supabase
      .from('dashboard_sessions')
      .insert({
        token,
        user_id: user.id,
        expires_at: expiresAt,
        created_at: now
      })
  } catch (_) {}

  // Also maintain in config fallback
  try {
    const { data } = await supabase.from('config').select('value').eq('key', 'dashboard_active_sessions').single()
    let sessions: DashboardSession[] = data?.value ? JSON.parse(data.value) : []
    // Filter out expired
    const curTime = Date.now()
    sessions = sessions.filter(s => new Date(s.expires_at).getTime() > curTime)
    sessions.push({
      token,
      user_id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name || user.username,
      avatar_url: user.avatar_url,
      linked_client_type: user.linked_client_type,
      linked_user_id: user.linked_user_id,
      expires_at: expiresAt,
      created_at: now
    })
    await supabase.from('config').upsert({ key: 'dashboard_active_sessions', value: JSON.stringify(sessions) }, { onConflict: 'key' })
  } catch (_) {}

  return token
}

export async function getSession(supabase: any, token: string): Promise<DashboardSession | null> {
  if (!token) return null

  // Try sessions table first
  try {
    const { data, error } = await supabase
      .from('dashboard_sessions')
      .select('*, dashboard_users(*)')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (!error && data && data.dashboard_users) {
      const u = data.dashboard_users
      return {
        token: data.token,
        user_id: u.id,
        username: u.username,
        role: u.role,
        display_name: u.display_name || u.username,
        avatar_url: u.avatar_url,
        linked_client_type: u.linked_client_type,
        linked_user_id: u.linked_user_id,
        expires_at: data.expires_at,
        created_at: data.created_at
      }
    }
  } catch (_) {}

  // Fallback to config table
  try {
    const { data } = await supabase.from('config').select('value').eq('key', 'dashboard_active_sessions').single()
    if (data?.value) {
      const sessions: DashboardSession[] = JSON.parse(data.value)
      const found = sessions.find(s => s.token === token && new Date(s.expires_at).getTime() > Date.now())
      if (found) return found
    }
  } catch (_) {}

  return null
}

export async function revokeSession(supabase: any, token: string): Promise<void> {
  try {
    await supabase.from('dashboard_sessions').delete().eq('token', token)
  } catch (_) {}

  try {
    const { data } = await supabase.from('config').select('value').eq('key', 'dashboard_active_sessions').single()
    if (data?.value) {
      const sessions: DashboardSession[] = JSON.parse(data.value)
      const filtered = sessions.filter(s => s.token !== token)
      await supabase.from('config').upsert({ key: 'dashboard_active_sessions', value: JSON.stringify(filtered) }, { onConflict: 'key' })
    }
  } catch (_) {}
}

// ------------------------------------
// AnymeX / Commentum Role Synchronization
// ------------------------------------

export async function syncCommentumRole(supabase: any, role: string, userId: string | undefined | null, isRemove = false) {
  if (!userId) return

  const roleMap: Record<string, string> = {
    owner: 'owner_users',
    super_admin: 'super_admin_users',
    admin: 'admin_users',
    moderator: 'moderator_users'
  }

  const allKeys = Object.values(roleMap)

  for (const [r, k] of Object.entries(roleMap)) {
    try {
      const { data } = await supabase.from('config').select('value').eq('key', k).single()
      let list: string[] = data?.value ? JSON.parse(data.value) : []
      const contains = list.includes(userId)

      if (r === role && !isRemove) {
        if (!contains) {
          list.push(userId)
          await supabase.from('config').upsert({ key: k, value: JSON.stringify(list) }, { onConflict: 'key' })
        }
      } else if (contains) {
        list = list.filter(id => id !== userId)
        await supabase.from('config').upsert({ key: k, value: JSON.stringify(list) }, { onConflict: 'key' })
      }
    } catch (_) {}
  }
}
