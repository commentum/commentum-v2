import { eq, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { fcmTokens, notificationPreferences, notifications, config } from "../db/schema";
import { getPlainTextPreview } from "./mentionUtils";
import type { Context } from "hono";
import type { Bindings } from "../types/env";

// ============================================
// FCM Push Notification System
// Cloudflare Workers Native (Web Crypto API RS256)
// Uses FCM v1 API with Service Account (OAuth2)
// ============================================

let cachedAccessToken: string | null = null;
let tokenExpiryTime: number = 0;

export type FcmNotificationType =
  | "comment_created"
  | "comment_reply"
  | "comment_updated"
  | "comment_deleted"
  | "comment_pinned"
  | "comment_unpinned"
  | "user_mentioned"
  | "comment_locked"
  | "comment_unlocked"
  | "vote_cast"
  | "vote_removed"
  | "report_filed"
  | "report_resolved"
  | "report_dismissed"
  | "user_warned"
  | "user_unwarned"
  | "user_muted"
  | "user_unmuted"
  | "user_banned"
  | "user_unbanned"
  | "user_shadow_banned"
  | "user_unshadow_banned"
  | "announcement_published"
  | "moderation_action";

export interface FcmNotificationPayload {
  type: FcmNotificationType;
  targetUserId: string;
  targetClientType: string;
  comment?: {
    id: number | string;
    user_id?: string;
    username?: string;
    content?: string;
    client_type?: string;
    media_id?: string;
    media_type?: string;
    media_title?: string;
    parent_id?: number | null;
  };
  actor?: {
    id: string;
    username?: string;
    avatar?: string;
  };
  media?: {
    id?: string;
    type?: string;
    title?: string;
    year?: number;
    poster?: string;
    client_type?: string;
  };
  moderator?: {
    id?: string;
    username?: string;
  };
  reason?: string;
  voteType?: "upvote" | "downvote";
  voteScore?: number;
  reportReason?: string;
  metadata?: any;
  announcementTitle?: string;
  announcementContent?: string;
  announcementId?: string;
  duration?: string;
}

const NOTIFICATION_PREF_MAP: Record<FcmNotificationType, string> = {
  comment_created: "notify_on_recent_comment",
  comment_reply: "notify_on_reply",
  comment_updated: "notify_on_mod_action",
  comment_deleted: "notify_on_comment_delete",
  comment_pinned: "notify_on_mod_action",
  comment_unpinned: "notify_on_mod_action",
  comment_locked: "notify_on_mod_action",
  comment_unlocked: "notify_on_mod_action",
  vote_cast: "notify_on_vote",
  vote_removed: "notify_on_vote",
  report_filed: "notify_on_mod_action",
  report_resolved: "notify_on_mod_action",
  report_dismissed: "notify_on_mod_action",
  user_mentioned: "notify_on_mention",
  user_warned: "notify_on_mod_action",
  user_unwarned: "notify_on_mod_action",
  user_muted: "notify_on_mod_action",
  user_unmuted: "notify_on_mod_action",
  user_banned: "notify_on_mod_action",
  user_unbanned: "notify_on_mod_action",
  user_shadow_banned: "notify_on_mod_action",
  user_unshadow_banned: "notify_on_mod_action",
  announcement_published: "notify_on_announcement",
  moderation_action: "notify_on_mod_action",
};

const FORCE_SEND_TYPES: FcmNotificationType[] = [
  "user_warned",
  "user_unwarned",
  "user_muted",
  "user_unmuted",
  "user_banned",
  "user_unbanned",
  "user_shadow_banned",
  "user_unshadow_banned",
];

export function getNotificationContent(payload: FcmNotificationPayload): { title: string; body: string } {
  const actorName = payload.actor?.username || "Someone";
  const mediaTitle = payload.comment?.media_title || payload.media?.title || "Unknown";
  const commentPreview = payload.comment?.content
    ? getPlainTextPreview(payload.comment.content, 80)
    : "";
  const modName = payload.moderator?.username || "A moderator";
  const voteEmoji = payload.voteType === "upvote" ? "▲" : "▼";
  const duration = payload.duration || "Not specified";

  switch (payload.type) {
    case "comment_created":
      return {
        title: "💬 New Comment",
        body: `${actorName} commented on ${mediaTitle}${commentPreview ? `: "${commentPreview}"` : ""}`,
      };
    case "comment_reply":
      return {
        title: "New Reply",
        body: `${actorName} replied to your comment on ${mediaTitle}${commentPreview ? `: "${commentPreview}"` : ""}`,
      };
    case "user_mentioned":
      return {
        title: "You Were Mentioned",
        body: `${actorName} mentioned you on ${mediaTitle}${commentPreview ? `: "${commentPreview}"` : ""}`,
      };
    case "comment_updated":
      return {
        title: "Comment Edited",
        body: `Your comment on ${mediaTitle} was edited${commentPreview ? `: "${commentPreview}"` : ""}`,
      };
    case "comment_deleted":
      return {
        title: "Comment Deleted",
        body: `Your comment on ${mediaTitle} was deleted by ${modName}.${payload.reason ? ` Reason: ${payload.reason}` : ""}`,
      };
    case "comment_pinned":
      return {
        title: "Comment Pinned",
        body: `${modName} pinned your comment on ${mediaTitle}.`,
      };
    case "comment_unpinned":
      return {
        title: "Comment Unpinned",
        body: `${modName} unpinned your comment on ${mediaTitle}.`,
      };
    case "comment_locked":
      return {
        title: "Thread Locked",
        body: `${modName} locked the comment thread on ${mediaTitle}.`,
      };
    case "comment_unlocked":
      return {
        title: "Thread Unlocked",
        body: `${modName} unlocked the comment thread on ${mediaTitle}.`,
      };
    case "vote_cast":
      return {
        title: `${voteEmoji} New Vote`,
        body: `${actorName} ${payload.voteType || "voted on"} your comment on ${mediaTitle} (Score: ${payload.voteScore ?? 0})`,
      };
    case "vote_removed":
      return {
        title: "Vote Removed",
        body: `${actorName} removed their vote on your comment on ${mediaTitle} (Score: ${payload.voteScore ?? 0})`,
      };
    case "report_filed":
      return {
        title: "Comment Reported",
        body: `Your comment on ${mediaTitle} was reported.${payload.reportReason ? ` Reason: ${payload.reportReason}` : ""}`,
      };
    case "report_resolved":
      return {
        title: "Report Resolved",
        body: `The report on your comment on ${mediaTitle} was resolved.`,
      };
    case "report_dismissed":
      return {
        title: "Report Dismissed",
        body: `The report on your comment on ${mediaTitle} was dismissed.`,
      };
    case "user_warned":
      return {
        title: "Warning Received",
        body: `${modName} issued you a warning.${payload.reason ? ` Reason: ${payload.reason}` : ""}`,
      };
    case "user_muted":
      return {
        title: "You Have Been Muted",
        body: `${modName} muted you for ${duration}.${payload.reason ? ` Reason: ${payload.reason}` : ""}`,
      };
    case "user_unmuted":
      return {
        title: "Unmuted",
        body: `${modName} has unmuted you. You can now post comments again.`,
      };
    case "user_banned":
      return {
        title: "Banned",
        body: `${modName} banned you for ${duration}.${payload.reason ? ` Reason: ${payload.reason}` : ""}`,
      };
    case "user_unbanned":
      return {
        title: "Unbanned",
        body: `${modName} has unbanned you. Welcome back!`,
      };
    case "user_unwarned":
      return {
        title: "Warning Removed",
        body: `${modName} has removed a warning from your account.${payload.reason ? ` Reason: ${payload.reason}` : ""}`,
      };
    case "user_unshadow_banned":
      return {
        title: "Restriction Lifted",
        body: `Your account restriction has been lifted by ${modName}. You can now interact normally.`,
      };
    case "user_shadow_banned":
      return {
        title: "Restricted",
        body: `Your account has been restricted by ${modName}.${payload.reason ? ` Reason: ${payload.reason}` : ""}`,
      };
    case "announcement_published":
      return {
        title: payload.announcementTitle || "📢 New Announcement",
        body: payload.announcementContent
          ? getPlainTextPreview(payload.announcementContent, 100)
          : "A new announcement has been published.",
      };
    default:
      return {
        title: "Notification",
        body: "You have a new notification on AnymeX.",
      };
  }
}

export function buildClickAction(payload: FcmNotificationPayload): string {
  const clientType = payload.comment?.client_type || payload.media?.client_type || payload.targetClientType || "anilist";
  const mediaType = payload.comment?.media_type || payload.media?.type || "anime";
  const mediaId = payload.comment?.media_id || payload.media?.id || "";

  if (mediaId) {
    const commentSuffix = payload.comment?.id ? `#comment-${payload.comment.id}` : "";
    return `anymex://${clientType}/${mediaType}/${mediaId}${commentSuffix}`;
  }
  return "anymex://notifications";
}

export function getAndroidChannelId(type: FcmNotificationType): string {
  if (["vote_cast", "vote_removed"].includes(type)) return "votes";
  if ([
    "user_warned", "user_unwarned", "user_muted", "user_unmuted",
    "user_banned", "user_unbanned", "user_shadow_banned", "user_unshadow_banned", "moderation_action",
  ].includes(type)) return "moderation";
  if (["report_filed", "report_resolved", "report_dismissed"].includes(type)) return "reports";
  if (type === "announcement_published") return "announcements";
  if (type === "user_mentioned") return "mentions";
  return "comments";
}

export function getNotificationTargetUserId(
  type: string,
  commentUserId: string | undefined,
  parentCommentUserId?: string | undefined,
  targetUserIdOverride?: string
): string | null {
  if (targetUserIdOverride) return targetUserIdOverride;
  const userActionTypes = [
    "user_warned", "user_unwarned", "user_muted", "user_unmuted",
    "user_banned", "user_unbanned", "user_shadow_banned", "user_unshadow_banned", "moderation_action",
  ];
  if (userActionTypes.includes(type) && commentUserId) return commentUserId;
  if (["vote_cast", "vote_removed", "report_filed", "comment_deleted"].includes(type) && commentUserId) return commentUserId;
  if (["comment_pinned", "comment_unpinned", "comment_locked", "comment_unlocked"].includes(type) && commentUserId) return commentUserId;
  if (["report_resolved", "report_dismissed"].includes(type) && commentUserId) return commentUserId;
  if (type === "comment_reply" && parentCommentUserId) return parentCommentUserId;
  return null;
}

// ============================================
// OAUTH2: Access Token from Google Service Account
// ============================================

export async function getFcmAccessToken(env: any): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiryTime - 300000) {
    return cachedAccessToken;
  }

  const clientEmail = env.FIREBASE_CLIENT_EMAIL || env.FCM_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_PRIVATE_KEY || env.FCM_PRIVATE_KEY;
  const projectId = env.FIREBASE_PROJECT_ID || env.FCM_PROJECT_ID;

  if (!clientEmail || !privateKey || !projectId) {
    throw new Error("Missing FCM env variables (FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID)");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const jwtPayload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: any) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const unsignedJwt = `${encode(header)}.${encode(jwtPayload)}`;

  const privateKeyClean = privateKey.replace(/\\n/g, "\n");
  const pemContents = privateKeyClean
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .trim();

  const binaryKey = atob(pemContents);
  const keyData = new Uint8Array(binaryKey.length);
  for (let i = 0; i < binaryKey.length; i++) {
    keyData[i] = binaryKey.charCodeAt(i);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedJwt)
  );

  const sigArray = new Uint8Array(signature);
  let sigBase64 = "";
  for (let i = 0; i < sigArray.length; i++) {
    sigBase64 += String.fromCharCode(sigArray[i]);
  }
  sigBase64 = btoa(sigBase64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${unsignedJwt}.${sigBase64}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    throw new Error(`Failed to get FCM access token: ${err}`);
  }

  const tokenData: any = await tokenResponse.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiryTime = Date.now() + tokenData.expires_in * 1000;

  return cachedAccessToken!;
}

