-- 031: Remove the media_type check constraint on comments
--
-- Root cause: comments_media_type_check only allowed
-- ('anime','manga','movie','tv','other') — all lowercase. The AnymeX app
-- sends media_info.type = media.id.split('*').last for Simkl
-- ('MOVIE' / 'SERIES' -> Postgres 23514 "violates check constraint
-- comments_media_type_check"), and novels would send 'novel' which was
-- never in the list either. Simkl comment creation could never pass it.
--
-- Decision: drop the constraint entirely instead of widening it.
-- Rationale: the edge function's validateMediaInfo already accepts any
-- string for type (display-only data), and a hard list keeps biting new
-- clients/sources (Simkl today, novels latent, extensions next). The
-- comments table has no media_type filter on reads (lookups are
-- media_id + client_type), so free-form type is safe.
--
-- Idempotent-friendly: running on a DB where the constraint is already
-- gone will error on the DROP — that just means it's already applied.

ALTER TABLE public.comments DROP CONSTRAINT comments_media_type_check;
