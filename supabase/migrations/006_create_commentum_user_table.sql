-- ====================================
-- COMMENTUM USER TABLE MIGRATION
-- Creates dedicated user table for better user management
-- ====================================

-- Create sequence for auto-incrementing user IDs
CREATE SEQUENCE IF NOT EXISTS commentum_user_id_seq START 1;

-- Create Commentum user table
CREATE TABLE commentum_users (
    -- Primary identification
    id INTEGER PRIMARY KEY DEFAULT nextval('commentum_user_id_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Core user identification (composite key for platform + user_id)
    commentum_client_type TEXT NOT NULL CHECK (commentum_client_type IN ('anilist', 'myanimelist', 'simkl', 'other')),
    commentum_user_id TEXT NOT NULL,
    commentum_username TEXT NOT NULL,
    
    -- User profile information
    commentum_user_avatar TEXT,
    commentum_user_role TEXT DEFAULT 'user' CHECK (commentum_user_role IN ('user', 'moderator', 'admin', 'super_admin')),
    
    -- User status and restrictions
    commentum_user_banned BOOLEAN DEFAULT FALSE,
    commentum_user_banned_at TIMESTAMPTZ,
    commentum_user_banned_by TEXT,
    commentum_user_banned_reason TEXT,
    
    commentum_user_muted BOOLEAN DEFAULT FALSE,
    commentum_user_muted_until TIMESTAMPTZ,
    commentum_user_muted_by TEXT,
    commentum_user_muted_reason TEXT,
    
    commentum_user_shadow_banned BOOLEAN DEFAULT FALSE,
    commentum_user_shadow_banned_at TIMESTAMPTZ,
    commentum_user_shadow_banned_by TEXT,
    commentum_user_shadow_banned_reason TEXT,
    
    -- Warning system
    commentum_user_warnings INTEGER DEFAULT 0,
    commentum_user_warning_details TEXT, -- JSON array of warning details
    commentum_user_last_warning_at TIMESTAMPTZ,
    commentum_user_last_warning_by TEXT,
    commentum_user_last_warning_reason TEXT,
    
    -- Activity tracking
    commentum_user_comment_count INTEGER DEFAULT 0,
    commentum_user_first_comment_at TIMESTAMPTZ,
    commentum_user_last_comment_at TIMESTAMPTZ,
    commentum_user_last_comment_id INTEGER,
    
    commentum_user_vote_count INTEGER DEFAULT 0,
    commentum_user_last_vote_at TIMESTAMPTZ,
    
    commentum_user_report_count INTEGER DEFAULT 0, -- Reports made by this user
    commentum_user_reported_count INTEGER DEFAULT 0, -- Times this user has been reported
    commentum_user_last_reported_at TIMESTAMPTZ,
    
    -- Moderation history
    commentum_user_moderated_count INTEGER DEFAULT 0, -- Times moderated
    commentum_user_moderation_history TEXT, -- JSON array of moderation actions
    commentum_user_last_moderated_at TIMESTAMPTZ,
    commentum_user_last_moderated_by TEXT,
    commentum_user_last_moderation_action TEXT,
    commentum_user_last_moderation_reason TEXT,
    
    -- System fields
    commentum_user_ip_addresses TEXT, -- JSON array of IP addresses used
    commentum_user_user_agents TEXT, -- JSON array of user agents used
    commentum_user_notes TEXT, -- Admin notes about this user
    
    -- Status flags
    commentum_user_active BOOLEAN DEFAULT TRUE,
    commentum_user_verified BOOLEAN DEFAULT FALSE,
    commentum_user_premium BOOLEAN DEFAULT FALSE,
    
    -- Constraints
    CONSTRAINT commentum_user_unique UNIQUE (commentum_client_type, commentum_user_id),
    CONSTRAINT commentum_username_length CHECK (length(commentum_username) >= 1 AND length(commentum_username) <= 50),
    CONSTRAINT commentum_user_warnings_non_negative CHECK (commentum_user_warnings >= 0),
    CONSTRAINT commentum_user_counts_non_negative CHECK (
        commentum_user_comment_count >= 0 AND 
        commentum_user_vote_count >= 0 AND 
        commentum_user_report_count >= 0 AND 
        commentum_user_reported_count >= 0 AND
        commentum_user_moderated_count >= 0
    )
);

-- Indexes for performance
CREATE INDEX idx_commentum_users_client_user ON commentum_users(commentum_client_type, commentum_user_id);
CREATE INDEX idx_commentum_users_username ON commentum_users(commentum_username);
CREATE INDEX idx_commentum_users_role ON commentum_users(commentum_user_role);
CREATE INDEX idx_commentum_users_banned ON commentum_users(commentum_user_banned);
CREATE INDEX idx_commentum_users_muted ON commentum_users(commentum_user_muted_until);
CREATE INDEX idx_commentum_users_shadow_banned ON commentum_users(commentum_user_shadow_banned);
CREATE INDEX idx_commentum_users_warnings ON commentum_users(commentum_user_warnings);
CREATE INDEX idx_commentum_users_active ON commentum_users(commentum_user_active);
CREATE INDEX idx_commentum_users_created ON commentum_users(created_at);
CREATE INDEX idx_commentum_users_last_comment ON commentum_users(commentum_user_last_comment_at);
CREATE INDEX idx_commentum_users_comment_count ON commentum_users(commentum_user_comment_count);

-- Trigger for updated_at
CREATE TRIGGER update_commentum_users_updated_at 
    BEFORE UPDATE ON commentum_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to get or create user
CREATE OR REPLACE FUNCTION get_or_create_commentum_user(
    p_client_type TEXT,
    p_user_id TEXT,
    p_username TEXT,
    p_user_avatar TEXT DEFAULT NULL,
    p_user_role TEXT DEFAULT 'user'
)
RETURNS INTEGER AS $$
DECLARE
    user_record RECORD;
    user_id INTEGER;
BEGIN
    -- Try to find existing user
    SELECT id INTO user_id 
    FROM commentum_users 
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    
    -- If user exists, update their info and return ID
    IF user_id IS NOT NULL THEN
        UPDATE commentum_users SET
            commentum_username = p_username,
            commentum_user_avatar = COALESCE(p_user_avatar, commentum_user_avatar),
            commentum_user_role = COALESCE(p_user_role, commentum_user_role),
            updated_at = NOW()
        WHERE id = user_id;
        
        RETURN user_id;
    END IF;
    
    -- Create new user
    INSERT INTO commentum_users (
        commentum_client_type,
        commentum_user_id,
        commentum_username,
        commentum_user_avatar,
        commentum_user_role,
        commentum_user_first_comment_at,
        commentum_user_last_comment_at
    ) VALUES (
        p_client_type,
        p_user_id,
        p_username,
        p_user_avatar,
        p_user_role,
        NOW(),
        NOW()
    ) RETURNING id INTO user_id;
    
    RETURN user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user comment activity
CREATE OR REPLACE FUNCTION update_user_comment_activity(
    p_client_type TEXT,
    p_user_id TEXT,
    p_comment_id INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    user_record RECORD;
BEGIN
    -- Update user's comment activity
    UPDATE commentum_users SET
        commentum_user_comment_count = commentum_user_comment_count + 1,
        commentum_user_last_comment_at = NOW(),
        commentum_user_last_comment_id = COALESCE(p_comment_id, commentum_user_last_comment_id),
        commentum_user_first_comment_at = COALESCE(commentum_user_first_comment_at, NOW()),
        updated_at = NOW()
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    
    -- If no rows were updated, user doesn't exist - create them
    IF NOT FOUND THEN
        -- This will be handled by the get_or_create_commentum_user function
        -- when called from the comment creation process
        NULL;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user vote activity
CREATE OR REPLACE FUNCTION update_user_vote_activity(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE commentum_users SET
        commentum_user_vote_count = commentum_user_vote_count + 1,
        commentum_user_last_vote_at = NOW(),
        updated_at = NOW()
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to add user warning
CREATE OR REPLACE FUNCTION add_user_warning(
    p_client_type TEXT,
    p_user_id TEXT,
    p_warning_reason TEXT,
    p_warned_by TEXT
)
RETURNS INTEGER AS $$
DECLARE
    new_warning_count INTEGER;
    warning_details JSONB;
BEGIN
    -- Get current warning details
    SELECT commentum_user_warning_details::jsonb INTO warning_details
    FROM commentum_users 
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    
    -- Add new warning to details
    IF warning_details IS NULL THEN
        warning_details = '[]'::jsonb;
    END IF;
    
    warning_details = warning_details || jsonb_build_object(
        'warning_id', extract(epoch from now())::text,
        'reason', p_warning_reason,
        'warned_by', p_warned_by,
        'warned_at', NOW(),
        'warning_number', COALESCE(commentum_user_warnings, 0) + 1
    );
    
    -- Update user with new warning
    UPDATE commentum_users SET
        commentum_user_warnings = commentum_user_warnings + 1,
        commentum_user_warning_details = warning_details::text,
        commentum_user_last_warning_at = NOW(),
        commentum_user_last_warning_by = p_warned_by,
        commentum_user_last_warning_reason = p_warning_reason,
        updated_at = NOW()
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id
    RETURNING commentum_user_warnings INTO new_warning_count;
    
    RETURN new_warning_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to ban user
CREATE OR REPLACE FUNCTION ban_commentum_user(
    p_client_type TEXT,
    p_user_id TEXT,
    p_ban_reason TEXT,
    p_banned_by TEXT,
    p_shadow_ban BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_shadow_ban THEN
        UPDATE commentum_users SET
            commentum_user_shadow_banned = TRUE,
            commentum_user_shadow_banned_at = NOW(),
            commentum_user_shadow_banned_by = p_banned_by,
            commentum_user_shadow_banned_reason = p_ban_reason,
            updated_at = NOW()
        WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    ELSE
        UPDATE commentum_users SET
            commentum_user_banned = TRUE,
            commentum_user_banned_at = NOW(),
            commentum_user_banned_by = p_banned_by,
            commentum_user_banned_reason = p_ban_reason,
            updated_at = NOW()
        WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    END IF;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mute user
CREATE OR REPLACE FUNCTION mute_commentum_user(
    p_client_type TEXT,
    p_user_id TEXT,
    p_mute_duration_hours INTEGER,
    p_mute_reason TEXT,
    p_muted_by TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE commentum_users SET
        commentum_user_muted = TRUE,
        commentum_user_muted_until = NOW() + (p_mute_duration_hours || ' hours')::INTERVAL,
        commentum_user_muted_by = p_muted_by,
        commentum_user_muted_reason = p_mute_reason,
        updated_at = NOW()
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user is banned/muted
CREATE OR REPLACE FUNCTION check_user_restrictions(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'banned', commentum_user_banned,
        'banned_at', commentum_user_banned_at,
        'banned_reason', commentum_user_banned_reason,
        'muted', commentum_user_muted,
        'muted_until', commentum_user_muted_until,
        'muted_reason', commentum_user_muted_reason,
        'shadow_banned', commentum_user_shadow_banned,
        'warnings', commentum_user_warnings,
        'last_warning_at', commentum_user_last_warning_at,
        'last_warning_reason', commentum_user_last_warning_reason
    ) INTO result
    FROM commentum_users 
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Row Level Security (RLS) for commentum_users
ALTER TABLE commentum_users ENABLE ROW LEVEL SECURITY;

-- Anyone can read user info (for displaying comments)
CREATE POLICY "Anyone can read commentum users" ON commentum_users
    FOR SELECT USING (true);

-- Only admins can update user info
CREATE POLICY "Admins can update commentum users" ON commentum_users
    FOR UPDATE USING (
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Anyone can insert users (for comment creation)
CREATE POLICY "Anyone can insert commentum users" ON commentum_users
    FOR INSERT WITH CHECK (true);

-- Only admins can delete users
CREATE POLICY "Admins can delete commentum users" ON commentum_users
    FOR DELETE USING (
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Add configuration for user management
INSERT INTO config (key, value) VALUES 
    ('user_table_enabled', 'true'),
    ('user_auto_create_on_comment', 'true'),
    ('user_track_ip_addresses', 'true'),
    ('user_max_warnings_before_auto_mute', '5'),
    ('user_max_warnings_before_auto_ban', '10'),
    ('user_default_mute_duration_hours', '24'),
    ('user_cleanup_inactive_days', '365');