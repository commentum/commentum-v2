-- ============================================
-- FCM Push Notification System Migration
-- ============================================

-- Table to store user FCM device tokens
-- Each user can have multiple devices (phone + tablet, etc.)
CREATE TABLE IF NOT EXISTS fcm_tokens (
    id BIGSERIAL PRIMARY KEY,
    client_type TEXT NOT NULL,
    user_id TEXT NOT NULL,
    fcm_token TEXT NOT NULL,
    device_info TEXT,
    platform TEXT DEFAULT 'android',
    app_version TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,

    -- Each (client_type, user_id, fcm_token) is unique
    UNIQUE(client_type, user_id, fcm_token)
);

-- Index for fast lookups when sending push notifications
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user ON fcm_tokens(client_type, user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_active ON fcm_tokens(is_active) WHERE is_active = TRUE;

-- Enable RLS
ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies: allow insert/update/delete via service role only
CREATE POLICY "Service role full access on fcm_tokens"
    ON fcm_tokens
    FOR ALL
    USING (auth.role() = 'service_role');

-- Table for user notification preferences (per user per client_type)
CREATE TABLE IF NOT EXISTS notification_preferences (
    id BIGSERIAL PRIMARY KEY,
    client_type TEXT NOT NULL,
    user_id TEXT NOT NULL,
    
    -- Notification type toggles
    notify_on_reply BOOLEAN DEFAULT TRUE,
    notify_on_vote BOOLEAN DEFAULT TRUE,
    notify_on_mention BOOLEAN DEFAULT TRUE,
    notify_on_comment_delete BOOLEAN DEFAULT FALSE,
    notify_on_mod_action BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One preference row per (client_type, user_id)
    UNIQUE(client_type, user_id)
);

-- Enable RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on notification_preferences"
    ON notification_preferences
    FOR ALL
    USING (auth.role() = 'service_role');

-- Add config entry for FCM push notifications
INSERT INTO config (key, value) VALUES ('fcm_notifications_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Add config entry for FCM server key (must be set by admin)
-- This is the Firebase Cloud Messaging server key / service account JSON
INSERT INTO config (key, value) VALUES ('fcm_server_key', '')
ON CONFLICT (key) DO NOTHING;

-- Add notification_types to config for granular control
INSERT INTO config (key, value) VALUES (
    'fcm_notification_types',
    '["comment_reply","comment_vote","comment_delete","mod_action"]'
) ON CONFLICT (key) DO NOTHING;
