-- ====================================
-- Migration 047: Rename breakdown field from_bonus to from_ads
-- and return points_reward in claim_ad_points
-- ====================================

CREATE OR REPLACE FUNCTION claim_ad_points(
    p_client_type TEXT,
    p_user_id TEXT,
    p_ad_id TEXT,
    p_points INTEGER DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_master_id INTEGER;
    v_norm_client TEXT;
    v_points_to_add INTEGER;
    v_total_points BIGINT;
    v_new_bonus BIGINT;
    v_linked_record RECORD;
BEGIN
    IF p_ad_id IS NULL OR TRIM(p_ad_id) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'ad_id_required');
    END IF;

    IF p_user_id IS NULL OR TRIM(p_user_id) = '' OR p_client_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'user_id_and_client_type_required');
    END IF;

    v_norm_client := LOWER(TRIM(p_client_type));
    IF v_norm_client = 'myanimelist' THEN
        v_norm_client := 'mal';
    END IF;

    -- 1. Determine points amount: uses points passed from app, or config, default 10
    IF p_points IS NOT NULL AND p_points > 0 THEN
        v_points_to_add := p_points;
    ELSE
        SELECT COALESCE(value::INTEGER, 10) INTO v_points_to_add
        FROM config
        WHERE key = 'points_per_ad';
        v_points_to_add := COALESCE(v_points_to_add, 10);
    END IF;

    -- 2. Find master user ID from commentum_users (across primary or linked accounts)
    SELECT id INTO v_master_id
    FROM commentum_users
    WHERE (commentum_client_type = v_norm_client AND commentum_user_id = p_user_id)
       OR (v_norm_client = 'anilist' AND linked_anilist_id = p_user_id)
       OR (v_norm_client = 'mal' AND linked_mal_id = p_user_id)
       OR (v_norm_client = 'simkl' AND linked_simkl_id = p_user_id)
    LIMIT 1;

    -- 3. Duplicate check: prevent this ad_id from being claimed by this user OR any linked accounts
    IF EXISTS (
        SELECT 1 FROM user_ad_rewards
        WHERE ad_id = p_ad_id
          AND (
              (v_master_id IS NOT NULL AND master_user_id = v_master_id)
              OR (user_id = p_user_id AND client_type = v_norm_client)
          )
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ad_already_claimed',
            'message', 'Points have already been claimed for this ad'
        );
    END IF;

    -- 4. Record the claim
    INSERT INTO user_ad_rewards (user_id, client_type, master_user_id, ad_id, points)
    VALUES (p_user_id, v_norm_client, v_master_id, p_ad_id, v_points_to_add);

    -- 5. Refresh cache row first so it exists
    PERFORM refresh_user_points(v_norm_client, p_user_id);

    -- 6. Atomically update user_points
    UPDATE user_points
    SET points_bonus = points_bonus + v_points_to_add,
        total_points = total_points + v_points_to_add,
        real_points  = real_points  + v_points_to_add,
        updated_at   = NOW()
    WHERE user_id = p_user_id
      AND client_type = v_norm_client
    RETURNING total_points, points_bonus INTO v_total_points, v_new_bonus;

    -- 7. If linked accounts exist, also sync points_bonus to linked accounts in user_points
    IF v_master_id IS NOT NULL THEN
        FOR v_linked_record IN
            SELECT commentum_client_type, commentum_user_id,
                   linked_anilist_id, linked_mal_id, linked_simkl_id
            FROM commentum_users
            WHERE id = v_master_id
        LOOP
            -- Primary account if different from caller
            IF v_linked_record.commentum_user_id != p_user_id OR v_linked_record.commentum_client_type != v_norm_client THEN
                PERFORM refresh_user_points(v_linked_record.commentum_client_type, v_linked_record.commentum_user_id);
                UPDATE user_points
                SET points_bonus = points_bonus + v_points_to_add,
                    total_points = total_points + v_points_to_add,
                    real_points  = real_points  + v_points_to_add,
                    updated_at   = NOW()
                WHERE user_id = v_linked_record.commentum_user_id
                  AND client_type = v_linked_record.commentum_client_type;
            END IF;

            -- Linked AniList
            IF v_linked_record.linked_anilist_id IS NOT NULL AND (v_norm_client != 'anilist' OR p_user_id != v_linked_record.linked_anilist_id) THEN
                PERFORM refresh_user_points('anilist', v_linked_record.linked_anilist_id);
                UPDATE user_points
                SET points_bonus = points_bonus + v_points_to_add,
                    total_points = total_points + v_points_to_add,
                    real_points  = real_points  + v_points_to_add,
                    updated_at   = NOW()
                WHERE user_id = v_linked_record.linked_anilist_id
                  AND client_type = 'anilist';
            END IF;

            -- Linked MAL
            IF v_linked_record.linked_mal_id IS NOT NULL AND (v_norm_client != 'mal' OR p_user_id != v_linked_record.linked_mal_id) THEN
                PERFORM refresh_user_points('mal', v_linked_record.linked_mal_id);
                UPDATE user_points
                SET points_bonus = points_bonus + v_points_to_add,
                    total_points = total_points + v_points_to_add,
                    real_points  = real_points  + v_points_to_add,
                    updated_at   = NOW()
                WHERE user_id = v_linked_record.linked_mal_id
                  AND client_type = 'mal';
            END IF;

            -- Linked Simkl
            IF v_linked_record.linked_simkl_id IS NOT NULL AND (v_norm_client != 'simkl' OR p_user_id != v_linked_record.linked_simkl_id) THEN
                PERFORM refresh_user_points('simkl', v_linked_record.linked_simkl_id);
                UPDATE user_points
                SET points_bonus = points_bonus + v_points_to_add,
                    total_points = total_points + v_points_to_add,
                    real_points  = real_points  + v_points_to_add,
                    updated_at   = NOW()
                WHERE user_id = v_linked_record.linked_simkl_id
                  AND client_type = 'simkl';
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'points_reward', v_points_to_add,
        'points_added', v_points_to_add,
        'new_total_points', v_total_points,
        'ad_id', p_ad_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- Update get_user_points to show from_ads in breakdown
