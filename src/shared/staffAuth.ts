import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { dashboardUsers, dashboardSessions, config, commentumUsers } from "../db/schema";
import type { Context } from "hono";
import type { AppContext } from "../types/env";

export interface DashboardUser {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
  role: "owner" | "super_admin" | "admin" | "moderator";
  display_name: string;
  avatar_url?: string | null;
  linked_client_type?: string | null;
  linked_user_id?: string | null;
  linked_username?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
}

export interface DashboardSession {
  token: string;
  user_id: number;
  username: string;
  role: "owner" | "super_admin" | "admin" | "moderator";
  display_name: string;
  avatar_url?: string | null;
  linked_client_type?: string | null;
  linked_user_id?: string | null;
  expires_at: string;
  created_at: string;
}

// ------------------------------------
// Cryptographic Helpers (PBKDF2)
// ------------------------------------

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: bytesToHex(salt),
  };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const computed = await hashPassword(password, salt);
  return computed.hash === hash;
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(bytes);
}

// ------------------------------------
// User Management via D1
// ------------------------------------

export async function getDashboardUsers(d1: D1Database): Promise<DashboardUser[]> {
  const db = drizzle(d1);
  try {
    const rows = await db.select().from(dashboardUsers).orderBy(dashboardUsers.id);
    return rows.map(r => ({
      id: r.id,
      username: r.username,
      password_hash: r.passwordHash,
      salt: r.salt,
      role: r.role as any,
      display_name: r.displayName || r.username,
      avatar_url: r.avatarUrl,
      linked_client_type: r.linkedClientType,
      linked_user_id: r.linkedUserId,
      linked_username: r.linkedUsername,
      is_active: r.isActive,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      last_login_at: r.lastLoginAt,
    }));
  } catch (_) {
    // Fall back to config table
  }

  try {
    const row = await db.select().from(config).where(eq(config.key, "dashboard_staff_users")).limit(1);
    if (row[0]?.value) {
      return JSON.parse(row[0].value);
    }
  } catch (_) {}

  return [];
}

export async function getDashboardUserByUsername(d1: D1Database, username: string): Promise<DashboardUser | null> {
  const users = await getDashboardUsers(d1);
  const norm = username.trim().toLowerCase();
  return users.find(u => u.username.toLowerCase() === norm) || null;
}

export async function saveDashboardUser(d1: D1Database, user: Partial<DashboardUser>): Promise<DashboardUser> {
  const db = drizzle(d1);
  const now = new Date().toISOString();

  if (user.id) {
    const updatePayload: Record<string, any> = { updatedAt: now };
    if (user.username !== undefined) updatePayload.username = user.username;
    if (user.password_hash !== undefined) updatePayload.passwordHash = user.password_hash;
    if (user.salt !== undefined) updatePayload.salt = user.salt;
    if (user.role !== undefined) updatePayload.role = user.role;
    if (user.display_name !== undefined) updatePayload.displayName = user.display_name;
    if (user.avatar_url !== undefined) updatePayload.avatarUrl = user.avatar_url;
    if (user.linked_client_type !== undefined) updatePayload.linkedClientType = user.linked_client_type;
    if (user.linked_user_id !== undefined) updatePayload.linkedUserId = String(user.linked_user_id);
    if (user.linked_username !== undefined) updatePayload.linkedUsername = user.linked_username;
    if (user.is_active !== undefined) updatePayload.isActive = user.is_active;
    if (user.last_login_at !== undefined) updatePayload.lastLoginAt = user.last_login_at;

    await db.update(dashboardUsers).set(updatePayload).where(eq(dashboardUsers.id, user.id));
    const updated = await db.select().from(dashboardUsers).where(eq(dashboardUsers.id, user.id)).limit(1);
    if (updated[0]) {
      const u = updated[0];
      return {
        id: u.id,
        username: u.username,
        password_hash: u.passwordHash,
        salt: u.salt,
        role: u.role as any,
        display_name: u.displayName || u.username,
        avatar_url: u.avatarUrl,
        linked_client_type: u.linkedClientType,
        linked_user_id: u.linkedUserId,
        linked_username: u.linkedUsername,
        is_active: u.isActive,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        last_login_at: u.lastLoginAt,
      };
    }
  } else {
    const inserted = await db.insert(dashboardUsers).values({
      username: user.username!,
      passwordHash: user.password_hash!,
      salt: user.salt!,
      role: user.role || "moderator",
      displayName: user.display_name || user.username,
      avatarUrl: user.avatar_url || null,
      linkedClientType: user.linked_client_type || null,
      linkedUserId: user.linked_user_id ? String(user.linked_user_id) : null,
      linkedUsername: user.linked_username || null,
      isActive: user.is_active !== undefined ? user.is_active : true,
      createdAt: now,
      updatedAt: now,
    }).returning();

    if (inserted[0]) {
      const u = inserted[0];
      return {
        id: u.id,
        username: u.username,
        password_hash: u.passwordHash,
        salt: u.salt,
        role: u.role as any,
        display_name: u.displayName || u.username,
        avatar_url: u.avatarUrl,
        linked_client_type: u.linkedClientType,
        linked_user_id: u.linkedUserId,
        linked_username: u.linkedUsername,
        is_active: u.isActive,
        created_at: u.createdAt,
        updated_at: u.updatedAt,
        last_login_at: u.lastLoginAt,
      };
    }
  }

  throw new Error("Failed to save dashboard user");
}