// ============================================
// CORE: SEND FCM NOTIFICATION
// ============================================

export async function sendFcmNotification(env: any, payload: FcmNotificationPayload): Promise<void> {
  try {
    const db = drizzle(env.DB);

    // 1. Check if FCM globally enabled
    const fcmEnabledRow = await db.select().from(config).where(eq(config.key, "fcm_notifications_enabled")).limit(1);
    if (!fcmEnabledRow[0] || JSON.parse(fcmEnabledRow[0].value) !== true) {
      await storeNotificationHistory(db, payload, false, false, "FCM disabled");
      return;
    }

    // 2. Check if notification type is enabled
    const typesConfigRow = await db.select().from(config).where(eq(config.key, "fcm_notification_types")).limit(1);
    const enabledTypes: string[] = typesConfigRow[0] ? JSON.parse(typesConfigRow[0].value) : [];
    if (enabledTypes.length > 0 && !enabledTypes.includes(payload.type)) {
      await storeNotificationHistory(db, payload, false, false, `Type ${payload.type} disabled`);
      return;
    }

    // 3. User notification preferences (for non-broadcast and non-forced)
    if (payload.targetUserId !== "broadcast" && !FORCE_SEND_TYPES.includes(payload.type)) {
      const prefKey = NOTIFICATION_PREF_MAP[payload.type];
      const prefRows = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, payload.targetUserId));

      if (prefRows.length > 0 && (prefRows[0] as any)[prefKey] === false) {
        await storeNotificationHistory(db, payload, false, false, "User preference disabled");
        return;
      }
    }

    // 4. Query active device tokens
    let tokens: { fcmToken: string; userId: string }[] = [];
    if (payload.targetUserId === "broadcast") {
      tokens = await db.select({ fcmToken: fcmTokens.fcmToken, userId: fcmTokens.userId })
        .from(fcmTokens)
        .where(eq(fcmTokens.isActive, true))
        .limit(1000);
    } else {
      tokens = await db.select({ fcmToken: fcmTokens.fcmToken, userId: fcmTokens.userId })
        .from(fcmTokens)
        .where(and(eq(fcmTokens.userId, payload.targetUserId), eq(fcmTokens.isActive, true)));
    }

    if (tokens.length === 0) {
      await storeNotificationHistory(db, payload, false, false, "No active device tokens");
      return;
    }

    // 5. Build notification payload
    const { title, body } = getNotificationContent(payload);
    const clickAction = buildClickAction(payload);
    const effectiveActor = payload.actor || (payload.moderator ? {
      id: payload.moderator.id || "",
      username: payload.moderator.username || "",
      avatar: (payload.moderator as any).avatar || "",
    } : null);

    const serviceClientType = payload.comment?.client_type || payload.media?.client_type || payload.targetClientType || "anilist";
    const announcementId = payload.announcementId || (payload.metadata?.announcement_id ? String(payload.metadata.announcement_id) : "");

    const messageData: Record<string, string> = {
      type: payload.type,
      title,
      body,
      announcement_id: announcementId,
      comment_id: payload.comment?.id?.toString() || "",
      media_id: payload.comment?.media_id || payload.media?.id || "",
      media_type: payload.comment?.media_type || payload.media?.type || "",
      media_title: payload.comment?.media_title || payload.media?.title || "",
      client_type: serviceClientType,
      actor_id: effectiveActor?.id || "",
      actor_username: effectiveActor?.username || "",
      actor_avatar: effectiveActor?.avatar || "",
      click_action: clickAction,
      timestamp: new Date().toISOString(),
      channel_id: getAndroidChannelId(payload.type),
    };

    let accessToken: string;
    try {
      accessToken = await getFcmAccessToken(env);
    } catch (err: any) {
      console.error("FCM Token generation error:", err?.message);
      await storeNotificationHistory(db, payload, false, false, err?.message);
      return;
    }

    const projectId = env.FIREBASE_PROJECT_ID || env.FCM_PROJECT_ID;
    let totalSuccess = 0;
    let totalFailure = 0;
    const invalidTokens: string[] = [];
    const seenTokens = new Set<string>();

    for (const tokenRecord of tokens) {
      if (seenTokens.has(tokenRecord.fcmToken)) continue;
      seenTokens.add(tokenRecord.fcmToken);

      const fcmMessage = {
        message: {
          token: tokenRecord.fcmToken,
          notification: { title, body },
          data: messageData,
          android: {
            priority: "HIGH",
            notification: {
              channel_id: getAndroidChannelId(payload.type),
              sound: "default",
              default_vibrate_timings: true,
            },
          },
          apns: {
            payload: {
              aps: { sound: "default", badge: 1 },
            },
          },
        },
      };

      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fcmMessage),
        });

        if (res.ok) {
          totalSuccess++;
        } else {
          totalFailure++;
          const errData: any = await res.json().catch(() => ({}));
          const errMsg = errData?.error?.message || await res.text();
          if (res.status === 404 || errMsg.includes("NotRegistered") || errMsg.includes("registration-token-not-registered")) {
            invalidTokens.push(tokenRecord.fcmToken);
          }
        }
      } catch (_) {
        totalFailure++;
      }
    }

    // Clean up inactive tokens
    if (invalidTokens.length > 0) {
      await db.update(fcmTokens)
        .set({ isActive: false, lastUsedAt: new Date().toISOString() })
        .where(inArray(fcmTokens.fcmToken, invalidTokens));
    }

    const fcmDelivered = totalSuccess >= 1;
    const fcmError = totalFailure > 0 ? `success: ${totalSuccess}, failure: ${totalFailure}` : null;
    await storeNotificationHistory(db, payload, true, fcmDelivered, fcmError);
  } catch (error: any) {
    console.error("sendFcmNotification error:", error);
  }
}

