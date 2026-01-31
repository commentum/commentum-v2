-- ====================================
-- ADD USERS TABLE FOR BETTER USER MANAGEMENT
-- ====================================

-- Create sequence for auto-incrementing user IDs
CREATE SEQUENCE IF NOT EXISTS user_id_seq START 1;

-- Users table to store user-specific information
CREATE TABLE users (
    -- Primary identification
    id INTEGER PRIMARY KEY DEFAULT nextval('user_id_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- User identification (composite key for different platforms)
    client_type TEXT NOT NULL,
    user_id TEXT NOT NULL,
    
    -- User profile information (from platform APIs)
    username TEXT NOT NULL,
    user_avatar TEXT,
    user_role TEXT DEFAULT 'user' CHECK (user_role IN ('user', 'moderator', 'admin', 'super_admin', 'owner')),
    
    -- User status and moderation
    user_banned BOOLEAN DEFAULT FALSE,
    user_shadow_banned BOOLEAN DEFAULT FALSE,
    user_muted_until TIMESTAMPTZ,
    user_warnings INTEGER DEFAULT 0,
    
    -- User statistics
    total_comments INTEGER DEFAULT 0,
    total_upvotes_received INTEGER DEFAULT 0,
    total_downvotes_received INTEGER DEFAULT 0,
    total_reports_received INTEGER DEFAULT 0,
    
    -- Last activity tracking
    last_comment_at TIMESTAMPTZ,
    last_moderation_at TIMESTAMPTZ,
    last_moderated_by TEXT,
    last_moderation_reason TEXT,
    last_moderation_action TEXT,
    
    -- Ban/mute history (JSON arrays for audit trail)
    ban_history TEXT, -- JSON array of ban records
    mute_history TEXT, -- JSON array of mute records
    warning_history TEXT, -- JSON array of warning records
    
    -- System fields
    ip_addresses TEXT, -- JSON array of IP addresses used
    user_agents TEXT, -- JSON array of user agents used
    
    -- Constraints
    CONSTRAINT unique_user_per_platform UNIQUE(client_type, user_id),
    CONSTRAINT username_length CHECK (length(username) >= 1 AND length(username) <= 50),
    CONSTRAINT user_warnings_non_negative CHECK (user_warnings >= 0),
    CONSTRAINT total_stats_non_negative CHECK (
        total_comments >= 0 AND 
        total_upvotes_received >= 0 AND 
        total_downvotes_received >= 0 AND 
        total_reports_received >= 0
    )
);

-- Add owner role to the check constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_role_check;
ALTER TABLE users ADD CONSTRAINT users_user_role_check 
    CHECK (user_role IN ('user', 'moderator', 'admin', 'super_admin', 'owner'));

-- Indexes for performance
CREATE INDEX idx_users_client_user ON users(client_type, user_id);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(user_role);
CREATE INDEX idx_users_banned ON users(user_banned);
CREATE INDEX idx_users_shadow_banned ON users(user_shadow_banned);
CREATE INDEX idx_users_muted ON users(user_muted_until);
CREATE INDEX idx_users_warnings ON users(user_warnings);
CREATE INDEX idx_users_last_comment ON users(last_comment_at);
CREATE INDEX idx_users_last_moderation ON users(last_moderation_at);

-- Trigger for updated_at on users table
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to get or create user
CREATE OR REPLACE FUNCTION get_or_create_user(
    p_client_type TEXT,
    p_user_id TEXT,
    p_username TEXT,
    p_user_avatar TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    user_record_id INTEGER;
BEGIN
    -- Try to find existing user
    SELECT id INTO user_record_id 
    FROM users 
    WHERE client_type = p_client_type AND user_id = p_user_id;
    
    -- If user doesn't exist, create them
    IF user_record_id IS NULL THEN
        INSERT INTO users (client_type, user_id, username, user_avatar)
        VALUES (p_client_type, p_user_id, p_username, p_user_avatar)
        RETURNING id INTO user_record_id;
    ELSE
        -- Update existing user's info in case it changed
        UPDATE users 
        SET 
            username = p_username,
            user_avatar = COALESCE(p_user_avatar, user_avatar),
            updated_at = NOW()
        WHERE id = user_record_id;
    END IF;
    
    RETURN user_record_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user statistics
CREATE OR REPLACE FUNCTION update_user_stats(
    p_user_id INTEGER,
    p_comment_increment INTEGER DEFAULT 0,
    p_upvote_increment INTEGER DEFAULT 0,
    p_downvote_increment INTEGER DEFAULT 0,
    p_report_increment INTEGER DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    UPDATE users 
    SET 
        total_comments = total_comments + p_comment_increment,
        total_upvotes_received = total_upvotes_received + p_upvote_increment,
        total_downvotes_received = total_downvotes_received + p_downvote_increment,
        total_reports_received = total_reports_received + p_report_increment,
        last_comment_at = CASE WHEN p_comment_increment > 0 THEN NOW() ELSE last_comment_at END,
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to apply moderation action to user
CREATE OR REPLACE FUNCTION apply_user_moderation(
    p_user_id INTEGER,
    p_action TEXT, -- 'warn', 'mute', 'ban', 'shadow_ban', 'unmute', 'unban'
    p_duration_hours INTEGER DEFAULT NULL, -- for mutes
    p_reason TEXT DEFAULT NULL,
    p_moderator_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    current_warnings INTEGER;
    new_mute_until TIMESTAMPTZ;
    history_record JSON;
BEGIN
    -- Get current warning count
    SELECT user_warnings INTO current_warnings FROM users WHERE id = p_user_id;
    
    CASE p_action
        WHEN 'warn' THEN
            UPDATE users 
            SET 
                user_warnings = user_warnings + 1,
                last_moderation_at = NOW(),
                last_moderated_by = p_moderator_id,
                last_moderation_reason = p_reason,
                last_moderation_action = 'warn',
                warning_history = COALESCE(warning_history, '[]'::json) || jsonb_build_object(
                    'timestamp', NOW(),
                    'reason', p_reason,
                    'moderator', p_moderator_id,
                    'warning_count', user_warnings + 1
                )::text
            WHERE id = p_user_id;
            
        WHEN 'mute' THEN
            new_mute_until := NOW() + (p_duration_hours || ' hours')::INTERVAL;
            UPDATE users 
            SET 
                user_muted_until = new_mute_until,
                last_moderation_at = NOW(),
                last_moderated_by = p_moderator_id,
                last_moderation_reason = p_reason,
                last_moderation_action = 'mute',
                mute_history = COALESCE(mute_history, '[]'::json) || jsonb_build_object(
                    'timestamp', NOW(),
                    'reason', p_reason,
                    'moderator', p_moderator_id,
                    'duration_hours', p_duration_hours,
                    'muted_until', new_mute_until
                )::text
            WHERE id = p_user_id;
            
        WHEN 'unmute' THEN
            UPDATE users 
            SET 
                user_muted_until = NULL,
                last_moderation_at = NOW(),
                last_moderated_by = p_moderator_id,
                last_moderation_reason = p_reason,
                last_moderation_action = 'unmute',
                mute_history = COALESCE(mute_history, '[]'::json) || jsonb_build_object(
                    'timestamp', NOW(),
                    'reason', p_reason,
                    'moderator', p_moderator_id,
                    'action', 'unmute'
                )::text
            WHERE id = p_user_id;
            
        WHEN 'ban' THEN
            UPDATE users 
            SET 
                user_banned = TRUE,
                last_moderation_at = NOW(),
                last_moderated_by = p_moderator_id,
                last_moderation_reason = p_reason,
                last_moderation_action = 'ban',
                ban_history = COALESCE(ban_history, '[]'::json) || jsonb_build_object(
                    'timestamp', NOW(),
                    'reason', p_reason,
                    'moderator', p_moderator_id,
                    'action', 'ban'
                )::text
            WHERE id = p_user_id;
            
        WHEN 'shadow_ban' THEN
            UPDATE users 
            SET 
                user_shadow_banned = TRUE,
                last_moderation_at = NOW(),
                last_moderated_by = p_moderator_id,
                last_moderation_reason = p_reason,
                last_moderation_action = 'shadow_ban',
                ban_history = COALESCE(ban_history, '[]'::json) || jsonb_build_object(
                    'timestamp', NOW(),
                    'reason', p_reason,
                    'moderator', p_moderator_id,
                    'action', 'shadow_ban'
                )::text
            WHERE id = p_user_id;
            
        WHEN 'unban' THEN
            UPDATE users 
            SET 
                user_banned = FALSE,
                user_shadow_banned = FALSE,
                last_moderation_at = NOW(),
                last_moderated_by = p_moderator_id,
                last_moderation_reason = p_reason,
                last_moderation_action = 'unban',
                ban_history = COALESCE(ban_history, '[]'::json) || jsonb_build_object(
                    'timestamp', NOW(),
                    'reason', p_reason,
                    'moderator', p_moderator_id,
                    'action', 'unban'
                )::text
            WHERE id = p_user_id;
    END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add owner_users config if it doesn't exist
INSERT INTO config (key, value) 
SELECT 'owner_users', '[]' 
WHERE NOT EXISTS (SELECT 1 FROM config WHERE key = 'owner_users');

-- Row Level Security for users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users RLS Policies
-- Anyone can read non-banned users
CREATE POLICY "Anyone can read users" ON users
    FOR SELECT USING (
        user_banned = false AND 
        user_shadow_banned = false
    );

-- Anyone can insert users (for user creation)
CREATE POLICY "Anyone can insert users" ON users
    FOR INSERT WITH CHECK (true);

-- Users can update their own profile, moderators can update any
CREATE POLICY "Users can update own profile" ON users
    FOR UPDATE USING (
        -- This would need auth.uid() mapping, for now allow moderators
        is_user_in_role(auth.uid()::text, 'moderator_users') OR
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users') OR
        is_user_in_role(auth.uid()::text, 'owner_users')
    );

-- Only moderators can delete users
CREATE POLICY "Moderators can delete users" ON users
    FOR DELETE USING (
        is_user_in_role(auth.uid()::text, 'moderator_users') OR
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users') OR
        is_user_in_role(auth.uid()::text, 'owner_users')
    );