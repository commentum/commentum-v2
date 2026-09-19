// Authentication utilities for admin/moderator verification
import { verifyClientToken, VerifiedUser } from './clientAuth.ts'
import { getConfigs } from './configCache.ts'

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

// Get user role: commentum_users table first (source of truth,
// backfilled from config in migration 032), config lists as fallback
// so any row missed by the backfill still resolves correctly.
const ROLE_ORDER = ['user', 'moderator', 'admin', 'super_admin', 'app_owner', 'owner']

function highestRole(a: string, b: string): string {
  return ROLE_ORDER.indexOf(a) >= ROLE_ORDER.indexOf(b) ? a : b
}

export async function getUserRole(supabase: any, userId: string) {
  try {
    const userIdStr = String(userId)

    // 1. Table first: highest role across all client rows for this user.
    try {
      const { data: rows } = await supabase
        .from('commentum_users')
        .select('commentum_user_role')
        .eq('commentum_user_id', userIdStr)

      let tableRole = 'user'
      for (const r of (rows || [])) {
        const v = (r?.commentum_user_role || 'user').toString().toLowerCase()
        if (ROLE_ORDER.includes(v)) {
          tableRole = highestRole(tableRole, v)
        }
      }
      if (tableRole !== 'user') {
        return tableRole
      }
    } catch {
      // Fall through to config on table errors.
    }
    // 2. Config fallback (kept dual-maintained by all role writers).
    // Get all role configs in ONE query (cached)
    const roles = await getConfigs(supabase, ['owner_users', 'app_owner_users', 'super_admin_users', 'admin_users', 'moderator_users'])
    
    const userIdStr = String(userId)
    const userIdNum = parseInt(userId)

    // Check roles in order of hierarchy
    if (roles.owner_users?.includes(userIdStr) || roles.owner_users?.includes(userIdNum)) {
      return 'owner'
    }
    if (roles.app_owner_users?.includes(userIdStr) || roles.app_owner_users?.includes(userIdNum)) {
      return 'app_owner'
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
    'app_owner': 4,
    'owner': 5
  }
  
  return roleHierarchy[moderatorRole] > roleHierarchy[targetRole]
}

// Unmasked roles: return actual role in API responses
export function getDisplayRole(role: string): string {
  return role || 'user'
}
