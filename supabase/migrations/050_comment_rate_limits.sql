-- Realistic comment anti-spam limits.
-- rate_limit_comments_per_hour was seeded as 30 in 001 but never enforced; the
-- comments function now enforces it. Lower it to 20 only if it is still the
-- untouched seed value (so a manually tuned value is never overwritten).
UPDATE config SET value = '20' WHERE key = 'rate_limit_comments_per_hour' AND value = '30';

INSERT INTO config (key, value) VALUES
    ('rate_limit_comments_per_hour', '20'),
    ('rate_limit_comments_per_minute', '5'),
    ('comment_cooldown_seconds', '5')
ON CONFLICT (key) DO NOTHING;
