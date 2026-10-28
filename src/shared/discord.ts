// Discord Bot Notification System with Discord Components V2 for Commentum v2
// Exactly preserved from revamp/supabase/functions/shared/discordNotifications.ts

import { eq, and, sql } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import { createDb } from "../db/index.js";
import {
  serverConfigs,
  config as configTable,
  comments,
  commentumUsers,
  discordNotifications,
  dantotsuIdMappings,
  media,
} from "../db/schema.js";
import { getLanguageName } from "./translate.js";

export interface DiscordNotificationData {
  type:
    | "comment_created"
    | "comment_updated"
    | "comment_deleted"
    | "user_banned"
    | "user_warned"
    | "user_unwarned"
    | "comment_pinned"
    | "comment_unpinned"
    | "comment_locked"
    | "report_filed"
    | "report_resolved"
    | "report_dismissed"
    | "user_muted"
    | "user_unmuted"
    | "user_shadow_banned"
    | "user_unshadow_banned"
    | "comment_unlocked"
    | "moderation_action"
    | "config_updated"
    | "system_enabled"
    | "system_disabled"
    | "user_unbanned"
    | "bulk_action"
    | "vote_cast"
    | "vote_removed"
    | "announcement_published";
  comment?: {
    id: number | string;
    user_id?: string;
    username?: string;
    user_avatar?: string;
    client_type?: string;
    media_id?: string;
    media_type?: string;
    media_title?: string;
    tag?: number;
    labels?: string[];
    content?: string;
    deleted?: boolean;
    deleted_by?: string;
    deleted_by_username?: string;
    user_banned?: boolean;
    user_muted_until?: string;
    user_warnings?: number;
    banned_by?: string;
    banned_by_username?: string;
    muted_by?: string;
    muted_by_username?: string;
    warned_by?: string;
    warned_by_username?: string;
    pinned?: boolean;
    locked?: boolean;
    url?: string;
    notes?: string;
    translated_content?: string;
    original_language?: string;
  };
  user?: {
    id: string;
    username?: string;
    avatar?: string;
    banned?: boolean;
    banned_by?: string;
    banned_by_username?: string;
    muted_until?: string;
    muted_by?: string;
    muted_by_username?: string;
    warned_by?: string;
    warned_by_username?: string;
    warnings?: number;
    notes?: string;
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
  reportReason?: string;
  actionedBy?: string;
  metadata?: any;
  voteType?: "upvote" | "downvote";
  voteScore?: number;
  notes?: string;
  dantotsuSync?: {
    status?: "synced" | "dantotsu_origin" | "anymex_only";
    dantotsuCommentId?: number | string;
  };
}

// ====================================
// DISCORD COMPONENTS V2 CONSTANTS
// ====================================

const COMPONENT_TYPES = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_DISPLAY: 10,
  SEPARATOR: 14,
  CONTAINER: 17,
} as const;

const BUTTON_STYLES = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const;

const IS_COMPONENTS_V2 = 32768;

interface ButtonComponent {
  type: number;
  style: number;
  label: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
  emoji?: { name: string };
}

interface ActionRowComponent {
  type: number;
  components: ButtonComponent[];
}

interface TextDisplayComponent {
  type: number;
  content: string;
}

interface SeparatorComponent {
  type: number;
  divider?: boolean;
  spacing?: number;
}

interface ContainerComponent {
  type: number;
  accent_color?: number;
  components: any[];
  spoiler?: boolean;
}

function buildButton(
  label: string,
  style: number,
  customId?: string,
  url?: string,
  emoji?: string,
  disabled: boolean = false
): ButtonComponent {
  const button: ButtonComponent = {
    type: COMPONENT_TYPES.BUTTON,
    style,
    label,
    disabled,
  };
  if (customId) button.custom_id = customId;
  if (url) button.url = url;
  if (emoji) button.emoji = { name: emoji };
  return button;
}

function buildActionRow(buttons: ButtonComponent[]): ActionRowComponent {
  return {
    type: COMPONENT_TYPES.ACTION_ROW,
    components: buttons,
  };
}

function buildTextDisplay(content: string): TextDisplayComponent {
  return {
    type: COMPONENT_TYPES.TEXT_DISPLAY,
    content,
  };
}

