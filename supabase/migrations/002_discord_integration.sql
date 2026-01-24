-- ====================================
-- DISCORD INTEGRATION MIGRATION
-- ====================================

-- Create Discord users table for bot integration
CREATE TABLE discord_users (
    id INTEGER PRIMARY KEY DEFAULT nextval('config_id_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Discord user information
    discord_user_id TEXT UNIQUE NOT NULL,
    discord_username TEXT NOT NULL,
    discord_discriminator TEXT,
    discord_avatar TEXT,
    
    -- Platform mapping
    platform_user_id TEXT NOT NULL,
    platform_type TEXT NOT NULL CHECK (platform_type IN ('anilist', 'myanimelist', 'simkl', 'other')),
    
    -- Role and permissions
    user_role TEXT NOT NULL DEFAULT 'user' CHECK (user_role IN ('user', 'moderator', 'admin', 'super_admin')),
    
    -- Registration status
    is_verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Last activity
    last_command_at TIMESTAMPTZ,
    last_action_at TIMESTAMPTZ,
    
    -- Check constraints
    CONSTRAINT discord_user_id_length CHECK (length(discord_user_id) >= 15 AND length(discord_user_id) <= 25),
    CONSTRAINT discord_username_length CHECK (length(discord_username) >= 2 AND length(discord_username) <= 32)
);

-- Create Discord notifications log table
CREATE TABLE discord_notifications (
    id INTEGER PRIMARY KEY DEFAULT nextval('comment_id_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Notification type and target
    notification_type TEXT NOT NULL CHECK (notification_type IN ('comment_created', 'comment_updated', 'comment_deleted', 'user_banned', 'user_warned', 'comment_pinned', 'comment_locked', 'vote_cast', 'report_filed')),
    target_id TEXT, -- Can be comment_id, user_id, etc.
    target_type TEXT, -- 'comment', 'user', 'media'
    
    -- Related data
    comment_data TEXT, -- JSON of comment data for context
    user_data TEXT, -- JSON of user data for context
    media_data TEXT, -- JSON of media data for context
    
    -- Discord delivery info
    webhook_url TEXT,
    message_id TEXT,
    delivery_status TEXT DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'failed')),
    delivery_error TEXT,
    delivered_at TIMESTAMPTZ,
    
    -- Retry info
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMPTZ
);

-- Indexes for Discord tables
CREATE INDEX idx_discord_users_discord_id ON discord_users(discord_user_id);
CREATE INDEX idx_discord_users_platform ON discord_users(platform_type, platform_user_id);
CREATE INDEX idx_discord_users_role ON discord_users(user_role);
CREATE INDEX idx_discord_users_active ON discord_users(is_active);
CREATE INDEX idx_discord_notifications_type ON discord_notifications(notification_type);
CREATE INDEX idx_discord_notifications_status ON discord_notifications(delivery_status);
CREATE INDEX idx_discord_notifications_created ON discord_notifications(created_at);

-- Trigger for updated_at on Discord tables
CREATE TRIGGER update_discord_users_updated_at 
    BEFORE UPDATE ON discord_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security for Discord tables
ALTER TABLE discord_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE discord_notifications ENABLE ROW LEVEL SECURITY;

-- Discord users RLS policies
-- Anyone can read active Discord users (for command verification)
CREATE POLICY "Anyone can read active discord users" ON discord_users
    FOR SELECT USING (is_active = true);

-- Only system can insert/update Discord users
CREATE POLICY "System can manage discord users" ON discord_users
    FOR ALL USING (false) WITH CHECK (false);

-- Discord notifications RLS policies
-- Only system can manage Discord notifications
CREATE POLICY "System can manage discord notifications" ON discord_notifications
    FOR ALL USING (false) WITH CHECK (false);

-- Add Discord configuration to config table
INSERT INTO config (key, value) VALUES 
    ('discord_webhook_url', ''),
    ('discord_bot_token', ''),
    ('discord_client_id', ''),
    ('discord_guild_id', ''),
    ('discord_notifications_enabled', 'true'),
    ('discord_notification_types', '["comment_created", "comment_updated", "comment_deleted", "user_banned", "user_warned", "comment_pinned", "comment_locked"]');