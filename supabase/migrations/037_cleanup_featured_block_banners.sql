-- =======================================================
-- MIGRATION 037: CLEANUP FEATURED BLOCK BANNERS
-- =======================================================
-- Removes banners with 'Featured Block Url' in title
-- which contain Discord store promo mockups and logos.
-- =======================================================

DELETE FROM public.customizations_catalog 
WHERE title LIKE '%Featured Block Url%';
