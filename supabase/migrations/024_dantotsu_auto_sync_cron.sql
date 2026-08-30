-- ====================================
-- MIGRATION 024: Dantotsu Auto-Sync via pg_cron
-- Calls the dantotsu-sync edge function every 2 hours
-- ====================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Uses internal Docker hostname (same network as the DB)
-- edge-runtime is the standard Supabase Docker service name for functions
-- Set DANTOTSU_AL_TOKEN in your edge function env (same as SUPABASE_URL, SUPABASE_ANON_KEY, etc.)

SELECT cron.schedule(
    'dantotsu-comment-sync',
    '0 */2 * * *',
    $$SELECT net.http_post(
        url := 'http://edge-runtime:8000/functions/v1/dantotsu-sync?action=api',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
    )$$
);

INSERT INTO config (key, value) VALUES
    ('dantotsu_sync_enabled', 'true'),
    ('dantotsu_sync_interval_hours', '2')
ON CONFLICT (key) DO NOTHING;

-- Check:  SELECT * FROM cron.job;
-- Remove: SELECT cron.unschedule('dantotsu-comment-sync');
-- Manual: SELECT net.http_post(url := 'http://edge-runtime:8000/functions/v1/dantotsu-sync?action=api', headers := jsonb_build_object('Content-Type', 'application/json'), body := '{}'::jsonb);
