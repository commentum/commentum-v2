-- ====================================
-- Migration 049: Idempotent point spending (decrease)
--
-- Mirrors user_ad_rewards (earn) with user_point_spends (spend).
-- The same ref_id can only be spent once per master user (all linked accounts).
-- Wraps spend_user_points() so balance checks + linked-account sync are reused.
-- ====================================

CREATE TABLE IF NOT EXISTS user_point_spends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    client_type TEXT NOT NULL,
    master_user_id INTEGER,
    ref_id TEXT NOT NULL,
    points INTEGER NOT NULL CHECK (points > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_point_spends_user ON user_point_spends(user_id, client_type);
CREATE INDEX IF NOT EXISTS idx_user_point_spends_master ON user_point_spends(master_user_id) WHERE master_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_point_spends_ref ON user_point_spends(ref_id);

CREATE OR REPLACE FUNCTION spend_points_once(
    p_client_type TEXT,
    p_user_id TEXT,
    p_ref_id TEXT,
    p_amount INTEGER
)
RETURNS JSONB AS $$
DECLARE
    v_norm_client TEXT;
    v_master commentum_users;
    v_result JSONB;
BEGIN
    IF p_ref_id IS NULL OR TRIM(p_ref_id) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'ref_id_required');
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_amount');
    END IF;

    v_norm_client := LOWER(TRIM(p_client_type));
    IF v_norm_client = 'myanimelist' THEN v_norm_client := 'mal'; END IF;

    v_master := get_unified_user_record(v_norm_client, p_user_id);

    -- Serialize concurrent calls with the same ref for this user
    PERFORM pg_advisory_xact_lock(hashtext(COALESCE(v_master.id::TEXT, v_norm_client || ':' || p_user_id) || ':' || p_ref_id));

    IF EXISTS (
        SELECT 1 FROM user_point_spends
        WHERE ref_id = p_ref_id
          AND (
              (v_master.id IS NOT NULL AND master_user_id = v_master.id)
              OR (user_id = p_user_id AND client_type = v_norm_client)
          )
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'ad_already_claimed',
            'message', 'Points have already been claimed for this ad'
        );
    END IF;

    v_result := spend_user_points(v_norm_client, p_user_id, p_amount);

    IF COALESCE((v_result->>'success')::BOOLEAN, false) THEN
        INSERT INTO user_point_spends (user_id, client_type, master_user_id, ref_id, points)
        VALUES (p_user_id, v_norm_client, v_master.id, p_ref_id, p_amount);
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Service role only: spending must never be callable with the public anon key
REVOKE ALL ON FUNCTION public.spend_points_once(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_points_once(TEXT, TEXT, TEXT, INTEGER) TO service_role;
