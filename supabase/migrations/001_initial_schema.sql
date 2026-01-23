-- ====================================
-- SIMPLE OPEN COMMENT SYSTEM FOR SUPABASE
-- SINGLE TABLE DESIGN WITH INTEGER IDs
-- ====================================

-- Create sequence for auto-incrementing comment IDs
CREATE SEQUENCE IF NOT EXISTS comment_id_seq START 1;

-- Main comments table with all features
CREATE TABLE comments (
    -- Primary identification (INTEGER ID)
    id INTEGER PRIMARY KEY DEFAULT nextval('comment_id_seq'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Core data (minimal required from frontend)
    client_type TEXT NOT NULL CHECK (client_type IN ('anilist', 'myanimelist', 'simkl', 'other')),
    user_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    content TEXT NOT NULL,
    
    -- Auto-fetched user information (from client APIs)
    username TEXT NOT NULL,
    user_avatar TEXT,
    user_role TEXT DEFAULT 'user' CHECK (user_role IN ('user', 'moderator', 'admin', 'super_admin')),
    
    -- Auto-fetched media information (from client APIs)
    media_type TEXT NOT NULL CHECK (media_type IN ('anime', 'manga', 'movie', 'tv', 'other')),
    media_title TEXT NOT NULL,
    media_year INTEGER,
    media_poster TEXT,
    
    -- Comment structure
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    
    -- Comment states
    deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    deleted_by TEXT,
    
    pinned BOOLEAN DEFAULT FALSE,
    pinned_at TIMESTAMPTZ,
    pinned_by TEXT,
    
    locked BOOLEAN DEFAULT FALSE,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    
    edited BOOLEAN DEFAULT FALSE,
    edited_at TIMESTAMPTZ,
    edit_count INTEGER DEFAULT 0,
    edit_history TEXT, -- JSON array of edit history
    
    -- Voting system
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    vote_score INTEGER DEFAULT 0,
    user_votes TEXT, -- JSON object of user_id -> vote_type
    
    -- Reporting system
    reported BOOLEAN DEFAULT FALSE,
    report_count INTEGER DEFAULT 0,
    reports TEXT, -- JSON array of reports
    report_status TEXT DEFAULT 'none' CHECK (report_status IN ('none', 'pending', 'reviewed', 'resolved', 'dismissed')),
    
    -- Content warnings
    tags TEXT, -- JSON array of tags (spoiler, nsfw, warning, offensive, spam)
    tagged_by TEXT,
    
    -- User status
    user_banned BOOLEAN DEFAULT FALSE,
    user_muted_until TIMESTAMPTZ,
    user_shadow_banned BOOLEAN DEFAULT FALSE,
    user_warnings INTEGER DEFAULT 0,
    
    -- Moderation
    moderated BOOLEAN DEFAULT FALSE,
    moderated_at TIMESTAMPTZ,
    moderated_by TEXT,
    moderation_reason TEXT,
    moderation_action TEXT,
    
    -- System fields
    ip_address TEXT,
    user_agent TEXT,
    
    -- Check constraints
    CONSTRAINT content_length CHECK (length(content) >= 1 AND length(content) <= 10000),
    CONSTRAINT username_length CHECK (length(username) >= 1 AND length(username) <= 50)
);

-- Configuration table for system settings
CREATE TABLE config (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL, -- JSON value
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create separate sequence for config IDs
CREATE SEQUENCE IF NOT EXISTS config_id_seq START 1000;

-- Update config table to use config sequence
ALTER TABLE config ALTER COLUMN id SET DEFAULT nextval('config_id_seq');

-- Indexes for performance
CREATE INDEX idx_comments_client_user ON comments(client_type, user_id);
CREATE INDEX idx_comments_media ON comments(media_id, media_type);
CREATE INDEX idx_comments_parent ON comments(parent_id);
CREATE INDEX idx_comments_created ON comments(created_at);
CREATE INDEX idx_comments_deleted ON comments(deleted);
CREATE INDEX idx_comments_role ON comments(user_role);
CREATE INDEX idx_comments_report_status ON comments(report_status);
CREATE INDEX idx_comments_pinned ON comments(pinned);
CREATE INDEX idx_comments_locked ON comments(locked);
CREATE INDEX idx_comments_vote_score ON comments(vote_score);
CREATE INDEX idx_comments_user_banned ON comments(user_banned);
CREATE INDEX idx_comments_user_muted ON comments(user_muted_until);
CREATE INDEX idx_config_key ON config(key);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_comments_updated_at 
    BEFORE UPDATE ON comments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_config_updated_at 
    BEFORE UPDATE ON config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default configuration
INSERT INTO config (key, value) VALUES 
    ('max_comment_length', '10000'),
    ('max_nesting_level', '10'),
    ('rate_limit_comments_per_hour', '30'),
    ('rate_limit_votes_per_hour', '100'),
    ('rate_limit_reports_per_hour', '10'),
    ('auto_warn_threshold', '3'),
    ('auto_mute_threshold', '5'),
    ('auto_ban_threshold', '10'),
    ('super_admin_users', '[]'),  -- JSON array of super admin user IDs
    ('moderator_users', '[]'),   -- JSON array of moderator user IDs
    ('admin_users', '[]'),       -- JSON array of admin user IDs
    ('banned_keywords', '[]'),   -- JSON array of banned keywords
    ('system_enabled', 'true'),
    ('voting_enabled', 'true'),
    ('reporting_enabled', 'true'),
    ('anilist_client_id', ''),
    ('myanimelist_client_id', ''),
    ('simkl_client_id', '');

-- Helper function to check if user is in a role list
CREATE OR REPLACE FUNCTION is_user_in_role(user_id_param TEXT, role_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    role_array JSONB;
BEGIN
    SELECT value::jsonb INTO role_array FROM config WHERE key = role_key;
    RETURN role_array @> to_jsonb(user_id_param);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Row Level Security (RLS) Policies
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;

-- Comments RLS Policies
-- Anyone can read non-deleted comments from non-banned users
CREATE POLICY "Anyone can read comments" ON comments
    FOR SELECT USING (
        deleted = false AND 
        user_banned = false AND 
        user_shadow_banned = false
    );

-- Anyone can insert comments (system is open)
CREATE POLICY "Anyone can insert comments" ON comments
    FOR INSERT WITH CHECK (true);

-- Users can update their own comments, moderators can update any
CREATE POLICY "Users can update own comments" ON comments
    FOR UPDATE USING (
        auth.uid()::text = user_id OR
        is_user_in_role(auth.uid()::text, 'moderator_users') OR
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Users can delete their own comments, moderators can delete any
CREATE POLICY "Users can delete own comments" ON comments
    FOR DELETE USING (
        auth.uid()::text = user_id OR
        is_user_in_role(auth.uid()::text, 'moderator_users') OR
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Config RLS Policies
-- Anyone can read config (needed for public comment system)
CREATE POLICY "Anyone can read config" ON config
    FOR SELECT USING (true);

-- Only admins can update config
CREATE POLICY "Admins can update config" ON config
    FOR UPDATE USING (
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- Only admins can insert config
CREATE POLICY "Admins can insert config" ON config
    FOR INSERT WITH CHECK (
        is_user_in_role(auth.uid()::text, 'admin_users') OR
        is_user_in_role(auth.uid()::text, 'super_admin_users')
    );

-- No one can delete config (use update instead)
CREATE POLICY "No one can delete config" ON config
    FOR DELETE USING (false);
