-- ====================================
-- Migration 048: Unify points across linked accounts
--
-- If a user has linked accounts (AniList, MAL, Simkl), their points pool,
-- comment counts, votes, and ad points are unified into a single shared balance.
-- Whether checking points via AniList, MAL, or Simkl, the balance is 100% identical.
-- ====================================

-- ====================================
-- 1. Helper function: get_unified_user_record
-- Resolves master record from commentum_users across primary or linked accounts
-- ====================================

CREATE OR REPLACE FUNCTION get_unified_user_record(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS commentum_users AS $$
DECLARE
    v_norm_client TEXT;
    v_rec commentum_users;
BEGIN
    v_norm_client := LOWER(TRIM(p_client_type));
    IF v_norm_client = 'myanimelist' THEN
        v_norm_client := 'mal';
    END IF;

    SELECT * INTO v_rec
    FROM commentum_users
    WHERE (commentum_client_type = v_norm_client AND commentum_user_id = p_user_id)
       OR (v_norm_client = 'anilist' AND linked_anilist_id = p_user_id)
       OR (v_norm_client = 'mal'     AND linked_mal_id = p_user_id)
       OR (v_norm_client = 'simkl'   AND linked_simkl_id = p_user_id)
    LIMIT 1;

    RETURN v_rec;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ====================================
-- 2. Updated get_user_points (Unified Across Linked Accounts)
-- ====================================

CREATE OR REPLACE FUNCTION get_user_points(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    user_record commentum_users;
    v_norm_client TEXT;
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
    v_total_votes_cast INTEGER;
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
    has_linked BOOLEAN;
BEGIN
    v_norm_client := LOWER(TRIM(p_client_type));
    IF v_norm_client = 'myanimelist' THEN
        v_norm_client := 'mal';
    END IF;

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

    -- 1. Fetch master user record (resolves across linked accounts)
    user_record := get_unified_user_record(v_norm_client, p_user_id);

    IF user_record IS NULL OR user_record.id IS NULL THEN
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

    has_linked := (
        user_record.linked_anilist_id IS NOT NULL OR
        user_record.linked_mal_id IS NOT NULL OR
        user_record.linked_simkl_id IS NOT NULL
    );

    -- Resolve user role (checks owner/admin across linked accounts)
    user_role := get_user_role(user_record.commentum_client_type, user_record.commentum_user_id);
    role_bonus := get_role_bonus(user_role);
    is_infinite := (user_role IN ('owner', 'app_owner'));

    -- 2. Count top-level comments across all linked accounts
    SELECT COUNT(*) INTO top_level_count
    FROM comments
    WHERE parent_id IS NULL AND deleted = false
      AND (
          (client_type = user_record.commentum_client_type AND user_id = user_record.commentum_user_id)
          OR (has_linked AND user_record.linked_anilist_id IS NOT NULL AND client_type = 'anilist' AND user_id = user_record.linked_anilist_id)
          OR (has_linked AND user_record.linked_mal_id IS NOT NULL AND client_type IN ('mal', 'myanimelist') AND user_id = user_record.linked_mal_id)
          OR (has_linked AND user_record.linked_simkl_id IS NOT NULL AND client_type = 'simkl' AND user_id = user_record.linked_simkl_id)
      );

    -- 3. Count replies across all linked accounts
    SELECT COUNT(*) INTO reply_count
    FROM comments
    WHERE parent_id IS NOT NULL AND deleted = false
      AND (
          (client_type = user_record.commentum_client_type AND user_id = user_record.commentum_user_id)
          OR (has_linked AND user_record.linked_anilist_id IS NOT NULL AND client_type = 'anilist' AND user_id = user_record.linked_anilist_id)
          OR (has_linked AND user_record.linked_mal_id IS NOT NULL AND client_type IN ('mal', 'myanimelist') AND user_id = user_record.linked_mal_id)
          OR (has_linked AND user_record.linked_simkl_id IS NOT NULL AND client_type = 'simkl' AND user_id = user_record.linked_simkl_id)
      );

    -- 4. Upvotes received from others across all linked accounts
    SELECT COALESCE(SUM(c.upvotes), 0) INTO upvotes_from_others
    FROM comments c
    WHERE c.deleted = false
      AND (
          (c.client_type = user_record.commentum_client_type AND c.user_id = user_record.commentum_user_id)
          OR (has_linked AND user_record.linked_anilist_id IS NOT NULL AND c.client_type = 'anilist' AND c.user_id = user_record.linked_anilist_id)
          OR (has_linked AND user_record.linked_mal_id IS NOT NULL AND c.client_type IN ('mal', 'myanimelist') AND c.user_id = user_record.linked_mal_id)
          OR (has_linked AND user_record.linked_simkl_id IS NOT NULL AND c.client_type = 'simkl' AND c.user_id = user_record.linked_simkl_id)
      );

    -- 5. Downvotes received from others across all linked accounts
    SELECT COALESCE(SUM(c.downvotes), 0) INTO downvotes_from_others
    FROM comments c
    WHERE c.deleted = false
      AND (
          (c.client_type = user_record.commentum_client_type AND c.user_id = user_record.commentum_user_id)
          OR (has_linked AND user_record.linked_anilist_id IS NOT NULL AND c.client_type = 'anilist' AND c.user_id = user_record.linked_anilist_id)
          OR (has_linked AND user_record.linked_mal_id IS NOT NULL AND c.client_type IN ('mal', 'myanimelist') AND c.user_id = user_record.linked_mal_id)
          OR (has_linked AND user_record.linked_simkl_id IS NOT NULL AND c.client_type = 'simkl' AND c.user_id = user_record.linked_simkl_id)
      );

    -- 6. Pinned comments across all linked accounts
    SELECT COUNT(*) INTO pinned_count
    FROM comments
    WHERE pinned = true AND deleted = false
      AND (
          (client_type = user_record.commentum_client_type AND user_id = user_record.commentum_user_id)
          OR (has_linked AND user_record.linked_anilist_id IS NOT NULL AND client_type = 'anilist' AND user_id = user_record.linked_anilist_id)
          OR (has_linked AND user_record.linked_mal_id IS NOT NULL AND client_type IN ('mal', 'myanimelist') AND user_id = user_record.linked_mal_id)
          OR (has_linked AND user_record.linked_simkl_id IS NOT NULL AND client_type = 'simkl' AND user_id = user_record.linked_simkl_id)
      );

    -- 7. Votes cast & Warnings across all linked records
    SELECT COALESCE(SUM(commentum_user_vote_count), 0), COALESCE(MAX(commentum_user_warnings), 0)
    INTO v_total_votes_cast, penalty_warnings
    FROM commentum_users
    WHERE id = user_record.id;

    -- Subtotal points from each source
    points_from_comments   := (top_level_count * p_per_comment) + (reply_count * p_per_reply);
    points_from_upvotes    := upvotes_from_others * p_per_upvote;
    points_from_downvotes  := downvotes_from_others * p_per_downvote;
    points_from_votes_cast := v_total_votes_cast * p_per_vote_cast;
    points_from_pinned     := pinned_count * p_per_pinned;

    -- Penalties
    penalty_warnings   := penalty_warnings * p_penalty_warning;
    penalty_mod_deletes := 0;
    penalty_ban        := CASE WHEN user_record.commentum_user_banned THEN p_penalty_ban ELSE 0 END;

    -- 8. Unified streak calculation
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
                WHERE deleted = false
                  AND (
                      (client_type = user_record.commentum_client_type AND user_id = user_record.commentum_user_id)
                      OR (has_linked AND user_record.linked_anilist_id IS NOT NULL AND client_type = 'anilist' AND user_id = user_record.linked_anilist_id)
                      OR (has_linked AND user_record.linked_mal_id IS NOT NULL AND client_type IN ('mal', 'myanimelist') AND user_id = user_record.linked_mal_id)
                      OR (has_linked AND user_record.linked_simkl_id IS NOT NULL AND client_type = 'simkl' AND user_id = user_record.linked_simkl_id)
                  )
            ) distinct_dates
        ) grouped_dates
        GROUP BY grp
    ) streak_groups;

    streak_days := 0;
    IF EXISTS (
        SELECT 1 FROM comments
        WHERE deleted = false
          AND created_at > NOW() - INTERVAL '2 days'
          AND (
              (client_type = user_record.commentum_client_type AND user_id = user_record.commentum_user_id)
              OR (has_linked AND user_record.linked_anilist_id IS NOT NULL AND client_type = 'anilist' AND user_id = user_record.linked_anilist_id)
              OR (has_linked AND user_record.linked_mal_id IS NOT NULL AND client_type IN ('mal', 'myanimelist') AND user_id = user_record.linked_mal_id)
              OR (has_linked AND user_record.linked_simkl_id IS NOT NULL AND client_type = 'simkl' AND user_id = user_record.linked_simkl_id)
          )
    ) THEN
        SELECT COUNT(DISTINCT DATE(created_at)) INTO streak_days
        FROM comments
        WHERE deleted = false
          AND created_at > NOW() - INTERVAL '60 days'
          AND (
              (client_type = user_record.commentum_client_type AND user_id = user_record.commentum_user_id)
              OR (has_linked AND user_record.linked_anilist_id IS NOT NULL AND client_type = 'anilist' AND user_id = user_record.linked_anilist_id)
              OR (has_linked AND user_record.linked_mal_id IS NOT NULL AND client_type IN ('mal', 'myanimelist') AND user_id = user_record.linked_mal_id)
              OR (has_linked AND user_record.linked_simkl_id IS NOT NULL AND client_type = 'simkl' AND user_id = user_record.linked_simkl_id)
          );
    END IF;

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

    -- 9. Unified SPENT POINTS and BONUS POINTS (from ads/grants) across linked accounts
    SELECT COALESCE(MAX(points_spent), 0), COALESCE(MAX(points_bonus), 0)
    INTO v_points_spent, v_points_bonus
    FROM user_points
    WHERE (client_type = user_record.commentum_client_type AND user_id = user_record.commentum_user_id)
       OR (has_linked AND user_record.linked_anilist_id IS NOT NULL AND client_type = 'anilist' AND user_id = user_record.linked_anilist_id)
       OR (has_linked AND user_record.linked_mal_id IS NOT NULL AND client_type = 'mal' AND user_id = user_record.linked_mal_id)
       OR (has_linked AND user_record.linked_simkl_id IS NOT NULL AND client_type = 'simkl' AND user_id = user_record.linked_simkl_id);

    -- Add bonus points directly from user_ad_rewards if higher
    SELECT GREATEST(v_points_bonus, COALESCE(SUM(points), 0))
    INTO v_points_bonus
    FROM user_ad_rewards
    WHERE master_user_id = user_record.id
       OR (user_id = user_record.commentum_user_id AND client_type = user_record.commentum_client_type)
       OR (has_linked AND user_record.linked_anilist_id IS NOT NULL AND client_type = 'anilist' AND user_id = user_record.linked_anilist_id)
       OR (has_linked AND user_record.linked_mal_id IS NOT NULL AND client_type = 'mal' AND user_id = user_record.linked_mal_id)
       OR (has_linked AND user_record.linked_simkl_id IS NOT NULL AND client_type = 'simkl' AND user_id = user_record.linked_simkl_id);

    real_points := GREATEST(real_points + COALESCE(v_points_bonus, 0) - COALESCE(v_points_spent, 0), 0);
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
        AND cu.commentum_client_type = user_record.commentum_client_type
    ) ranked
    WHERE ranked.uid = user_record.commentum_user_id;

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
            'comment_count', top_level_count + reply_count,
            'top_level_comments', top_level_count,
            'replies', reply_count,
            'upvotes_from_others', upvotes_from_others,
            'downvotes_from_others', downvotes_from_others,
            'vote_count', v_total_votes_cast,
            'pinned_count', pinned_count,
            'warnings', penalty_warnings
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- 3. Updated refresh_user_points: Syncs identical balance across linked accounts
-- ====================================

