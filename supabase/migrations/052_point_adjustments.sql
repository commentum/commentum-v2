-- ====================================
-- Migration 052: Manual point adjustments (/points_give, /points_deduct, /points_undo)
--
-- Adjustments live in their own append-only table and are added AFTER the normal
-- 0-floor in get_user_points(), so:
--   * a deduction can take a balance below zero
--   * it survives every points refresh / recompute (nothing is overwritten)
--   * linked accounts (AniList / MAL / Simkl) share the same adjustments
--   * undo = an offsetting row, the audit history is never erased
-- ====================================

CREATE TABLE IF NOT EXISTS public.user_point_adjustments (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_type TEXT        NOT NULL,
    user_id     TEXT        NOT NULL,
    points      BIGINT      NOT NULL CHECK (points <> 0),
    reason      TEXT        NOT NULL,
    created_by  TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_point_adjustments_user
    ON public.user_point_adjustments (client_type, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_point_adjustments_reason
    ON public.user_point_adjustments (reason);

-- Only the service role (edge functions) may touch it.
ALTER TABLE public.user_point_adjustments ENABLE ROW LEVEL SECURITY;

-- ====================================
-- Wrap get_user_points: keep the old calculation as get_user_points_base and
-- layer the adjustments on top. refresh_user_points() calls get_user_points(), so
-- the stored user_points / leaderboard values include adjustments automatically.
-- ====================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_user_points_base'
    ) THEN
        ALTER FUNCTION public.get_user_points(TEXT, TEXT) RENAME TO get_user_points_base;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_user_points(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    base        JSONB;
    rec         commentum_users;
    v_norm      TEXT;
    v_rec_type  TEXT;
    v_adj       BIGINT;
    v_points    BIGINT;
    v_real      BIGINT;
    v_infinite  BOOLEAN;
    v_tier      TEXT;
    v_next      INTEGER;
BEGIN
    base := get_user_points_base(p_client_type, p_user_id);
    IF base IS NULL THEN
        RETURN base;
    END IF;

    v_norm := LOWER(TRIM(p_client_type));
    IF v_norm = 'myanimelist' THEN v_norm := 'mal'; END IF;

    rec := get_unified_user_record(v_norm, p_user_id);
    v_rec_type := LOWER(COALESCE(rec.commentum_client_type, ''));
    IF v_rec_type = 'myanimelist' THEN v_rec_type := 'mal'; END IF;

    SELECT COALESCE(SUM(a.points), 0) INTO v_adj
    FROM user_point_adjustments a
    WHERE (a.client_type = v_norm AND a.user_id = p_user_id)
       OR (rec.id IS NOT NULL AND a.client_type = v_rec_type AND a.user_id = rec.commentum_user_id)
       OR (rec.linked_anilist_id IS NOT NULL AND a.client_type = 'anilist' AND a.user_id = rec.linked_anilist_id)
       OR (rec.linked_mal_id     IS NOT NULL AND a.client_type = 'mal'     AND a.user_id = rec.linked_mal_id)
       OR (rec.linked_simkl_id   IS NOT NULL AND a.client_type = 'simkl'   AND a.user_id = rec.linked_simkl_id);

    IF v_adj = 0 THEN
        RETURN base;
    END IF;

    v_infinite := COALESCE((base->>'is_infinite')::BOOLEAN, FALSE);
    v_points   := COALESCE((base->>'points')::BIGINT, 0) + v_adj;      -- no floor: may go below zero
    v_real     := COALESCE((base->>'real_points')::BIGINT, 0) + v_adj;

    v_tier := CASE
        WHEN v_infinite        THEN 'elite'
        WHEN v_points >= 5000  THEN 'elite'
        WHEN v_points >= 1500  THEN 'veteran'
        WHEN v_points >= 500   THEN 'active'
        WHEN v_points >= 100   THEN 'regular'
        ELSE 'newcomer'
    END;

    v_next := CASE
        WHEN v_infinite        THEN NULL
        WHEN v_points < 100    THEN 100
        WHEN v_points < 500    THEN 500
        WHEN v_points < 1500   THEN 1500
        WHEN v_points < 5000   THEN 5000
        ELSE NULL
    END;

    RETURN base || jsonb_build_object(
        'points', v_points,
        'real_points', v_real,
        'display_points', CASE WHEN v_infinite THEN '∞' ELSE v_points::TEXT END,
        'tier', v_tier,
        'next_tier_at', v_next,
        'points_to_next_tier', CASE WHEN v_next IS NOT NULL THEN v_next - v_points ELSE NULL END,
        'adjustments', v_adj,
        'breakdown', COALESCE(base->'breakdown', '{}'::JSONB) || jsonb_build_object('adjustments', v_adj)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- adjust_user_points: record one adjustment, refresh the stored cache and return
-- the new balance (same JSON shape as get_user_points plus adjustment_id).
-- ====================================

CREATE OR REPLACE FUNCTION public.adjust_user_points(
    p_client_type TEXT,
    p_user_id TEXT,
    p_points BIGINT,
    p_reason TEXT,
    p_by TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_norm   TEXT;
    v_id     UUID;
    v_result JSONB;
BEGIN
    IF p_points IS NULL OR p_points = 0 THEN
        RAISE EXCEPTION 'points must be a non-zero number';
    END IF;

    v_norm := LOWER(TRIM(p_client_type));
    IF v_norm = 'myanimelist' THEN v_norm := 'mal'; END IF;

    INSERT INTO user_point_adjustments (client_type, user_id, points, reason, created_by)
    VALUES (v_norm, p_user_id, p_points, COALESCE(NULLIF(TRIM(p_reason), ''), 'no reason'), COALESCE(p_by, 'unknown'))
    RETURNING id INTO v_id;

    PERFORM refresh_user_points(v_norm, p_user_id);
    v_result := get_user_points(v_norm, p_user_id);

    RETURN COALESCE(v_result, '{}'::JSONB) || jsonb_build_object('adjustment_id', v_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.adjust_user_points(TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
