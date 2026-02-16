-- ====================================
-- 3-CHANNEL SYSTEM MIGRATION
-- ====================================
-- This migration adds support for a 3-channel notification system:
-- 1. user_activity_channel_id - for user activity (non-mod)
-- 2. updates_channel_id - for votes + general updates
-- 3. moderation_channel_id - for moderation actions only

-- ====================================
-- UPDATE server_configs TABLE
-- ====================================

-- Rename existing channel_id to user_activity_channel_id for consistency
-- First, check if channel_id exists and rename it
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'server_configs' AND column_name = 'channel_id'
    ) THEN
        ALTER TABLE server_configs RENAME COLUMN channel_id TO user_activity_channel_id;
    END IF;
END $$;

-- Add updates_channel_id column
ALTER TABLE server_configs ADD COLUMN IF NOT EXISTS updates_channel_id TEXT;

-- Ensure moderation_channel_id exists (should already exist from migration 008)
ALTER TABLE server_configs ADD COLUMN IF NOT EXISTS moderation_channel_id TEXT;

-- Add indexes for new channel lookups
CREATE INDEX IF NOT EXISTS idx_server_configs_user_activity_channel_id ON server_configs(user_activity_channel_id);
CREATE INDEX IF NOT EXISTS idx_server_configs_updates_channel_id ON server_configs(updates_channel_id);

-- Add comments for documentation
COMMENT ON COLUMN server_configs.user_activity_channel_id IS 'Channel ID for user activity notifications (comment_created, comment_updated)';
COMMENT ON COLUMN server_configs.updates_channel_id IS 'Channel ID for updates and engagement notifications (votes, announcements, pin/lock)';
COMMENT ON COLUMN server_configs.moderation_channel_id IS 'Channel ID for moderation notifications (deletions, reports, bans, etc.)';

-- ====================================
-- UPDATE config TABLE
-- ====================================

-- Add documentation about the 3-channel system
INSERT INTO config (key, value) VALUES
    ('discord_channel_system', '3-channel'),
    ('discord_channel_system_description', JSON_BUILD_OBJECT(
        'user_activity_channel', 'User activity only (comment_created, comment_updated)',
        'updates_channel', 'Updates + engagement (votes, announcements, pin/lock)',
        'mods_channel', 'Moderation actions only (deletions, reports, bans, etc.)'
    )::TEXT)
ON CONFLICT (key) DO NOTHING;

-- ====================================
-- MIGRATION NOTES
-- ====================================
-- After running this migration:
-- 1. Update server_configs to set:
--    - user_activity_channel_id (previously channel_id)
--    - updates_channel_id (new field)
--    - moderation_channel_id (should already be set from migration 008)
-- 2. Each channel must be configured separately
-- 3. Bot must have SEND_MESSAGES permission in all three channels
-- 4. Bot must have READ_MESSAGE_HISTORY for updating messages
-- 5. Events will be routed to the appropriate channel automatically
