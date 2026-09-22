-- =======================================================
-- MIGRATION 038: FIX ADD_USER_WARNING FUNCTION
-- =======================================================
-- Fixes "column commentum_user_warnings does not exist" error
-- when issuing warnings from Discord bot or API.
-- In PL/pgSQL, commentum_user_warnings was referenced inside
-- jsonb_build_object without being selected into a variable first.
-- =======================================================

CREATE OR REPLACE FUNCTION add_user_warning(
    p_client_type TEXT,
    p_user_id TEXT,
    p_warning_reason TEXT,
    p_warned_by TEXT
)
RETURNS INTEGER AS $$
DECLARE
    new_warning_count INTEGER;
    warning_details JSONB;
    current_warnings INTEGER := 0;
BEGIN
    -- Get current warning details and current count
    SELECT 
        commentum_user_warning_details::jsonb,
        COALESCE(commentum_user_warnings, 0)
    INTO 
        warning_details,
        current_warnings
    FROM commentum_users 
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id;
    
    -- Add new warning to details
    IF warning_details IS NULL THEN
        warning_details = '[]'::jsonb;
    END IF;
    
    warning_details = warning_details || jsonb_build_object(
        'warning_id', extract(epoch from now())::text,
        'reason', p_warning_reason,
        'warned_by', p_warned_by,
        'warned_at', NOW(),
        'warning_number', current_warnings + 1
    );
    
    -- Update user with new warning AND moderation tracking
    UPDATE commentum_users SET
        commentum_user_warnings = current_warnings + 1,
        commentum_user_warning_details = warning_details::text,
        commentum_user_last_warning_at = NOW(),
        commentum_user_last_warning_by = p_warned_by,
        commentum_user_last_warning_reason = p_warning_reason,
        commentum_user_moderated_count = commentum_user_moderated_count + 1,
        commentum_user_last_moderated_at = NOW(),
        commentum_user_last_moderated_by = p_warned_by,
        commentum_user_last_moderation_action = 'warn',
        commentum_user_last_moderation_reason = p_warning_reason,
        updated_at = NOW()
    WHERE commentum_client_type = p_client_type AND commentum_user_id = p_user_id
    RETURNING commentum_user_warnings INTO new_warning_count;
    
    RETURN new_warning_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
