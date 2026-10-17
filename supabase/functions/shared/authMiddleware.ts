// Authentication Middleware for Commentum v2
// Extracts & verifies JWT session tokens from incoming requests

import { verifyJwt, JwtPayload } from './jwt.ts'

export interface AuthUser extends JwtPayload {
  sub: string;             // e.g. "anilist:12345"
  uid: string;             // e.g. "12345"
  provider: string;        // "anilist" | "mal" | "simkl"
  username: string;
  role: string;            // 'user' | 'moderator' | 'admin' | 'super_admin' | 'app_owner' | 'owner'
  is_banned?: boolean;
  is_muted?: boolean;
}

export const ROLE_HIERARCHY = ['user', 'moderator', 'admin', 'super_admin', 'app_owner', 'owner']

export function hasRoleLevel(userRole: string, minRole: string): boolean {
  const userIdx = ROLE_HIERARCHY.indexOf(userRole || 'user')
  const minIdx = ROLE_HIERARCHY.indexOf(minRole || 'user')
  return userIdx >= minIdx
}

export function canModerateRole(modRole: string, targetRole: string): boolean {
  if (modRole === 'owner') return true
  if (modRole === 'app_owner' && targetRole !== 'owner') return true
  if (modRole === 'super_admin' && !['owner', 'app_owner'].includes(targetRole)) return true
  const modIdx = ROLE_HIERARCHY.indexOf(modRole || 'user')
  const targetIdx = ROLE_HIERARCHY.indexOf(targetRole || 'user')
  return modIdx > targetIdx
}

/**
 * Extracts the bearer token from the Authorization header,
 * or x-session-token header, or query param "token"
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim()
    }
    // Direct token without Bearer prefix
    return authHeader.trim()
  }

  const customHeader = req.headers.get('x-session-token')
  if (customHeader) {
    return customHeader.trim()
  }

  // URL query parameter fallback
  try {
    const url = new URL(req.url)
    const tokenQuery = url.searchParams.get('token')
    if (tokenQuery) return tokenQuery.trim()
  } catch (_) {
    // Ignore URL parse error
  }

  return null
}

export interface AuthResult {
  valid: boolean;
  user?: AuthUser;
  error?: string;
  status: number;
}

/**
 * Validates request authorization token
 * @param req The incoming HTTP request
 * @param options requireAuth: true throws 401 if token missing; checkDb: checks real-time ban/mute from DB
 */
export async function getAuthUser(
  req: Request,
  options: { requireAuth?: boolean; supabase?: any; checkDb?: boolean } = { requireAuth: true }
): Promise<AuthResult> {
  const token = extractBearerToken(req)

  if (!token) {
    if (options.requireAuth === false) {
      return { valid: true, status: 200 }
    }
    return {
      valid: false,
      error: 'Missing Authorization header with Bearer token',
      status: 401,
    }
  }

  const verification = await verifyJwt<AuthUser>(token)
  if (!verification.valid || !verification.payload) {
    return {
      valid: false,
      error: verification.error || 'Invalid or expired token',
      status: 401,
    }
  }

  const user = verification.payload

  // Optional real-time DB check for ban/mute status if supabase client passed
  if (options.checkDb && options.supabase) {
    try {
      const dbClientType = user.provider === 'mal' ? 'myanimelist' : user.provider
      const { data: dbUser } = await options.supabase
        .from('commentum_users')
        .select('commentum_user_banned, commentum_user_muted, commentum_user_role')
        .eq('commentum_client_type', dbClientType)
        .eq('commentum_user_id', user.uid)
        .maybeSingle()

      if (dbUser) {
        if (dbUser.commentum_user_banned) {
          return {
            valid: false,
            error: 'User account is banned from Commentum',
            status: 403,
          }
        }
        if (dbUser.commentum_user_role) {
          user.role = dbUser.commentum_user_role
        }
        user.is_muted = dbUser.commentum_user_muted || false
      }
    } catch (e) {
      console.warn('Real-time DB user status check failed, using token claims:', e)
    }
  }

  return {
    valid: true,
    user,
    status: 200,
  }
}

/**
 * Standard JSON response helper
 */
export function jsonResponse(data: any, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  })
}
