-- ====================================
-- POINTS SYSTEM MIGRATION
-- Adds points calculation, leaderboard, and streak tracking
-- ====================================

-- ====================================
-- CONFIG: Points system configuration keys
-- ====================================

INSERT INTO config (key, value) VALUES
    ('points_enabled', 'true'),
    ('points_per_comment', '5'),
    ('points_per_reply', '3'),
    ('points_per_upvote_received', '2'),
    ('points_per_downvote_received', '1'),
    -- deducted (stored as positive, subtracted in calc)
    ('points_per_vote_cast', '1'),
    ('points_per_pinned', '15'),
    ('points_streak_7_day_bonus', '10'),
    ('points_streak_30_day_bonus', '25'),
    ('points_penalty_warning', '20'),
    ('points_penalty_mod_delete', '10'),
    ('points_penalty_ban', '100'),
    -- Tier thresholds
    ('points_tier_newcomer_max', '99'),
    ('points_tier_regular_max', '499'),
    ('points_tier_active_max', '1499'),
    ('points_tier_veteran_max', '4999'),
    -- elite = 5000+
    ('points_leaderboard_enabled', 'true'),
    ('points_leaderboard_page_size', '50'),
    ('points_streak_max_lookback_days', '60');

-- ====================================
-- INDEX: Optimise points queries
-- ====================================

-- Index for streak calculation (distinct dates per user)
CREATE INDEX IF NOT EXISTS idx_comments_user_streak 
    ON comments(client_type, user_id, created_at) 
    WHERE deleted = false;

-- Index for pinned comment count
CREATE INDEX IF NOT EXISTS idx_comments_pinned_by_user 
    ON comments(client_type, user_id) 
    WHERE pinned = true AND deleted = false;

-- ====================================
-- FUNCTION: get_user_points
-- Calculates points for a single user, excluding self-votes
-- ====================================