export async function deleteDashboardUser(d1: D1Database, id: number): Promise<boolean> {
  const db = drizzle(d1);
  await db.delete(dashboardSessions).where(eq(dashboardSessions.userId, id));
  await db.delete(dashboardUsers).where(eq(dashboardUsers.id, id));
  return true;
}

// ------------------------------------
// Session Management
// ------------------------------------

export async function createSession(d1: D1Database, user: DashboardUser): Promise<string> {
  const db = drizzle(d1);
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  const now = new Date().toISOString();

  await db.insert(dashboardSessions).values({
    id: crypto.randomUUID(),
    token,
    userId: user.id,
    expiresAt,
    createdAt: now,
  });

  return token;
}

export async function getSession(d1: D1Database, token: string): Promise<DashboardSession | null> {
  if (!token) return null;
  const db = drizzle(d1);
  const now = new Date().toISOString();

  try {
    const sessions = await db
      .select()
      .from(dashboardSessions)
      .where(eq(dashboardSessions.token, token))
      .limit(1);

    if (sessions[0] && sessions[0].expiresAt > now) {
      const s = sessions[0];
      const users = await db
        .select()
        .from(dashboardUsers)
        .where(eq(dashboardUsers.id, s.userId))
        .limit(1);

      if (users[0]) {
        const u = users[0];
        return {
          token: s.token,
          user_id: u.id,
          username: u.username,
          role: u.role as any,
          display_name: u.displayName || u.username,
          avatar_url: u.avatarUrl,
          linked_client_type: u.linkedClientType,
          linked_user_id: u.linkedUserId,
          expires_at: s.expiresAt,
          created_at: s.createdAt,
        };
      }
    }
  } catch (_) {}

  return null;
}

export async function revokeSession(d1: D1Database, token: string): Promise<void> {
  const db = drizzle(d1);
  await db.delete(dashboardSessions).where(eq(dashboardSessions.token, token));
}

// ------------------------------------
// Role Synchronization
// ------------------------------------

export async function syncCommentumRole(d1: D1Database, role: string, userId: string | undefined | null, isRemove = false) {
  if (!userId) return;
  const db = drizzle(d1);

  const roleMap: Record<string, string> = {
    owner: "owner_users",
    super_admin: "super_admin_users",
    admin: "admin_users",
    moderator: "moderator_users",
  };

  for (const [r, k] of Object.entries(roleMap)) {
    try {
      const rows = await db.select().from(config).where(eq(config.key, k)).limit(1);
      let list: string[] = rows[0]?.value ? JSON.parse(rows[0].value) : [];
      const contains = list.includes(userId);

      if (r === role && !isRemove) {
        if (!contains) {
          list.push(userId);
          await db.insert(config).values({ key: k, value: JSON.stringify(list) })
            .onConflictDoUpdate({ target: config.key, set: { value: JSON.stringify(list) } });
        }
      } else if (contains) {
        list = list.filter(id => id !== userId);
        await db.insert(config).values({ key: k, value: JSON.stringify(list) })
          .onConflictDoUpdate({ target: config.key, set: { value: JSON.stringify(list) } });
      }
    } catch (_) {}
  }

  // Also sync to commentum_users table
  try {
    const targetRole = isRemove ? "user" : (role === "owner" || role === "super_admin" ? "admin" : role);
    await db.update(commentumUsers)
      .set({ commentumUserRole: targetRole, updatedAt: new Date().toISOString() })
      .where(eq(commentumUsers.commentumUserId, userId));
  } catch (_) {}
}

// ------------------------------------
// Staff Auth Middleware Helpers
// ------------------------------------

const ROLE_RANKS: Record<string, number> = {
  moderator: 1,
  admin: 2,
  super_admin: 3,
  owner: 4,
};

export function extractStaffToken(c: Context<any>): string | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  return c.req.header("x-session-token") || null;
}

export async function checkStaffAuth(
  c: Context<any>,
  minRole: "moderator" | "admin" | "super_admin" | "owner" = "moderator"
): Promise<{ success: boolean; user?: DashboardUser; error?: string }> {
  const adminKey = c.req.header("x-admin-key");
  const authHeader = c.req.header("Authorization");
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : null;

  if ((adminKey && adminKey === c.env.ADMIN_API_KEY) || (token && token === c.env.ADMIN_API_KEY)) {
    return {
      success: true,
      user: {
        id: 0,
        username: "system_admin",
        role: "owner",
        display_name: "Master Admin",
        avatar_url: null,
        linked_client_type: null,
        linked_user_id: null,
        linked_username: null,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        password_hash: "",
        salt: "",
      },
    };
  }

  const sessionToken = extractStaffToken(c);
  if (!sessionToken) {
    return { success: false, error: "Missing authentication token" };
  }

  const session = await getSession(c.env.DB, sessionToken);
  if (!session) {
    return { success: false, error: "Invalid or expired session" };
  }

  const userRoleRank = ROLE_RANKS[session.role] || 0;
  const reqRoleRank = ROLE_RANKS[minRole] || 1;

  if (userRoleRank < reqRoleRank) {
    return { success: false, error: `Insufficient permissions. Requires '${minRole}' or higher.` };
  }

  return {
    success: true,
    user: {
      id: session.user_id,
      username: session.username,
      role: session.role,
      display_name: session.display_name,
      avatar_url: session.avatar_url,
      linked_client_type: session.linked_client_type,
      linked_user_id: session.linked_user_id,
      linked_username: session.username,
      is_active: true,
      created_at: session.created_at,
      updated_at: session.created_at,
      password_hash: "",
      salt: "",
    },
  };
}
