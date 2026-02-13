-- ====================================
-- CHANNEL IDS FOR BOT API (COMPONENTS V2)
-- ====================================
-- This migration replaces webhook URLs with channel IDs for Bot API usage
-- This enables interactive buttons via Discord Components V2

-- ====================================
-- UPDATE server_configs TABLE
-- ====================================

-- Drop the webhook_url column
ALTER TABLE server_configs DROP COLUMN IF EXISTS webhook_url;

-- Drop the moderation_webhook_url column
ALTER TABLE server_configs DROP COLUMN IF EXISTS moderation_webhook_url;

-- Add channel_id column for comments channel
ALTER TABLE server_configs ADD COLUMN IF NOT EXISTS channel_id TEXT;

-- Add moderation_channel_id column for moderation channel
ALTER TABLE server_configs ADD COLUMN IF NOT EXISTS moderation_channel_id TEXT;

-- Add index for channel lookups
CREATE INDEX IF NOT EXISTS idx_server_configs_channel_id ON server_configs(channel_id);
CREATE INDEX IF NOT EXISTS idx_server_configs_moderation_channel_id ON server_configs(moderation_channel_id);

-- ====================================
-- UPDATE discord_notifications TABLE
-- ====================================

-- Drop the webhook_url column
ALTER TABLE discord_notifications DROP COLUMN IF EXISTS webhook_url;

-- Add channel_id column (to track which channel the notification was sent to)
ALTER TABLE discord_notifications ADD COLUMN IF NOT EXISTS channel_id TEXT;

-- Add message_id column if not exists (to track the Discord message for button interactions)
-- This allows us to update/delete messages when actions are taken
ALTER TABLE discord_notifications ADD COLUMN IF NOT EXISTS message_id TEXT;

-- Add guild_id column to track which server received the notification
ALTER TABLE discord_notifications ADD COLUMN IF NOT EXISTS guild_id TEXT;

-- Create index for message lookups (for button interaction handling)
CREATE INDEX IF NOT EXISTS idx_discord_notifications_message_id ON discord_notifications(message_id);
CREATE INDEX IF NOT EXISTS idx_discord_notifications_guild_id ON discord_notifications(guild_id);

-- ====================================
-- UPDATE config TABLE
-- ====================================

-- Ensure bot token is available (should already exist from 002 migration)
-- This is just a reminder that discord_bot_token must be set in config

-- Add bot presence status
INSERT INTO config (key, value) VALUES 
    ('discord_bot_status', 'online'),
    ('discord_bot_activity', 'Monitoring comments')
ON CONFLICT (key) DO NOTHING;

-- ====================================
-- COMMENTS
-- ====================================
-- After running this migration:
-- 1. Set channel_id and moderation_channel_id in server_configs for each server
-- 2. Ensure discord_bot_token is set in config table
-- 3. Bot must have SEND_MESSAGES permission in both channels
-- 4. Bot must have READ_MESSAGE_HISTORY for updating messages
