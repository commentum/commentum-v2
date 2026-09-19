-- ===================================================
-- MIGRATION 033: DECORATIONS GLOBAL KILL-SWITCH
-- Seeds the decorations_enabled flag (default true). When false,
-- all endpoints strip avatar_decoration and equipping is rejected.
-- Toggled via the existing Discord /config command:
--   /config update key:decorations_enabled value:false
-- ===================================================

INSERT INTO config (key, value)
VALUES ('decorations_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
