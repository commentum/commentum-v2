// Role hierarchy and permissions for Commentum v2

export type UserRole = "user" | "moderator" | "admin" | "super_admin" | "app_owner" | "owner";

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  user: 0,
  moderator: 1,
  admin: 2,
  super_admin: 3,
  app_owner: 4,
  owner: 5,
};

export function hasMinRole(userRole: string, requiredRole: UserRole): boolean {
  const normRole = (userRole || "user").toLowerCase() as UserRole;
  const userLevel = ROLE_HIERARCHY[normRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
  return userLevel >= requiredLevel;
}

export function isModeratorOrHigher(role: string): boolean {
  return hasMinRole(role, "moderator");
}

export function isAdminOrHigher(role: string): boolean {
  return hasMinRole(role, "admin");
}

export function isSuperAdminOrHigher(role: string): boolean {
  return hasMinRole(role, "super_admin");
}

export function isOwner(role: string): boolean {
  return hasMinRole(role, "app_owner");
}
