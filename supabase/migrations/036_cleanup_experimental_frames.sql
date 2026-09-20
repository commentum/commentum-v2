-- =======================================================
-- MIGRATION 036: CLEANUP EXPERIMENTAL PROFILE FRAMES
-- =======================================================
-- Removes the 31 experimental profile frames that contained
-- Discord marketing mockups and empty URLs.
-- Leaves 1,672 pure, clean assets:
-- - 457 Avatar Decorations
-- - 246 Nameplates
-- - 270 Profile Effects
-- - 699 Category Banners
-- =======================================================

DELETE FROM public.customizations_catalog 
WHERE type = 'frame';