function buildSeparator(divider: boolean = true, spacing: number = 1): SeparatorComponent {
  return {
    type: COMPONENT_TYPES.SEPARATOR,
    divider,
    spacing,
  };
}

function buildContainer(components: any[], accentColor?: number): ContainerComponent {
  const container: ContainerComponent = {
    type: COMPONENT_TYPES.CONTAINER,
    components,
  };
  if (accentColor !== undefined) {
    container.accent_color = accentColor;
  }
  return container;
}

// Discord Bot API helper
export async function discordBotApi(
  endpoint: string,
  method: string = "GET",
  body?: any,
  botToken?: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const token = botToken;
    if (!token) {
      return { success: false, error: "Discord bot token not configured" };
    }

    const response = await fetch(`https://discord.com/api/v10${endpoint}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`Discord API error (${response.status}):`, responseText);
      return {
        success: false,
        error: `Discord API returned ${response.status}: ${responseText}`,
      };
    }

    let data = null;
    if (responseText && responseText.trim()) {
      try {
        data = JSON.parse(responseText);
      } catch {
        // Ignored
      }
    }

    return { success: true, data };
  } catch (error: any) {
    console.error("Discord API request failed:", error);
    return { success: false, error: error?.message || String(error) };
  }
}

async function sendComponentsV2Message(
  channelId: string,
  components: any[],
  botToken?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const body = {
    flags: IS_COMPONENTS_V2,
    components,
  };

  const result = await discordBotApi(
    `/channels/${channelId}/messages`,
    "POST",
    body,
    botToken
  );

  if (result.success && result.data?.id) {
    return { success: true, messageId: result.data.id };
  }

  return { success: false, error: result.error };
}

function getChannelForNotificationType(
  notificationType: string
): "user_activity" | "updates" | "mods" {
  const userActivityChannelTypes = ["comment_created", "comment_updated"];
  const updatesChannelTypes = [
    "vote_cast",
    "vote_removed",
    "announcement_published",
    "comment_pinned",
    "comment_unpinned",
    "comment_locked",
    "comment_unlocked",
  ];
  const modsChannelTypes = [
    "comment_deleted",
    "report_filed",
    "report_resolved",
    "report_dismissed",
    "user_warned",
    "user_unwarned",
    "user_muted",
    "user_unmuted",
    "user_banned",
    "user_unbanned",
    "user_shadow_banned",
    "user_unshadow_banned",
  ];

  if (userActivityChannelTypes.includes(notificationType)) {
    return "user_activity";
  } else if (updatesChannelTypes.includes(notificationType)) {
    return "updates";
  } else if (modsChannelTypes.includes(notificationType)) {
    return "mods";
  }
  return "mods";
}

function buildDeepLinkUrl(data: DiscordNotificationData): string {
  const clientType = data.comment?.client_type || data.media?.client_type || "anilist";
  const mediaType = data.comment?.media_type || data.media?.type || "anime";
  const mediaId = data.comment?.media_id || data.media?.id || "";

  const base = "http://anymex.duckdns.org:8081/open";
  return `${base}?source=${clientType}&type=${mediaType}&id=${mediaId}`;
}

function buildInteractiveButtons(data: DiscordNotificationData): ActionRowComponent[] {
  const rows: ActionRowComponent[] = [];
  const deepLinkUrl = buildDeepLinkUrl(data);

  switch (data.type) {
    case "comment_created":
    case "comment_updated":
      if (data.comment?.id) {
        const isDeleted = data.comment?.deleted === true;
        const deletedBy =
          data.comment?.deleted_by_username || data.comment?.deleted_by || null;

        rows.push(
          buildActionRow([
            buildButton(
              isDeleted ? `Already deleted by ${deletedBy || "Unknown"}` : "Delete",
              BUTTON_STYLES.DANGER,
              isDeleted ? undefined : `mod_delete:${data.comment.id}:${data.comment.user_id}`,
              undefined,
              "🗑️",
              isDeleted
            ),
            buildButton("View", BUTTON_STYLES.LINK, undefined, deepLinkUrl, "👁️"),
          ])
        );

        if (data.comment?.user_id) {
          const isBanned = data.user?.banned === true || data.comment?.user_banned === true;
          const isMuted =
            (data.user?.muted_until && new Date(data.user.muted_until) > new Date()) ||
            (data.comment?.user_muted_until &&
              new Date(data.comment.user_muted_until) > new Date());
          const warningCount = data.user?.warnings || data.comment?.user_warnings || 0;
          const bannedBy =
            data.user?.banned_by_username ||
            data.user?.banned_by ||
            data.comment?.banned_by_username ||
            data.comment?.banned_by ||
            null;
          const mutedBy =
            data.user?.muted_by_username ||
            data.user?.muted_by ||
            data.comment?.muted_by_username ||
            data.comment?.muted_by ||
            null;
          const warnedBy =
            data.user?.warned_by_username ||
            data.user?.warned_by ||
            data.comment?.warned_by_username ||
            data.comment?.warned_by ||
            null;

          rows.push(
            buildActionRow([
              buildButton(
                warningCount > 0
                  ? `Already warned by ${warnedBy || "Mod"} (${warningCount}x)`
                  : "Warn User",
                BUTTON_STYLES.SECONDARY,
                warningCount > 0 ? undefined : `mod_warn:${data.comment.user_id}`,
                undefined,
                "⚠️",
                Boolean(warningCount > 0)
              ),
              buildButton(
                isMuted ? `Already muted by ${mutedBy || "Mod"}` : "Mute User",
                BUTTON_STYLES.SECONDARY,
                isMuted ? undefined : `mod_mute:${data.comment.user_id}`,
                undefined,
                "🔇",
                Boolean(isMuted)
              ),
            ])
          );

          rows.push(
            buildActionRow([
              buildButton(
                isBanned ? `Already banned by ${bannedBy || "Mod"}` : "Ban User",
                BUTTON_STYLES.DANGER,
                isBanned ? undefined : `mod_ban:${data.comment.user_id}`,
                undefined,
                "🔨",
                Boolean(isBanned)
              ),
            ])
          );
        }
      }
      break;

    case "report_filed":
      if (data.comment?.id) {
        const userId = data.comment.user_id || data.user?.id;
        const isDeleted = data.comment?.deleted === true;
        const isBanned = data.user?.banned === true || data.comment?.user_banned === true;
        const deletedBy = data.comment?.deleted_by_username || data.comment?.deleted_by || null;
        rows.push(
          buildActionRow([
            buildButton("Approve", BUTTON_STYLES.SUCCESS, `report_approve:${data.comment.id}:${userId}`, undefined, "✅"),
            buildButton("Dismiss", BUTTON_STYLES.SECONDARY, `report_dismiss:${data.comment.id}`, undefined, "❌"),
            buildButton("View", BUTTON_STYLES.LINK, undefined, deepLinkUrl, "👁️"),
          ])
        );
        rows.push(
          buildActionRow([
            buildButton(
              isDeleted ? `Deleted by ${deletedBy || "Mod"}` : "Delete & Warn",
              BUTTON_STYLES.DANGER,
              isDeleted ? undefined : `mod_del_warn:${data.comment.id}:${userId}`,
              undefined,
              "⚠️",
              isDeleted
            ),
            buildButton(
              isDeleted && isBanned ? `Already handled` : "Delete & Ban",
              BUTTON_STYLES.DANGER,
              isDeleted || isBanned ? undefined : `mod_del_ban:${data.comment.id}:${userId}`,
              undefined,
              "🔨",
              isDeleted || isBanned
            ),
          ])
        );
      }
      break;

    case "user_warned":
    case "user_muted":
      if (data.user?.id) {
        const isBanned = data.user?.banned === true;
        const bannedBy = data.user?.banned_by_username || data.user?.banned_by || null;
        rows.push(
          buildActionRow([
            buildButton(
              isBanned ? `Already banned by ${bannedBy || "Mod"}` : "Ban User",
              BUTTON_STYLES.DANGER,
              isBanned ? undefined : `mod_ban:${data.user.id}`,
              undefined,
              "🔨",
              isBanned
            ),
            buildButton("View History", BUTTON_STYLES.SECONDARY, `mod_history:${data.user.id}`, undefined, "📋"),
          ])
        );
      }
      break;

    case "user_unwarned":
    case "user_unmuted":
    case "user_unbanned":
    case "user_unshadow_banned":
      if (data.user?.id) {
        const reActionMap: Record<string, { label: string; emoji: string; customId: string }> = {
          user_unwarned: { label: "Re-warn", emoji: "⚠️", customId: `mod_warn:${data.user.id}` },
          user_unmuted: { label: "Re-mute", emoji: "🔇", customId: `mod_mute:${data.user.id}` },
          user_unbanned: { label: "Re-ban", emoji: "🔨", customId: `mod_ban:${data.user.id}` },
          user_unshadow_banned: { label: "Re-shadowban", emoji: "👻", customId: `mod_ban:${data.user.id}` },
        };
        const reAction = reActionMap[data.type];
        if (reAction) {
          rows.push(
            buildActionRow([
              buildButton(reAction.label, BUTTON_STYLES.SECONDARY, reAction.customId, undefined, reAction.emoji),
              buildButton("View History", BUTTON_STYLES.SECONDARY, `mod_history:${data.user.id}`, undefined, "📋"),
            ])
          );
        }
      }
      break;

    case "comment_pinned":
    case "comment_locked":
      if (data.comment?.id) {
        if (data.type === "comment_pinned") {
          rows.push(
            buildActionRow([
              buildButton("Unpin", BUTTON_STYLES.SECONDARY, `mod_unpin:${data.comment.id}`, undefined, "📍"),
              buildButton("View", BUTTON_STYLES.LINK, undefined, deepLinkUrl, "👁️"),
            ])
          );
        } else {
          rows.push(
            buildActionRow([
              buildButton("Unlock", BUTTON_STYLES.SUCCESS, `mod_unlock:${data.comment.id}`, undefined, "🔓"),
              buildButton("View", BUTTON_STYLES.LINK, undefined, deepLinkUrl, "👁️"),
            ])
          );
        }
      }
      break;

    default:
      break;
  }

  return rows;
}

function buildNotificationContent(data: DiscordNotificationData): ContainerComponent {
  let accentColor: number | undefined;
  let content: string = "";

  const authorName = data.comment?.username || data.user?.username || "Unknown";
  const authorId = data.comment?.user_id || data.user?.id || "";
  const moderatorName = data.moderator?.username || "Unknown";
  const moderatorId = data.moderator?.id || "";
  const commentId = data.comment?.id || "";
  const commentContent = data.comment?.content || "";
  const translatedContent = data.comment?.translated_content || null;
  const originalLanguage = data.comment?.original_language || null;

  const section = (label: string, body: string) =>
    `**${label}**\n${"─".repeat(32)}\n${body}`;

  const translationBlock =
    translatedContent && originalLanguage && originalLanguage !== "en"
      ? `\n\n${section(`Translated (${getLanguageName(originalLanguage)} → English)`, translatedContent)}`
      : "";

  const notes = data.notes || data.comment?.notes || data.user?.notes || "";

  const mediaId = data.comment?.media_id || data.media?.id || "Unknown";
  const clientType = data.comment?.client_type || data.media?.client_type || "Unknown";
  const mediaType = data.comment?.media_type || data.media?.type || "anime";
  const mediaTitle = data.comment?.media_title || data.media?.title || "Unknown";

  const mediaLine = `${mediaTitle}  \`[${mediaId} · ${clientType} · ${mediaType}]\``;

  const tagNum = data.comment?.tag;
  const labels = data.comment?.labels;
  const tagParts: string[] = [];
  if (tagNum !== undefined && tagNum !== null) {
    tagParts.push(`Tag: #${tagNum}`);
  }
  if (labels && labels.length > 0) {
    tagParts.push(`Labels: [${labels.join(", ")}]`);
  }
  const tagLine = tagParts.length > 0 ? tagParts.join(" · ") : "";

  const dantotsuInfo = data.dantotsuSync;
  let dantotsuLine = "";
  if (dantotsuInfo) {
    if (dantotsuInfo.status === "dantotsu_origin") {
      dantotsuLine = `Dantotsu: Posted on Dantotsu (\`#${dantotsuInfo.dantotsuCommentId}\`)`;
    } else if (dantotsuInfo.status === "synced") {
      dantotsuLine = `Dantotsu: Synced (\`#${dantotsuInfo.dantotsuCommentId}\`)`;
    } else if (dantotsuInfo.status === "anymex_only") {
      dantotsuLine = `Dantotsu: AnymeX Only`;
    }
  }

  const reason = data.reason || "";
  const reportReason = data.reportReason || "";
  const voteType = data.voteType === "upvote" ? "Upvote ▲" : "Downvote ▼";
  const voterName = data.user?.username || "Unknown";
  const voterId = data.user?.id || "";
  const reporterName = data.user?.username || "Unknown";
  const reporterId = data.user?.id || "";
  const publisherName = data.moderator?.username || "Unknown";
  const publisherId = data.moderator?.id || "";
  const duration = data.metadata?.duration || "Not specified";
  const announcementTitle = data.reason || "No Title";
  const announcementContent = data.comment?.content || "";

  switch (data.type) {
    case "comment_created":
      accentColor = 0x2ecc71;
      content = `🆕  **New Comment**

Author: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}${tagLine ? `\n${tagLine}` : ""}

${section(originalLanguage && originalLanguage !== "en" ? `Content (${getLanguageName(originalLanguage)})` : "Content", commentContent)}${translationBlock}`;
      break;

    case "comment_updated":
      accentColor = 0x9b59b6;
      content = `✏️  **Comment Edited**

Author: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}${tagLine ? `\n${tagLine}` : ""}

${section(originalLanguage && originalLanguage !== "en" ? `Updated Content (${getLanguageName(originalLanguage)})` : "Updated Content", commentContent)}${translationBlock}`;
      break;

    case "comment_deleted": {
      accentColor = 0xe74c3c;
      const safeDeletedContent = commentContent ? `||${commentContent.trim()}||` : "*No content*";
      const safeTranslated = translatedContent ? `||${translatedContent.trim()}||` : "";
      const delTranslationBlock =
        safeTranslated && originalLanguage && originalLanguage !== "en"
          ? `\n\n${section(`Translated (${getLanguageName(originalLanguage)} → English)`, safeTranslated)}`
          : "";

      content = `🗑️  **Comment Deleted**

Actor: ${moderatorName}  \`${moderatorId}\`
Author: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}${tagLine ? `\n${tagLine}` : ""}

${section(originalLanguage && originalLanguage !== "en" ? `Deleted Content (${getLanguageName(originalLanguage)})` : "Deleted Content", safeDeletedContent)}${delTranslationBlock}

${section("Reason", reason || "No reason specified")}`;
      break;
    }

    case "comment_pinned":
      accentColor = 0x00bfff;
      content = `📌  **Comment Pinned**

Actor: ${moderatorName}  \`${moderatorId}\`
Author: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}${tagLine ? `\n${tagLine}` : ""}

${section(originalLanguage && originalLanguage !== "en" ? `Comment (${getLanguageName(originalLanguage)})` : "Comment", commentContent)}${translationBlock}`;
      break;

    case "comment_unpinned":
      accentColor = 0x00bfff;
      content = `📍  **Comment Unpinned**

Actor: ${moderatorName}  \`${moderatorId}\`
Author: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}${tagLine ? `\n${tagLine}` : ""}

${section(originalLanguage && originalLanguage !== "en" ? `Comment (${getLanguageName(originalLanguage)})` : "Comment", commentContent)}${translationBlock}`;
      break;

    case "comment_locked":
      accentColor = 0x8b4513;
      content = `🔒  **Thread Locked**

Actor: ${moderatorName}  \`${moderatorId}\`
Author: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}${tagLine ? `\n${tagLine}` : ""}

${section(originalLanguage && originalLanguage !== "en" ? `Comment (${getLanguageName(originalLanguage)})` : "Comment", commentContent)}${translationBlock}`;
      break;

    case "comment_unlocked":
      accentColor = 0x2ecc71;
      content = `🔓  **Thread Unlocked**

Actor: ${moderatorName}  \`${moderatorId}\`
Author: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}${tagLine ? `\n${tagLine}` : ""}

${section(originalLanguage && originalLanguage !== "en" ? `Comment (${getLanguageName(originalLanguage)})` : "Comment", commentContent)}${translationBlock}`;
      break;

    case "report_filed":
      accentColor = 0xff8c00;
      content = `🚨  **Report Filed**

Reporter: ${reporterName}  \`${reporterId}\`
Reported: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}${tagLine ? `\n${tagLine}` : ""}

${section(originalLanguage && originalLanguage !== "en" ? `Reported Comment (${getLanguageName(originalLanguage)})` : "Reported Comment", commentContent)}${translationBlock}

${section("Report Reason", reportReason)}${notes ? `\n\n${section("Notes", notes)}` : ""}`;
      break;

    case "report_resolved":
      accentColor = 0x00fa9a;
      content = `✅  **Report Resolved**

Actor: ${moderatorName}  \`${moderatorId}\`
Reported: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}${tagLine ? `\n${tagLine}` : ""}

${section(originalLanguage && originalLanguage !== "en" ? `Comment (${getLanguageName(originalLanguage)})` : "Comment", commentContent)}${translationBlock}`;
      break;

    case "report_dismissed":
      accentColor = 0xdc143c;
      content = `❌  **Report Dismissed**

Actor: ${moderatorName}  \`${moderatorId}\`
Reported: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}${tagLine ? `\n${tagLine}` : ""}

${section(originalLanguage && originalLanguage !== "en" ? `Comment (${getLanguageName(originalLanguage)})` : "Comment", commentContent)}${translationBlock}`;
      break;

    case "user_warned": {
      accentColor = 0xffd700;
      const warnCommentId = data.comment?.id || "";
      const warnCommentContent = data.comment?.content || "";
      const warnMediaId = data.comment?.media_id || "Unknown";
      const warnClientType = data.comment?.client_type || "Unknown";
      const warnMediaType = data.comment?.media_type || "anime";
      const warnMediaTitle = data.comment?.media_title || "Unknown";
      const warnMediaLine = `${warnMediaTitle}  \`[${warnMediaId} · ${warnClientType} · ${warnMediaType}]\``;

      content = `⚠️  **Warning Issued**

Actor: ${moderatorName}  \`${moderatorId}\`
User: ${authorName}  \`${authorId}\`
Comment ID: \`${warnCommentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${warnMediaLine}

${section("Comment", warnCommentContent)}

${section("Reason", reason)}${notes ? `\n\n${section("User Notes", notes)}` : ""}`;
      break;
    }

    case "user_muted": {
      accentColor = 0x808080;
      const hasMuteComment = !!(commentId && commentContent);
      const muteCommentBlock = hasMuteComment
        ? `Comment ID  — \`${commentId}\`\n${dantotsuLine ? `${dantotsuLine}\n` : ""}Media       — ${mediaLine}\n\n${section("Comment", commentContent)}\n\n`
        : "";

      content = `🔇  **User Muted**

Actor: ${moderatorName}  \`${moderatorId}\`
User: ${authorName}  \`${authorId}\`
Duration: ${duration}

${muteCommentBlock}${section("Reason", reason)}${notes ? `\n\n${section("User Notes", notes)}` : ""}`;
      break;
    }

    case "user_unwarned": {
      accentColor = 0x2ecc71;
      const unwarnNotes = data.notes || data.user?.notes || "";
      content = `✅  **Warning Removed**

Actor: ${moderatorName}  \`${moderatorId}\`
User: ${authorName}  \`${authorId}\`

${section("Reason", reason)}${unwarnNotes ? `\n\n${section("User Notes", unwarnNotes)}` : ""}`;
      break;
    }

    case "user_unmuted":
      accentColor = 0x2ecc71;
      content = `🔊  **User Unmuted**

Actor: ${moderatorName}  \`${moderatorId}\`
User: ${authorName}  \`${authorId}\``;
      break;

    case "user_unshadow_banned":
      accentColor = 0x2ecc71;
      content = `🌟  **Shadow Ban Removed**

Actor: ${moderatorName}  \`${moderatorId}\`
User: ${authorName}  \`${authorId}\`

${section("Reason", reason)}`;
      break;

    case "user_banned": {
      accentColor = 0x8b0000;
      const hasBanComment = !!(commentId && commentContent);
      const banCommentBlock = hasBanComment
        ? `Comment ID  — \`${commentId}\`\n${dantotsuLine ? `${dantotsuLine}\n` : ""}Media       — ${mediaLine}\n\n${section("Comment", commentContent)}\n\n`
        : "";

      content = `⛔  **User Banned**

Actor: ${moderatorName}  \`${moderatorId}\`
User: ${authorName}  \`${authorId}\`
Duration: ${duration}

${banCommentBlock}${section("Reason", reason)}${notes ? `\n\n${section("User Notes", notes)}` : ""}`;
      break;
    }

    case "user_unbanned":
      accentColor = 0x2ecc71;
      content = `♻️  **User Unbanned**

Actor: ${moderatorName}  \`${moderatorId}\`
User: ${authorName}  \`${authorId}\``;
      break;

    case "user_shadow_banned":
      accentColor = 0x4b0082;
      content = `👻  **User Shadow Banned**

Actor: ${moderatorName}  \`${moderatorId}\`
User: ${authorName}  \`${authorId}\`

${section("Reason", reason)}${notes ? `\n\n${section("User Notes", notes)}` : ""}`;
      break;

    case "vote_cast":
      accentColor = 0xffa500;
      content = `👍  **Vote Cast**

Voter: ${voterName}  \`${voterId}\`
Author: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
Vote: ${voteType}
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}

${section(originalLanguage && originalLanguage !== "en" ? `Comment (${getLanguageName(originalLanguage)})` : "Comment", commentContent)}${translationBlock}`;
      break;

    case "vote_removed":
      accentColor = 0xffa500;
      content = `➖  **Vote Removed**

Voter: ${voterName}  \`${voterId}\`
Author: ${authorName}  \`${authorId}\`
Comment ID: \`${commentId}\`
${dantotsuLine ? `${dantotsuLine}\n` : ""}Media: ${mediaLine}

${section(originalLanguage && originalLanguage !== "en" ? `Comment (${getLanguageName(originalLanguage)})` : "Comment", commentContent)}${translationBlock}`;
      break;

    case "announcement_published":
      accentColor = 0x5865f2;
      content = `📢  **Announcement Published**

Publisher: ${publisherName}  \`${publisherId}\`

${section("Title", announcementTitle)}

${section("Content", announcementContent)}`;
      break;

    default:
      accentColor = 0x808080;
      content = `⚙️  **System Event**

Event       — \`${data.type}\``;
  }

  return buildContainer([buildTextDisplay(content)], accentColor);
}

function createComponentsV2Message(data: DiscordNotificationData): any[] {
  const components: any[] = [];
  components.push(buildNotificationContent(data));
  components.push(buildSeparator(true, 1));
  const buttons = buildInteractiveButtons(data);
  if (buttons.length > 0) {
    components.push(...buttons);
  }
  return components;
}

/**
 * Send Discord Channel Notification using Bot Token and Discord Components V2
 */
export async function sendDiscordNotification(
  d1: D1Database,
  data: DiscordNotificationData,
  botToken?: string
): Promise<{ success: boolean; reason?: string }> {
  try {
    const db = createDb(d1);

    if (!botToken) {
      return { success: false, reason: "Discord bot token not configured" };
    }

    // Check system configs for discord_notifications_enabled
    const notifEnabledConfig = await db
      .select()
      .from(configTable)
      .where(eq(configTable.key, "discord_notifications_enabled"))
      .limit(1);

    if (notifEnabledConfig.length > 0) {
      try {
        if (JSON.parse(notifEnabledConfig[0].value) !== true) {
          return { success: false, reason: "Discord notifications disabled" };
        }
      } catch {
        // Continue if parse error
      }
    }

    // Check notification type filter
    const typesConfig = await db
      .select()
      .from(configTable)
      .where(eq(configTable.key, "discord_notification_types"))
      .limit(1);

    if (typesConfig.length > 0) {
      try {
        const enabledTypes = JSON.parse(typesConfig[0].value);
        if (Array.isArray(enabledTypes) && !enabledTypes.includes(data.type)) {
          return { success: false, reason: "Notification type disabled in config" };
        }
      } catch {
        // Continue
      }
    }

    // Channel routing: user_activity, updates, mods
    const channelType = getChannelForNotificationType(data.type);

    // Retrieve active server configs
    const servers = await db
      .select()
      .from(serverConfigs)
      .where(eq(serverConfigs.isActive, true));

    if (servers.length === 0) {
      return { success: false, reason: "No active server configurations found" };
    }

    const channelConfigs: { guildId: string; channelId: string }[] = [];
    for (const s of servers) {
      let targetChannel: string | null = null;
      if (channelType === "user_activity") {
        targetChannel = s.channelId;
      } else if (channelType === "updates") {
        targetChannel = s.updatesChannelId || s.channelId;
      } else {
        targetChannel = s.moderationChannelId || s.channelId;
      }

      if (targetChannel) {
        channelConfigs.push({
          guildId: s.guildId,
          channelId: targetChannel,
        });
      }
    }

    if (channelConfigs.length === 0) {
      return { success: false, reason: `No channel IDs configured for ${channelType}` };
    }

    // Data enrichment
    try {
      if (
        data.comment?.id &&
        (!data.comment.content || !data.comment.username || !data.comment.media_title)
      ) {
        const commentIdNum = Number(data.comment.id);
        if (!isNaN(commentIdNum)) {
          const cRows = await db
            .select()
            .from(comments)
            .where(eq(comments.id, commentIdNum))
            .limit(1);

          if (cRows.length > 0) {
            const c = cRows[0];
            data.comment.username = data.comment.username || c.username;
            data.comment.content = data.comment.content || c.content;
            data.comment.client_type = data.comment.client_type || c.clientType;
            data.comment.media_id = data.comment.media_id || c.mediaId;
            data.comment.user_avatar = data.comment.user_avatar || c.userAvatar || undefined;
            if (!data.comment.media_title && c.mediaId) {
              const mRows = await db
                .select()
                .from(media)
                .where(and(eq(media.clientType, c.clientType), eq(media.mediaId, c.mediaId)))
                .limit(1);
              if (mRows.length > 0) {
                data.comment.media_title = mRows[0].title;
                data.comment.media_type = mRows[0].type;
              }
            }
          }
        }
      }

      if (data.user?.id && !data.user.username) {
        const uRows = await db
          .select()
          .from(commentumUsers)
          .where(eq(commentumUsers.commentumUserId, data.user.id))
          .limit(1);

        if (uRows.length > 0) {
          data.user.username = uRows[0].commentumUsername;
          data.user.avatar = uRows[0].commentumUserAvatar || undefined;
          data.user.warnings = uRows[0].commentumUserWarnings;
          data.user.banned = uRows[0].commentumUserBanned;
          data.user.muted_until = uRows[0].commentumUserMutedUntil || undefined;
        }
      }

      // Dantotsu sync enrichment
      if (!data.dantotsuSync && data.comment?.id) {
        const commentIdNum = Number(data.comment.id);
        if (!isNaN(commentIdNum)) {
          const danMap = await db
            .select()
            .from(dantotsuIdMappings)
            .where(eq(dantotsuIdMappings.commentumId, commentIdNum))
            .limit(1);

          if (danMap.length > 0) {
            data.dantotsuSync = {
              status: danMap[0].origin === "dantotsu" ? "dantotsu_origin" : "synced",
              dantotsuCommentId: danMap[0].dantotsuCommentId,
            };
          } else {
            data.dantotsuSync = {
              status: "anymex_only",
            };
          }
        }
      }
    } catch (enrichErr) {
      console.error("Discord enrichment error:", enrichErr);
    }

    const components = createComponentsV2Message(data);

    // Send to all configured channels
    for (const cfg of channelConfigs) {
      const res = await sendComponentsV2Message(cfg.channelId, components, botToken);
      if (res.success && res.messageId) {
        await db.insert(discordNotifications).values({
          notificationType: data.type,
          targetId: data.comment?.id?.toString() || data.user?.id || null,
          targetType: data.comment ? "comment" : data.user ? "user" : "unknown",
          commentData: data.comment ? JSON.stringify(data.comment) : null,
          userData: data.user ? JSON.stringify(data.user) : null,
          mediaData: data.media ? JSON.stringify(data.media) : null,
          channelId: cfg.channelId,
          guildId: cfg.guildId,
          messageId: res.messageId,
          deliveryStatus: "sent",
          deliveredAt: new Date().toISOString(),
        });
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error("sendDiscordNotification error:", err);
    return { success: false, reason: err?.message || String(err) };
  }
}

/**
 * Queue Discord notification in background (non-blocking)
 */
export async function queueDiscordNotification(
  data: DiscordNotificationData,
  env: { DB: D1Database; DISCORD_BOT_TOKEN?: string },
  ctx?: { waitUntil?: (p: Promise<any>) => void }
): Promise<void> {
  const promise = sendDiscordNotification(env.DB, data, env.DISCORD_BOT_TOKEN);
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(promise);
  } else {
    promise.catch((e) => console.error("queueDiscordNotification background error:", e));
  }
}
