-- ===================================================
-- 030: get_points_leaderboard now returns avatar_decoration
-- The leaderboard RPC never selected commentum_users.avatar_decoration
-- (added in 027), so client AnymeXDecoratedAvatar got null decorationUrl
-- and leaderboard entries rendered a plain bordered avatar.
-- Signature unchanged -> CREATE OR REPLACE keeps existing grants.
-- ===================================================

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

    WITH user_points AS (
        SELECT
            cu.commentum_user_id,
            cu.commentum_username,
            cu.commentum_user_avatar,
            cu.avatar_decoration,
            cu.commentum_client_type,
            cu.commentum_user_comment_count,
            cu.commentum_user_vote_count,
            cu.commentum_user_warnings,
            cu.commentum_user_banned,
            cu.commentum_user_last_comment_at,
            cu.commentum_user_role,
            -- REAL POINTS: strictly from activity, NO role bonus!
            GREATEST(0, (
                (cu.commentum_user_comment_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_comment'), 5)) +
                (cu.commentum_user_vote_count * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_per_vote_cast'), 1)) -
                (cu.commentum_user_warnings * COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_warning'), 20)) -
                (CASE WHEN cu.commentum_user_banned THEN COALESCE((SELECT value::INTEGER FROM config WHERE key = 'points_penalty_ban'), 100) ELSE 0 END)
            )) as real_points,
            -- Resolved role
            get_user_role(cu.commentum_client_type, cu.commentum_user_id) as resolved_role
        FROM commentum_users cu
        WHERE cu.commentum_user_active = true
        AND cu.commentum_user_banned = false
        AND cu.commentum_user_shadow_banned = false
        AND (p_client_type IS NULL OR cu.commentum_client_type = p_client_type)
    ),
    ranked_users AS (
        SELECT
            -- RANKED STRICTLY BY REAL POINTS!
            ROW_NUMBER() OVER (ORDER BY real_points DESC, commentum_user_comment_count DESC) as rank,
            commentum_user_id,
            commentum_username,
            commentum_user_avatar,
            avatar_decoration,
            commentum_client_type,
            commentum_user_comment_count,
            real_points,
            resolved_role,
            get_role_bonus(resolved_role) as role_bonus,
            (resolved_role IN ('owner', 'app_owner')) as is_infinite,
            CASE
                WHEN real_points >= 5000 THEN 'elite'
                WHEN real_points >= 1500 THEN 'veteran'
                WHEN real_points >= 500  THEN 'active'
                WHEN real_points >= 100  THEN 'regular'
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
                'avatar_decoration', avatar_decoration,
                'client_type', commentum_client_type,
                'points', real_points,
                'real_points', real_points,
                'role_bonus', role_bonus,
                'is_infinite', is_infinite,
                'tier', tier,
                'role', resolved_role,
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
