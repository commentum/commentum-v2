-- ====================================
-- CREATE DEDICATED USERS TABLE
-- Centralizes all user-related information
-- ====================================

-- Create sequence for users table
CREATE SEQUENCE IF NOT EXISTS users_id_seq START 1000;

-- Create dedicated users table
CREATE TABLE users (
    -- Primary identification
    id INTEGER PRIMARY KEY DEFAULT nextval('users_id_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- User identification (composite key for multi-platform support)
    user_id TEXT NOT NULL,        -- Platform user ID
    client_type TEXT NOT NULL,    -- Platform name (anilist, myanimelist, simkl, other)
    
    -- User profile information
    username TEXT NOT NULL,
    user_avatar TEXT,
    
    -- Role and permissions
    user_role TEXT DEFAULT 'user' CHECK (user_role IN ('user', 'moderator', 'admin', 'super_admin', 'owner')),
    
    -- User status and moderation
    user_banned BOOLEAN DEFAULT FALSE,
    user_shadow_banned BOOLEAN DEFAULT FALSE,
    user_muted_until TIMESTAMPTZ,
    user_warnings INTEGER DEFAULT 0,
    
    -- User statistics (denormalized for performance)
    total_comments INTEGER DEFAULT 0,
    total_upvotes_received INTEGER DEFAULT 0,
    total_downvotes_received INTEGER DEFAULT 0,
    total_votes_cast INTEGER DEFAULT 0,
    total_reports_filed INTEGER DEFAULT 0,
    total_reports_received INTEGER DEFAULT 0,
    total_pinned_comments INTEGER DEFAULT 0,
    total_deleted_comments INTEGER DEFAULT 0,
    
    -- Last activity tracking
    last_comment_at TIMESTAMPTZ,
    last_vote_at TIMESTAMPTZ,
    last_report_at TIMESTAMPTZ,
    last_moderation_action_at TIMESTAMPTZ,
    
    -- Moderation history (JSON arrays for audit trail)
    ban_history TEXT,              -- JSON array of ban records
    warning_history TEXT,          -- JSON array of warning records
    mute_history TEXT,             -- JSON array of mute records
    moderation_history TEXT,       -- JSON array of all moderation actions
    
    -- System fields
    ip_address TEXT,
    user_agent TEXT,
    
    -- Unique constraint for platform-specific user identification
    CONSTRAINT users_unique_platform_user UNIQUE (user_id, client_type),
    
    -- Check constraints
    CONSTRAINT username_length CHECK (length(username) >= 1 AND length(username) <= 50),
    CONSTRAINT user_id_length CHECK (length(user_id) >= 1),
    CONSTRAINT non_negative_warnings CHECK (user_warnings >= 0),
    CONSTRAINT non_negative_stats CHECK (
        total_comments >= 0 AND 
        total_upvotes_received >= 0 AND 
        total_downvotes_received >= 0 AND
        total_votes_cast >= 0 AND
        total_reports_filed >= 0 AND
        total_reports_received >= 0 AND
        total_pinned_comments >= 0 AND
        total_deleted_comments >= 0
    )
);

-- Indexes for performance
CREATE INDEX idx_users_platform_user ON users(user_id, client_type);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(user_role);
CREATE INDEX idx_users_banned ON users(user_banned);
CREATE INDEX idx_users_shadow_banned ON users(user_shadow_banned);
CREATE INDEX idx_users_muted ON users(user_muted_until);
CREATE INDEX idx_users_warnings ON users(user_warnings);
CREATE INDEX idx_users_last_activity ON users(last_comment_at, last_vote_at, last_report_at);
CREATE INDEX idx_users_stats ON users(total_comments, total_votes_cast);
CREATE INDEX idx_users_created_at ON users(created_at);

-- Trigger for updated_at
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security for users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users RLS Policies
-- Anyone can read non-banned, non-shadow-banned user profiles
CREATE POLICY "Anyone can read user profiles" ON users
    FOR SELECT USING (
        user_banned = false AND 
        user_shadow_banned = false
    );

-- Users can update their own profile (username, avatar only)
CREATE POLICY "Users can update own profile" ON users
    FOR UPDATE USING (
        auth.uid()::text = user_id
    ) WITH CHECK (
        auth.uid()::text = user_id AND
        -- Only allow updating username and avatar
        (username IS NOT NULL AND user_avatar IS NOT NULL OR user_avatar IS NULL)
    );

-- Only admins can read all users (including banned/shadow-banned)
CREATE POLICY "Admins can read all users" ON users
    FOR SELECT USING (
        is_user_in_role(auth.uid()::text, 'moderator_users') OR
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Only system/moderators can insert/update user records
CREATE POLICY "System can manage users" ON users
    FOR ALL USING (
        is_user_in_role(auth.uid()::text, 'moderator_users') OR
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    ) WITH CHECK (
        is_user_in_role(auth.uid()::text, 'moderator_users') OR
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Function to get or create user record
CREATE OR REPLACE FUNCTION get_or_create_user(
    p_user_id TEXT,
    p_client_type TEXT,
    p_username TEXT,
    p_user_avatar TEXT DEFAULT NULL
)
RETURNS TABLE (
    id INTEGER,
    user_id TEXT,
    client_type TEXT,
    username TEXT,
    user_avatar TEXT,
    user_role TEXT,
    user_banned BOOLEAN,
    user_shadow_banned BOOLEAN,
    user_muted_until TIMESTAMPTZ,
    user_warnings INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    -- Try to find existing user
    RETURN QUERY
    SELECT u.id, u.user_id, u.client_type, u.username, u.user_avatar, 
           u.user_role, u.user_banned, u.user_shadow_banned, u.user_muted_until, 
           u.user_warnings, u.created_at, u.updated_at
    FROM users u
    WHERE u.user_id = p_user_id AND u.client_type = p_client_type;
    
    -- If user exists, return it
    IF FOUND THEN
        RETURN;
    END IF;
    
    -- If user doesn't exist, create it
    INSERT INTO users (
        user_id, 
        client_type, 
        username, 
        user_avatar,
        user_role
    ) VALUES (
        p_user_id, 
        p_client_type, 
        p_username, 
        p_user_avatar,
        'user'  -- Default role
    )
    ON CONFLICT (user_id, client_type) DO NOTHING;
    
    -- Return the newly created user
    RETURN QUERY
    SELECT u.id, u.user_id, u.client_type, u.username, u.user_avatar, 
           u.user_role, u.user_banned, u.user_shadow_banned, u.user_muted_until, 
           u.user_warnings, u.created_at, u.updated_at
    FROM users u
    WHERE u.user_id = p_user_id AND u.client_type = p_client_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user statistics
CREATE OR REPLACE FUNCTION update_user_stats(
    p_user_id TEXT,
    p_client_type TEXT,
    p_stat_type TEXT,  -- 'comment', 'vote', 'report_filed', 'report_received', 'pin', 'delete'
    p_increment INTEGER DEFAULT 1,
    p_decrement INTEGER DEFAULT 0
)
RETURNS BOOLEAN AS $$
BEGIN
    CASE p_stat_type
        WHEN 'comment' THEN
            UPDATE users 
            SET 
                total_comments = total_comments + p_increment - p_decrement,
                last_comment_at = CASE WHEN p_increment > 0 THEN NOW() ELSE last_comment_at END,
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
            
        WHEN 'vote' THEN
            UPDATE users 
            SET 
                total_votes_cast = total_votes_cast + p_increment - p_decrement,
                last_vote_at = CASE WHEN p_increment > 0 THEN NOW() ELSE last_vote_at END,
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
            
        WHEN 'report_filed' THEN
            UPDATE users 
            SET 
                total_reports_filed = total_reports_filed + p_increment - p_decrement,
                last_report_at = CASE WHEN p_increment > 0 THEN NOW() ELSE last_report_at END,
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
            
        WHEN 'report_received' THEN
            UPDATE users 
            SET 
                total_reports_received = total_reports_received + p_increment - p_decrement,
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
            
        WHEN 'pin' THEN
            UPDATE users 
            SET 
                total_pinned_comments = total_pinned_comments + p_increment - p_decrement,
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
            
        WHEN 'delete' THEN
            UPDATE users 
            SET 
                total_deleted_comments = total_deleted_comments + p_increment - p_decrement,
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
    END CASE;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to apply moderation action to user
CREATE OR REPLACE FUNCTION apply_user_moderation(
    p_user_id TEXT,
    p_client_type TEXT,
    p_action TEXT,      -- 'warn', 'mute', 'ban', 'shadow_ban', 'unban', 'unmute'
    p_duration_hours INTEGER DEFAULT NULL,  -- For mutes
    p_reason TEXT DEFAULT NULL,
    p_moderator_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_current_warnings INTEGER;
    v_new_muted_until TIMESTAMPTZ;
    v_moderation_record JSONB;
BEGIN
    -- Get current user state
    SELECT user_warnings INTO v_current_warnings
    FROM users 
    WHERE user_id = p_user_id AND client_type = p_client_type;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Create moderation record for history
    v_moderation_record := jsonb_build_object(
        'action', p_action,
        'reason', p_reason,
        'moderator_id', p_moderator_id,
        'timestamp', NOW(),
        'duration_hours', p_duration_hours
    );
    
    CASE p_action
        WHEN 'warn' THEN
            UPDATE users 
            SET 
                user_warnings = user_warnings + 1,
                warning_history = COALESCE(warning_history, '[]'::text) || v_moderation_record::text,
                last_moderation_action_at = NOW(),
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
            
        WHEN 'mute' THEN
            v_new_muted_until := NOW() + (p_duration_hours || ' hours')::INTERVAL;
            UPDATE users 
            SET 
                user_muted_until = v_new_muted_until,
                mute_history = COALESCE(mute_history, '[]'::text) || v_moderation_record::text,
                last_moderation_action_at = NOW(),
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
            
        WHEN 'unmute' THEN
            UPDATE users 
            SET 
                user_muted_until = NULL,
                mute_history = COALESCE(mute_history, '[]'::text) || v_moderation_record::text,
                last_moderation_action_at = NOW(),
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
            
        WHEN 'ban' THEN
            UPDATE users 
            SET 
                user_banned = TRUE,
                ban_history = COALESCE(ban_history, '[]'::text) || v_moderation_record::text,
                last_moderation_action_at = NOW(),
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
            
        WHEN 'shadow_ban' THEN
            UPDATE users 
            SET 
                user_shadow_banned = TRUE,
                ban_history = COALESCE(ban_history, '[]'::text) || v_moderation_record::text,
                last_moderation_action_at = NOW(),
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
            
        WHEN 'unban' THEN
            UPDATE users 
            SET 
                user_banned = FALSE,
                user_shadow_banned = FALSE,
                user_muted_until = NULL,
                ban_history = COALESCE(ban_history, '[]'::text) || v_moderation_record::text,
                last_moderation_action_at = NOW(),
                updated_at = NOW()
            WHERE user_id = p_user_id AND client_type = p_client_type;
    END CASE;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user with all details for API responses
CREATE OR REPLACE FUNCTION get_user_details(
    p_user_id TEXT,
    p_client_type TEXT,
    p_include_hidden BOOLEAN DEFAULT FALSE  -- Include banned/shadow-banned info for admins
)
RETURNS TABLE (
    id INTEGER,
    user_id TEXT,
    client_type TEXT,
    username TEXT,
    user_avatar TEXT,
    user_role TEXT,
    user_banned BOOLEAN,
    user_shadow_banned BOOLEAN,
    user_muted_until TIMESTAMPTZ,
    user_warnings INTEGER,
    total_comments INTEGER,
    total_upvotes_received INTEGER,
    total_downvotes_received INTEGER,
    total_votes_cast INTEGER,
    total_reports_filed INTEGER,
    total_reports_received INTEGER,
    total_pinned_comments INTEGER,
    total_deleted_comments INTEGER,
    last_comment_at TIMESTAMPTZ,
    last_vote_at TIMESTAMPTZ,
    last_report_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id, u.user_id, u.client_type, u.username, u.user_avatar,
        u.user_role, 
        CASE 
            WHEN p_include_hidden THEN u.user_banned 
            ELSE FALSE 
        END as user_banned,
        CASE 
            WHEN p_include_hidden THEN u.user_shadow_banned 
            ELSE FALSE 
        END as user_shadow_banned,
        u.user_muted_until, u.user_warnings,
        u.total_comments, u.total_upvotes_received, u.total_downvotes_received,
        u.total_votes_cast, u.total_reports_filed, u.total_reports_received,
        u.total_pinned_comments, u.total_deleted_comments,
        u.last_comment_at, u.last_vote_at, u.last_report_at,
        u.created_at, u.updated_at
    FROM users u
    WHERE u.user_id = p_user_id AND u.client_type = p_client_type
    AND (
        p_include_hidden OR
        (u.user_banned = FALSE AND u.user_shadow_banned = FALSE)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
