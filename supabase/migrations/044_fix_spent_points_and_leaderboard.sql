-- ===================================================
-- MIGRATION: SPENT-POINTS TRACKING + LEADERBOARD CONSISTENCY
--
-- Two bugs fixed:
--
-- BUG 1 - Spent points came back after the next activity.
--   Buying a cosmetic subtracted the cost directly from
--   user_points.total_points, but user_points is a CACHE that is
--   recomputed from raw activity on every comment/vote/moderation
--   event (triggers -> refresh_user_points -> get_user_points).
--   That recalculation never accounted for purchases, so the
--   deduction was overwritten and the spent points silently
--   "returned" on the user's next comment or vote - effectively
--   letting the same balance be spent again and again.
--
--   Fix: user_points.points_spent stores lifetime spending.
--   get_user_points() subtracts points_spent from the activity
--   total, refresh_user_points() preserves points_spent whenever
--   the cache is recomputed, and purchases go through the new
--   atomic spend_user_points() function instead of overwriting
--   total_points directly.
--
-- BUG 2 - The leaderboard ranked with a different (simpler) formula
--   than the balance. It ranked by
--       comments*5 + votes_cast*1 - warnings*20 - ban_penalty
--   while the balance formula counts top-level comments *5,
--   replies *3, upvotes received *2, votes cast *1, pins *15,
--   streak bonuses, downvotes received *-1 and penalties. The
--   'rank' field inside get_user_points() (migration 031) used the
--   same simplified formula, so a user's profile rank could
--   disagree with the leaderboard they see.
--
--   Fix: the leaderboard and the per-user rank both read
--   user_points.real_points now. real_points is the activity total
--   (net of spending, EXCLUDING role bonus) kept fresh by the same
--   triggers that keep total_points fresh, so ranking always uses
--   the exact same numbers as the balance.
--
-- AFTER DEPLOY:
--   The backfill block at the bottom computes a points-cache row for
--   every active user who has activity but no row yet, so the
--   cache-based leaderboard shows them correctly. If anything was
--   missed, the maintenance endpoint rebuilds everyone:
--       POST /functions/v1/points  {"action": "refresh_all"}
-- ===================================================

-- ====================================
-- 1. New columns on the user_points cache
-- ====================================

-- Real activity points (net of spending, no role bonus). Kept fresh by
-- refresh_user_points; used for leaderboard ranking.
ALTER TABLE user_points ADD COLUMN IF NOT EXISTS real_points BIGINT NOT NULL DEFAULT 0;

-- Lifetime points spent on cosmetics. NEVER touched by recalculations.
ALTER TABLE user_points ADD COLUMN IF NOT EXISTS points_spent BIGINT NOT NULL DEFAULT 0;

-- ====================================
-- 2. get_user_points: subtract lifetime spending
-- (base: migration 031 version, rank subselect updated to match
--  the new leaderboard ordering)
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
    -- NOTE: the column is comments.pinned (NOT is_pinned). is_pinned made
    -- get_user_points fail with "column is_pinned does not exist", which
    -- aborted any UPDATE on commentum_users that changed
    -- role/ban/warnings/vote_count (points refresh trigger).
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

    -- Real points from ACTIVITY (no role bonus yet)
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
    -- SPENT POINTS: subtract lifetime cosmetic purchases.
    -- points_spent is written only by spend_user_points() and is
    -- preserved by refresh_user_points(), so a purchase stays
    -- deducted no matter how often activity recalculations run.
    -- ---------------------------------------------------------
    SELECT COALESCE(points_spent, 0) INTO v_points_spent
    FROM user_points
    WHERE user_id = p_user_id
    AND client_type = p_client_type;

    real_points := GREATEST(real_points - COALESCE(v_points_spent, 0), 0);

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

    -- Leaderboard rank: identical ordering to get_points_leaderboard
    -- (ROW_NUMBER over cached real_points DESC, total_points DESC,
    -- comment_count DESC). NULL when unranked.
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

-- ====================================
-- 3. refresh_user_points: store real_points, PRESERVE points_spent
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
    v_real_points BIGINT;
    v_total_points BIGINT;
BEGIN
    calc_result := get_user_points(p_client_type, p_user_id);

    v_tier           := COALESCE(calc_result->>'tier', 'newcomer');
    v_streak         := COALESCE((calc_result->>'streak')::INTEGER, 0);
    v_longest_streak := COALESCE((calc_result->>'longest_streak')::INTEGER, 0);
    v_real_points    := COALESCE((calc_result->>'real_points')::BIGINT, 0);
    v_total_points   := COALESCE((calc_result->>'points')::BIGINT, 0);

    INSERT INTO user_points (user_id, client_type, total_points, real_points, tier, current_streak, longest_streak, updated_at)
    VALUES (
        p_user_id,
        p_client_type,
        v_total_points,
        v_real_points,
        v_tier,
        v_streak,
        v_longest_streak,
        NOW()
    )
    ON CONFLICT (user_id, client_type)
    DO UPDATE SET
        total_points = EXCLUDED.total_points,
        real_points = EXCLUDED.real_points,
        tier = EXCLUDED.tier,
        current_streak = EXCLUDED.current_streak,
        longest_streak = GREATEST(user_points.longest_streak, EXCLUDED.longest_streak),
        updated_at = NOW();
    -- NOTE: points_spent is intentionally NOT updated here. It is owned
    -- by spend_user_points() only, so spending survives every recalc.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- 4. spend_user_points: atomic, guarded deduction for purchases
-- Used by the unlock_customization edge action. Refreshes the cache
-- row first (so the balance is fresh and exists), then deducts inside
-- a single conditional UPDATE - concurrent purchases cannot double-
-- spend because the WHERE clause is re-evaluated on the locked row.
-- ====================================

