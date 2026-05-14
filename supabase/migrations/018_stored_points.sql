-- ====================================
-- STORED POINTS SYSTEM
-- Caches user points in a table for fast reads
-- Triggers refresh on comment/vote/moderation changes
-- ====================================

-- ====================================
-- TABLE: user_points (cache layer)
-- ====================================

CREATE TABLE IF NOT EXISTS user_points (
    user_id TEXT NOT NULL,
    client_type TEXT NOT NULL DEFAULT 'anilist',
    total_points BIGINT NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'newcomer',
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_activity_date DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, client_type)
);

CREATE INDEX IF NOT EXISTS idx_user_points_tier
    ON user_points(client_type, tier);

CREATE INDEX IF NOT EXISTS idx_user_points_points
    ON user_points(client_type, total_points DESC);

-- ====================================
-- FUNCTION: refresh_user_points
-- Full recalculation for one user, upserts into user_points table
-- Called by triggers AND available as manual refresh endpoint
-- ====================================

CREATE OR REPLACE FUNCTION refresh_user_points(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS VOID AS $$
DECLARE
    calc_result JSONB;
    v_tier TEXT;
    v_streak INTEGER;
BEGIN
    calc_result := get_user_points(p_client_type, p_user_id);

    v_tier := COALESCE(calc_result->>'tier', 'newcomer');
    v_streak := COALESCE((calc_result->>'streak')::INTEGER, 0);

    INSERT INTO user_points (user_id, client_type, total_points, tier, current_streak, updated_at)
    VALUES (
        p_user_id,
        p_client_type,
        COALESCE((calc_result->>'points')::BIGINT, 0),
        v_tier,
        v_streak,
        NOW()
    )
    ON CONFLICT (user_id, client_type)
    DO UPDATE SET
        total_points = COALESCE((calc_result->>'points')::BIGINT, 0),
        tier = v_tier,
        current_streak = v_streak,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- FUNCTION: refresh_all_user_points
-- Bulk refresh for all users (admin/maintenance)
-- ====================================

CREATE OR REPLACE FUNCTION refresh_all_user_points(
    p_client_type TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT DISTINCT commentum_user_id, commentum_client_type
        FROM commentum_users
        WHERE commentum_user_active = true
        AND (p_client_type IS NULL OR commentum_client_type = p_client_type)
    LOOP
        PERFORM refresh_user_points(rec.commentum_client_type, rec.commentum_user_id);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- TRIGGER: Refresh points on comment insert
-- ====================================

CREATE OR REPLACE FUNCTION trg_comment_points_insert()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM refresh_user_points(NEW.client_type, NEW.user_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_comment_points_insert ON comments;
CREATE TRIGGER trigger_comment_points_insert
    AFTER INSERT ON comments
    FOR EACH ROW
    EXECUTE FUNCTION trg_comment_points_insert();

-- ====================================
-- TRIGGER: Refresh points on comment update
-- Handles: pin, unpin, soft delete, vote changes
-- ====================================

CREATE OR REPLACE FUNCTION trg_comment_points_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.pinned != NEW.pinned
       OR OLD.deleted != NEW.deleted
       OR OLD.user_id != NEW.user_id
       OR OLD.upvotes != NEW.upvotes
       OR OLD.downvotes != NEW.downvotes
       OR OLD.user_votes IS DISTINCT FROM NEW.user_votes THEN
        PERFORM refresh_user_points(NEW.client_type, NEW.user_id);
        IF OLD.user_id != NEW.user_id THEN
            PERFORM refresh_user_points(OLD.client_type, OLD.user_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_comment_points_update ON comments;
CREATE TRIGGER trigger_comment_points_update
    AFTER UPDATE ON comments
    FOR EACH ROW
    EXECUTE FUNCTION trg_comment_points_update();

-- ====================================
-- TRIGGER: Refresh points on comment delete
-- ====================================

CREATE OR REPLACE FUNCTION trg_comment_points_delete()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM refresh_user_points(OLD.client_type, OLD.user_id);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_comment_points_delete ON comments;
CREATE TRIGGER trigger_comment_points_delete
    AFTER DELETE ON comments
    FOR EACH ROW
    EXECUTE FUNCTION trg_comment_points_delete();

-- ====================================
-- TRIGGER: Refresh points on user role/status change
-- (handles: warnings, bans, role changes)
-- ====================================

CREATE OR REPLACE FUNCTION trg_user_points_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.commentum_user_warnings != NEW.commentum_user_warnings
       OR OLD.commentum_user_banned != NEW.commentum_user_banned
       OR OLD.commentum_user_role != NEW.commentum_user_role
       OR OLD.commentum_user_vote_count != NEW.commentum_user_vote_count THEN
        PERFORM refresh_user_points(NEW.commentum_client_type, NEW.commentum_user_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_user_points_update ON commentum_users;
CREATE TRIGGER trigger_user_points_update
    AFTER UPDATE ON commentum_users
    FOR EACH ROW
    EXECUTE FUNCTION trg_user_points_update();

-- ====================================
-- FUNCTION: get_user_points_cached
-- Fast lookup from stored table, falls back to full calc if missing
-- ====================================

CREATE OR REPLACE FUNCTION get_user_points_cached(
    p_client_type TEXT,
    p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
    cached JSONB;
BEGIN
    SELECT jsonb_build_object(
        'user_id', user_id,
        'total_points', total_points,
        'tier', tier,
        'tier_emoji', CASE tier
            WHEN 'elite' THEN '💎'
            WHEN 'veteran' THEN '⭐'
            WHEN 'active' THEN '🌸'
            WHEN 'regular' THEN '🍃'
            ELSE '🌱'
        END,
        'current_streak', current_streak,
        'longest_streak', longest_streak,
        'role', get_user_role(p_client_type, p_user_id),
        'updated_at', updated_at
    ) INTO cached
    FROM user_points
    WHERE user_id = p_user_id AND client_type = p_client_type;

    IF cached IS NOT NULL THEN
        RETURN cached;
    END IF;

    PERFORM refresh_user_points(p_client_type, p_user_id);

    SELECT jsonb_build_object(
        'user_id', user_id,
        'total_points', total_points,
        'tier', tier,
        'tier_emoji', CASE tier
            WHEN 'elite' THEN '💎'
            WHEN 'veteran' THEN '⭐'
            WHEN 'active' THEN '🌸'
            WHEN 'regular' THEN '🍃'
            ELSE '🌱'
        END,
        'current_streak', current_streak,
        'longest_streak', longest_streak,
        'role', get_user_role(p_client_type, p_user_id),
        'updated_at', updated_at
    ) INTO cached
    FROM user_points
    WHERE user_id = p_user_id AND client_type = p_client_type;

    RETURN COALESCE(cached, jsonb_build_object(
        'user_id', p_user_id,
        'total_points', 0,
        'tier', 'newcomer',
        'tier_emoji', '🌱',
        'current_streak', 0,
        'longest_streak', 0,
        'role', 'user'
    ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ====================================
-- FUNCTION: get_batch_user_points_cached
-- Fast batch lookup for embedding in comment lists
-- ====================================

CREATE OR REPLACE FUNCTION get_batch_user_points_cached(
    p_client_type TEXT,
    p_user_ids TEXT[]
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_object_agg(
        up.user_id,
        jsonb_build_object(
            'user_id', up.user_id,
            'total_points', up.total_points,
            'tier', up.tier,
            'tier_emoji', CASE up.tier
                WHEN 'elite' THEN '💎'
                WHEN 'veteran' THEN '⭐'
                WHEN 'active' THEN '🌸'
                WHEN 'regular' THEN '🍃'
                ELSE '🌱'
            END,
            'current_streak', up.current_streak,
            'longest_streak', up.longest_streak,
            'role', get_user_role(p_client_type, up.user_id)
        )
    ) INTO result
    FROM user_points up
    WHERE up.client_type = p_client_type
    AND up.user_id = ANY(p_user_ids);

    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
