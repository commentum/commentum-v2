-- ====================================
-- MIGRATION 039: Dantotsu Mapping Origin
-- Adds origin tracking ('anymex' vs 'dantotsu') to dantotsu_id_mappings
-- ====================================

ALTER TABLE dantotsu_id_mappings
ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'dantotsu';
