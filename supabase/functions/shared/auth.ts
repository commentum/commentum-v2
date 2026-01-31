// Authentication utilities for admin/moderator verification

// Check if user has admin/moderator role based on user_id only
export async function verifyAdminAccess(supabase: any, userId: string) {
  // Get user role from config
  const userRole = await getUserRole(supabase, userId)
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
    return { valid: false, reason: 'Insufficient permissions' }
  }

  return { valid: true, role: userRole }
}

// Get user information from users table
export async function getUserInfo(supabase: any, userId: string, clientType: string) {
  try {
    const { data: userRecord } = await supabase
      .from('users')
      .select('*')
      .eq('client_type', clientType)
      .eq('user_id', userId)
      .single()

    return userRecord
  } catch (error) {
    console.error('Get user info error:', error)
    return null
  }
}

// Get user role from configuration or users table
export async function getUserRole(supabase: any, userId: string, clientType?: string) {
  try {
    // First try to get from users table if clientType is provided
    if (clientType) {
      const { data: userRecord } = await supabase
        .from('users')
        .select('user_role')
        .eq('client_type', clientType)
        .eq('user_id', userId)
        .single()

      if (userRecord) {
        return userRecord.user_role
      }
    }

    // Fallback to config-based role system
    const { data: owners } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'owner_users')
      .single()

    const { data: superAdmins } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'super_admin_users')
      .single()

    const { data: admins } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'admin_users')
      .single()

    const { data: moderators } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'moderator_users')
      .single()

    const ownerList = owners ? JSON.parse(owners.value) : []
    const superAdminList = superAdmins ? JSON.parse(superAdmins.value) : []
    const adminList = admins ? JSON.parse(admins.value) : []
    const moderatorList = moderators ? JSON.parse(moderators.value) : []

    if (ownerList.includes(userId)) return 'owner'
    if (superAdminList.includes(userId)) return 'super_admin'
    if (adminList.includes(userId)) return 'admin'
    if (moderatorList.includes(userId)) return 'moderator'
    return 'user'
  } catch (error) {
    console.error('Get user role error:', error)
    return 'user'
  }
}

// Check if user can moderate target user
export function canModerate(moderatorRole: string, targetRole: string) {
  const roleHierarchy: { [key: string]: number } = {
    'user': 0,
    'moderator': 1,
    'admin': 2,
    'super_admin': 3,
    'owner': 4
  }
  
  // Handle null/undefined roles by treating them as 'user'
  const moderatorLevel = roleHierarchy[moderatorRole] ?? 0
  const targetLevel = roleHierarchy[targetRole] ?? 0
  
  return moderatorLevel > targetLevel
}

// Hide owner role by displaying it as super_admin in API responses
export function getDisplayRole(role: string): string {
  return role === 'owner' ? 'super_admin' : role
}
