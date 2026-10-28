// Discord 3-Channel Bot & Webhook Notification System for Commentum v2

export interface DiscordNotificationPayload {
  type:
    | "comment_created"
    | "comment_updated"
    | "comment_deleted"
    | "comment_pinned"
    | "comment_unpinned"
    | "comment_locked"
    | "comment_unlocked"
    | "report_filed"
    | "report_resolved"
    | "user_warned"
    | "user_muted"
    | "user_unmuted"
    | "user_banned"
    | "user_unbanned"
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
    content?: string;
    episode?: string;
    chapter?: string;
  };
  user?: {
    id?: string;
    username?: string;
    avatar?: string;
  };
  moderator?: {
    id?: string;
    username?: string;
    role?: string;
  };
  report?: {
    reporter_id?: string;
    reason?: string;
    notes?: string;
  };
  reason?: string;
  announcement?: {
    title: string;
    content: string;
    app_id: string;
  };
}

/**
 * Format and dispatch an embed to Discord Webhook
 */
export async function sendDiscordWebhook(
  webhookUrl: string,
  embed: any
): Promise<boolean> {
  if (!webhookUrl || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
    return false;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Commentum v2",
        avatar_url: "https://raw.githubusercontent.com/RyanYuuki/AnymeX/main/assets/images/logo.png",
        embeds: [embed],
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn("Discord webhook delivery failed:", err);
    return false;
  }
}

/**
 * Dispatches notification to appropriate channel:
 * - Comments channel (new comments, edits, deletes)
 * - Reports channel (new reports, resolved reports)
 * - Moderation / Audit log channel (bans, mutes, warns, pins, locks)
 */
export async function queueDiscordNotification(
  data: DiscordNotificationPayload,
  env: {
    DISCORD_WEBHOOK_COMMENTS?: string;
    DISCORD_WEBHOOK_REPORTS?: string;
    DISCORD_WEBHOOK_LOGS?: string;
  }
) {
  const timestamp = new Date().toISOString();

  // 1. Comments Channel
  if (data.type === "comment_created") {
    if (!env.DISCORD_WEBHOOK_COMMENTS) return;
    const c = data.comment;
    await sendDiscordWebhook(env.DISCORD_WEBHOOK_COMMENTS, {
      title: `💬 New Comment on ${c?.media_title || "Media #" + c?.media_id}`,
      description: c?.content ? (c.content.length > 500 ? c.content.slice(0, 497) + "..." : c.content) : "",
      color: 0x3b82f6, // Blue
      fields: [
        { name: "Author", value: `${c?.username || "Unknown"} (${c?.client_type})`, inline: true },
        { name: "Media ID", value: String(c?.media_id), inline: true },
        ...(c?.episode ? [{ name: "Episode", value: String(c.episode), inline: true }] : []),
      ],
      timestamp,
    });
  }

  // 2. Reports Channel
  else if (data.type === "report_filed") {
    if (!env.DISCORD_WEBHOOK_REPORTS) return;
    await sendDiscordWebhook(env.DISCORD_WEBHOOK_REPORTS, {
      title: `🚨 Report Filed on Comment #${data.comment?.id}`,
      color: 0xef4444, // Red
      fields: [
        { name: "Reason", value: data.report?.reason || "Other", inline: true },
        { name: "Reporter", value: String(data.report?.reporter_id), inline: true },
        { name: "Notes", value: data.report?.notes || "None" },
      ],
      timestamp,
    });
  }

  // 3. Moderation Channel (Warn, Mute, Ban, Pin, Lock)
  else if (
    data.type === "user_warned" ||
    data.type === "user_muted" ||
    data.type === "user_banned" ||
    data.type === "comment_pinned" ||
    data.type === "comment_locked"
  ) {
    if (!env.DISCORD_WEBHOOK_LOGS) return;
    const colors: Record<string, number> = {
      user_warned: 0xf59e0b, // Amber
      user_muted: 0xe11d48,  // Rose
      user_banned: 0x991b1b, // Dark red
      comment_pinned: 0x10b981, // Emerald
      comment_locked: 0x6b7280, // Gray
    };

    await sendDiscordWebhook(env.DISCORD_WEBHOOK_LOGS, {
      title: `🛡️ Moderation: ${data.type.replace(/_/g, " ").toUpperCase()}`,
      color: colors[data.type] || 0x6b7280,
      fields: [
        { name: "Staff Member", value: `${data.moderator?.username || "Staff"} (${data.moderator?.role || "mod"})`, inline: true },
        { name: "Target User", value: `${data.user?.username || data.user?.id || "N/A"}`, inline: true },
        ...(data.reason ? [{ name: "Reason", value: data.reason }] : []),
      ],
      timestamp,
    });
  }

  // 4. Announcements Channel
  else if (data.type === "announcement_published") {
    if (!env.DISCORD_WEBHOOK_COMMENTS) return;
    await sendDiscordWebhook(env.DISCORD_WEBHOOK_COMMENTS, {
      title: `📢 Announcement: ${data.announcement?.title}`,
      description: data.announcement?.content,
      color: 0x8b5cf6, // Violet
      fields: [
        { name: "App", value: data.announcement?.app_id || "AnymeX", inline: true },
      ],
      timestamp,
    });
  }
}
