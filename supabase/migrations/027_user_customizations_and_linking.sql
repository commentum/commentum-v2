-- =======================================================
-- MIGRATION 027: USER CUSTOMIZATIONS AND ACCOUNT LINKING
-- Enables Discord avatar decorations, anime banners,
-- and multi-service account linking (AniList, MAL, Simkl)
-- =======================================================

-- 1. Add customization columns to commentum_users
ALTER TABLE commentum_users 
ADD COLUMN IF NOT EXISTS avatar_decoration TEXT,
ADD COLUMN IF NOT EXISTS banner_url TEXT,
ADD COLUMN IF NOT EXISTS banner_theme TEXT,
ADD COLUMN IF NOT EXISTS nameplate_theme TEXT;

-- 2. Add linked account columns to commentum_users
ALTER TABLE commentum_users
ADD COLUMN IF NOT EXISTS linked_anilist_id TEXT,
ADD COLUMN IF NOT EXISTS linked_anilist_username TEXT,
ADD COLUMN IF NOT EXISTS linked_mal_id TEXT,
ADD COLUMN IF NOT EXISTS linked_mal_username TEXT,
ADD COLUMN IF NOT EXISTS linked_simkl_id TEXT,
ADD COLUMN IF NOT EXISTS linked_simkl_username TEXT;

-- 3. Add btree indexes for fast unified account lookups
CREATE INDEX IF NOT EXISTS idx_commentum_users_linked_anilist 
ON commentum_users(linked_anilist_id) 
WHERE linked_anilist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commentum_users_linked_mal 
ON commentum_users(linked_mal_id) 
WHERE linked_mal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commentum_users_linked_simkl 
ON commentum_users(linked_simkl_id) 
WHERE linked_simkl_id IS NOT NULL;

-- 4. Add decoration and banner columns to comments table
ALTER TABLE comments
ADD COLUMN IF NOT EXISTS avatar_decoration TEXT,
ADD COLUMN IF NOT EXISTS banner_url TEXT;

-- 5. Helper RPC to fetch customizations and linked accounts in batch for comment lists
CREATE OR REPLACE FUNCTION get_batch_user_customizations(
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
    FROM commentum_users cu
    WHERE cu.commentum_client_type = p_client_type
      AND cu.commentum_user_id = ANY(p_user_ids);

    RETURN result;
END;
$$;

-- Grant execution to service_role and anon/authenticated
GRANT EXECUTE ON FUNCTION get_batch_user_customizations(TEXT, TEXT[]) TO service_role, anon, authenticated;
