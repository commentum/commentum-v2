// Authentication utilities for admin/moderator verification

// Check if user has admin/moderator role based on user_id only
export async function verifyAdminAccess(supabase: any, userId: string) {
  // Get user role from config
  const userRole = await getUserRole(supabase, userId)
  if (!['moderator', 'admin', 'super_admin'].includes(userRole)) {
    return { valid: false, reason: 'Insufficient permissions' }
  }

  return { valid: true, role: userRole }
}

// Get user role from configuration
export async function getUserRole(supabase: any, userId: string) {
  try {
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

    const superAdminList = superAdmins ? JSON.parse(superAdmins.value) : []
    const adminList = admins ? JSON.parse(admins.value) : []
    const moderatorList = moderators ? JSON.parse(moderators.value) : []

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
    'super_admin': 3
  }
  
  return roleHierarchy[moderatorRole] > roleHierarchy[targetRole]
}