CREATE OR REPLACE FUNCTION get_user_points(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    user_record RECORD;
    total_points INTEGER;
    current_tier TEXT;
    streak_days INTEGER;
    pinned_count INTEGER;
    upvotes_from_others BIGINT;
    downvotes_from_others BIGINT;
    points_from_comments INTEGER;
    points_from_upvotes INTEGER;
    points_from_downvotes INTEGER;
    points_from_votes_cast INTEGER;
    points_from_pinned INTEGER;
    penalty_warnings INTEGER;
    penalty_mod_deletes INTEGER;
    penalty_ban INTEGER;
    streak_bonus INTEGER;
    next_tier_points INTEGER;
    p_per_comment INTEGER;
    p_per_reply INTEGER;
    p_per_upvote INTEGER;
    p_per_downvote INTEGER;
    p_per_vote_cast INTEGER;
    p_per_pinned INTEGER;
    p_streak_7 INTEGER;
    p_streak_30 INTEGER;
    p_penalty_warning INTEGER;
    p_penalty_mod_delete INTEGER;
    p_penalty_ban INTEGER;
    reply_count BIGINT;
    top_level_count BIGINT;
BEGIN
    -- Load point values from config (with defaults)
    SELECT value::INTEGER INTO p_per_comment FROM config WHERE key = 'points_per_comment';
    SELECT value::INTEGER INTO p_per_reply FROM config WHERE key = 'points_per_reply';
    SELECT value::INTEGER INTO p_per_upvote FROM config WHERE key = 'points_per_upvote_received';
    SELECT value::INTEGER INTO p_per_downvote FROM config WHERE key = 'points_per_downvote_received';
    SELECT value::INTEGER INTO p_per_vote_cast FROM config WHERE key = 'points_per_vote_cast';
    SELECT value::INTEGER INTO p_per_pinned FROM config WHERE key = 'points_per_pinned';
    SELECT value::INTEGER INTO p_streak_7 FROM config WHERE key = 'points_streak_7_day_bonus';
    SELECT value::INTEGER INTO p_streak_30 FROM config WHERE key = 'points_streak_30_day_bonus';
    SELECT value::INTEGER INTO p_penalty_warning FROM config WHERE key = 'points_penalty_warning';
    SELECT value::INTEGER INTO p_penalty_mod_delete FROM config WHERE key = 'points_penalty_mod_delete';
    SELECT value::INTEGER INTO p_penalty_ban FROM config WHERE key = 'points_penalty_ban';

    -- Defaults if config missing
    p_per_comment     := COALESCE(p_per_comment, 5);
    p_per_reply       := COALESCE(p_per_reply, 3);
    p_per_upvote      := COALESCE(p_per_upvote, 2);
    p_per_downvote    := COALESCE(p_per_downvote, 1);
    p_per_vote_cast   := COALESCE(p_per_vote_cast, 1);
    p_per_pinned      := COALESCE(p_per_pinned, 15);
    p_streak_7        := COALESCE(p_streak_7, 10);
    p_streak_30       := COALESCE(p_streak_30, 25);
    p_penalty_warning := COALESCE(p_penalty_warning, 20);
    p_penalty_mod_delete := COALESCE(p_penalty_mod_delete, 10);
    p_penalty_ban     := COALESCE(p_penalty_ban, 100);

    -- Fetch user record
    SELECT * INTO user_record FROM commentum_users
    WHERE commentum_client_type = p_client_type 
    AND commentum_user_id = p_user_id;

    IF NOT FOUND THEN 
        RETURN jsonb_build_object(
            'points', 0,
            'tier', 'newcomer',
            'streak', 0,
            'breakdown', '{}'::jsonb,
            'next_tier_at', 100
        );
    END IF;

    -- Count top-level comments vs replies
    SELECT 
        COUNT(*) FILTER (WHERE parent_id IS NULL),
        COUNT(*) FILTER (WHERE parent_id IS NOT NULL)
    INTO top_level_count, reply_count
    FROM comments
    WHERE user_id = p_user_id 
    AND client_type = p_client_type 
    AND deleted = false;

    -- Count upvotes from OTHERS (exclude self-votes)
    -- user_votes is JSON: { "user_id_1": "upvote", "user_id_2": "downvote" }
    -- If the author's own user_id appears in user_votes as "upvote", subtract 1
    SELECT COALESCE(SUM(
        upvotes - 
        CASE 
            WHEN user_votes IS NOT NULL 
            AND user_votes::jsonb ? p_user_id 
            AND (user_votes::jsonb->>p_user_id) = 'upvote' 
            THEN 1 
            ELSE 0 
        END
    ), 0) INTO upvotes_from_others
    FROM comments 
    WHERE user_id = p_user_id 
    AND client_type = p_client_type 
    AND deleted = false;

    -- Count downvotes from OTHERS (exclude self-downvotes)
    SELECT COALESCE(SUM(
        downvotes - 
        CASE 
            WHEN user_votes IS NOT NULL 
            AND user_votes::jsonb ? p_user_id 
            AND (user_votes::jsonb->>p_user_id) = 'downvote' 
            THEN 1 
            ELSE 0 
        END
    ), 0) INTO downvotes_from_others
    FROM comments 
    WHERE user_id = p_user_id 
    AND client_type = p_client_type 
    AND deleted = false;

    -- Pinned comments (mods only pin = not farmable)
    SELECT COUNT(*) INTO pinned_count
    FROM comments 
    WHERE user_id = p_user_id 
    AND client_type = p_client_type 
    AND pinned = true 
    AND deleted = false;

    -- Calculate individual components
    points_from_comments  := (top_level_count::INTEGER * p_per_comment) + (reply_count::INTEGER * p_per_reply);
    points_from_upvotes   := upvotes_from_others::INTEGER * p_per_upvote;
    points_from_downvotes := downvotes_from_others::INTEGER * p_per_downvote;
    points_from_votes_cast := user_record.commentum_user_vote_count * p_per_vote_cast;
    points_from_pinned    := pinned_count * p_per_pinned;
    penalty_warnings      := user_record.commentum_user_warnings * p_penalty_warning;
    penalty_mod_deletes   := user_record.commentum_user_moderated_count * p_penalty_mod_delete;
    penalty_ban           := CASE WHEN user_record.commentum_user_banned THEN p_penalty_ban ELSE 0 END;

    -- Streak calculation
    -- A streak is consecutive days with at least 1 comment
    -- Only counts if user commented in the last 2 days (otherwise streak is broken)
    streak_days := 0;
    IF user_record.commentum_user_last_comment_at > NOW() - INTERVAL '2 days' THEN
        -- Count distinct days the user commented in the lookback period
        SELECT COUNT(DISTINCT DATE(created_at)) INTO streak_days
        FROM comments
        WHERE user_id = p_user_id 
        AND client_type = p_client_type
        AND created_at > NOW() - INTERVAL '60 days'
        AND deleted = false;
        
        -- Verify the streak is actually consecutive from today/yesterday
        -- Check if user commented today or yesterday (streak start)
        IF NOT EXISTS (
            SELECT 1 FROM comments
            WHERE user_id = p_user_id 
            AND client_type = p_client_type
            AND created_at > CURRENT_DATE - INTERVAL '1 day'
            AND deleted = false
        ) THEN
            streak_days := 0;
        END IF;
    END IF;

    -- Streak bonuses
    streak_bonus := 0;
    IF streak_days >= 30 THEN
        streak_bonus := p_streak_30;
    ELSIF streak_days >= 7 THEN
        streak_bonus := p_streak_7;
    END IF;

    -- Total points
    total_points := (
        points_from_comments +
        points_from_upvotes +
        points_from_votes_cast +
        points_from_pinned +
        streak_bonus -
        points_from_downvotes -
        penalty_warnings -
        penalty_mod_deletes -
        penalty_ban
    );

    -- Floor at 0
    total_points := GREATEST(total_points, 0);

    -- Determine tier
    current_tier := CASE
        WHEN total_points >= 5000 THEN 'elite'
        WHEN total_points >= 1500 THEN 'veteran'
        WHEN total_points >= 500  THEN 'active'
        WHEN total_points >= 100  THEN 'regular'
        ELSE 'newcomer'
    END;

    -- Next tier threshold
    next_tier_points := CASE
        WHEN total_points < 100  THEN 100
        WHEN total_points < 500  THEN 500
        WHEN total_points < 1500 THEN 1500
        WHEN total_points < 5000 THEN 5000
        ELSE NULL
    END;

    RETURN jsonb_build_object(
        'points', total_points,
        'tier', current_tier,
        'streak', streak_days,
        'next_tier_at', next_tier_points,
        'points_to_next_tier', CASE 
            WHEN next_tier_points IS NOT NULL 
            THEN next_tier_points - total_points 
            ELSE NULL 
        END,
        'breakdown', jsonb_build_object(
            'from_comments', points_from_comments,
            'from_upvotes_received', points_from_upvotes,
            'from_downvotes_received', -points_from_downvotes,
            'from_votes_cast', points_from_votes_cast,
            'from_pinned', points_from_pinned,
            'from_streak_bonus', streak_bonus,
            'penalty_warnings', -penalty_warnings,
            'penalty_mod_deletes', -penalty_mod_deletes,
            'penalty_ban', -penalty_ban
        ),
        'stats', jsonb_build_object(
            'comment_count', user_record.commentum_user_comment_count,
            'top_level_comments', top_level_count,
            'replies', reply_count,
            'upvotes_from_others', upvotes_from_others,
            'downvotes_from_others', downvotes_from_others,
            'vote_count', user_record.commentum_user_vote_count,
            'pinned_count', pinned_count,
            'warnings', user_record.commentum_user_warnings
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- FUNCTION: get_points_leaderboard
-- Returns top users ranked by points
-- ====================================

CREATE OR REPLACE FUNCTION get_points_leaderboard(
    p_client_type TEXT DEFAULT NULL,
    p_page INTEGER DEFAULT 1,
    p_limit INTEGER DEFAULT 50
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    effective_limit INTEGER;
    effective_offset INTEGER;
BEGIN
    -- Check if leaderboard is enabled
    IF EXISTS (SELECT 1 FROM config WHERE key = 'points_leaderboard_enabled' AND value::boolean = false) THEN
        RETURN jsonb_build_object(
            'enabled', false,
            'leaderboard', '[]'::jsonb,
            'pagination', NULL
        );
    END IF;

    effective_limit := LEAST(GREATEST(p_limit, 1), 100);
    effective_offset := (GREATEST(p_page, 1) - 1) * effective_limit;

    -- Build leaderboard by computing points for each user
    -- Uses the commentum_users table + aggregated comment data
    -- Note: For large datasets, consider a materialized points cache
    WITH user_points AS (
        SELECT 
            cu.commentum_user_id,
            cu.commentum_username,
            cu.commentum_user_avatar,
            cu.commentum_client_type,
            cu.commentum_user_comment_count,
            cu.commentum_user_vote_count,
            cu.commentum_user_warnings,
            cu.commentum_user_banned,
            cu.commentum_user_last_comment_at,
            -- Calculate points inline for ranking
            GREATEST(0, (
                (cu.commentum_user_comment_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_comment'), 5)) +
                (cu.commentum_user_vote_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_vote_cast'), 1)) -
                (cu.commentum_user_warnings * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_warning'), 20)) -
                (CASE WHEN cu.commentum_user_banned THEN COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_ban'), 100) ELSE 0 END)
            )) as estimated_points
        FROM commentum_users cu
        WHERE cu.commentum_user_active = true
        AND cu.commentum_user_banned = false
        AND cu.commentum_user_shadow_banned = false
        AND (p_client_type IS NULL OR cu.commentum_client_type = p_client_type)
    ),
    ranked_users AS (
        SELECT 
            ROW_NUMBER() OVER (ORDER BY estimated_points DESC, commentum_user_comment_count DESC) as rank,
            commentum_user_id,
            commentum_username,
            commentum_user_avatar,
            commentum_client_type,
            commentum_user_comment_count,
            estimated_points,
            -- Tier from estimated points
            CASE
                WHEN estimated_points >= 5000 THEN 'elite'
                WHEN estimated_points >= 1500 THEN 'veteran'
                WHEN estimated_points >= 500  THEN 'active'
                WHEN estimated_points >= 100  THEN 'regular'
                ELSE 'newcomer'
            END as tier
        FROM user_points
    )
    SELECT jsonb_build_object(
        'leaderboard', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'rank', rank,
                'user_id', commentum_user_id,
                'username', commentum_username,
                'avatar', commentum_user_avatar,
                'client_type', commentum_client_type,
                'points', estimated_points,
                'tier', tier,
                'comment_count', commentum_user_comment_count
            ) ORDER BY rank)
            FROM ranked_users
            OFFSET effective_offset
            LIMIT effective_limit),
            '[]'::jsonb
        ),
        'pagination', jsonb_build_object(
            'page', p_page,
            'limit', effective_limit,
            'total', (SELECT COUNT(*) FROM user_points)
        )
    ) INTO result;

    RETURN COALESCE(result, '{"leaderboard": [], "pagination": null}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- FUNCTION: get_points_config
-- Returns the public points configuration (for clients to display tier info)
-- ====================================

CREATE OR REPLACE FUNCTION get_points_config()
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'enabled', COALESCE((SELECT value::boolean FROM config WHERE key = 'points_enabled'), true),
        'tiers', jsonb_build_object(
            'newcomer', jsonb_build_object('min', 0, 'max', 99, 'label', 'Newcomer', 'icon', 'seedling'),
            'regular', jsonb_build_object('min', 100, 'max', 499, 'label', 'Regular', 'icon', 'leaf'),
            'active', jsonb_build_object('min', 500, 'max', 1499, 'label', 'Active', 'icon', 'flower'),
            'veteran', jsonb_build_object('min', 1500, 'max', 4999, 'label', 'Veteran', 'icon', 'star'),
            'elite', jsonb_build_object('min', 5000, 'max', NULL, 'label', 'Elite', 'icon', 'diamond')
        ),
        'earning', jsonb_build_object(
            'comment', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_comment'), 5),
            'reply', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_reply'), 3),
            'upvote_received', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_upvote_received'), 2),
            'downvote_received', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_downvote_received'), 1),
            'vote_cast', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_vote_cast'), 1),
            'pinned', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_pinned'), 15),
            'streak_7_day', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_streak_7_day_bonus'), 10),
            'streak_30_day', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_streak_30_day_bonus'), 25)
        ),
        'penalties', jsonb_build_object(
            'warning', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_warning'), 20),
            'mod_delete', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_mod_delete'), 10),
            'ban', COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_ban'), 100)
        )
    ) INTO result;

    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- FUNCTION: get_batch_user_points
-- Get points for multiple users at once (for embedding in comment lists)
-- This is efficient for showing badges next to usernames in comments
-- ====================================

CREATE OR REPLACE FUNCTION get_batch_user_points(
    p_client_type TEXT,
    p_user_ids TEXT[]
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    -- For each user in the array, compute their tier only (lightweight)
    -- Full points calculation is expensive in batch, so we estimate tier
    -- from commentum_user_comment_count + vote_count
    SELECT jsonb_object_agg(
        cu.commentum_user_id,
        jsonb_build_object(
            'tier', CASE
                WHEN GREATEST(0, (
                    (cu.commentum_user_comment_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_comment'), 5)) +
                    (cu.commentum_user_vote_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_vote_cast'), 1)) -
                    (cu.commentum_user_warnings * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_warning'), 20))
                )) >= 5000 THEN 'elite'
                WHEN GREATEST(0, (
                    (cu.commentum_user_comment_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_comment'), 5)) +
                    (cu.commentum_user_vote_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_vote_cast'), 1)) -
                    (cu.commentum_user_warnings * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_warning'), 20))
                )) >= 1500 THEN 'veteran'
                WHEN GREATEST(0, (
                    (cu.commentum_user_comment_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_comment'), 5)) +
                    (cu.commentum_user_vote_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_vote_cast'), 1)) -
                    (cu.commentum_user_warnings * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_warning'), 20))
                )) >= 500 THEN 'active'
                WHEN GREATEST(0, (
                    (cu.commentum_user_comment_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_comment'), 5)) +
                    (cu.commentum_user_vote_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_vote_cast'), 1)) -
                    (cu.commentum_user_warnings * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_warning'), 20))
                )) >= 100 THEN 'regular'
                ELSE 'newcomer'
            END,
            'username', cu.commentum_username,
            'avatar', cu.commentum_user_avatar
        )
    ) INTO result
    FROM commentum_users cu
    WHERE cu.commentum_client_type = p_client_type
    AND cu.commentum_user_id = ANY(p_user_ids)
    AND cu.commentum_user_active = true;

    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
