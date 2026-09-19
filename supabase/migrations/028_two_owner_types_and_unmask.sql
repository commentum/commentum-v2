-- =======================================================
-- MIGRATION 028: TWO OWNER TYPES AND UNMASK OWNER ROLE
-- Enables 'owner' (Commentum Owner) and 'app_owner' (App Creator)
-- Unmasks owner in API responses and updates role constraints
-- =======================================================

-- 1. Insert 'app_owner_users' configuration key if not present.
-- NOTE: DO NOTHING (never reset) — ON CONFLICT DO UPDATE used to wipe
-- subsequently added app owners on every deploy replay.
INSERT INTO config (key, value)
VALUES ('app_owner_users', '["5965508"]')
ON CONFLICT (key) DO NOTHING;

-- 2. Update comments table constraint for user_role
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_user_role_check;
ALTER TABLE comments ADD CONSTRAINT comments_user_role_check
CHECK (user_role IN ('user', 'moderator', 'admin', 'super_admin', 'app_owner', 'owner'));

-- 3. Update commentum_users table constraint for commentum_user_role
ALTER TABLE commentum_users DROP CONSTRAINT IF EXISTS commentum_users_commentum_user_role_check;
ALTER TABLE commentum_users ADD CONSTRAINT commentum_users_commentum_user_role_check
CHECK (commentum_user_role IN ('user', 'moderator', 'admin', 'super_admin', 'app_owner', 'owner'));

-- 4. Update dashboard_users constraint if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'dashboard_users'
    ) THEN
        ALTER TABLE dashboard_users DROP CONSTRAINT IF EXISTS valid_dashboard_role;
        ALTER TABLE dashboard_users ADD CONSTRAINT valid_dashboard_role
        CHECK (role IN ('owner', 'app_owner', 'super_admin', 'admin', 'moderator'));
    END IF;
END $$;

-- 5. Update PostgreSQL function get_user_role to recognize both owner types
CREATE OR REPLACE FUNCTION get_user_role(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS TEXT AS $$
DECLARE
    owner_list TEXT;
    app_owner_list TEXT;
    v_role TEXT;
BEGIN
    -- Check Commentum owner first (highest priority)
    SELECT value INTO owner_list FROM config WHERE key = 'owner_users';
    IF owner_list IS NOT NULL AND owner_list::jsonb ? p_user_id THEN
        RETURN 'owner';
    END IF;

    -- Check App owner (App Creator)
    SELECT value INTO app_owner_list FROM config WHERE key = 'app_owner_users';
    IF app_owner_list IS NOT NULL AND app_owner_list::jsonb ? p_user_id THEN
        RETURN 'app_owner';
    END IF;

    -- Fall back to cached role from commentum_users
    SELECT commentum_user_role INTO v_role
    FROM commentum_users
    WHERE commentum_client_type = p_client_type
    AND commentum_user_id = p_user_id;

    RETURN COALESCE(v_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Update user 5965508 existing comments and commentum_users records
UPDATE commentum_users
SET commentum_user_role = 'app_owner'
WHERE commentum_user_id = '5965508';

UPDATE comments
SET user_role = 'app_owner'
WHERE user_id = '5965508';
