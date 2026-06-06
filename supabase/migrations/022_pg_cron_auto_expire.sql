-- ====================================
-- MIGRATION 022: pg_cron Auto-Expire
-- Schedules cleanup_expired_moderation() to run every 5 minutes
-- This ensures expired bans/mutes/shadowbans are reset AUTOMATICALLY
-- without requiring an API call (not just lazy/on-call cleanup)
-- ====================================

-- Enable pg_cron extension (Supabase supports this)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the cleanup function to run every 5 minutes
-- This resets the boolean flags (banned=false, muted=false, shadow_banned=false)
-- when their *_until timestamp has passed, making it truly "auto" expire
SELECT cron.schedule(
    'cleanup-expired-moderation',
    '*/5 * * * *',  -- Every 5 minutes
    $$SELECT cleanup_expired_moderation()$$
);

-- Add config entry for pg_cron interval (for documentation/disabling)
INSERT INTO config (key, value) VALUES
    ('auto_expire_cron_enabled', 'true'),
    ('auto_expire_cron_interval_minutes', '5')
ON CONFLICT (key) DO NOTHING;
