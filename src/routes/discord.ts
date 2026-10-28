import { Hono } from "hono";
import { AppContext } from "../types/env.js";
import { createDb } from "../db/index.js";
import {
  comments,
  commentumUsers,
  discordUsers,
  serverConfigs,
  config as configTable,
  media,
} from "../db/schema.js";
import { eq, and, sql, desc, or, like } from "drizzle-orm";
import { isModeratorOrHigher, isAdminOrHigher, isSuperAdminOrHigher } from "../shared/roles.js";
import { queueDiscordNotification } from "../shared/discord.js";

export const discordRoutes = new Hono<AppContext>();

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string
): Promise<boolean> {
  try {
    if (!publicKey || !signature || !timestamp) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKey),
      { name: "ed25519", namedCurve: "ed25519" },
      false,
      ["verify"]
    );
    const data = new TextEncoder().encode(timestamp + body);
    const sig = hexToBytes(signature);
    return await crypto.subtle.verify("ed25519", key, sig, data);
  } catch (err) {
    console.warn("Discord signature verification error:", err);
    return false;
  }
}

function createDiscordMessage(content: string, ephemeral = false) {
  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      content,
      flags: ephemeral ? 64 : 0,
    },
  };
}

function createModalResponse(
  title: string,
  customId: string,
  inputLabel: string,
  placeholder: string = "Enter reason...",
  minLength: number = 1,
  maxLength: number = 500
) {
  return {
    type: 9, // MODAL
    data: {
      title,
      custom_id: customId,
      components: [
        {
          type: 1, // ACTION_ROW
          components: [
            {
              type: 4, // TEXT_INPUT
              custom_id: "reason_input",
              label: inputLabel,
              style: 1, // PARAGRAPH
              placeholder,
              min_length: minLength,
              max_length: maxLength,
              required: true,
            },
          ],
        },
      ],
    },
  };
}

function createAutocompleteResponse(choices: Array<{ name: string; value: string | number }>) {
  return {
    type: 8, // APPLICATION_COMMAND_AUTOCOMPLETE_RESULT
    data: {
      choices: choices.slice(0, 25).map((c) => ({
        name: String(c.name).slice(0, 100),
        value: typeof c.value === "number" ? c.value : String(c.value).slice(0, 100),
      })),
    },
  };
}

