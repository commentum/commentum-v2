// Authentication utilities for admin/moderator verification
import { verifyClientToken, VerifiedUser } from './clientAuth.ts'

// Check if user has admin/moderator role based on user_id only
export async function verifyAdminAccess(supabase: any, userId: string) {
  // Get user role from config
  const userRole = await getUserRole(supabase, userId)
  if (!['moderator', 'admin', 'super_admin', 'owner'].includes(userRole)) {
    return { valid: false, reason: 'Insufficient permissions' }
  }

  return { valid: true, role: userRole }
}

/**
 * Verify client token AND check admin access in one call
 * This combines token verification with role checking
 * @param supabase - Supabase client
 * @param clientType - The client type: 'mal', 'anilist', or 'simkl'
 * @param accessToken - The OAuth access token from the client
 * @returns Object with verified user info and role if successful, or error info if failed
 */
export async function verifyTokenAndAdminAccess(
  supabase: any, 
  clientType: string, 
  accessToken: string
): Promise<{
  valid: boolean;
  reason?: string;
  verifiedUser?: VerifiedUser;
  role?: string;
}> {
  // First verify the token with the provider
  const verifiedUser = await verifyClientToken(clientType, accessToken)
  if (!verifiedUser) {
    return { valid: false, reason: 'Invalid or expired access token' }
  }

  // Then check admin access
  const adminAccess = await verifyAdminAccess(supabase, verifiedUser.provider_user_id)
  if (!adminAccess.valid) {
    return { valid: false, reason: adminAccess.reason }
  }

  return {
    valid: true,
    verifiedUser,
    role: adminAccess.role
  }
}

// Get user role from configuration
export async function getUserRole(supabase: any, userId: string) {
  try {
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
  
  return roleHierarchy[moderatorRole] > roleHierarchy[targetRole]
}

// Hide owner role by displaying it as super_admin in API responses
export function getDisplayRole(role: string): string {
  return role === 'owner' ? 'super_admin' : role
}
