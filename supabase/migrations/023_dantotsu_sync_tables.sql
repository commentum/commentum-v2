-- ====================================
-- MIGRATION 023: Dantotsu Sync Tables
-- Supports syncing dantotsu/AniList comments into the comments table
-- No changes to existing schema — only adds new tables
-- ====================================

-- 1. ID Mapping: dantotsu_comment_id → commentum_id
-- This lets us resolve parent_id relationships and detect duplicates
CREATE TABLE IF NOT EXISTS dantotsu_id_mappings (
    dantotsu_comment_id  INTEGER PRIMARY KEY,
    commentum_id         INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    media_id             INTEGER NOT NULL,
    synced_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dantotsu_mappings_commentum
    ON dantotsu_id_mappings(commentum_id);

-- 2. AniList Media Cache: avoid re-fetching media info from AniList API
CREATE TABLE IF NOT EXISTS dantotsu_media_cache (
    media_id     INTEGER PRIMARY KEY,
    media_type   TEXT NOT NULL,
    media_title  TEXT NOT NULL,
    media_year   INTEGER,
    media_poster  TEXT,
    fetched_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Sync Metadata: track sync state for resumable imports
CREATE TABLE IF NOT EXISTS dantotsu_sync_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to auto-update updated_at on dantotsu_sync_meta
CREATE OR REPLACE FUNCTION update_dantotsu_sync_meta_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_dantotsu_sync_meta_updated_at ON dantotsu_sync_meta;
CREATE TRIGGER update_dantotsu_sync_meta_updated_at
    BEFORE UPDATE ON dantotsu_sync_meta
    FOR EACH ROW
    EXECUTE FUNCTION update_dantotsu_sync_meta_updated_at();
