-- ===================================================
-- MIGRATION 032: USER TABLE AS ROLE SOURCE OF TRUTH
-- Backfills commentum_users.commentum_user_role from the config
-- role lists (hierarchy: owner > app_owner > super_admin >
-- admin > moderator > user). Config values may store ids as
-- JSON strings or numbers, so both forms are matched.
-- After this, getUserRole() reads the table first with the
-- config lists as fallback, and every role-change path writes
-- the table + backfills comments.user_role.
-- ===================================================

-- Helper: does a config JSON array contain a user id (string or number form)?
CREATE OR REPLACE FUNCTION _config_has_user(p_key TEXT, p_user_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    raw TEXT;
BEGIN
    SELECT value INTO raw FROM config WHERE key = p_key;
    IF raw IS NULL THEN
        RETURN false;
    END IF;
    RETURN (
        raw::jsonb @> to_jsonb(p_user_id::TEXT)
        OR raw::jsonb @> to_jsonb(CASE WHEN p_user_id ~ '^[0-9]+$' THEN p_user_id::BIGINT ELSE NULL END)
    );
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Backfill: highest config role wins; only touch rows whose stored
-- role disagrees (or is null) so existing correct rows are untouched.
UPDATE commentum_users cu
SET commentum_user_role = ranked.role,
    updated_at = NOW()
FROM (
    SELECT
        commentum_user_id,
        commentum_client_type,
        CASE
            WHEN _config_has_user('owner_users', commentum_user_id) THEN 'owner'
            WHEN _config_has_user('app_owner_users', commentum_user_id) THEN 'app_owner'
            WHEN _config_has_user('super_admin_users', commentum_user_id) THEN 'super_admin'
            WHEN _config_has_user('admin_users', commentum_user_id) THEN 'admin'
            WHEN _config_has_user('moderator_users', commentum_user_id) THEN 'moderator'
            ELSE 'user'
        END AS role
    FROM commentum_users
) ranked
WHERE cu.commentum_user_id = ranked.commentum_user_id
AND cu.commentum_client_type = ranked.commentum_client_type
AND (
    cu.commentum_user_role IS NULL
    OR cu.commentum_user_role IS DISTINCT FROM ranked.role
);

DROP FUNCTION IF EXISTS _config_has_user(TEXT, TEXT);
