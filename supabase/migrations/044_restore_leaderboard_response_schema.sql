-- ====================================
-- Migration 044: Restore the exact 035 leaderboard response schema
--
-- Migration 042 rewrote get_points_leaderboard to rank by the cached
-- real_points balance (the actual bug fix), but it also changed the
-- RESPONSE SHAPE:
--   - added 'total_points', 'current_streak', 'longest_streak' and
--     'tier_emoji' to every entry. The client renders tier_emoji and a
--     streak fire icon when present, so emojis reappeared in the
--     leaderboard UI that were not there before.
--   - dropped 'banner_url', 'banner_theme' and 'profile_effect_url'
--     (present since migration 035). Migration 043 restored the two
--     banner columns but kept the added fields and still missed
--     profile_effect_url.
--
-- This migration re-applies get_points_leaderboard with the EXACT
-- migration 035 output schema, nothing more, nothing less:
--   rank, user_id, username, avatar, avatar_decoration, nameplate_theme,
--   banner_theme, banner_url, profile_effect_url, client_type, points,
--   real_points, role_bonus, is_infinite, tier, role, comment_count
--
-- The underlying points fix is KEPT: entries are ranked by the cached
-- user_points.real_points (activity earned minus points spent), with the
-- same ordering as the 'rank' field inside get_user_points
-- (real_points DESC, total_points DESC, comment_count DESC), so the
-- leaderboard position and the user's own rank never disagree.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- ====================================

CREATE OR REPLACE FUNCTION public.get_points_leaderboard(
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
            cu.banner_theme,
            cu.banner_url,
            cu.profile_effect_url,
            cu.commentum_client_type                            AS client_type,
            cu.commentum_user_comment_count                     AS comment_count,
            -- REAL POINTS from the cache: activity earned minus points
            -- spent. Same number the balance endpoint reports.
            GREATEST(COALESCE(up.real_points, 0), 0)            AS real_points,
            COALESCE(up.total_points, 0)                        AS total_points,
            get_user_role(cu.commentum_client_type, cu.commentum_user_id) AS resolved_role
        FROM public.commentum_users cu
        LEFT JOIN public.user_points up
            ON up.user_id = cu.commentum_user_id
            AND up.client_type = cu.commentum_client_type
        WHERE cu.commentum_user_active = true
        AND cu.commentum_user_banned = false
        AND cu.commentum_user_shadow_banned = false
        AND (p_client_type IS NULL OR cu.commentum_client_type = p_client_type)
    ),
    ranked_users AS (
        SELECT
            -- Same ordering as the 'rank' field in get_user_points
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
                'banner_theme', banner_theme,
                'banner_url', banner_url,
                'profile_effect_url', profile_effect_url,
                'client_type', client_type,
                'points', real_points,
                'real_points', real_points,
                'role_bonus', role_bonus,
                'is_infinite', is_infinite,
                'tier', tier,
                'role', resolved_role,
                'comment_count', comment_count
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

GRANT EXECUTE ON FUNCTION public.get_points_leaderboard(TEXT, INTEGER, INTEGER) TO service_role, anon, authenticated;