async function storeNotificationHistory(
  db: any,
  payload: FcmNotificationPayload,
  fcmSent: boolean,
  fcmDelivered: boolean,
  fcmError: string | null
): Promise<void> {
  if (payload.targetUserId === "broadcast") return;
  try {
    const { title, body } = getNotificationContent(payload);
    const clickAction = buildClickAction(payload);
    await db.insert(notifications).values({
      clientType: payload.targetClientType || "anilist",
      userId: payload.targetUserId,
      type: payload.type,
      title,
      body,
      commentId: payload.comment?.id ? Number(payload.comment.id) : null,
      mediaId: payload.comment?.media_id || payload.media?.id || null,
      mediaTitle: payload.comment?.media_title || payload.media?.title || null,
      content: payload.comment?.content || null,
      actorId: payload.actor?.id || payload.moderator?.id || null,
      actorUsername: payload.actor?.username || payload.moderator?.username || null,
      actorAvatar: payload.actor?.avatar || null,
      moderatorId: payload.moderator?.id || null,
      moderatorUsername: payload.moderator?.username || null,
      reason: payload.reason || payload.reportReason || null,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      clickAction,
      isRead: false,
    });
  } catch (err) {
    console.error("storeNotificationHistory error:", err);
  }
}

// Queue an FCM notification asynchronously via Cloudflare Workers waitUntil
export function queueFcmNotification(c: Context<any>, payload: FcmNotificationPayload) {
  try {
    if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
      c.executionCtx.waitUntil(sendFcmNotification(c.env, payload));
    } else {
      sendFcmNotification(c.env, payload).catch((err) => {
        console.error("FCM async send error:", err);
      });
    }
  } catch (err) {
    console.error("Failed to queue FCM notification:", err);
  }
}
