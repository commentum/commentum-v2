-- =======================================================
-- MIGRATION 035: CUSTOMIZATIONS CATALOG & SYSTEM LINKING
-- Central catalog for avatar decorations, nameplates, 
-- profile effects, and banners.
-- Links customizations to comment threads, leaderboard,
-- and user inventory/points.
-- =======================================================

-- 1. Create central customizations_catalog table
CREATE TABLE IF NOT EXISTS public.customizations_catalog (
    id TEXT PRIMARY KEY,                             -- Unique identifier / asset ID
    type VARCHAR(30) NOT NULL,                       -- 'decoration', 'banner', 'nameplate', 'effect', 'frame'
    title TEXT NOT NULL,                             -- Display title
    category TEXT NOT NULL,                          -- Category (e.g., 'Fall Foragers', 'Mermaid Melodies')
    url TEXT NOT NULL,                               -- Discord CDN URL
    asset_id TEXT,                                   -- Hash / asset reference
    description TEXT,                                -- Accessibility / description
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,     -- Extra attributes (palette, effects array, webm_url, static_url)
    points_required INTEGER NOT NULL DEFAULT 0,      -- 0 = free/unlocked, >0 = unlockable with points
    is_active BOOLEAN NOT NULL DEFAULT TRUE,          -- Visibility toggle for devs
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes for efficient catalog querying
CREATE INDEX IF NOT EXISTS idx_customizations_type_active 
ON public.customizations_catalog(type, is_active);

CREATE INDEX IF NOT EXISTS idx_customizations_category 
ON public.customizations_catalog(category);

CREATE INDEX IF NOT EXISTS idx_customizations_points 
ON public.customizations_catalog(points_required);

-- 3. Row Level Security for catalog
ALTER TABLE public.customizations_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read for active customizations"
ON public.customizations_catalog
FOR SELECT
USING (is_active = true);

CREATE POLICY "Allow service_role full management on customizations"
ON public.customizations_catalog
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

GRANT SELECT ON public.customizations_catalog TO anon, authenticated, service_role;
GRANT ALL ON public.customizations_catalog TO service_role;

-- 4. Add inventory and profile effect tracking to commentum_users
ALTER TABLE public.commentum_users
ADD COLUMN IF NOT EXISTS unlocked_customizations TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS profile_effect_url TEXT;

-- 5. Update get_batch_user_customizations to include nameplate_theme and profile_effect_url
CREATE OR REPLACE FUNCTION public.get_batch_user_customizations(
    p_client_type TEXT,
    p_user_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT COALESCE(
        jsonb_object_agg(
            cu.commentum_user_id,
            jsonb_build_object(
                'avatar_decoration', cu.avatar_decoration,
                'banner_url', cu.banner_url,
                'banner_theme', cu.banner_theme,
                'nameplate_theme', cu.nameplate_theme,
                'profile_effect_url', cu.profile_effect_url,
                'unlocked_customizations', COALESCE(cu.unlocked_customizations, '{}'::text[]),
                'linked_accounts', jsonb_build_object(
                    'anilist', CASE 
                        WHEN cu.linked_anilist_id IS NOT NULL THEN 
                            jsonb_build_object('id', cu.linked_anilist_id, 'username', cu.linked_anilist_username)
                        WHEN cu.commentum_client_type = 'anilist' THEN
                            jsonb_build_object('id', cu.commentum_user_id, 'username', cu.commentum_username)
                        ELSE NULL 
                    END,
                    'mal', CASE 
                        WHEN cu.linked_mal_id IS NOT NULL THEN 
                            jsonb_build_object('id', cu.linked_mal_id, 'username', cu.linked_mal_username)
                        WHEN cu.commentum_client_type IN ('mal', 'myanimelist') THEN
                            jsonb_build_object('id', cu.commentum_user_id, 'username', cu.commentum_username)
                        ELSE NULL 
                    END,
                    'simkl', CASE 
                        WHEN cu.linked_simkl_id IS NOT NULL THEN 
                            jsonb_build_object('id', cu.linked_simkl_id, 'username', cu.linked_simkl_username)
                        WHEN cu.commentum_client_type = 'simkl' THEN
                            jsonb_build_object('id', cu.commentum_user_id, 'username', cu.commentum_username)
                        ELSE NULL 
                    END
                )
            )
        ),
        '{}'::jsonb
    ) INTO result
    FROM public.commentum_users cu
    WHERE cu.commentum_client_type = p_client_type
      AND cu.commentum_user_id = ANY(p_user_ids);

    RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_batch_user_customizations(TEXT, TEXT[]) TO service_role, anon, authenticated;

-- 6. Update get_points_leaderboard to include nameplate_theme, banner_theme, and banner_url
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

    WITH user_points AS (
        SELECT
            cu.commentum_user_id,
            cu.commentum_username,
            cu.commentum_user_avatar,
            cu.avatar_decoration,
            cu.nameplate_theme,
            cu.banner_theme,
            cu.banner_url,
            cu.profile_effect_url,
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
        FROM public.commentum_users cu
        WHERE cu.commentum_user_active = true
        AND cu.commentum_user_banned = false
        AND cu.commentum_user_shadow_banned = false
        AND (p_client_type IS NULL OR cu.commentum_client_type = p_client_type)
    ),
    ranked_users AS (
        SELECT
            ROW_NUMBER() OVER (ORDER BY real_points DESC, commentum_user_comment_count DESC) as rank,
            commentum_user_id,
            commentum_username,
            commentum_user_avatar,
            avatar_decoration,
            nameplate_theme,
            banner_theme,
            banner_url,
            profile_effect_url,
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
                'nameplate_theme', nameplate_theme,
                'banner_theme', banner_theme,
                'banner_url', banner_url,
                'profile_effect_url', profile_effect_url,
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

GRANT EXECUTE ON FUNCTION public.get_points_leaderboard(TEXT, INTEGER, INTEGER) TO service_role, anon, authenticated;
