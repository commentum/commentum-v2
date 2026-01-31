-- Script to populate users table from existing comments
-- This will add all unique users from comments table to users table

-- Insert unique users from comments into users table
INSERT INTO users (
    client_type,
    user_id,
    username,
    user_avatar,
    user_role,
    total_comments,
    last_comment_at,
    created_at,
    updated_at
)
SELECT 
    client_type,
    user_id,
    username,
    user_avatar,
    user_role,
    COUNT(*) as total_comments,
    MAX(created_at) as last_comment_at,
    MIN(created_at) as created_at,
    NOW() as updated_at
FROM comments
WHERE deleted = false
GROUP BY client_type, user_id, username, user_avatar, user_role
ON CONFLICT (client_type, user_id) DO UPDATE SET
    username = EXCLUDED.username,
    user_avatar = COALESCE(EXCLUDED.user_avatar, users.user_avatar),
    user_role = EXCLUDED.user_role,
    total_comments = EXCLUDED.total_comments,
    last_comment_at = EXCLUDED.last_comment_at,
    updated_at = NOW();

-- Update user statistics (votes received)
UPDATE users 
SET 
    total_upvotes_received = (
        SELECT COALESCE(SUM(upvotes), 0)
        FROM comments 
        WHERE comments.client_type = users.client_type 
        AND comments.user_id = users.user_id 
        AND comments.deleted = false
    ),
    total_downvotes_received = (
        SELECT COALESCE(SUM(downvotes), 0)
        FROM comments 
        WHERE comments.client_type = users.client_type 
        AND comments.user_id = users.user_id 
        AND comments.deleted = false
    ),
    total_reports_received = (
        SELECT COUNT(*)
        FROM comments 
        WHERE comments.client_type = users.client_type 
        AND comments.user_id = users.user_id 
        AND comments.deleted = false
        AND comments.reported = true
    )
WHERE EXISTS (
    SELECT 1 FROM comments 
    WHERE comments.client_type = users.client_type 
    AND comments.user_id = users.user_id
);

-- Update moderation status from comments
UPDATE users 
SET 
    user_banned = (
        SELECT bool_or(user_banned)
        FROM comments 
        WHERE comments.client_type = users.client_type 
        AND comments.user_id = users.user_id 
        AND comments.deleted = false
    ),
    user_shadow_banned = (
        SELECT bool_or(user_shadow_banned)
        FROM comments 
        WHERE comments.client_type = users.client_type 
        AND comments.user_id = users.user_id 
        AND comments.deleted = false
    ),
    user_muted_until = (
        SELECT MAX(user_muted_until)
        FROM comments 
        WHERE comments.client_type = users.client_type 
        AND comments.user_id = users.user_id 
        AND comments.deleted = false
        AND user_muted_until IS NOT NULL
    ),
    user_warnings = (
        SELECT MAX(user_warnings)
        FROM comments 
        WHERE comments.client_type = users.client_type 
        AND comments.user_id = users.user_id 
        AND comments.deleted = false
    )
WHERE EXISTS (
    SELECT 1 FROM comments 
    WHERE comments.client_type = users.client_type 
    AND comments.user_id = users.user_id
);

-- Show results
SELECT 
    client_type,
    user_id,
    username,
    user_role,
    total_comments,
    total_upvotes_received,
    total_downvotes_received,
    total_reports_received,
    user_banned,
    user_shadow_banned,
    user_muted_until,
    user_warnings,
    created_at,
    last_comment_at
FROM users 
ORDER BY total_comments DESC, created_at ASC;