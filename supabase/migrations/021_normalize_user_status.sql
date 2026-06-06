-- ====================================
-- MIGRATION 021: Normalize User Status
-- Removes denormalized user status from comments table
-- Adds expiration support to commentum_users
-- All user status (banned, muted, shadow_banned, warnings) now ONLY lives on commentum_users
-- RLS policies updated to JOIN with commentum_users
-- Auto-expire cleanup function added
-- ====================================

-- ====================================
-- STEP 1: Add expiration columns to commentum_users
-- ====================================

-- Add banned_until for temporary bans (NULL = permanent)
ALTER TABLE commentum_users ADD COLUMN IF NOT EXISTS commentum_user_banned_until TIMESTAMPTZ;
ALTER TABLE commentum_users ADD COLUMN IF NOT EXISTS commentum_user_shadow_banned_until TIMESTAMPTZ;

-- Add index for expiration lookups
CREATE INDEX IF NOT EXISTS idx_commentum_users_banned_until ON commentum_users(commentum_user_banned_until) WHERE commentum_user_banned_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commentum_users_shadow_banned_until ON commentum_users(commentum_user_shadow_banned_until) WHERE commentum_user_shadow_banned_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commentum_users_muted_until ON commentum_users(commentum_user_muted_until) WHERE commentum_user_muted_until IS NOT NULL;

-- ====================================
-- STEP 2: Update ban_commentum_user to support duration
-- ====================================

