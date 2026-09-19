-- ===================================================
-- MIGRATION 033: SYNC comments.user_role FROM commentum_users
--
-- commentum_users is the role source of truth (032). Badges render
-- from comments.user_role, so every role change made in the USER
-- TABLE must propagate to all of that user's comments — regardless
-- of which code path performed the change (users edge function,
-- discord bot, dashboard, manual SQL).
--
-- The edge function and discord promote/demote already backfill
-- comments manually; this trigger covers every other path and makes
-- the guarantee structural instead of per-call-site.
-- ===================================================

-- 1. Trigger function: fires only when the role actually changed.
CREATE OR REPLACE FUNCTION sync_comments_user_role_on_change()
RETURNS TRIGGER AS $$
DECLARE
    v_badge_role TEXT;
BEGIN
    -- No-op when the role didn't actually change (case-insensitive)
    IF lower(COALESCE(NEW.commentum_user_role, '')) =
       lower(COALESCE(OLD.commentum_user_role, '')) THEN
        RETURN NEW;
    END IF;

    -- Map to the badge roles allowed by comments_user_role_check (028).
    -- Unknown/NULL values fall back to 'user' so this UPDATE can never
    -- violate the check constraint and abort the role change itself.
    v_badge_role := CASE
        WHEN lower(COALESCE(NEW.commentum_user_role, '')) IN
             ('user','moderator','admin','super_admin','app_owner','owner')
        THEN lower(NEW.commentum_user_role)
        ELSE 'user'
    END;

    -- Match on (user_id, client_type): the same numeric id in different
    -- clients (anilist 123 vs mal 123) is a DIFFERENT person.
    UPDATE comments
    SET user_role = v_badge_role
    WHERE user_id = NEW.commentum_user_id
      AND client_type = NEW.commentum_client_type
      AND user_role IS DISTINCT FROM v_badge_role;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_comments_user_role ON commentum_users;
CREATE TRIGGER trg_sync_comments_user_role
    AFTER UPDATE OF commentum_user_role ON commentum_users
    FOR EACH ROW
    EXECUTE FUNCTION sync_comments_user_role_on_change();

-- 2. One-time drift repair: bring every existing comment in line with
-- the user table (comments whose user has no table row are untouched).
UPDATE comments c
SET user_role = m.badge_role
FROM (
    SELECT
        commentum_user_id,
        commentum_client_type,
        CASE
            WHEN lower(COALESCE(commentum_user_role, '')) IN
                 ('user','moderator','admin','super_admin','app_owner','owner')
            THEN lower(commentum_user_role)
            ELSE 'user'
        END AS badge_role
    FROM commentum_users
) m
WHERE c.user_id = m.commentum_user_id
  AND c.client_type = m.commentum_client_type
  AND c.user_role IS DISTINCT FROM m.badge_role;