-- ====================================

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
    v_points_spent BIGINT;
    v_points_bonus BIGINT;
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
            'points_spent', 0,
            'points_bonus', 0,
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

    -- Count top-level comments
    SELECT COUNT(*) INTO top_level_count
    FROM comments
    WHERE user_id = p_user_id
    AND client_type = p_client_type
    AND parent_id IS NULL
    AND deleted = false;

    -- Count replies
    SELECT COUNT(*) INTO reply_count
    FROM comments
    WHERE user_id = p_user_id
    AND client_type = p_client_type
    AND parent_id IS NOT NULL
    AND deleted = false;

    -- Upvotes received from others
    SELECT COALESCE(SUM(c.upvotes), 0) INTO upvotes_from_others
    FROM comments c
    WHERE c.user_id = p_user_id
    AND c.client_type = p_client_type
    AND c.deleted = false;

    -- Downvotes received from others
    SELECT COALESCE(SUM(c.downvotes), 0) INTO downvotes_from_others
    FROM comments c
    WHERE c.user_id = p_user_id
    AND c.client_type = p_client_type
    AND c.deleted = false;

    -- Pinned comments
    SELECT COUNT(*) INTO pinned_count
    FROM comments
    WHERE user_id = p_user_id
    AND client_type = p_client_type
    AND pinned = true
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

    -- Real points from ACTIVITY
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

    -- ---------------------------------------------------------
    -- SPENT POINTS & BONUS POINTS (from ads/grants)
    -- Both survive activity recalculations
    -- ---------------------------------------------------------
    SELECT COALESCE(points_spent, 0), COALESCE(points_bonus, 0)
    INTO v_points_spent, v_points_bonus
    FROM user_points
    WHERE user_id = p_user_id
    AND client_type = p_client_type;

    real_points := GREATEST(real_points + COALESCE(v_points_bonus, 0) - COALESCE(v_points_spent, 0), 0);

    -- Total points (spendable balance, includes role bonus for non-owners)
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

    -- Leaderboard rank
    SELECT ranked.rnk INTO user_rank
    FROM (
        SELECT
            cu.commentum_user_id AS uid,
            ROW_NUMBER() OVER (
                ORDER BY
                    GREATEST(COALESCE(up.real_points, 0), 0) DESC,
                    COALESCE(up.total_points, 0) DESC,
                    cu.commentum_user_comment_count DESC
            ) AS rnk
        FROM commentum_users cu
        LEFT JOIN user_points up
            ON up.user_id = cu.commentum_user_id
            AND up.client_type = cu.commentum_client_type
        WHERE cu.commentum_user_active = true
        AND cu.commentum_user_banned = false
        AND cu.commentum_user_shadow_banned = false
        AND cu.commentum_client_type = p_client_type
    ) ranked
    WHERE ranked.uid = p_user_id;

    RETURN jsonb_build_object(
        'points', total_points,
        'real_points', real_points,
        'points_spent', COALESCE(v_points_spent, 0),
        'points_bonus', COALESCE(v_points_bonus, 0),
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
            'from_ads', COALESCE(v_points_bonus, 0),
            'penalty_warnings', -penalty_warnings,
            'penalty_mod_deletes', -penalty_mod_deletes,
            'penalty_ban', -penalty_ban,
            'points_spent', -COALESCE(v_points_spent, 0)
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

GRANT EXECUTE ON FUNCTION public.claim_ad_points(TEXT, TEXT, TEXT, INTEGER) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_points(TEXT, TEXT) TO anon, authenticated, service_role;