CREATE OR REPLACE FUNCTION spend_user_points(
    p_client_type TEXT,
    p_user_id TEXT,
    p_amount INTEGER
)
RETURNS JSONB AS $$
DECLARE
    v_total BIGINT;
    v_spent BIGINT;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_amount');
    END IF;

    -- Make sure a cache row exists and is fresh (also creates one for
    -- users who never had activity since migration 018).
    PERFORM refresh_user_points(p_client_type, p_user_id);

    UPDATE user_points
    SET points_spent = points_spent + p_amount,
        total_points = total_points - p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id
      AND client_type = p_client_type
      AND total_points >= p_amount
    RETURNING total_points, points_spent INTO v_total, v_spent;

    IF NOT FOUND THEN
        -- Balance insufficient (or row vanished): report current balance.
        SELECT total_points INTO v_total
        FROM user_points
        WHERE user_id = p_user_id
        AND client_type = p_client_type;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'insufficient_points',
            'remaining_points', COALESCE(v_total, 0)
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'points_spent', p_amount,
        'remaining_points', v_total,
        'lifetime_spent', v_spent
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- 5. get_points_leaderboard: rank from the SAME numbers as the balance
-- Ranked by user_points.real_points (activity net of spending, NO role
-- bonus - staff bonus still does not count toward rank), tiebroken by
-- total_points then comment_count. Same ordering as the 'rank' field
-- in get_user_points above.
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

    WITH entries AS (
        SELECT
            cu.commentum_user_id                                AS user_id,
            cu.commentum_username                               AS username,
            cu.commentum_user_avatar                            AS avatar,
            cu.avatar_decoration,
            cu.nameplate_theme,
            cu.commentum_client_type                            AS client_type,
            cu.commentum_user_comment_count                     AS comment_count,
            GREATEST(COALESCE(up.real_points, 0), 0)            AS real_points,
            COALESCE(up.total_points, 0)                        AS total_points,
            COALESCE(up.current_streak, 0)                      AS current_streak,
            COALESCE(up.longest_streak, 0)                      AS longest_streak,
            get_user_role(cu.commentum_client_type, cu.commentum_user_id) AS resolved_role
        FROM commentum_users cu
        LEFT JOIN user_points up
            ON up.user_id = cu.commentum_user_id
            AND up.client_type = cu.commentum_client_type
        WHERE cu.commentum_user_active = true
        AND cu.commentum_user_banned = false
        AND cu.commentum_user_shadow_banned = false
        AND (p_client_type IS NULL OR cu.commentum_client_type = p_client_type)
    ),
    ranked_users AS (
        SELECT
            -- RANKED BY REAL ACTIVITY POINTS - same numbers as the balance
            ROW_NUMBER() OVER (
                ORDER BY real_points DESC, total_points DESC, comment_count DESC
            ) AS rank,
            e.*,
            get_role_bonus(resolved_role) AS role_bonus,
            (resolved_role IN ('owner', 'app_owner')) AS is_infinite,
            CASE
                WHEN real_points >= 5000 THEN 'elite'
                WHEN real_points >= 1500 THEN 'veteran'
                WHEN real_points >= 500  THEN 'active'
                WHEN real_points >= 100  THEN 'regular'
                ELSE 'newcomer'
            END AS tier
        FROM entries e
    )
    SELECT jsonb_build_object(
        'leaderboard', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'rank', rank,
                'user_id', user_id,
                'username', username,
                'avatar', avatar,
                'avatar_decoration', avatar_decoration,
                'nameplate_theme', nameplate_theme,
                'client_type', client_type,
                'points', real_points,
                'real_points', real_points,
                'total_points', total_points,
                'role_bonus', role_bonus,
                'is_infinite', is_infinite,
                'tier', tier,
                'tier_emoji', CASE tier
                    WHEN 'elite' THEN '💎'
                    WHEN 'veteran' THEN '⭐'
                    WHEN 'active' THEN '🌸'
                    WHEN 'regular' THEN '🍃'
                    ELSE '🌱'
                END,
                'role', resolved_role,
                'comment_count', comment_count,
                'current_streak', current_streak,
                'longest_streak', longest_streak
            ) ORDER BY rank)
            FROM ranked_users
            OFFSET effective_offset
            LIMIT effective_limit),
            '[]'::jsonb
        ),
        'pagination', jsonb_build_object(
            'page', p_page,
            'limit', effective_limit,
            'total', (SELECT COUNT(*) FROM entries)
        )
    ) INTO result;

    RETURN COALESCE(result, '{"leaderboard": [], "pagination": null}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- 6. BACKFILL: build cache rows for active users who have activity
-- but no user_points row yet (e.g. they last acted before migration
-- 018 deployed). Without this they would show as 0 points on the new
-- cache-based leaderboard until their next comment/vote.
-- ====================================

DO $$
DECLARE
    rec RECORD;
    v_count INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT cu.commentum_user_id, cu.commentum_client_type
        FROM commentum_users cu
        LEFT JOIN user_points up
            ON up.user_id = cu.commentum_user_id
            AND up.client_type = cu.commentum_client_type
        WHERE up.user_id IS NULL
        AND cu.commentum_user_active = true
        AND (cu.commentum_user_comment_count > 0 OR cu.commentum_user_vote_count > 0)
    LOOP
        BEGIN
            PERFORM refresh_user_points(rec.commentum_client_type, rec.commentum_user_id);
            v_count := v_count + 1;
        EXCEPTION WHEN OTHERS THEN
            -- Never fail the whole migration because of one bad user row
            RAISE NOTICE 'points backfill failed for % / %',
                rec.commentum_client_type, rec.commentum_user_id;
        END;
    END LOOP;
    RAISE NOTICE 'points cache backfilled for % users', v_count;
END;
$$;
