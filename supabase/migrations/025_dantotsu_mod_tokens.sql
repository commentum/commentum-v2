-- ====================================
-- MIGRATION 025: Dantotsu Moderator Tokens Pool
-- Automatically captures and stores Dantotsu moderator tokens when a mod
-- authenticates, allowing backend/Discord bot/AnymeX mods to execute
-- Dantotsu moderation actions (e.g. comment deletion) on behalf of staff.
-- ====================================

CREATE TABLE IF NOT EXISTS dantotsu_mod_tokens (
    user_id              TEXT PRIMARY KEY,
    username             TEXT,
    anilist_token        TEXT NOT NULL,
    dantotsu_auth_token  TEXT NOT NULL,
    is_mod               BOOLEAN DEFAULT TRUE,
    is_admin             BOOLEAN DEFAULT FALSE,
    last_verified_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fastest retrieval of active mod tokens
CREATE INDEX IF NOT EXISTS idx_dantotsu_mod_tokens_updated
    ON dantotsu_mod_tokens(updated_at DESC);

-- Enable RLS
ALTER TABLE dantotsu_mod_tokens ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
DROP POLICY IF EXISTS "Service role full access on dantotsu_mod_tokens" ON dantotsu_mod_tokens;
CREATE POLICY "Service role full access on dantotsu_mod_tokens"
    ON dantotsu_mod_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
