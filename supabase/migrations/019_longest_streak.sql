-- ====================================
-- MIGRATION 019: Add longest_streak calculation
-- Updates get_user_points to calculate and return longest_streak
-- Updates refresh_user_points to store it in user_points table
-- ====================================

-- ====================================
-- Replace get_user_points with longest_streak support
-- ====================================

CREATE OR REPLACE FUNCTION get_user_points(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    user_record RECORD;
    total_points BIGINT;
    current_tier TEXT;
    streak_days INTEGER;
    longest_streak_days INTEGER;
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
    role_bonus BIGINT;
    user_role TEXT;
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
            'longest_streak', 0,
            'role', 'user',
            'role_bonus', 0,
            'breakdown', '{}'::jsonb,
            'next_tier_at', 100
        );
    END IF;

    -- Resolve user role (owner from config, then cached role)
    user_role := get_user_role(p_client_type, p_user_id);
    role_bonus := get_role_bonus(user_role);

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

    -- Current streak calculation
    streak_days := 0;
    IF user_record.commentum_user_last_comment_at > NOW() - INTERVAL '2 days' THEN
        SELECT COUNT(DISTINCT DATE(created_at)) INTO streak_days
        FROM comments
        WHERE user_id = p_user_id
        AND client_type = p_client_type
        AND created_at > NOW() - INTERVAL '60 days'
        AND deleted = false;

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

    -- ========================================
    -- Longest streak calculation (all-time)
    -- Uses gaps-and-islands: consecutive dates
    -- share the same (date - row_number) group
    -- ========================================
    longest_streak_days := 0;
    SELECT COALESCE(MAX(streak_len), 0) INTO longest_streak_days
    FROM (
        SELECT COUNT(*) AS streak_len
        FROM (
            SELECT
                comment_date,
                comment_date - (ROW_NUMBER() OVER (ORDER BY comment_date))::INTEGER AS grp
            FROM (
                SELECT DISTINCT DATE(created_at) AS comment_date
                FROM comments
                WHERE user_id = p_user_id
                AND client_type = p_client_type
                AND deleted = false
            ) distinct_dates
        ) grouped_dates
        GROUP BY grp
    ) streak_groups;

    -- Ensure current streak doesn't exceed longest
    longest_streak_days := GREATEST(longest_streak_days, streak_days);

    -- Streak bonuses
    streak_bonus := 0;
    IF streak_days >= 30 THEN
        streak_bonus := p_streak_30;
    ELSIF streak_days >= 7 THEN
        streak_bonus := p_streak_7;
    END IF;

    -- Total points (includes role bonus)
    total_points := (
        points_from_comments +
        points_from_upvotes +
        points_from_votes_cast +
        points_from_pinned +
        streak_bonus +
        role_bonus -
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
        'longest_streak', longest_streak_days,
        'role', user_role,
        'role_bonus', role_bonus,
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
            'from_role_bonus', role_bonus,
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
-- Update refresh_user_points to store longest_streak
-- ====================================

CREATE OR REPLACE FUNCTION refresh_user_points(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS VOID AS $$
DECLARE
    calc_result JSONB;
    v_tier TEXT;
    v_streak INTEGER;
    v_longest_streak INTEGER;
BEGIN
    calc_result := get_user_points(p_client_type, p_user_id);

    v_tier := COALESCE(calc_result->>'tier', 'newcomer');
    v_streak := COALESCE((calc_result->>'streak')::INTEGER, 0);
    v_longest_streak := COALESCE((calc_result->>'longest_streak')::INTEGER, 0);

    INSERT INTO user_points (user_id, client_type, total_points, tier, current_streak, longest_streak, updated_at)
    VALUES (
        p_user_id,
        p_client_type,
        COALESCE((calc_result->>'points')::BIGINT, 0),
        v_tier,
        v_streak,
        v_longest_streak,
        NOW()
    )
    ON CONFLICT (user_id, client_type)
    DO UPDATE SET
        total_points = COALESCE((calc_result->>'points')::BIGINT, 0),
        tier = v_tier,
        current_streak = v_streak,
        longest_streak = GREATEST(user_points.longest_streak, v_longest_streak),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
