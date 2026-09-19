-- ===================================================
-- MIGRATION 031: PER-USER LEADERBOARD RANK IN get_user_points
-- Adds 'rank' to the get_user_points response so clients can show
-- "#N" without paging the whole leaderboard. Ordering is identical
-- to get_points_leaderboard: ROW_NUMBER() OVER (real_points DESC,
-- comment_count DESC), where real_points uses the leaderboard formula
-- (activity only, NO role bonus). NULL when the user is unranked
-- (unknown/inactive/banned/shadow-banned).
-- ===================================================

CREATE OR REPLACE FUNCTION get_user_points(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    user_record RECORD;
    real_points BIGINT;
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
    is_infinite BOOLEAN;
    next_tier_points INTEGER;
    user_rank INTEGER;
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
    p_per_comment        := COALESCE(p_per_comment, 5);
    p_per_reply          := COALESCE(p_per_reply, 3);
    p_per_upvote         := COALESCE(p_per_upvote, 2);
    p_per_downvote       := COALESCE(p_per_downvote, 1);
    p_per_vote_cast      := COALESCE(p_per_vote_cast, 1);
    p_per_pinned         := COALESCE(p_per_pinned, 15);
    p_streak_7           := COALESCE(p_streak_7, 10);
    p_streak_30          := COALESCE(p_streak_30, 25);
    p_penalty_warning    := COALESCE(p_penalty_warning, 20);
    p_penalty_mod_delete := COALESCE(p_penalty_mod_delete, 10);
    p_penalty_ban        := COALESCE(p_penalty_ban, 100);

    -- Fetch user record
    SELECT * INTO user_record FROM commentum_users
    WHERE commentum_client_type = p_client_type
    AND commentum_user_id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'points', 0,
            'real_points', 0,
            'is_infinite', false,
            'display_points', '0',
            'tier', 'newcomer',
            'streak', 0,
            'longest_streak', 0,
            'role', 'user',
            'role_bonus', 0,
            'rank', NULL,
            'breakdown', '{}'::jsonb,
            'next_tier_at', 100
        );
    END IF;

    -- Resolve user role
    user_role := get_user_role(p_client_type, p_user_id);
    role_bonus := get_role_bonus(user_role);
    is_infinite := (user_role IN ('owner', 'app_owner'));

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

    -- Pinned comments
    SELECT COUNT(*) INTO pinned_count
    FROM comments
    WHERE user_id = p_user_id
    AND client_type = p_client_type
    AND is_pinned = true
    AND deleted = false;

    -- Subtotal points from each source
    points_from_comments   := (top_level_count * p_per_comment) + (reply_count * p_per_reply);
    points_from_upvotes    := upvotes_from_others * p_per_upvote;
    points_from_downvotes  := downvotes_from_others * p_per_downvote;
    points_from_votes_cast := user_record.commentum_user_vote_count * p_per_vote_cast;
    points_from_pinned     := pinned_count * p_per_pinned;

    -- Penalties
    penalty_warnings   := user_record.commentum_user_warnings * p_penalty_warning;
    penalty_mod_deletes := 0;
    penalty_ban        := CASE WHEN user_record.commentum_user_banned THEN p_penalty_ban ELSE 0 END;

    -- Streak calculation
    streak_days := calculate_comment_streak(p_client_type, p_user_id);

    -- Longest streak
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

    longest_streak_days := GREATEST(longest_streak_days, streak_days);

    -- Streak bonuses
    streak_bonus := 0;
    IF streak_days >= 30 THEN
        streak_bonus := p_streak_30;
    ELSIF streak_days >= 7 THEN
        streak_bonus := p_streak_7;
    END IF;

    -- Real points (activity earned, NO role bonus)
    real_points := (
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
    real_points := GREATEST(real_points, 0);

    -- Total points (includes role bonus for non-owners)
    total_points := GREATEST(real_points + role_bonus, 0);

    -- Determine tier
    current_tier := CASE
        WHEN is_infinite THEN 'elite'
        WHEN total_points >= 5000 THEN 'elite'
        WHEN total_points >= 1500 THEN 'veteran'
        WHEN total_points >= 500  THEN 'active'
        WHEN total_points >= 100  THEN 'regular'
        ELSE 'newcomer'
    END;

    -- Next tier threshold
    next_tier_points := CASE
        WHEN is_infinite THEN NULL
        WHEN total_points < 100  THEN 100
        WHEN total_points < 500  THEN 500
        WHEN total_points < 1500 THEN 1500
        WHEN total_points < 5000 THEN 5000
        ELSE NULL
    END;

    -- Leaderboard rank: identical ordering to get_points_leaderboard
    -- (ROW_NUMBER over leaderboard-formula real_points DESC,
    -- comment_count DESC). NULL when unranked.
    SELECT ranked.rnk INTO user_rank
    FROM (
        SELECT
            cu.commentum_user_id AS uid,
            ROW_NUMBER() OVER (
                ORDER BY
                    GREATEST(0, (
                        (cu.commentum_user_comment_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_comment'), 5)) +
                        (cu.commentum_user_vote_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_vote_cast'), 1)) -
                        (cu.commentum_user_warnings * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_warning'), 20)) -
                        (CASE WHEN cu.commentum_user_banned THEN COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_ban'), 100) ELSE 0 END)
                    )) DESC,
                    cu.commentum_user_comment_count DESC
            ) AS rnk
        FROM commentum_users cu
        WHERE cu.commentum_user_active = true
        AND cu.commentum_user_banned = false
        AND cu.commentum_user_shadow_banned = false
        AND cu.commentum_client_type = p_client_type
    ) ranked
    WHERE ranked.uid = p_user_id;

    RETURN jsonb_build_object(
        'points', total_points,
        'real_points', real_points,
        'is_infinite', is_infinite,
        'display_points', CASE WHEN is_infinite THEN '∞' ELSE total_points::TEXT END,
        'tier', current_tier,
        'streak', streak_days,
        'longest_streak', longest_streak_days,
        'role', user_role,
        'role_bonus', role_bonus,
        'rank', user_rank,
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
