# Discord Integration Setup Guide

This guide explains how to set up the Discord bot and notification system for your existing Commentum v2 backend.

## 🎯 Overview

The Discord integration adds three main features:
1. **Role-based actions** - Enhanced permission system
2. **Discord bot** - Slash commands for moderation
3. **Discord notifications** - Real-time notifications via webhooks

## 📋 Prerequisites

- Discord server with administrator permissions
- Discord bot application created
- Supabase project with Commentum v2 backend
- Environment variables configured

## 🔧 Step 1: Create Discord Bot Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Name your bot (e.g., "Commentum Bot")
4. Go to "Bot" section and click "Add Bot"
5. Enable:
   - ✅ Message Content Intent
   - ✅ Application Commands (if available)
   - ✅ Bot permissions for your server

## 🔧 Step 2: Configure Bot Permissions

Add these bot permissions:
- **Send Messages** - For sending notifications
- **Embed Links** - For rich embeds
- **Read Message History** - For context
- **Use Slash Commands** - For commands
- **Read Messages/View Channels** - For monitoring

## 🔧 Step 3: Create Discord Webhook

1. In your Discord server, go to Server Settings → Integrations → Webhooks
2. Click "New Webhook"
3. Name it "Commentum Notifications"
4. Select the channel where you want notifications
5. Copy the Webhook URL

## 🔧 Step 4: Deploy Database Migrations

Run these SQL migrations in order:

```sql
-- Run migration 001 (already exists)
-- Run migration 002
-- Run migration 003
```

```bash
# Deploy to Supabase
supabase db push
```

## 🔧 Step 5: Deploy Edge Functions

```bash
# Deploy Discord bot
supabase functions deploy discord-bot --no-verify-jwt

# Deploy Discord notifications
supabase functions deploy discord-notifications --no-verify-jwt
```

## 🔧 Step 6: Set Environment Variables

Add these to your Supabase Edge Function secrets:

```bash
# Discord Bot
DISCORD_PUBLIC_KEY=your_bot_public_key
DISCORD_BOT_TOKEN=your_bot_token

# Discord Notifications
DISCORD_WEBHOOK_URL=your_webhook_url

# Supabase (already exists)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
```

## 🔧 Step 7: Set Up Discord Commands

1. Go to Discord Developer Portal → Your Application → OAuth2 → URL Generator
2. Select `bot` scope
3. Copy the generated URL
4. Invite the bot to your server with the URL

## 🔧 Step 8: Configure Discord Users

Map Discord users to Commentum roles by inserting into the `discord_users` table:

```sql
-- Example: Map Discord user to super admin
INSERT INTO discord_users (
    discord_user_id,
    discord_username,
    guild_id,
    discord_roles,
    user_id,
    user_role,
    client_type
) VALUES (
    '123456789012345678',  -- Discord user ID
    'AdminUser',              -- Discord username
    '987654321098765432',  -- Discord server ID
    ARRAY['123456789', '987654321'], -- Discord role IDs
    '5724017',               -- Commentum user ID
    'super_admin',            -- Commentum role
    'anilist'                 -- Client type
);
```

## 🔧 Step 9: Configure Notification Settings

Update the config table to enable/disable notifications:

```sql
-- Enable Discord notifications
UPDATE config SET value = 'true' WHERE key = 'discord_notifications_enabled';

-- Set webhook URL
UPDATE config SET value = 'https://discord.com/api/webhooks/...' WHERE key = 'discord_webhook_url';

-- Configure what to notify about
UPDATE config SET value = 'true' WHERE key = 'discord_notify_new_comments';
UPDATE config SET value = 'true' WHERE key = 'discord_notify_moderation';
UPDATE config SET value = 'true' WHERE key = 'discord_notify_reports';
```

## 🎮 Available Discord Commands

### Comment Management
```
/comment delete <comment_id> - Delete a comment
/comment pin <comment_id> - Pin a comment
/comment unpin <comment_id> - Unpin a comment
/comment lock <comment_id> - Lock comment thread
/comment unlock <comment_id> - Unlock comment thread
/comment warn <comment_id> <reason> - Warn comment author
/comment ban <comment_id> <reason> - Ban comment author
```

### User Management
```
/user warn <user_id> <reason> - Warn a user
/user ban <user_id> <reason> [duration] - Ban a user
/user unban <user_id> - Unban a user
/user mute <user_id> <duration> - Mute a user
/user unmute <user_id> - Unmute a user
```

### Report Management
```
/reports list - List pending reports
/reports resolve <report_id> - Resolve a report
/reports dismiss <report_id> - Dismiss a report
```

## 🔒 Role-Based Permissions

### Moderator (Level 1)
- ✅ View reports
- ✅ Resolve/dismiss reports
- ✅ Pin/unpin comments
- ✅ Lock/unlock comment threads
- ✅ Warn users

### Admin (Level 2)
- ✅ All moderator permissions
- ✅ Delete any comments
- ✅ Ban users
- ✅ Manage user roles

### Super Admin (Level 3)
- ✅ All admin permissions
- ✅ Manage Discord user mappings
- ✅ System configuration

## 📱 Notification Types

### New Comment Notifications
- Trigger: New comment insertion
- Includes: User info, media info, comment content
- Color: Green (✅)

### Moderation Action Notifications
- Trigger: Comment deletion, pinning, locking
- Includes: Action type, moderator info, comment details
- Color: Action-specific (red for delete, gold for pin, etc.)

### Report Notifications
- Trigger: Report count increase
- Includes: Comment ID, report count, content preview
- Color: Red (🚨)

## 🚀 Testing the Integration

### Test Discord Bot
1. Join your Discord server
2. Type `/comment` to see available commands
3. Try a simple command like `/reports list`

### Test Notifications
1. Create a new comment via your API
2. Check Discord channel for notification
3. Perform a moderation action
4. Verify notification appears

### Test Role Permissions
1. Try commands with different Discord users
2. Verify permission restrictions work
3. Check that unauthorized users get errors

## 🔍 Troubleshooting

### Bot Not Responding
- Check if bot token is valid
- Verify bot is in the server
- Check if bot has correct permissions
- Check Edge Function logs

### Notifications Not Working
- Verify webhook URL is correct
- Check if webhook is in the right channel
- Check Edge Function logs for errors
- Verify database triggers are created

### Permission Issues
- Check Discord user mapping in `discord_users` table
- Verify role hierarchy in `permissions.ts`
- Check user is active and verified

### Database Issues
- Run `supabase db push` to apply migrations
- Check if `pg_net` extension is enabled
- Verify RLS policies are correct

## 📊 Monitoring

Check these logs for issues:
- Discord bot Edge Function logs
- Discord notifications Edge Function logs
- Database trigger logs
- Supabase function logs

## 🔄 Maintenance

Regular maintenance tasks:
- Update Discord bot token if changed
- Refresh Discord user role mappings
- Clean up old notification logs
- Update permission rules as needed

## 🛡️ Security Considerations

- Never commit Discord tokens to version control
- Use environment variables for all secrets
- Regularly rotate Discord bot tokens
- Monitor webhook URL exposure
- Limit Discord user mapping to trusted users
- Audit Discord command usage logs

## 📚 Next Steps

After setup, you can:
1. Customize Discord embeds and messages
2. Add more Discord commands
3. Create custom notification rules
4. Integrate with other Discord bots
5. Set up automated moderation workflows