CREATE OR REPLACE FUNCTION refresh_user_points(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS VOID AS $$
DECLARE
    calc_result JSONB;
    user_record commentum_users;
    v_norm_client TEXT;
    v_tier TEXT;
    v_streak INTEGER;
    v_longest_streak INTEGER;
    v_real_points BIGINT;
    v_total_points BIGINT;
    v_bonus BIGINT;
    v_spent BIGINT;
    has_linked BOOLEAN;
BEGIN
    v_norm_client := LOWER(TRIM(p_client_type));
    IF v_norm_client = 'myanimelist' THEN
        v_norm_client := 'mal';
    END IF;

    user_record := get_unified_user_record(v_norm_client, p_user_id);
    calc_result := get_user_points(v_norm_client, p_user_id);

    v_tier           := COALESCE(calc_result->>'tier', 'newcomer');
    v_streak         := COALESCE((calc_result->>'streak')::INTEGER, 0);
    v_longest_streak := COALESCE((calc_result->>'longest_streak')::INTEGER, 0);
    v_real_points    := COALESCE((calc_result->>'real_points')::BIGINT, 0);
    v_total_points   := COALESCE((calc_result->>'points')::BIGINT, 0);
    v_bonus          := COALESCE((calc_result->>'points_bonus')::BIGINT, 0);
    v_spent          := COALESCE((calc_result->>'points_spent')::BIGINT, 0);

    -- Update calling account
    INSERT INTO user_points (user_id, client_type, total_points, real_points, points_bonus, points_spent, tier, current_streak, longest_streak, updated_at)
    VALUES (
        p_user_id,
        v_norm_client,
        v_total_points,
        v_real_points,
        v_bonus,
        v_spent,
        v_tier,
        v_streak,
        v_longest_streak,
        NOW()
    )
    ON CONFLICT (user_id, client_type)
    DO UPDATE SET
        total_points = EXCLUDED.total_points,
        real_points = EXCLUDED.real_points,
        points_bonus = GREATEST(user_points.points_bonus, EXCLUDED.points_bonus),
        points_spent = GREATEST(user_points.points_spent, EXCLUDED.points_spent),
        tier = EXCLUDED.tier,
        current_streak = EXCLUDED.current_streak,
        longest_streak = GREATEST(user_points.longest_streak, EXCLUDED.longest_streak),
        updated_at = NOW();

    -- If linked accounts exist, sync identical points across all linked rows in user_points
    IF user_record IS NOT NULL THEN
        -- Primary
        INSERT INTO user_points (user_id, client_type, total_points, real_points, points_bonus, points_spent, tier, current_streak, longest_streak, updated_at)
        VALUES (
            user_record.commentum_user_id,
            user_record.commentum_client_type,
            v_total_points,
            v_real_points,
            v_bonus,
            v_spent,
            v_tier,
            v_streak,
            v_longest_streak,
            NOW()
        )
        ON CONFLICT (user_id, client_type)
        DO UPDATE SET
            total_points = EXCLUDED.total_points,
            real_points = EXCLUDED.real_points,
            points_bonus = GREATEST(user_points.points_bonus, EXCLUDED.points_bonus),
            points_spent = GREATEST(user_points.points_spent, EXCLUDED.points_spent),
            tier = EXCLUDED.tier,
            current_streak = EXCLUDED.current_streak,
            longest_streak = GREATEST(user_points.longest_streak, EXCLUDED.longest_streak),
            updated_at = NOW();

        -- Linked AniList
        IF user_record.linked_anilist_id IS NOT NULL THEN
            INSERT INTO user_points (user_id, client_type, total_points, real_points, points_bonus, points_spent, tier, current_streak, longest_streak, updated_at)
            VALUES (user_record.linked_anilist_id, 'anilist', v_total_points, v_real_points, v_bonus, v_spent, v_tier, v_streak, v_longest_streak, NOW())
            ON CONFLICT (user_id, client_type)
            DO UPDATE SET
                total_points = EXCLUDED.total_points,
                real_points = EXCLUDED.real_points,
                points_bonus = GREATEST(user_points.points_bonus, EXCLUDED.points_bonus),
                points_spent = GREATEST(user_points.points_spent, EXCLUDED.points_spent),
                tier = EXCLUDED.tier,
                current_streak = EXCLUDED.current_streak,
                longest_streak = GREATEST(user_points.longest_streak, EXCLUDED.longest_streak),
                updated_at = NOW();
        END IF;

        -- Linked MAL
        IF user_record.linked_mal_id IS NOT NULL THEN
            INSERT INTO user_points (user_id, client_type, total_points, real_points, points_bonus, points_spent, tier, current_streak, longest_streak, updated_at)
            VALUES (user_record.linked_mal_id, 'mal', v_total_points, v_real_points, v_bonus, v_spent, v_tier, v_streak, v_longest_streak, NOW())
            ON CONFLICT (user_id, client_type)
            DO UPDATE SET
                total_points = EXCLUDED.total_points,
                real_points = EXCLUDED.real_points,
                points_bonus = GREATEST(user_points.points_bonus, EXCLUDED.points_bonus),
                points_spent = GREATEST(user_points.points_spent, EXCLUDED.points_spent),
                tier = EXCLUDED.tier,
                current_streak = EXCLUDED.current_streak,
                longest_streak = GREATEST(user_points.longest_streak, EXCLUDED.longest_streak),
                updated_at = NOW();
        END IF;

        -- Linked Simkl
        IF user_record.linked_simkl_id IS NOT NULL THEN
            INSERT INTO user_points (user_id, client_type, total_points, real_points, points_bonus, points_spent, tier, current_streak, longest_streak, updated_at)
            VALUES (user_record.linked_simkl_id, 'simkl', v_total_points, v_real_points, v_bonus, v_spent, v_tier, v_streak, v_longest_streak, NOW())
            ON CONFLICT (user_id, client_type)
            DO UPDATE SET
                total_points = EXCLUDED.total_points,
                real_points = EXCLUDED.real_points,
                points_bonus = GREATEST(user_points.points_bonus, EXCLUDED.points_bonus),
                points_spent = GREATEST(user_points.points_spent, EXCLUDED.points_spent),
                tier = EXCLUDED.tier,
                current_streak = EXCLUDED.current_streak,
                longest_streak = GREATEST(user_points.longest_streak, EXCLUDED.longest_streak),
                updated_at = NOW();
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- 4. Updated spend_user_points: Deducts atomically across linked accounts
-- ====================================

CREATE OR REPLACE FUNCTION spend_user_points(
    p_client_type TEXT,
    p_user_id TEXT,
    p_amount INTEGER
)
RETURNS JSONB AS $$
DECLARE
    user_record commentum_users;
    v_norm_client TEXT;
    v_total BIGINT;
    v_spent BIGINT;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_amount');
    END IF;

    v_norm_client := LOWER(TRIM(p_client_type));
    IF v_norm_client = 'myanimelist' THEN
        v_norm_client := 'mal';
    END IF;

    user_record := get_unified_user_record(v_norm_client, p_user_id);
    PERFORM refresh_user_points(v_norm_client, p_user_id);

    UPDATE user_points
    SET points_spent = points_spent + p_amount,
        total_points = total_points - p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id
      AND client_type = v_norm_client
      AND total_points >= p_amount
    RETURNING total_points, points_spent INTO v_total, v_spent;

    IF NOT FOUND THEN
        SELECT total_points INTO v_total
        FROM user_points
        WHERE user_id = p_user_id
        AND client_type = v_norm_client;

        RETURN jsonb_build_object(
            'success', false,
            'error', 'insufficient_points',
            'remaining_points', COALESCE(v_total, 0)
        );
    END IF;

    -- Sync points_spent and total_points to linked accounts in user_points
    IF user_record IS NOT NULL THEN
        -- Primary
        UPDATE user_points
        SET points_spent = points_spent + p_amount,
            total_points = total_points - p_amount,
            updated_at = NOW()
        WHERE user_id = user_record.commentum_user_id
          AND client_type = user_record.commentum_client_type
          AND (user_record.commentum_user_id != p_user_id OR user_record.commentum_client_type != v_norm_client);

        -- Linked AniList
        IF user_record.linked_anilist_id IS NOT NULL AND (v_norm_client != 'anilist' OR p_user_id != user_record.linked_anilist_id) THEN
            UPDATE user_points
            SET points_spent = points_spent + p_amount,
                total_points = total_points - p_amount,
                updated_at = NOW()
            WHERE user_id = user_record.linked_anilist_id AND client_type = 'anilist';
        END IF;

        -- Linked MAL
        IF user_record.linked_mal_id IS NOT NULL AND (v_norm_client != 'mal' OR p_user_id != user_record.linked_mal_id) THEN
            UPDATE user_points
            SET points_spent = points_spent + p_amount,
                total_points = total_points - p_amount,
                updated_at = NOW()
            WHERE user_id = user_record.linked_mal_id AND client_type = 'mal';
        END IF;

        -- Linked Simkl
        IF user_record.linked_simkl_id IS NOT NULL AND (v_norm_client != 'simkl' OR p_user_id != user_record.linked_simkl_id) THEN
            UPDATE user_points
            SET points_spent = points_spent + p_amount,
                total_points = total_points - p_amount,
                updated_at = NOW()
            WHERE user_id = user_record.linked_simkl_id AND client_type = 'simkl';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'points_spent', p_amount,
        'remaining_points', v_total,
        'lifetime_spent', v_spent
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grants
GRANT EXECUTE ON FUNCTION public.get_unified_user_record(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_points(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_user_points(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.spend_user_points(TEXT, TEXT, INTEGER) TO anon, authenticated, service_role;
