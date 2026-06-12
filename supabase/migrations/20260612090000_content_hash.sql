-- Change-detection for scraper upserts. The daily GitHub Action re-scrapes
-- the whole history and used to rewrite all ~80k rows even when nothing
-- changed, paying full index maintenance (GIN trigram + covering index +
-- generated search_text) per row and hitting statement timeouts. saveToNewDb
-- now stores an md5 of the upsert payload here and skips rows whose hash is
-- unchanged. Backfill is intentional skipped: rows start NULL, so the first
-- sweep after deploy rewrites everything once (setting hashes), and every
-- sweep after that only writes rows that actually changed.

ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS content_hash text;