// 24 Discord Slash Commands Definition
export const GLOBAL_DISCORD_COMMANDS = [
  {
    name: "register",
    description: "Register your platform account with Commentum",
    options: [
      {
        name: "platform",
        description: "Choose your platform",
        type: 3,
        required: true,
        choices: [
          { name: "AniList", value: "anilist" },
          { name: "MyAnimeList", value: "myanimelist" },
          { name: "SIMKL", value: "simkl" },
        ],
      },
      {
        name: "user_id",
        description: "Your platform user ID",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "server",
        description: "Server name to register with",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "report",
    description: "Report a comment for moderation",
    options: [
      {
        name: "comment_id",
        description: "Comment ID to report",
        type: 4,
        required: true,
      },
      {
        name: "reason",
        description: "Report reason",
        type: 3,
        required: true,
        choices: [
          { name: "Spam", value: "spam" },
          { name: "Offensive", value: "offensive" },
          { name: "Harassment", value: "harassment" },
          { name: "Spoiler", value: "spoiler" },
          { name: "NSFW", value: "nsfw" },
          { name: "Off Topic", value: "off_topic" },
          { name: "Other", value: "other" },
        ],
      },
      {
        name: "notes",
        description: "Additional notes",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "user",
    description: "Get detailed user information",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to lookup",
        type: 3,
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: "comment",
    description: "Get detailed comment information",
    options: [
      {
        name: "comment_id",
        description: "Comment ID to lookup",
        type: 4,
        required: true,
      },
    ],
  },
  {
    name: "stats",
    description: "View system statistics",
  },
  {
    name: "help",
    description: "Show help information based on your role",
  },
  {
    name: "warn",
    description: "Warn a user",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to warn",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "reason",
        description: "Reason for warning",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "unwarn",
    description: "Remove warning from user",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to unwarn",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "reason",
        description: "Reason for removing warning",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "mute",
    description: "Mute a user for specified duration",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to mute",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "reason",
        description: "Reason for muting",
        type: 3,
        required: true,
      },
      {
        name: "duration",
        description: "Duration in hours (default: 24)",
        type: 4,
        required: false,
      },
    ],
  },
  {
    name: "unmute",
    description: "Remove mute from a user",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to unmute",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "reason",
        description: "Reason for unmuting",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "pin",
    description: "Pin a comment to highlight it",
    options: [
      {
        name: "comment_id",
        description: "Comment ID to pin",
        type: 4,
        required: true,
      },
      {
        name: "reason",
        description: "Reason for pinning",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "unpin",
    description: "Unpin a comment",
    options: [
      {
        name: "comment_id",
        description: "Comment ID to unpin",
        type: 4,
        required: true,
      },
      {
        name: "reason",
        description: "Reason for unpinning",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "lock",
    description: "Lock a comment thread to prevent replies",
    options: [
      {
        name: "comment_id",
        description: "Comment ID to lock",
        type: 4,
        required: true,
      },
      {
        name: "reason",
        description: "Reason for locking",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "unlock",
    description: "Unlock a comment thread",
    options: [
      {
        name: "comment_id",
        description: "Comment ID to unlock",
        type: 4,
        required: true,
      },
      {
        name: "reason",
        description: "Reason for unlocking",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "resolve",
    description: "Resolve a reported comment",
    options: [
      {
        name: "comment_id",
        description: "Comment ID with report",
        type: 4,
        required: true,
      },
      {
        name: "reporter_id",
        description: "Reporter user ID",
        type: 3,
        required: true,
      },
      {
        name: "resolution",
        description: "Resolution type",
        type: 3,
        required: true,
        choices: [
          { name: "Resolved", value: "resolved" },
          { name: "Dismissed", value: "dismissed" },
        ],
      },
      {
        name: "notes",
        description: "Review notes",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "queue",
    description: "View moderation queue of pending reports",
  },
  {
    name: "delete",
    description: "Delete a comment",
    options: [
      {
        name: "comment_id",
        description: "Comment ID to delete",
        type: 4,
        required: true,
      },
    ],
  },
  {
    name: "search_comments",
    description: "Search comments with wildcards, user/media autocomplete, and delete buttons",
    options: [
      {
        name: "query",
        description: "Search text inside comments",
        type: 3,
        required: false,
      },
      {
        name: "match_type",
        description: "Match type (contains, exact, prefix, suffix, regex)",
        type: 3,
        required: false,
        choices: [
          { name: "Contains (Wildcard %text%)", value: "contains" },
          { name: "Exact Match (\"text\")", value: "exact" },
          { name: "Prefix / Starts With (text%)", value: "prefix" },
          { name: "Suffix / Ends With (%text)", value: "suffix" },
          { name: "Regex (~* pattern)", value: "regex" },
        ],
      },
      {
        name: "user",
        description: "Search by user (type username or ID for live autocomplete)",
        type: 3,
        required: false,
        autocomplete: true,
      },
      {
        name: "media",
        description: "Filter by media (type title or ID for live autocomplete)",
        type: 3,
        required: false,
        autocomplete: true,
      },
      {
        name: "platform",
        description: "Filter by platform",
        type: 3,
        required: false,
        choices: [
          { name: "All Platforms", value: "all" },
          { name: "AniList", value: "anilist" },
          { name: "MyAnimeList", value: "myanimelist" },
          { name: "SIMKL", value: "simkl" },
          { name: "Other", value: "other" },
        ],
      },
      {
        name: "status",
        description: "Filter by comment status",
        type: 3,
        required: false,
        choices: [
          { name: "Active Comments Only (default)", value: "active" },
          { name: "All Comments (including deleted)", value: "all" },
          { name: "Deleted Comments Only", value: "deleted" },
          { name: "Reported Comments Only", value: "reported" },
          { name: "Pinned Comments Only", value: "pinned" },
          { name: "Locked Comments Only", value: "locked" },
        ],
      },
      {
        name: "limit",
        description: "Number of results per page (default: 5, max: 10)",
        type: 4,
        required: false,
        choices: [
          { name: "3 comments per page", value: 3 },
          { name: "5 comments per page", value: 5 },
          { name: "10 comments per page", value: 10 },
        ],
      },
      {
        name: "page",
        description: "Page number (default: 1)",
        type: 4,
        required: false,
      },
    ],
  },
  {
    name: "ban",
    description: "Ban a user from the system",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to ban",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "reason",
        description: "Reason for ban",
        type: 3,
        required: true,
      },
      {
        name: "shadow",
        description: "Shadow ban (true/false)",
        type: 5,
        required: false,
      },
    ],
  },
  {
    name: "unban",
    description: "Unban a user",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to unban",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "reason",
        description: "Reason for unban",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "shadowban",
    description: "Shadow ban a user",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to shadow ban",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "reason",
        description: "Reason for shadow ban",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "unshadowban",
    description: "Remove shadow ban from a user",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to unshadow ban",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "reason",
        description: "Reason for removing shadow ban",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "promote",
    description: "Promote a user to higher role",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to promote",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "role",
        description: "New role",
        type: 3,
        required: true,
        choices: [
          { name: "Moderator", value: "moderator" },
          { name: "Admin", value: "admin" },
          { name: "Super Admin", value: "super_admin" },
          { name: "Owner", value: "owner" },
        ],
      },
      {
        name: "reason",
        description: "Reason for promotion",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "demote",
    description: "Demote a user to lower role",
    options: [
      {
        name: "user_id",
        description: "Platform user ID to demote",
        type: 3,
        required: true,
        autocomplete: true,
      },
      {
        name: "role",
        description: "New role",
        type: 3,
        required: true,
        choices: [
          { name: "User", value: "user" },
          { name: "Moderator", value: "moderator" },
          { name: "Admin", value: "admin" },
          { name: "Super Admin", value: "super_admin" },
        ],
      },
      {
        name: "reason",
        description: "Reason for demotion",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "config",
    description: "View or update system configuration",
    options: [
      {
        name: "action",
        description: "Action to perform",
        type: 3,
        required: true,
        choices: [
          { name: "View Config", value: "view" },
          { name: "Update Config", value: "update" },
        ],
      },
      {
        name: "key",
        description: "Configuration key",
        type: 3,
        required: false,
      },
      {
        name: "value",
        description: "New configuration value",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "add",
    description: "Configure a new server (Super Admin only)",
    options: [
      {
        name: "server_name",
        description: "Server name",
        type: 3,
        required: true,
      },
      {
        name: "guild_id",
        description: "Discord guild ID",
        type: 3,
        required: true,
      },
      {
        name: "channel_id",
        description: "Channel ID for comment notifications",
        type: 3,
        required: false,
      },
      {
        name: "moderation_channel_id",
        description: "Channel ID for moderation notifications",
        type: 3,
        required: false,
      },
      {
        name: "role_id",
        description: "Discord role ID for auto-assignment",
        type: 3,
        required: false,
      },
    ],
  },
];

/**
 * Main Discord Interaction Handler
 */
discordRoutes.post("/", async (c) => {
  try {
    const signature = c.req.header("x-signature-ed25519");
    const timestamp = c.req.header("x-signature-timestamp");

    if (!signature || !timestamp) {
      return c.text("Missing signature headers", 401);
    }

    const rawBody = await c.req.text();
    const publicKey = (c.env as any).DISCORD_PUBLIC_KEY;

    if (publicKey) {
      const isValid = await verifyDiscordSignature(rawBody, signature, timestamp, publicKey);
      if (!isValid) {
        return c.text("Invalid signature", 401);
      }
    }

    const interaction = JSON.parse(rawBody);

    // 1. PING (Type 1)
    if (interaction.type === 1) {
      return c.json({ type: 1 });
    }

    const db = createDb(c.env.DB);
    const discordUserId = interaction.user?.id || interaction.member?.user?.id;
    const discordUsername =
      interaction.user?.username || interaction.member?.user?.username || "Unknown";

    let staffRole = "user";
    if (discordUserId) {
      const staffRows = await db
        .select()
        .from(discordUsers)
        .where(and(eq(discordUsers.discordUserId, discordUserId), eq(discordUsers.isActive, true)))
        .limit(1);
      if (staffRows.length > 0) {
        staffRole = staffRows[0].userRole;
      }
    }

    // 2. Autocomplete (Type 4)
    if (interaction.type === 4) {
      const options = interaction.data?.options || [];
      const focused = options.find((opt: any) => opt.focused === true);
      if (!focused) {
        return c.json(createAutocompleteResponse([]));
      }

      const fieldName = focused.name;
      const rawVal = (focused.value || "").toString().trim();

      if (fieldName === "user" || fieldName === "user_id") {
        const choices: Array<{ name: string; value: string }> = [];
        const seen = new Set<string>();

        let userQuery = db
          .select({
            userId: commentumUsers.commentumUserId,
            username: commentumUsers.commentumUsername,
            clientType: commentumUsers.commentumClientType,
          })
          .from(commentumUsers)
          .limit(20);

        if (rawVal.length > 0) {
          userQuery = db
            .select({
              userId: commentumUsers.commentumUserId,
              username: commentumUsers.commentumUsername,
              clientType: commentumUsers.commentumClientType,
            })
            .from(commentumUsers)
            .where(
              or(
                like(commentumUsers.commentumUsername, `%${rawVal}%`),
                like(commentumUsers.commentumUserId, `%${rawVal}%`)
              )
            )
            .limit(20) as any;
        }

        const uRows = await userQuery;
        for (const u of uRows) {
          if (!u.userId || seen.has(u.userId)) continue;
          seen.add(u.userId);
          choices.push({
            name: `👤 [${(u.clientType || "anilist").toUpperCase()}] ${u.username} (${u.userId})`,
            value: u.userId,
          });
        }
        return c.json(createAutocompleteResponse(choices));
      }

      if (fieldName === "media") {
        const choices: Array<{ name: string; value: string }> = [];
        const seen = new Set<string>();

        let mediaQuery = db
          .select({
            mediaId: media.mediaId,
            mediaTitle: media.title,
          })
          .from(media)
          .limit(20);

        if (rawVal.length > 0) {
          mediaQuery = db
            .select({
              mediaId: media.mediaId,
              mediaTitle: media.title,
            })
            .from(media)
            .where(like(media.title, `%${rawVal}%`))
            .limit(20) as any;
        }

        const mRows = await mediaQuery;
        for (const m of mRows) {
          if (!m.mediaId || seen.has(m.mediaId)) continue;
          seen.add(m.mediaId);
          choices.push({
            name: `📺 ${m.mediaTitle || m.mediaId} (${m.mediaId})`,
            value: m.mediaId,
          });
        }
        return c.json(createAutocompleteResponse(choices));
      }

      return c.json(createAutocompleteResponse([]));
    }

    // 3. Modal Submissions (Type 5)
    if (interaction.type === 5) {
      const customId = interaction.data?.custom_id || "";
      const components = interaction.data?.components || [];
      let reason = "";

      for (const comp of components) {
        for (const inner of comp.components || []) {
          if (inner.custom_id === "reason_input" && inner.value) {
            reason = inner.value.trim();
          }
        }
      }

      const parts = customId.split(":");
      const action = parts[0];
      const id1 = parts[1];
      const id2 = parts[2];

      if (action === "modal_delete") {
        const commentId = parseInt(id1, 10);
        await db
          .update(comments)
          .set({
            deleted: true,
            deletedAt: sql`(datetime('now'))`,
            deletedBy: `discord:${discordUsername}`,
            content: "[deleted by moderator]",
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(comments.id, commentId));

        queueDiscordNotification(
          {
            type: "comment_deleted",
            comment: { id: commentId, user_id: id2 },
            moderator: { id: discordUserId, username: discordUsername },
            reason,
          },
          c.env
        );

        return c.json(createDiscordMessage(`🗑️ Comment \`#${commentId}\` deleted! Reason: ${reason}`));
      }

      if (action === "modal_warn" || action === "modal_del_warn") {
        const userId = id1;
        await db
          .update(commentumUsers)
          .set({
            commentumUserWarnings: sql`commentum_user_warnings + 1`,
            commentumUserLastWarningAt: sql`(datetime('now'))`,
            commentumUserLastWarningBy: `discord:${discordUsername}`,
            commentumUserLastWarningReason: reason,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(commentumUsers.commentumUserId, userId));

        if (action === "modal_del_warn") {
          const commentId = parseInt(id2, 10);
          await db
            .update(comments)
            .set({
              deleted: true,
              deletedAt: sql`(datetime('now'))`,
              deletedBy: `discord:${discordUsername}`,
              content: "[deleted by moderator]",
              updatedAt: sql`(datetime('now'))`,
            })
            .where(eq(comments.id, commentId));
        }

        queueDiscordNotification(
          {
            type: "user_warned",
            user: { id: userId },
            moderator: { id: discordUserId, username: discordUsername },
            reason,
          },
          c.env
        );

        return c.json(createDiscordMessage(`⚠️ User \`${userId}\` warned! Reason: ${reason}`));
      }

      if (action === "modal_mute") {
        const userId = id1;
        await db
          .update(commentumUsers)
          .set({
            commentumUserMuted: true,
            commentumUserMutedBy: `discord:${discordUsername}`,
            commentumUserMutedReason: reason,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(commentumUsers.commentumUserId, userId));

        queueDiscordNotification(
          {
            type: "user_muted",
            user: { id: userId },
            moderator: { id: discordUserId, username: discordUsername },
            reason,
          },
          c.env
        );

        return c.json(createDiscordMessage(`🔇 User \`${userId}\` muted! Reason: ${reason}`));
      }

      if (action === "modal_ban" || action === "modal_del_ban") {
        const userId = id1;
        await db
          .update(commentumUsers)
          .set({
            commentumUserBanned: true,
            commentumUserBannedAt: sql`(datetime('now'))`,
            commentumUserBannedBy: `discord:${discordUsername}`,
            commentumUserBannedReason: reason,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(commentumUsers.commentumUserId, userId));

        if (action === "modal_del_ban") {
          const commentId = parseInt(id2, 10);
          await db
            .update(comments)
            .set({
              deleted: true,
              deletedAt: sql`(datetime('now'))`,
              deletedBy: `discord:${discordUsername}`,
              content: "[deleted by moderator]",
              updatedAt: sql`(datetime('now'))`,
            })
            .where(eq(comments.id, commentId));
        }

        queueDiscordNotification(
          {
            type: "user_banned",
            user: { id: userId },
            moderator: { id: discordUserId, username: discordUsername },
            reason,
          },
          c.env
        );

        return c.json(createDiscordMessage(`🔨 User \`${userId}\` banned! Reason: ${reason}`));
      }

      return c.json(createDiscordMessage(`Modal action recorded: ${reason}`, true));
    }

    // 4. Button Clicks & Select Menus (Type 3)
    if (interaction.type === 3) {
      const customId = interaction.data?.custom_id || "";
      const [action, id1, id2] = customId.split(":");

      if (action === "mod_delete") {
        return c.json(createModalResponse("Delete Comment", `modal_delete:${id1}:${id2}`, "Reason for deletion"));
      }

      if (action === "mod_warn") {
        return c.json(createModalResponse("Warn User", `modal_warn:${id1}`, "Reason for warning"));
      }

      if (action === "mod_mute") {
        return c.json(createModalResponse("Mute User", `modal_mute:${id1}`, "Mute duration & reason"));
      }

      if (action === "mod_ban") {
        return c.json(createModalResponse("Ban User", `modal_ban:${id1}`, "Reason for ban"));
      }

      if (action === "mod_del_warn") {
        return c.json(createModalResponse("Delete Comment & Warn User", `modal_del_warn:${id2}:${id1}`, "Reason for warning & deletion"));
      }

      if (action === "mod_del_ban") {
        return c.json(createModalResponse("Delete Comment & Ban User", `modal_del_ban:${id2}:${id1}`, "Reason for ban & deletion"));
      }

      if (action === "report_approve") {
        const commentId = parseInt(id1, 10);
        await db
          .update(comments)
          .set({ reportStatus: "resolved", reported: true, updatedAt: sql`(datetime('now'))` })
          .where(eq(comments.id, commentId));

        queueDiscordNotification(
          {
            type: "report_resolved",
            comment: { id: commentId, user_id: id2 },
            moderator: { id: discordUserId, username: discordUsername },
          },
          c.env
        );

        return c.json(createDiscordMessage(`✅ Report for comment \`#${commentId}\` approved & marked resolved.`));
      }

      if (action === "report_dismiss") {
        const commentId = parseInt(id1, 10);
        await db
          .update(comments)
          .set({ reportStatus: "dismissed", reported: false, updatedAt: sql`(datetime('now'))` })
          .where(eq(comments.id, commentId));

        queueDiscordNotification(
          {
            type: "report_dismissed",
            comment: { id: commentId },
            moderator: { id: discordUserId, username: discordUsername },
          },
          c.env
        );

        return c.json(createDiscordMessage(`❌ Report for comment \`#${commentId}\` dismissed.`));
      }

      if (action === "mod_unpin") {
        const commentId = parseInt(id1, 10);
        await db
          .update(comments)
          .set({ pinned: false, updatedAt: sql`(datetime('now'))` })
          .where(eq(comments.id, commentId));

        queueDiscordNotification(
          {
            type: "comment_unpinned",
            comment: { id: commentId },
            moderator: { id: discordUserId, username: discordUsername },
          },
          c.env
        );

        return c.json(createDiscordMessage(`📍 Comment \`#${commentId}\` unpinned.`));
      }

      if (action === "mod_unlock") {
        const commentId = parseInt(id1, 10);
        await db
          .update(comments)
          .set({ locked: false, updatedAt: sql`(datetime('now'))` })
          .where(eq(comments.id, commentId));

        queueDiscordNotification(
          {
            type: "comment_unlocked",
            comment: { id: commentId },
            moderator: { id: discordUserId, username: discordUsername },
          },
          c.env
        );

        return c.json(createDiscordMessage(`🔓 Comment \`#${commentId}\` unlocked.`));
      }

      if (action === "mod_history") {
        const userId = id1;
        const userComments = await db
          .select({
            id: comments.id,
            content: comments.content,
            deleted: comments.deleted,
            createdAt: comments.createdAt,
          })
          .from(comments)
          .where(eq(comments.userId, userId))
          .orderBy(desc(comments.createdAt))
          .limit(5);

        const history =
          userComments.length > 0
            ? userComments
                .map(
                  (c) =>
                    `• \`#${c.id}\`: ${c.content?.slice(0, 40) || "N/A"}... ${c.deleted ? "🗑️ [deleted]" : ""}`
                )
                .join("\n")
            : "No comments found";

        return c.json(createDiscordMessage(`📋 **Recent Comments for User \`${userId}\`:**\n\n${history}`, true));
      }

      return c.json(createDiscordMessage(`Action \`${action}\` executed.`, true));
    }

    // 5. Slash Commands (Type 2)
    if (interaction.type === 2) {
      const commandName = interaction.data?.name;
      const options = interaction.data?.options || [];
      const getOpt = (name: string) => options.find((o: any) => o.name === name)?.value;

      // /help
      if (commandName === "help") {
        return c.json(
          createDiscordMessage(
            `📚 **Commentum v2 Bot Commands:**\n` +
              `• \`/register platform user_id server\` — Link platform account\n` +
              `• \`/report comment_id reason [notes]\` — Report a comment\n` +
              `• \`/user user_id\` — User profile & stats\n` +
              `• \`/comment comment_id\` — Comment details\n` +
              `• \`/stats\` — Platform system metrics\n\n` +
              `🛡️ **Moderator Commands:**\n` +
              `• \`/warn user_id reason\` — Issue a formal warning\n` +
              `• \`/unwarn user_id [reason]\` — Remove warning\n` +
              `• \`/mute user_id reason [duration]\` — Mute user\n` +
              `• \`/unmute user_id [reason]\` — Unmute user\n` +
              `• \`/pin comment_id [reason]\` — Pin comment\n` +
              `• \`/unpin comment_id [reason]\` — Unpin comment\n` +
              `• \`/lock comment_id [reason]\` — Lock thread\n` +
              `• \`/unlock comment_id [reason]\` — Unlock thread\n` +
              `• \`/delete comment_id\` — Delete comment\n` +
              `• \`/resolve comment_id reporter_id resolution [notes]\` — Resolve report\n` +
              `• \`/queue\` — View pending reports\n` +
              `• \`/search_comments [query] [user] [media] ...\` — Search comments\n\n` +
              `👑 **Admin Commands:**\n` +
              `• \`/ban user_id reason [shadow]\` — Ban user\n` +
              `• \`/unban user_id [reason]\` — Unban user\n` +
              `• \`/shadowban user_id reason\` — Shadowban user\n` +
              `• \`/unshadowban user_id [reason]\` — Remove shadowban\n` +
              `• \`/promote user_id role [reason]\` — Promote user\n` +
              `• \`/demote user_id role [reason]\` — Demote user\n` +
              `• \`/config action [key] [value]\` — View/update config\n` +
              `• \`/add server_name guild_id [channel_id] ...\` — Configure server`,
            true
          )
        );
      }

      // /stats
      if (commandName === "stats") {
        const commentCount = await db.select({ count: sql<number>`count(*)` }).from(comments);
        const userCount = await db.select({ count: sql<number>`count(*)` }).from(commentumUsers);
        const serverCount = await db.select({ count: sql<number>`count(*)` }).from(serverConfigs);
        return c.json(
          createDiscordMessage(
            `📊 **Commentum v2 System Statistics:**\n` +
              `• Total Comments: **${commentCount[0]?.count || 0}**\n` +
              `• Registered Users: **${userCount[0]?.count || 0}**\n` +
              `• Connected Servers: **${serverCount[0]?.count || 0}**\n` +
              `• Engine: Cloudflare Workers + D1 Database\n` +
              `• Status: 🟢 100% Operational`
          )
        );
      }

      // /register
      if (commandName === "register") {
        const platform = String(getOpt("platform"));
        const platformUserId = String(getOpt("user_id"));
        const serverName = String(getOpt("server"));

        await db
          .insert(discordUsers)
          .values({
            discordUserId,
            discordUsername,
            platformType: platform,
            platformUserId,
            userRole: "user",
            isVerified: true,
            verifiedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: discordUsers.discordUserId,
            set: {
              platformType: platform,
              platformUserId,
              updatedAt: new Date().toISOString(),
            },
          });

        return c.json(
          createDiscordMessage(
            `✅ Successfully linked **${discordUsername}** to **${platform.toUpperCase()}** account \`${platformUserId}\`!`
          )
        );
      }

      // /report
      if (commandName === "report") {
        const commentId = parseInt(getOpt("comment_id"), 10);
        const reason = String(getOpt("reason"));
        const notes = getOpt("notes") ? String(getOpt("notes")) : "";

        const existingComment = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
        if (existingComment.length > 0) {
          const cRow = existingComment[0];
          const repList = JSON.parse(cRow.reports || "[]");
          repList.push({
            reporter_id: discordUserId,
            reporter_username: discordUsername,
            reason,
            notes,
            created_at: new Date().toISOString(),
          });

          await db
            .update(comments)
            .set({
              reported: true,
              reportCount: (cRow.reportCount || 0) + 1,
              reports: JSON.stringify(repList),
              reportStatus: "pending",
              updatedAt: sql`(datetime('now'))`,
            })
            .where(eq(comments.id, commentId));
        }

        queueDiscordNotification(
          {
            type: "report_filed",
            comment: { id: commentId },
            user: { id: discordUserId, username: discordUsername },
            reportReason: reason,
            notes: notes || undefined,
          },
          c.env
        );

        return c.json(createDiscordMessage(`🚨 Report filed for comment \`#${commentId}\`. Thank you!`));
      }

      // /user
      if (commandName === "user") {
        const targetUserId = String(getOpt("user_id"));
        const uRows = await db
          .select()
          .from(commentumUsers)
          .where(eq(commentumUsers.commentumUserId, targetUserId))
          .limit(1);

        if (uRows.length === 0) {
          return c.json(createDiscordMessage(`❌ User \`${targetUserId}\` not found in database.`, true));
        }

        const u = uRows[0];
        const statusBadges = [];
        if (u.commentumUserBanned) statusBadges.push("⛔ BANNED");
        if (u.commentumUserMuted) statusBadges.push("🔇 MUTED");
        if (u.commentumUserShadowBanned) statusBadges.push("👻 SHADOWBANNED");
        if (u.commentumUserWarnings > 0) statusBadges.push(`⚠️ ${u.commentumUserWarnings} WARNING(S)`);

        return c.json(
          createDiscordMessage(
            `👤 **User Profile: ${u.commentumUsername}**\n` +
              `• User ID: \`${u.commentumUserId}\`\n` +
              `• Platform: \`${u.commentumClientType}\`\n` +
              `• Role: **${u.commentumUserRole.toUpperCase()}**\n` +
              `• Total Comments: **${u.commentumUserCommentCount}**\n` +
              `• Status: ${statusBadges.length > 0 ? statusBadges.join(" | ") : "🟢 Clean"}`
          )
        );
      }

      // /comment
      if (commandName === "comment") {
        const commentId = parseInt(getOpt("comment_id"), 10);
        const cRows = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);

        if (cRows.length === 0) {
          return c.json(createDiscordMessage(`❌ Comment \`#${commentId}\` not found.`, true));
        }

        const cm = cRows[0];
        let mediaTitle = cm.mediaId;
        const mRow = await db
          .select({ title: media.title })
          .from(media)
          .where(and(eq(media.clientType, cm.clientType), eq(media.mediaId, cm.mediaId)))
          .limit(1);
        if (mRow.length > 0 && mRow[0].title) {
          mediaTitle = mRow[0].title;
        }

        return c.json(
          createDiscordMessage(
            `💬 **Comment #${cm.id} Details:**\n` +
              `• Author: **${cm.username}** (\`${cm.userId}\`)\n` +
              `• Media: **${mediaTitle}** (\`${cm.mediaId}\` · ${cm.clientType})\n` +
              `• Votes: ▲ ${cm.upvotes} | ▼ ${cm.downvotes}\n` +
              `• Status: ${cm.deleted ? "🗑️ Deleted" : "🟢 Active"} ${cm.pinned ? "📌 Pinned" : ""} ${cm.locked ? "🔒 Locked" : ""}\n\n` +
              `**Content:**\n${cm.content}`
          )
        );
      }

      // Moderator verification check for remaining commands
      if (!isModeratorOrHigher(staffRole)) {
        return c.json(createDiscordMessage("❌ Moderator permissions required for this command.", true));
      }

      // /warn & /unwarn
      if (commandName === "warn" || commandName === "unwarn") {
        const targetUserId = String(getOpt("user_id"));
        const reason = String(getOpt("reason") || "Rule violation");
        const isWarn = commandName === "warn";

        if (isWarn) {
          await db
            .update(commentumUsers)
            .set({
              commentumUserWarnings: sql`commentum_user_warnings + 1`,
              commentumUserLastWarningAt: sql`(datetime('now'))`,
              commentumUserLastWarningBy: `discord:${discordUsername}`,
              commentumUserLastWarningReason: reason,
              updatedAt: sql`(datetime('now'))`,
            })
            .where(eq(commentumUsers.commentumUserId, targetUserId));

          queueDiscordNotification(
            {
              type: "user_warned",
              user: { id: targetUserId },
              moderator: { id: discordUserId, username: discordUsername },
              reason,
            },
            c.env
          );

          return c.json(createDiscordMessage(`⚠️ Warned user \`${targetUserId}\` for: **${reason}**`));
        } else {
          await db
            .update(commentumUsers)
            .set({
              commentumUserWarnings: sql`max(0, commentum_user_warnings - 1)`,
              updatedAt: sql`(datetime('now'))`,
            })
            .where(eq(commentumUsers.commentumUserId, targetUserId));

          queueDiscordNotification(
            {
              type: "user_unwarned",
              user: { id: targetUserId },
              moderator: { id: discordUserId, username: discordUsername },
              reason,
            },
            c.env
          );

          return c.json(createDiscordMessage(`✅ Removed warning from user \`${targetUserId}\`.`));
        }
      }

      // /mute & /unmute
      if (commandName === "mute" || commandName === "unmute") {
        const targetUserId = String(getOpt("user_id"));
        const reason = String(getOpt("reason") || "Rule violation");
        const isMute = commandName === "mute";

        await db
          .update(commentumUsers)
          .set({
            commentumUserMuted: isMute,
            commentumUserMutedBy: isMute ? `discord:${discordUsername}` : null,
            commentumUserMutedReason: isMute ? reason : null,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(commentumUsers.commentumUserId, targetUserId));

        queueDiscordNotification(
          {
            type: isMute ? "user_muted" : "user_unmuted",
            user: { id: targetUserId },
            moderator: { id: discordUserId, username: discordUsername },
            reason,
          },
          c.env
        );

        return c.json(createDiscordMessage(isMute ? `🔇 User \`${targetUserId}\` muted.` : `🔊 User \`${targetUserId}\` unmuted.`));
      }

      // /pin & /unpin
      if (commandName === "pin" || commandName === "unpin") {
        const commentId = parseInt(getOpt("comment_id"), 10);
        const isPin = commandName === "pin";
        await db
          .update(comments)
          .set({ pinned: isPin, pinnedBy: `discord:${discordUsername}`, updatedAt: sql`(datetime('now'))` })
          .where(eq(comments.id, commentId));

        queueDiscordNotification(
          {
            type: isPin ? "comment_pinned" : "comment_unpinned",
            comment: { id: commentId },
            moderator: { id: discordUserId, username: discordUsername },
          },
          c.env
        );

        return c.json(createDiscordMessage(isPin ? `📌 Pinned comment \`#${commentId}\`` : `📍 Unpinned comment \`#${commentId}\``));
      }

      // /lock & /unlock
      if (commandName === "lock" || commandName === "unlock") {
        const commentId = parseInt(getOpt("comment_id"), 10);
        const isLock = commandName === "lock";
        await db
          .update(comments)
          .set({ locked: isLock, lockedBy: `discord:${discordUsername}`, updatedAt: sql`(datetime('now'))` })
          .where(eq(comments.id, commentId));

        queueDiscordNotification(
          {
            type: isLock ? "comment_locked" : "comment_unlocked",
            comment: { id: commentId },
            moderator: { id: discordUserId, username: discordUsername },
          },
          c.env
        );

        return c.json(createDiscordMessage(isLock ? `🔒 Locked thread \`#${commentId}\`` : `🔓 Unlocked thread \`#${commentId}\``));
      }

      // /delete
      if (commandName === "delete") {
        const commentId = parseInt(getOpt("comment_id"), 10);
        await db
          .update(comments)
          .set({
            deleted: true,
            deletedAt: sql`(datetime('now'))`,
            deletedBy: `discord:${discordUsername}`,
            content: "[deleted by moderator]",
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(comments.id, commentId));

        queueDiscordNotification(
          {
            type: "comment_deleted",
            comment: { id: commentId },
            moderator: { id: discordUserId, username: discordUsername },
          },
          c.env
        );

        return c.json(createDiscordMessage(`🗑️ Comment \`#${commentId}\` deleted.`));
      }

      // /resolve
      if (commandName === "resolve") {
        const commentId = parseInt(getOpt("comment_id"), 10);
        const resolution = String(getOpt("resolution"));
        const notes = getOpt("notes") ? String(getOpt("notes")) : "";

        await db
          .update(comments)
          .set({
            reportStatus: resolution,
            reported: resolution === "resolved",
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(comments.id, commentId));

        queueDiscordNotification(
          {
            type: resolution === "resolved" ? "report_resolved" : "report_dismissed",
            comment: { id: commentId },
            moderator: { id: discordUserId, username: discordUsername },
            notes,
          },
          c.env
        );

        return c.json(createDiscordMessage(`✅ Report for comment \`#${commentId}\` marked **${resolution}**.`));
      }

      // /queue
      if (commandName === "queue") {
        const pendingComments = await db
          .select({
            id: comments.id,
            mediaId: comments.mediaId,
            reportCount: comments.reportCount,
            reports: comments.reports,
            updatedAt: comments.updatedAt,
          })
          .from(comments)
          .where(eq(comments.reportStatus, "pending"))
          .orderBy(desc(comments.updatedAt))
          .limit(10);

        if (pendingComments.length === 0) {
          return c.json(createDiscordMessage("✅ Moderation queue is empty! No pending reports."));
        }

        const list = pendingComments
          .map((cm) => `• Comment \`#${cm.id}\` on media \`${cm.mediaId}\`: **${cm.reportCount} reports**`)
          .join("\n");

        return c.json(createDiscordMessage(`🚨 **Pending Moderation Queue (${pendingComments.length}):**\n\n${list}`));
      }

      // /search_comments
      if (commandName === "search_comments") {
        const query = getOpt("query") ? String(getOpt("query")) : "";
        const limit = getOpt("limit") ? parseInt(getOpt("limit"), 10) : 5;

        let results = await db
          .select({
            id: comments.id,
            userId: comments.userId,
            username: comments.username,
            content: comments.content,
            mediaId: comments.mediaId,
          })
          .from(comments)
          .where(query ? like(comments.content, `%${query}%`) : sql`1=1`)
          .limit(limit);

        if (results.length === 0) {
          return c.json(createDiscordMessage(`🔍 No comments found matching search criteria.`));
        }

        const out = results
          .map((c) => `• \`#${c.id}\` by **${c.username}**: ${c.content.slice(0, 50)}...`)
          .join("\n");

        return c.json(createDiscordMessage(`🔍 **Search Results:**\n\n${out}`));
      }

      // Admin verification check for remaining commands
      if (!isAdminOrHigher(staffRole)) {
        return c.json(createDiscordMessage("❌ Admin permissions required for this command.", true));
      }

      // /ban & /unban
      if (commandName === "ban" || commandName === "unban") {
        const targetUserId = String(getOpt("user_id"));
        const reason = String(getOpt("reason") || "Banned by admin");
        const isBan = commandName === "ban";
        const shadow = getOpt("shadow") === true;

        if (isBan) {
          await db
            .update(commentumUsers)
            .set({
              commentumUserBanned: !shadow,
              commentumUserShadowBanned: shadow,
              commentumUserBannedAt: sql`(datetime('now'))`,
              commentumUserBannedBy: `discord:${discordUsername}`,
              commentumUserBannedReason: reason,
              updatedAt: sql`(datetime('now'))`,
            })
            .where(eq(commentumUsers.commentumUserId, targetUserId));

          queueDiscordNotification(
            {
              type: shadow ? "user_shadow_banned" : "user_banned",
              user: { id: targetUserId },
              moderator: { id: discordUserId, username: discordUsername },
              reason,
            },
            c.env
          );

          return c.json(createDiscordMessage(shadow ? `👻 User \`${targetUserId}\` shadowbanned.` : `⛔ User \`${targetUserId}\` banned.`));
        } else {
          await db
            .update(commentumUsers)
            .set({
              commentumUserBanned: false,
              commentumUserShadowBanned: false,
              updatedAt: sql`(datetime('now'))`,
            })
            .where(eq(commentumUsers.commentumUserId, targetUserId));

          queueDiscordNotification(
            {
              type: "user_unbanned",
              user: { id: targetUserId },
              moderator: { id: discordUserId, username: discordUsername },
              reason,
            },
            c.env
          );

          return c.json(createDiscordMessage(`♻️ User \`${targetUserId}\` unbanned.`));
        }
      }

      // /shadowban & /unshadowban
      if (commandName === "shadowban" || commandName === "unshadowban") {
        const targetUserId = String(getOpt("user_id"));
        const reason = String(getOpt("reason") || "Shadow ban action");
        const isShadow = commandName === "shadowban";

        await db
          .update(commentumUsers)
          .set({
            commentumUserShadowBanned: isShadow,
            commentumUserShadowBannedAt: isShadow ? sql`(datetime('now'))` : null,
            commentumUserShadowBannedBy: isShadow ? `discord:${discordUsername}` : null,
            commentumUserShadowBannedReason: isShadow ? reason : null,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(commentumUsers.commentumUserId, targetUserId));

        queueDiscordNotification(
          {
            type: isShadow ? "user_shadow_banned" : "user_unshadow_banned",
            user: { id: targetUserId },
            moderator: { id: discordUserId, username: discordUsername },
            reason,
          },
          c.env
        );

        return c.json(createDiscordMessage(isShadow ? `👻 User \`${targetUserId}\` shadowbanned.` : `🌟 Shadowban removed for \`${targetUserId}\`.`));
      }

      // /promote & /demote
      if (commandName === "promote" || commandName === "demote") {
        const targetUserId = String(getOpt("user_id"));
        const newRole = String(getOpt("role"));

        await db
          .update(commentumUsers)
          .set({
            commentumUserRole: newRole,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(commentumUsers.commentumUserId, targetUserId));

        return c.json(createDiscordMessage(`🎖️ User \`${targetUserId}\` role updated to **${newRole.toUpperCase()}**.`));
      }

      // Super Admin commands
      if (!isSuperAdminOrHigher(staffRole)) {
        return c.json(createDiscordMessage("❌ Super Admin permissions required.", true));
      }

      // /config
      if (commandName === "config") {
        const action = String(getOpt("action"));
        const key = getOpt("key") ? String(getOpt("key")) : null;
        const val = getOpt("value") ? String(getOpt("value")) : null;

        if (action === "view") {
          if (key) {
            const row = await db.select().from(configTable).where(eq(configTable.key, key)).limit(1);
            return c.json(createDiscordMessage(`⚙️ **Config \`${key}\`**: \`${row[0]?.value || "not set"}\``));
          }
          const all = await db.select().from(configTable).limit(20);
          const out = all.map((cfg) => `• \`${cfg.key}\`: ${cfg.value}`).join("\n");
          return c.json(createDiscordMessage(`⚙️ **System Configurations:**\n\n${out}`));
        }

        if (action === "update" && key && val) {
          await db
            .insert(configTable)
            .values({ key, value: val })
            .onConflictDoUpdate({
              target: configTable.key,
              set: { value: val, updatedAt: sql`(datetime('now'))` },
            });
          return c.json(createDiscordMessage(`✅ Updated config \`${key}\` to \`${val}\`.`));
        }

        return c.json(createDiscordMessage("Invalid config options.", true));
      }

      // /add
      if (commandName === "add") {
        const serverName = String(getOpt("server_name"));
        const guildId = String(getOpt("guild_id"));
        const channelId = getOpt("channel_id") ? String(getOpt("channel_id")) : null;
        const modChannelId = getOpt("moderation_channel_id") ? String(getOpt("moderation_channel_id")) : null;
        const roleId = getOpt("role_id") ? String(getOpt("role_id")) : null;

        await db
          .insert(serverConfigs)
          .values({
            serverName,
            guildId,
            channelId,
            moderationChannelId: modChannelId,
            roleId,
          })
          .onConflictDoUpdate({
            target: serverConfigs.guildId,
            set: {
              serverName,
              channelId,
              moderationChannelId: modChannelId,
              roleId,
              updatedAt: sql`(datetime('now'))`,
            },
          });

        return c.json(createDiscordMessage(`🏰 Server **${serverName}** (\`${guildId}\`) registered successfully!`));
      }

      return c.json(createDiscordMessage(`Command \`/${commandName}\` executed.`, true));
    }

    return c.json({ type: 1 });
  } catch (error: any) {
    console.error("Discord interaction error:", error);
    return c.json(createDiscordMessage(`❌ Error: ${error?.message || "Internal error"}`), 500);
  }
});

/**
 * POST /discord/sync-commands
 * Syncs and publishes all 24 global slash commands to Discord's API
 */
discordRoutes.post("/sync-commands", async (c) => {
  const botToken = (c.env as any).DISCORD_BOT_TOKEN;
  const appId = (c.env as any).DISCORD_APPLICATION_ID || (c.env as any).DISCORD_CLIENT_ID;

  if (!botToken || !appId) {
    return c.json({ success: false, error: "Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID" }, 400);
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
      method: "PUT",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(GLOBAL_DISCORD_COMMANDS),
    });

    if (!res.ok) {
      const err = await res.text();
      return c.json({ success: false, error: err }, res.status as any);
    }

    const data = await res.json();
    return c.json({
      success: true,
      message: `Successfully synced ${GLOBAL_DISCORD_COMMANDS.length} global commands to Discord!`,
      commands: data,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