CREATE OR REPLACE FUNCTION ban_commentum_user(
    p_client_type TEXT,
    p_user_id TEXT,
    p_ban_reason TEXT,
    p_banned_by TEXT,
    p_shadow_ban BOOLEAN DEFAULT FALSE,
    p_duration_hours INTEGER DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_shadow_ban THEN
        UPDATE commentum_users SET
            commentum_user_shadow_banned = TRUE,
            commentum_user_shadow_banned_at = NOW(),
            commentum_user_shadow_banned_by = p_banned_by,
            commentum_user_shadow_banned_reason = p_ban_reason,
            commentum_user_shadow_banned_until = CASE WHEN p_duration_hours IS NOT NULL THEN NOW() + (p_duration_hours || ' hours')::INTERVAL ELSE NULL END,
            commentum_user_moderated_count = commentum_user_moderated_count + 1,
            commentum_user_last_moderated_at = NOW(),
            commentum_user_last_moderated_by = p_banned_by,
            commentum_user_last_moderation_action = 'shadow_ban',
            commentum_user_last_moderation_reason = p_ban_reason,
            updated_at = NOW()
        WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    ELSE
        UPDATE commentum_users SET
            commentum_user_banned = TRUE,
            commentum_user_banned_at = NOW(),
            commentum_user_banned_by = p_banned_by,
            commentum_user_banned_reason = p_ban_reason,
            commentum_user_banned_until = CASE WHEN p_duration_hours IS NOT NULL THEN NOW() + (p_duration_hours || ' hours')::INTERVAL ELSE NULL END,
            commentum_user_moderated_count = commentum_user_moderated_count + 1,
            commentum_user_last_moderated_at = NOW(),
            commentum_user_last_moderated_by = p_banned_by,
            commentum_user_last_moderation_action = 'ban',
            commentum_user_last_moderation_reason = p_ban_reason,
            updated_at = NOW()
        WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    END IF;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- STEP 3: Update mute_commentum_user to also update moderation tracking
-- ====================================

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
        commentum_user_moderated_count = commentum_user_moderated_count + 1,
        commentum_user_last_moderated_at = NOW(),
        commentum_user_last_moderated_by = p_muted_by,
        commentum_user_last_moderation_action = 'mute',
        commentum_user_last_moderation_reason = p_mute_reason,
        updated_at = NOW()
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- STEP 4: Update add_user_warning to also update moderation tracking
-- ====================================

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
    
    -- Update user with new warning AND moderation tracking
    UPDATE commentum_users SET
        commentum_user_warnings = commentum_user_warnings + 1,
        commentum_user_warning_details = warning_details::text,
        commentum_user_last_warning_at = NOW(),
        commentum_user_last_warning_by = p_warned_by,
        commentum_user_last_warning_reason = p_warning_reason,
        commentum_user_moderated_count = commentum_user_moderated_count + 1,
        commentum_user_last_moderated_at = NOW(),
        commentum_user_last_moderated_by = p_warned_by,
        commentum_user_last_moderation_action = 'warn',
        commentum_user_last_moderation_reason = p_warning_reason,
        updated_at = NOW()
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id
    RETURNING commentum_user_warnings INTO new_warning_count;
    
    RETURN new_warning_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- STEP 5: Add unwarn_commentum_user function
-- ====================================

CREATE OR REPLACE FUNCTION unwarn_commentum_user(
    p_client_type TEXT,
    p_user_id TEXT,
    p_reason TEXT,
    p_unwarned_by TEXT
)
RETURNS INTEGER AS $$
DECLARE
    new_warning_count INTEGER;
BEGIN
    UPDATE commentum_users SET
        commentum_user_warnings = GREATEST(commentum_user_warnings - 1, 0),
        commentum_user_moderated_count = commentum_user_moderated_count + 1,
        commentum_user_last_moderated_at = NOW(),
        commentum_user_last_moderated_by = p_unwarned_by,
        commentum_user_last_moderation_action = 'unwarn',
        commentum_user_last_moderation_reason = p_reason,
        updated_at = NOW()
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id
    RETURNING commentum_user_warnings INTO new_warning_count;
    
    RETURN new_warning_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- STEP 6: Add auto-expire cleanup function
-- ====================================

CREATE OR REPLACE FUNCTION cleanup_expired_moderation()
RETURNS INTEGER AS $$
DECLARE
    cleaned_count INTEGER := 0;
BEGIN
    -- Expired mutes
    UPDATE commentum_users SET
        commentum_user_muted = FALSE,
        commentum_user_muted_until = NULL,
        updated_at = NOW()
    WHERE commentum_user_muted = TRUE 
    AND commentum_user_muted_until IS NOT NULL 
    AND commentum_user_muted_until < NOW();
    
    GET DIAGNOSTICS cleaned_count = ROW_COUNT;
    
    -- Expired bans
    UPDATE commentum_users SET
        commentum_user_banned = FALSE,
        commentum_user_banned_until = NULL,
        updated_at = NOW()
    WHERE commentum_user_banned = TRUE 
    AND commentum_user_banned_until IS NOT NULL 
    AND commentum_user_banned_until < NOW();
    
    GET DIAGNOSTICS cleaned_count = cleaned_count + ROW_COUNT;
    
    -- Expired shadow bans
    UPDATE commentum_users SET
        commentum_user_shadow_banned = FALSE,
        commentum_user_shadow_banned_until = NULL,
        updated_at = NOW()
    WHERE commentum_user_shadow_banned = TRUE 
    AND commentum_user_shadow_banned_until IS NOT NULL 
    AND commentum_user_shadow_banned_until < NOW();
    
    GET DIAGNOSTICS cleaned_count = cleaned_count + ROW_COUNT;
    
    RETURN cleaned_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- STEP 7: Update check_user_restrictions to handle expiration
-- ====================================

CREATE OR REPLACE FUNCTION check_user_restrictions(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    -- First, auto-cleanup any expired moderation for this user
    UPDATE commentum_users SET
        commentum_user_muted = CASE WHEN commentum_user_muted AND commentum_user_muted_until IS NOT NULL AND commentum_user_muted_until < NOW() THEN FALSE ELSE commentum_user_muted END,
        commentum_user_muted_until = CASE WHEN commentum_user_muted AND commentum_user_muted_until IS NOT NULL AND commentum_user_muted_until < NOW() THEN NULL ELSE commentum_user_muted_until END,
        commentum_user_banned = CASE WHEN commentum_user_banned AND commentum_user_banned_until IS NOT NULL AND commentum_user_banned_until < NOW() THEN FALSE ELSE commentum_user_banned END,
        commentum_user_banned_until = CASE WHEN commentum_user_banned AND commentum_user_banned_until IS NOT NULL AND commentum_user_banned_until < NOW() THEN NULL ELSE commentum_user_banned_until END,
        commentum_user_shadow_banned = CASE WHEN commentum_user_shadow_banned AND commentum_user_shadow_banned_until IS NOT NULL AND commentum_user_shadow_banned_until < NOW() THEN FALSE ELSE commentum_user_shadow_banned END,
        commentum_user_shadow_banned_until = CASE WHEN commentum_user_shadow_banned AND commentum_user_shadow_banned_until IS NOT NULL AND commentum_user_shadow_banned_until < NOW() THEN NULL ELSE commentum_user_shadow_banned_until END,
        updated_at = NOW()
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    
    -- Now return the (possibly corrected) status
    SELECT jsonb_build_object(
        'banned', commentum_user_banned,
        'banned_at', commentum_user_banned_at,
        'banned_until', commentum_user_banned_until,
        'banned_reason', commentum_user_banned_reason,
        'muted', commentum_user_muted AND (commentum_user_muted_until IS NULL OR commentum_user_muted_until > NOW()),
        'muted_until', commentum_user_muted_until,
        'muted_reason', commentum_user_muted_reason,
        'shadow_banned', commentum_user_shadow_banned,
        'shadow_banned_until', commentum_user_shadow_banned_until,
        'warnings', commentum_user_warnings,
        'last_warning_at', commentum_user_last_warning_at,
        'last_warning_reason', commentum_user_last_warning_reason
    ) INTO result
    FROM commentum_users 
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    
    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- STEP 8: Update commentum_user_summary view to handle expiration
-- ====================================

CREATE OR REPLACE VIEW commentum_user_summary AS
SELECT 
    commentum_client_type,
    commentum_user_id,
    commentum_username,
    commentum_user_role,
    commentum_user_banned,
    commentum_user_banned_until,
    CASE WHEN commentum_user_muted AND (commentum_user_muted_until IS NULL OR commentum_user_muted_until > NOW()) THEN TRUE ELSE FALSE END AS commentum_user_muted,
    commentum_user_muted_until,
    commentum_user_shadow_banned,
    commentum_user_shadow_banned_until,
    commentum_user_warnings,
    commentum_user_comment_count,
    commentum_user_last_comment_at,
    created_at,
    updated_at,
    -- Status summary (respects expiration)
    CASE 
        WHEN commentum_user_banned AND (commentum_user_banned_until IS NULL OR commentum_user_banned_until > NOW()) THEN 'banned'
        WHEN commentum_user_shadow_banned AND (commentum_user_shadow_banned_until IS NULL OR commentum_user_shadow_banned_until > NOW()) THEN 'shadow_banned'
        WHEN commentum_user_muted AND (commentum_user_muted_until IS NULL OR commentum_user_muted_until > NOW()) THEN 'muted'
        WHEN commentum_user_warnings >= 5 THEN 'high_risk'
        WHEN commentum_user_warnings >= 3 THEN 'medium_risk'
        WHEN commentum_user_warnings > 0 THEN 'low_risk'
        ELSE 'active'
    END as status_level,
    -- Risk score (0-100)
    LEAST(100, 
        (commentum_user_warnings * 10) + 
        (CASE WHEN commentum_user_banned THEN 100 ELSE 0 END) +
        (CASE WHEN commentum_user_shadow_banned THEN 80 ELSE 0 END) +
        (CASE WHEN commentum_user_muted AND (commentum_user_muted_until IS NULL OR commentum_user_muted_until > NOW()) THEN 50 ELSE 0 END)
    ) as risk_score
FROM commentum_users
WHERE commentum_user_active = true;

-- Re-grant permissions on the updated view
GRANT SELECT ON commentum_user_summary TO authenticated;
GRANT SELECT ON commentum_user_summary TO anon;

-- ====================================
-- STEP 9: Update get_user_statistics to handle expiration
-- ====================================

CREATE OR REPLACE FUNCTION get_user_statistics(p_client_type TEXT DEFAULT NULL, p_days INTEGER DEFAULT 30)
RETURNS JSONB AS $$
DECLARE
    stats JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_users', COUNT(*),
        'active_users', COUNT(*) FILTER (WHERE commentum_user_last_comment_at > NOW() - (p_days || ' days')::INTERVAL),
        'banned_users', COUNT(*) FILTER (WHERE commentum_user_banned = true AND (commentum_user_banned_until IS NULL OR commentum_user_banned_until > NOW())),
        'muted_users', COUNT(*) FILTER (WHERE commentum_user_muted = true AND (commentum_user_muted_until IS NULL OR commentum_user_muted_until > NOW())),
        'shadow_banned_users', COUNT(*) FILTER (WHERE commentum_user_shadow_banned = true AND (commentum_user_shadow_banned_until IS NULL OR commentum_user_shadow_banned_until > NOW())),
        'users_with_warnings', COUNT(*) FILTER (WHERE commentum_user_warnings > 0),
        'total_comments', SUM(commentum_user_comment_count),
        'avg_comments_per_user', AVG(commentum_user_comment_count),
        'new_users_this_period', COUNT(*) FILTER (WHERE created_at > NOW() - (p_days || ' days')::INTERVAL)
    ) INTO stats
    FROM commentum_users 
    WHERE (p_client_type IS NULL OR commentum_client_type = p_client_type);
    
    RETURN COALESCE(stats, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- STEP 10: Update RLS policies on comments to use commentum_users
-- ====================================

-- Drop old RLS policies that reference removed columns
DROP POLICY IF EXISTS "Anyone can read comments" ON comments;

-- Create new RLS policy that checks user status via commentum_users
-- Note: We use a subquery to check if the user is banned/shadow_banned in commentum_users
CREATE POLICY "Anyone can read comments" ON comments
    FOR SELECT USING (
        deleted = false AND 
        NOT EXISTS (
            SELECT 1 FROM commentum_users 
            WHERE commentum_client_type = comments.client_type 
            AND commentum_user_id = comments.user_id 
            AND (commentum_user_banned = true OR commentum_user_shadow_banned = true)
            -- Respect expiration: only treat as banned if not expired
            AND (
                (commentum_user_banned = true AND (commentum_user_banned_until IS NULL OR commentum_user_banned_until > NOW()))
                OR
                (commentum_user_shadow_banned = true AND (commentum_user_shadow_banned_until IS NULL OR commentum_user_shadow_banned_until > NOW()))
            )
        )
    );

-- ====================================
-- STEP 11: Drop the old sync triggers and functions that wrote to comments.user_*
-- ====================================

-- Drop trigger that synced user status TO comments on insert
DROP TRIGGER IF EXISTS sync_commentum_user_on_insert ON comments;

-- Drop trigger that synced user status TO comments on update  
DROP TRIGGER IF EXISTS sync_commentum_user_status_on_update ON comments;

-- Drop the sync functions
DROP FUNCTION IF EXISTS sync_commentum_user_on_comment() CASCADE;
DROP FUNCTION IF EXISTS sync_commentum_user_status_on_comment_update() CASCADE;
DROP FUNCTION IF EXISTS sync_user_status_to_all_comments() CASCADE;

-- Keep the trigger that creates/updates user in commentum_users on comment insert,
-- but recreate it WITHOUT the part that writes user_banned/etc back to comments
CREATE OR REPLACE FUNCTION sync_commentum_user_on_comment()
RETURNS TRIGGER AS $$
DECLARE
    user_exists BOOLEAN;
BEGIN
    -- Check if user already exists in commentum_users table
    SELECT EXISTS(
        SELECT 1 FROM commentum_users 
        WHERE commentum_client_type = NEW.client_type 
        AND commentum_user_id = NEW.user_id
    ) INTO user_exists;
    
    -- If user doesn't exist, create them
    IF NOT user_exists THEN
        INSERT INTO commentum_users (
            commentum_client_type,
            commentum_user_id,
            commentum_username,
            commentum_user_avatar,
            commentum_user_role,
            commentum_user_first_comment_at,
            commentum_user_last_comment_at,
            commentum_user_last_comment_id,
            commentum_user_comment_count,
            commentum_user_ip_addresses,
            commentum_user_user_agents
        ) VALUES (
            NEW.client_type,
            NEW.user_id,
            NEW.username,
            NEW.user_avatar,
            NEW.user_role,
            NEW.created_at,
            NEW.created_at,
            NEW.id,
            1,
            COALESCE(NEW.ip_address, '[]'),
            COALESCE(NEW.user_agent, '[]')
        );
    ELSE
        -- Update existing user's activity (no status sync back to comment)
        UPDATE commentum_users SET
            commentum_username = NEW.username,
            commentum_user_avatar = COALESCE(NEW.user_avatar, commentum_user_avatar),
            commentum_user_role = COALESCE(NEW.user_role, commentum_user_role),
            commentum_user_comment_count = commentum_user_comment_count + 1,
            commentum_user_last_comment_at = NEW.created_at,
            commentum_user_last_comment_id = NEW.id,
            commentum_user_first_comment_at = COALESCE(commentum_user_first_comment_at, NEW.created_at),
            updated_at = NOW()
        WHERE commentum_client_type = NEW.client_type AND commentum_user_id = NEW.user_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the insert trigger (without status sync back)
CREATE TRIGGER sync_commentum_user_on_insert
    AFTER INSERT ON comments
    FOR EACH ROW
    EXECUTE FUNCTION sync_commentum_user_on_comment();

-- ====================================
-- STEP 12: Remove user status columns from comments table
-- ====================================

-- Drop indexes that reference these columns
DROP INDEX IF EXISTS idx_comments_user_banned;
DROP INDEX IF EXISTS idx_comments_user_muted;

-- Drop the columns
ALTER TABLE comments DROP COLUMN IF EXISTS user_banned;
ALTER TABLE comments DROP COLUMN IF EXISTS user_muted_until;
ALTER TABLE comments DROP COLUMN IF EXISTS user_shadow_banned;
ALTER TABLE comments DROP COLUMN IF EXISTS user_warnings;

-- ====================================
-- STEP 13: Add config entries for auto-expire
-- ====================================

INSERT INTO config (key, value) VALUES
    ('auto_cleanup_moderation_on_request', 'true'),
    ('ban_default_duration_hours', ''),  -- empty = permanent by default
    ('shadow_ban_default_duration_hours', '')  -- empty = permanent by default
ON CONFLICT (key) DO NOTHING;
