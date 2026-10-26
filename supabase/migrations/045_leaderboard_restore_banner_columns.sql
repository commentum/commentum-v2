-- ====================================
-- Migration 045: Restore banner columns in get_points_leaderboard
--
-- Migration 044 rewrote get_points_leaderboard to rank by the cached
-- real_points balance but accidentally dropped the banner_url and
-- banner_theme output columns that existed since migration 035 (and are
-- documented in docs/CUSTOMIZATIONS_API.md). Consumers reading equipped
-- banners from the leaderboard (client profiles, Discord bot) stopped
-- receiving them.
--
-- This migration re-applies the exact 044 definition with the two
-- missing columns added to the entries CTE and the JSON output.
-- Idempotent: CREATE OR REPLACE FUNCTION.
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
            cu.banner_url,
            cu.banner_theme,
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
                'banner_url', banner_url,
                'banner_theme', banner_theme,
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
