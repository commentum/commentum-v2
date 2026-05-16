-- ====================================
-- MIGRATION 020: Add translation fields to comments table
-- Adds: translated_content, original_language, translated_at
-- Enables auto-translation of comments to English using Google Translate (client=gtx)
-- ====================================

-- Add translation columns to the comments table
ALTER TABLE comments
ADD COLUMN IF NOT EXISTS translated_content TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS original_language TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS translated_at TIMESTAMPTZ DEFAULT NULL;

-- Add index on original_language for filtering comments by language
CREATE INDEX IF NOT EXISTS idx_comments_original_language ON comments(original_language) WHERE original_language IS NOT NULL;

-- Add index on translated_content for finding untranslated comments
CREATE INDEX IF NOT EXISTS idx_comments_untranslated ON comments(id) WHERE translated_content IS NULL AND original_language IS NOT NULL AND original_language != 'en';

-- Add comment to document the fields
COMMENT ON COLUMN comments.translated_content IS 'English translation of the comment content (auto-generated via Google Translate client=gtx). NULL if already English or translation failed.';
COMMENT ON COLUMN comments.original_language IS 'ISO 639-1 language code detected for the original comment content. NULL if not yet detected.';
COMMENT ON COLUMN comments.translated_at IS 'Timestamp when the translation was generated. NULL if not yet translated.';
