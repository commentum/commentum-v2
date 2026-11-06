# Discord bot commands

All commands are global slash commands, auto-synced on cold start of the `discord` edge function
(set `DISCORD_COMMAND_SYNC_ON_BOOT=false` to disable). Roles: `user < moderator < admin < super_admin < app_owner < owner`.
The effective role is the highest of: the `discord_users` row, and the role of the registered platform ID and
the Discord ID in `commentum_users` / `config`.

## Everyone
| Command | What it shows |
|---|---|
| `/register` | Link your Discord account to a platform account |
| `/report` | Report a comment |
| `/user user_id [section] [platform]` | Profile. Sections: `overview` (counts, votes, reports, first/last comment, Discord link, points, per-platform status), `points` (balance, tier, breakdown, streak, spent, ad rewards), `customization`, `linked` |
| `/comment comment_id` | Comment details: votes, replies, media, tags, pinned/locked/deleted info, language |
| `/search_comments` | Search with wildcards, user and media autocomplete |
| `/stats` | Totals, 24h/7d/30d activity, users per platform and role, top commenters, system flags |
| `/leaderboard [platform] [page]` | Points leaderboard |
| `/mypoints` | Your own points (needs `/register`) |
| `/customizations [user_id]` | Catalog summary, or a user's equipped and unlocked items |
| `/announcements` | Latest published announcements |
| `/help` | Commands for your role |

## Moderator
| Command | Purpose |
|---|---|
| `/warn` `/unwarn` `/mute` `/unmute` | Warnings and mutes |
| `/pin` `/unpin` `/lock` `/unlock` | Comment moderation |
| `/resolve` | Resolve a report |
| `/queue [page]` | Pending reports, oldest first, with reporter ID, reason and notes |
| `/user ... section:moderation` | Ban/mute/shadow-ban reasons, who and when, warnings, notes |
| `/modlog user_id` | Full history: warnings, bans, mutes, moderated and deleted comments |
| `/note user_id action:view\|add\|clear [text]` | Staff notes (`clear` is admin only) |
| `/bans [type] [page]` | Active bans, shadow bans and mutes |
| `/audit [limit] [moderator_id]` | Recent moderation actions (points adjustments for admins) |
| `/sync_status` | Dantotsu sync metadata and mapping counts (token-like keys are masked) |
| `/delete`, `/points_check` | As before |

## Admin and above
`/ban` `/unban` `/shadowban` `/unshadowban`, `/points_give` `/points_deduct` `/points_undo`,
`/purge user_id reason confirm:true` (soft-deletes all live comments of a user; without `confirm` it only reports the count).

## Super admin and above
`/promote` `/demote` `/config` `/add`.

## Notes
- IP addresses and user agents are stored on comments and users but are deliberately **not** shown in Discord.
- `/audit` is derived from fields already stored (`moderated_*`, `last_moderation_*`, point adjustments). A dedicated
  append-only audit table would be the next step if full history per action is required.
- Counts use exact head-counts and paged reads, so results are no longer capped at 1000 rows.
