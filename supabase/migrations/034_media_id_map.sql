-- ===================================================
-- MIGRATION 034: MEDIA ID MAP (cross-client comment merging)
--
-- The same show lives under different ids per client (anilist 21 =
-- mal 21 = simkl 38636 for One Piece), so comments are split into 3
-- separate threads today. This table groups equivalent media ids
-- under one map_key so the media edge function can merge threads at
-- READ time (comments stay stored per-client; nothing migrates).
--
-- map_key is deterministic (prefers mal id, then anilist, then
-- simkl) so re-running the seed script always produces the same
-- keys and upserts converge without drift.
--
-- Populated by scripts/sync_media_mappings.py (Fribb anime-lists for
-- anime incl. simkl; AniList GraphQL idMal crawl for manga — simkl
-- has no manga).
-- ===================================================

CREATE TABLE IF NOT EXISTS public.media_id_map (
    client_type TEXT NOT NULL,                 -- anilist | mal | simkl
    media_id    TEXT NOT NULL,                 -- id exactly as stored in comments.media_id
    map_key     TEXT NOT NULL,                 -- e.g. 'anime:mal:21' groups all equivalents
    media_type  TEXT NOT NULL DEFAULT 'anime', -- anime | manga
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_type, media_id)
);

-- Lookup by map_key (the read path: resolve one pair -> all equivalents)
CREATE INDEX IF NOT EXISTS idx_media_id_map_key ON public.media_id_map(map_key);

-- Only edge functions (service role, bypasses RLS) touch this table.
ALTER TABLE public.media_id_map ENABLE ROW LEVEL SECURITY;
