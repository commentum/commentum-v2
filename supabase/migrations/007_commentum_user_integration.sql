-- ====================================
-- COMMENTUM USER TABLE INTEGRATION MIGRATION
-- Creates triggers to automatically sync user data with comments
-- ====================================

-- Function to sync user data when comment is created
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
        -- Update existing user's activity
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
    
    -- Sync user status from commentum_users back to the comment
    -- This ensures the comment always reflects current user status
    SELECT 
        commentum_user_banned,
        commentum_user_muted_until,
        commentum_user_shadow_banned,
        commentum_user_warnings
    INTO 
        NEW.user_banned,
        NEW.user_muted_until,
        NEW.user_shadow_banned,
        NEW.user_warnings
    FROM commentum_users 
    WHERE commentum_client_type = NEW.client_type AND commentum_user_id = NEW.user_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync user status when comment is updated
CREATE OR REPLACE FUNCTION sync_commentum_user_status_on_comment_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Sync user status from commentum_users to the comment
    -- This ensures comments always reflect current user status
    SELECT 
        commentum_user_banned,
        commentum_user_muted_until,
        commentum_user_shadow_banned,
        commentum_user_warnings
    INTO 
        NEW.user_banned,
        NEW.user_muted_until,
        NEW.user_shadow_banned,
        NEW.user_warnings
    FROM commentum_users 
    WHERE commentum_client_type = NEW.client_type AND commentum_user_id = NEW.user_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user when vote is cast
CREATE OR REPLACE FUNCTION update_user_on_vote()
RETURNS TRIGGER AS $$
BEGIN
    -- Update user's vote activity
    UPDATE commentum_users SET
        commentum_user_vote_count = commentum_user_vote_count + 1,
        commentum_user_last_vote_at = NOW(),
        updated_at = NOW()
    WHERE commentum_client_type = OLD.client_type AND commentum_user_id = OLD.user_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user when comment is reported
CREATE OR REPLACE FUNCTION update_user_on_report()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the reported user's reported count
    UPDATE commentum_users SET
        commentum_user_reported_count = commentum_user_reported_count + 1,
        commentum_user_last_reported_at = NOW(),
        updated_at = NOW()
    WHERE commentum_client_type = OLD.client_type AND commentum_user_id = OLD.user_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers
-- Trigger on comment insert to create/update user
CREATE TRIGGER sync_commentum_user_on_insert
    AFTER INSERT ON comments
    FOR EACH ROW
    EXECUTE FUNCTION sync_commentum_user_on_comment();

-- Trigger on comment update to sync user status
CREATE TRIGGER sync_commentum_user_status_on_update
    BEFORE UPDATE ON comments
    FOR EACH ROW
    EXECUTE FUNCTION sync_commentum_user_status_on_comment_update();

-- Trigger on comment update when votes change to update user vote count
CREATE TRIGGER update_user_on_vote_change
    AFTER UPDATE OF upvotes, downvotes, user_votes ON comments
    FOR EACH ROW
    WHEN (OLD.upvotes != NEW.upvotes OR OLD.downvotes != NEW.downvotes OR OLD.user_votes != NEW.user_votes)
    EXECUTE FUNCTION update_user_on_vote();

-- Trigger on comment update when reports change to update user reported count
CREATE TRIGGER update_user_on_report_change
    AFTER UPDATE OF reported, report_count, reports ON comments
    FOR EACH ROW
    WHEN (OLD.reported != NEW.reported OR OLD.report_count != NEW.report_count OR OLD.reports != NEW.reports)
    EXECUTE FUNCTION update_user_on_report();

-- Function to batch sync all existing comments to user table
CREATE OR REPLACE FUNCTION batch_sync_existing_comments_to_users()
RETURNS INTEGER AS $$
DECLARE
    synced_count INTEGER := 0;
    comment_record RECORD;
