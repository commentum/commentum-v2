// Enhanced role-based permission system
export interface UserRole {
  level: number;
  permissions: string[];
}

export const ROLE_HIERARCHY: Record<string, UserRole> = {
  'user': {
    level: 0,
    permissions: ['read', 'comment', 'vote', 'report']
  },
  'moderator': {
    level: 1,
    permissions: ['read', 'comment', 'vote', 'report', 'moderate', 'pin', 'lock', 'warn']
  },
  'admin': {
    level: 2,
    permissions: ['read', 'comment', 'vote', 'report', 'moderate', 'pin', 'lock', 'warn', 'ban', 'delete_others', 'manage_reports']
  },
  'super_admin': {
    level: 3,
    permissions: ['*'] // All permissions
  }
}

export function hasPermission(userRole: string, permission: string): boolean {
  const role = ROLE_HIERARCHY[userRole];
  if (!role) return false;
  
  if (role.permissions.includes('*')) return true;
  return role.permissions.includes(permission);
}

export function canPerformAction(userRole: string, action: string, targetRole?: string): boolean {
  // Check basic permission
  if (!hasPermission(userRole, action)) return false;
  
  // Check role hierarchy for actions on other users
  if (targetRole) {
    const userLevel = ROLE_HIERARCHY[userRole]?.level ?? 0;
    const targetLevel = ROLE_HIERARCHY[targetRole]?.level ?? 0;
    
    // Special rules for specific actions
    switch (action) {
      case 'ban':
      case 'delete_others':
        // Only admins and super admins can ban/delete others' content
        return userLevel >= 2;
      case 'warn':
        // Moderators can warn users, admins can warn moderators, super admins can warn anyone
        return userLevel > targetLevel;
      default:
        return true;
    }
  }
  
  return true;
}

export function validateActionPermission(
  userRole: string, 
  action: string, 
  targetUserId?: string, 
  targetUserRole?: string
): { valid: boolean; reason?: string } {
  // Check if user has the basic permission
  if (!hasPermission(userRole, action)) {
    return { valid: false, reason: `Insufficient permissions for action: ${action}` };
  }
  
  // Check role-based restrictions for actions on other users
  if (targetUserId && targetUserRole) {
    if (!canPerformAction(userRole, action, targetUserRole)) {
      return { valid: false, reason: `Cannot perform ${action} on user with role ${targetUserRole}` };
    }
  }
  
  return { valid: true };
}