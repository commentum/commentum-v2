-- Generic fixed-window rate limiter used by the edge functions
-- (votes, reports, edits, deletes, translations, points claims, ...).
CREATE TABLE IF NOT EXISTS public.rate_limits (
    key          TEXT        NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    count        INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (key, window_start)
);

-- Only the service role (edge functions) may touch it.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Atomically count one hit for p_key in the current window and report whether
-- it is still within p_limit. Blocked attempts are counted too.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_key            TEXT,
    p_limit          INTEGER,
    p_window_seconds INTEGER
) RETURNS TABLE (allowed BOOLEAN, retry_after INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
    v_start TIMESTAMPTZ;
    v_count INTEGER;
BEGIN
    v_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

    INSERT INTO public.rate_limits AS r (key, window_start, count)
    VALUES (p_key, v_start, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = r.count + 1
    RETURNING r.count INTO v_count;

    -- opportunistic cleanup of old windows (~1% of calls)
    IF random() < 0.01 THEN
        DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 days';
    END IF;

    allowed := v_count <= p_limit;
    retry_after := GREATEST(1, ceil(extract(epoch FROM (v_start + make_interval(secs => p_window_seconds) - now())))::INTEGER);
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- Seed new limits (existing values are never overwritten).
INSERT INTO config (key, value) VALUES
    ('rate_limit_votes_per_minute', '20'),
    ('rate_limit_reports_per_minute', '3'),
    ('rate_limit_edits_per_hour', '30'),
    ('rate_limit_deletes_per_hour', '30'),
    ('rate_limit_translations_per_minute', '15'),
    ('rate_limit_points_claims_per_minute', '5'),
    ('rate_limit_points_claims_per_hour', '30')
ON CONFLICT (key) DO NOTHING;
