-- 031: Allow Simkl media types in comments.media_type
--
-- Root cause: comments_media_type_check only allowed lowercase
-- ('anime','manga','movie','tv','other'). The AnymeX app sends
-- media_info.type = media.id.split('*').last for Simkl, which is
-- 'MOVIE' / 'SERIES' (uppercase) -> Postgres 23514 on every Simkl
-- comment create ("violates check constraint comments_media_type_check").
--
-- Fix: widen the check to include the Simkl variants (and lowercase
-- 'series' for future safety). Signature-compatible, no data rewrite,
-- no edge function redeploy needed - run in SQL editor and Simkl
-- comment creation works immediately.

ALTER TABLE public.comments DROP CONSTRAINT comments_media_type_check;

ALTER TABLE public.comments ADD CONSTRAINT comments_media_type_check
  CHECK (media_type = ANY (ARRAY[
    'anime'::text,
    'manga'::text,
    'movie'::text,
    'tv'::text,
    'other'::text,
    'MOVIE'::text,
    'SERIES'::text,
    'ANIME'::text,
    'series'::text
  ]));
