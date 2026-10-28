import { MiddlewareHandler } from "hono";
import { AppContext, UserJwtPayload } from "../types/env";
import { verifyJwt } from "../shared/jwt";
import { UserRole, hasMinRole } from "../shared/roles";

/**
 * Require valid JWT session token
 */
export const requireAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const authHeader = c.req.header("Authorization") || c.req.header("x-session-token");
  
  if (!authHeader) {
    return c.json({ success: false, error: "Missing Authorization header" }, 401);
  }

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
  const secret = c.env.JWT_SECRET;

  const result = await verifyJwt<UserJwtPayload>(token, secret);
  if (!result.valid || !result.payload) {
    return c.json({ success: false, error: result.error || "Invalid or expired session token" }, 401);
  }

  c.set("user", result.payload);
  await next();
};

/**
 * Optional authentication - extracts user if token provided, but doesn't block if missing
 */
export const optionalAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const authHeader = c.req.header("Authorization") || c.req.header("x-session-token");
  
  if (authHeader) {
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    const secret = c.env.JWT_SECRET;
    const result = await verifyJwt<UserJwtPayload>(token, secret);
    if (result.valid && result.payload) {
      c.set("user", result.payload);
    }
  }

  await next();
};

/**
 * Require minimum staff role (e.g. moderator, admin, owner)
 */
export const requireRole = (minRole: UserRole): MiddlewareHandler<AppContext> => {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ success: false, error: "Authentication required" }, 401);
    }

    if (!hasMinRole(user.role, minRole)) {
      return c.json({ success: false, error: `Insufficient permissions. Requires minimum role: ${minRole}` }, 403);
    }

    await next();
  };
};
