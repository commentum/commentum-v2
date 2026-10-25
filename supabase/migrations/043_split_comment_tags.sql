-- ====================================
-- MIGRATION 043: Split comment tags into `tag` (integer) + `labels` (array)
-- `tags` was a TEXT JSON array mixing client labels ("Spoiler", "General")
-- and Dantotsu episode numbers ("episode:5"). Split it:
--   - `tag`    INTEGER — episode/chapter number, Dantotsu-compatible, nullable
--   - `labels` TEXT    — JSON array of client labels (spoiler, general, ...)
-- Old rows: the first element containing digits ("episode:5", "5") becomes
-- `tag`; remaining pure-text elements stay in `labels` (NULL when none left).
-- ====================================

ALTER TABLE comments RENAME COLUMN tags TO labels;
ALTER TABLE comments ADD COLUMN tag INTEGER;

-- Extract the episode/chapter number from old array elements
UPDATE comments
SET tag = (
  SELECT (regexp_match(e, '\d+'))[1]::int
  FROM jsonb_array_elements_text(labels::jsonb) AS e
  WHERE e ~ '\d+' AND length((regexp_match(e, '\d+'))[1]) <= 9
  LIMIT 1
)
WHERE labels LIKE '[%'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(labels::jsonb) AS e
    WHERE e ~ '\d+' AND length((regexp_match(e, '\d+'))[1]) <= 9
  );

-- Rows whose elements were all numeric: labels becomes NULL
UPDATE comments
SET labels = NULL
WHERE labels LIKE '[%'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(labels::jsonb) AS e
    WHERE e !~ '\d+'
  );

-- Rows with a mix: keep only the pure-text elements, preserving order
UPDATE comments
SET labels = (
  SELECT jsonb_agg(e ORDER BY ord)::text
  FROM jsonb_array_elements_text(labels::jsonb) WITH ORDINALITY AS t(e, ord)
  WHERE e !~ '\d+'
)
WHERE labels LIKE '[%'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(labels::jsonb) AS e
    WHERE e !~ '\d+'
  );