BEGIN
    -- Create a temporary table to track unique users
    CREATE TEMPORARY TABLE unique_users AS
    SELECT DISTINCT client_type, user_id, username, user_avatar, user_role, MIN(created_at) as first_comment_at, MAX(created_at) as last_comment_at, COUNT(*) as comment_count
    FROM comments
    WHERE deleted = false
    GROUP BY client_type, user_id, username, user_avatar, user_role;
    
    -- Insert each unique user into commentum_users
    FOR comment_record IN SELECT * FROM unique_users LOOP
        INSERT INTO commentum_users (
            commentum_client_type,
            commentum_user_id,
            commentum_username,
            commentum_user_avatar,
            commentum_user_role,
            commentum_user_comment_count,
            commentum_user_first_comment_at,
            commentum_user_last_comment_at,
            commentum_user_ip_addresses,
            commentum_user_user_agents
        ) VALUES (
            comment_record.client_type,
            comment_record.user_id,
            comment_record.username,
            comment_record.user_avatar,
            comment_record.user_role,
            comment_record.comment_count,
            comment_record.first_comment_at,
            comment_record.last_comment_at,
            '[]',
            '[]'
        ) ON CONFLICT (commentum_client_type, commentum_user_id) DO UPDATE SET
            commentum_username = EXCLUDED.commentum_username,
            commentum_user_avatar = COALESCE(EXCLUDED.commentum_user_avatar, commentum_users.commentum_user_avatar),
            commentum_user_role = COALESCE(EXCLUDED.commentum_user_role, commentum_users.commentum_user_role),
            commentum_user_comment_count = EXCLUDED.commentum_user_comment_count,
            commentum_user_first_comment_at = LEAST(commentum_users.commentum_user_first_comment_at, EXCLUDED.commentum_user_first_comment_at),
            commentum_user_last_comment_at = GREATEST(commentum_users.commentum_user_last_comment_at, EXCLUDED.commentum_user_last_comment_at),
            updated_at = NOW();
        
        synced_count := synced_count + 1;
    END LOOP;
    
    -- Drop temporary table
    DROP TABLE unique_users;
    
    RETURN synced_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync user status back to all comments
CREATE OR REPLACE FUNCTION sync_user_status_to_all_comments()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER := 0;
    user_record RECORD;
BEGIN
    -- Update all comments with current user status from commentum_users
    FOR user_record IN SELECT * FROM commentum_users LOOP
        UPDATE comments SET
            user_banned = user_record.commentum_user_banned,
            user_muted_until = user_record.commentum_user_muted_until,
            user_shadow_banned = user_record.commentum_user_shadow_banned,
            user_warnings = user_record.commentum_user_warnings,
            updated_at = NOW()
        WHERE client_type = user_record.commentum_client_type 
        AND user_id = user_record.commentum_user_id
        AND (
            user_banned != user_record.commentum_user_banned OR
            user_muted_until != user_record.commentum_user_muted_until OR
            user_shadow_banned != user_record.commentum_user_shadow_banned OR
            user_warnings != user_record.commentum_user_warnings
        );
        
        GET DIAGNOSTICS updated_count = updated_count + ROW_COUNT;
    END LOOP;
    
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user statistics
CREATE OR REPLACE FUNCTION get_user_statistics(p_client_type TEXT DEFAULT NULL, p_days INTEGER DEFAULT 30)
RETURNS JSONB AS $$
DECLARE
    stats JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_users', COUNT(*),
        'active_users', COUNT(*) FILTER (WHERE commentum_user_last_comment_at > NOW() - (p_days || ' days')::INTERVAL),
        'banned_users', COUNT(*) FILTER (WHERE commentum_user_banned = true),
        'muted_users', COUNT(*) FILTER (WHERE commentum_user_muted = true AND commentum_user_muted_until > NOW()),
        'shadow_banned_users', COUNT(*) FILTER (WHERE commentum_user_shadow_banned = true),
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

-- Create view for user summary (useful for admin dashboards)
CREATE OR REPLACE VIEW commentum_user_summary AS
SELECT 
    commentum_client_type,
    commentum_user_id,
    commentum_username,
    commentum_user_role,
    commentum_user_banned,
    commentum_user_muted,
    commentum_user_shadow_banned,
    commentum_user_warnings,
    commentum_user_comment_count,
    commentum_user_last_comment_at,
    created_at,
    updated_at,
    -- Status summary
    CASE 
        WHEN commentum_user_banned THEN 'banned'
        WHEN commentum_user_shadow_banned THEN 'shadow_banned'
        WHEN commentum_user_muted AND commentum_user_muted_until > NOW() THEN 'muted'
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
        (CASE WHEN commentum_user_muted AND commentum_user_muted_until > NOW() THEN 50 ELSE 0 END)
    ) as risk_score
FROM commentum_users
WHERE commentum_user_active = true;

-- Grant necessary permissions
GRANT SELECT ON commentum_user_summary TO authenticated;
GRANT SELECT ON commentum_user_summary TO anon;