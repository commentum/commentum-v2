# Discord Bot Integration Setup Guide

## 🎯 Overview

This guide will help you set up the Discord bot integration for Commentum v2, which provides:
- **Slash Commands** for admin/moderator management
- **Real-time Notifications** for all comment activities
- **Role-based Permissions** (Super Admin, Admin, Mod)
- **Media Preview Images** in notifications

## 📋 Prerequisites

1. **Discord Bot Token** - Create a bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. **Discord Application ID** - From your bot application
3. **Discord Guild ID** - Your server ID where the bot will be installed
4. **Discord Webhook URL** - For sending notifications to a channel

## 🚀 Setup Steps

### 1. Create Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" → Give it a name (e.g., "Commentum Bot")
3. Go to "Bot" tab → Click "Add Bot"
4. Under "Privileged Gateway Intents", enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
5. Copy the **Bot Token** (keep this secure!)

### 2. Configure Bot Permissions

1. Go to "OAuth2" → "URL Generator"
2. Select these scopes:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Select these Bot Permissions:
   - ✅ `Send Messages`
   - ✅ `Embed Links`
   - ✅ `Read Message History`
   - ✅ `Use Application Commands`
   - ✅ `Manage Messages` (for moderation)
4. Copy the generated URL and invite the bot to your server

### 3. Get Required IDs

1. **Guild ID**: Right-click your server icon in Discord → "Copy Server ID" (enable Developer Mode in Discord settings)
2. **Channel ID**: Right-click the channel where you want notifications → "Copy Channel ID"
3. **Webhook URL**: 
   - Go to channel settings → "Integrations" → "Webhooks" → "New Webhook"
   - Name it "Commentum Notifications"
   - Copy the Webhook URL

### 4. Update Database Schema

Apply the new migration to add Discord integration tables:

```sql
-- Apply this migration to your Supabase database
-- File: /supabase/migrations/002_discord_integration.sql
```

### 5. Configure Environment Variables

Add these to your Supabase Edge Functions environment:

```bash
# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
DISCORD_GUILD_ID=your_server_id_here
DISCORD_WEBHOOK_URL=your_webhook_url_here
```

### 6. Deploy Functions

Deploy all the Edge Functions:

```bash
# Deploy all functions including the new discord function
supabase functions deploy .

# Or deploy specific functions
supabase functions deploy discord
supabase functions deploy comments
supabase functions deploy votes
supabase functions deploy moderation
supabase functions deploy reports
```

### 7. Sync Discord Commands

Call the sync endpoint to register slash commands:

```bash
curl -X POST "https://your-project.supabase.co/functions/v1/discord" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_service_role_key" \
  -d '{
    "action": "sync_commands"
  }'
```

## 🎮 Available Commands

### `/register` - Register Your Account
**Required for first-time users**
- `platform`: Choose your platform (AniList, MyAnimeList, SIMKL)
- `user_id`: Your platform user ID
- `token`: Your platform access token

### 🔒 Moderator+ Commands
- `/ban <user_id> <reason> [shadow]` - Ban a user (Admin/Super Admin only)
- `/warn <user_id> <reason>` - Warn a user
- `/pin <comment_id> [reason]` - Pin a comment
- `/lock <comment_id> [reason]` - Lock a comment thread
- `/delete <comment_id>` - Delete a comment

### 📊 Information Commands
- `/stats` - View system statistics

## 🎨 Notification Types

The bot sends notifications for:

### 💬 Comment Activities
- **New Comments**: Shows comment preview with media info
- **Edited Comments**: Notifies when comments are edited
- **Deleted Comments**: Shows who deleted the comment

### 🗳️ Voting Activities
- **Upvotes/Downvotes**: Notifies new votes on comments

### 🛡️ Moderation Actions
- **User Bans**: Shows banned user and reason
- **User Warnings**: Shows warned user and reason
- **Pinned Comments**: Highlights pinned comments
- **Locked Threads**: Notifies when threads are locked

### 🚨 Reports
- **Comment Reports**: Shows reported content and reason

## 🖼️ Media Preview Images

All notifications include:
- **Media Poster Images** (when available)
- **Media Title and Year**
- **User Avatars** (when available)
- **Color-coded Embeds** by action type

## 🔧 Configuration Options

Update these in the `config` table:

```sql
-- Enable/disable Discord notifications
UPDATE config SET value = 'true' WHERE key = 'discord_notifications_enabled';

-- Configure which notifications to send
UPDATE config SET value = '["comment_created", "comment_updated", "user_banned", "comment_pinned"]' 
WHERE key = 'discord_notification_types';

-- Update webhook URL
UPDATE config SET value = '"https://discord.com/api/webhooks/..."' 
WHERE key = 'discord_webhook_url';
```

## 🎯 Role Permissions

| Action | User | Mod | Admin | Super Admin |
|--------|------|-----|-------|-------------|
| Register | ✅ | ✅ | ✅ | ✅ |
| View Stats | ✅ | ✅ | ✅ | ✅ |
| Delete Own Comment | ✅ | ✅ | ✅ | ✅ |
| Warn Users | ❌ | ✅ | ✅ | ✅ |
| Pin/Lock Comments | ❌ | ✅ | ✅ | ✅ |
| Delete Any Comment | ❌ | ❌ | ✅ | ✅ |
| Ban Users | ❌ | ❌ | ✅ | ✅ |
| Manage Bot | ❌ | ❌ | ❌ | ✅ |

## 🚨 Troubleshooting

### Bot Not Responding
1. Check if bot token is correct
2. Verify bot has proper permissions
3. Check if environment variables are set

### Commands Not Working
1. Run the sync_commands endpoint
2. Check if bot has "Application Commands" permission
3. Verify guild ID is correct

### Notifications Not Sending
1. Check webhook URL is valid
2. Verify `discord_notifications_enabled` is 'true'
3. Check notification types are enabled

### Registration Failing
1. Verify platform token is valid
2. Check user ID is correct
3. Ensure platform API is accessible

## 📝 Example Usage

### Register as AniList User
```
/register platform:anilist user_id:123456 token:your_anilist_token
```

### Ban a User (Admin)
```
/ban user_id:789012 reason:"Spamming comments"
```

### Pin a Comment (Mod)
```
/pin comment_id:42 reason:"Great discussion point"
```

### View Statistics
```
/stats
```

## 🔗 Useful Links

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord API Documentation](https://discord.com/developers/docs/intro)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

## 🎉 Success!

Once set up, your Commentum v2 system will have:
- ✅ **Real-time Discord notifications** for all activities
- ✅ **Powerful moderation commands** via Discord
- ✅ **Beautiful media previews** in notifications
- ✅ **Role-based access control** for team management
- ✅ **Comprehensive logging** of all actions

Your Discord server is now a command center for managing your comment system! 🚀