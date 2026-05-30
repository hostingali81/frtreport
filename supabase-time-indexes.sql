-- Supabase/Postgres index check + recommended indexes for complaint reports.
-- Run this in Supabase SQL Editor, or with:
--   npx supabase db query --linked -f supabase-time-indexes.sql
--
-- Note: CREATE INDEX CONCURRENTLY cannot run inside an explicit transaction.
-- If Supabase SQL Editor reports a transaction error, run the CREATE INDEX
-- statements one by one, or remove CONCURRENTLY during a quiet/off-peak time.
--
-- Current DB notes from 2026-05-27 index dump:
-- - complaint_date is already indexed twice:
--   idx_complaint_date and idx_complaints_date both use (complaint_date DESC).
-- - complaint_number is already unique:
--   complaints_complaint_number_key uses (complaint_number).
-- - division/status/closed_status date composites already exist under shorter
--   names: idx_division_date, idx_status_date, idx_closed_status_date.
-- - Missing useful composites for the app: sub_division + date,
--   sub_station + date, location + date, and scrape_metadata success lookup.

-- 1) Check current table columns and index definitions.
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'complaints'
  AND column_name IN (
    'complaint_date',
    'complaint_number',
    'division',
    'sub_division',
    'sub_station',
    'status',
    'closed_status'
  )
ORDER BY ordinal_position;

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('complaints', 'scrape_metadata')
ORDER BY tablename, indexname;

-- 2) Confirm complaint_number duplicates. This should return no rows because
-- complaints_complaint_number_key already exists as a UNIQUE index.
SELECT
  complaint_number,
  COUNT(*) AS duplicate_count
FROM public.complaints
WHERE complaint_number IS NOT NULL
GROUP BY complaint_number
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, complaint_number
LIMIT 20;

-- 3) Missing composite indexes for month/time retrieval with common filters.
-- Equality columns come first, then complaint_date for date range + DESC order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_subdiv_date
ON public.complaints (sub_division, complaint_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_substation_date
ON public.complaints (sub_station, complaint_date DESC);

-- Helpful when division + sub_division + sub_station filters are selected.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_location_date
ON public.complaints (division, sub_division, sub_station, complaint_date DESC);

-- Metadata endpoint checks latest successful scrape.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scrape_metadata_success_created_at
ON public.scrape_metadata (status, created_at DESC)
WHERE status = 'success';

ANALYZE public.complaints;
ANALYZE public.scrape_metadata;

-- 4) Verify planner uses a date index. Change the sample dates/filters as needed.
EXPLAIN (ANALYZE, BUFFERS)
SELECT raw_data
FROM public.complaints
WHERE complaint_date >= TIMESTAMPTZ '2026-05-01 00:00:00+05:30'
  AND complaint_date <  TIMESTAMPTZ '2026-06-01 00:00:00+05:30'
ORDER BY complaint_date DESC
LIMIT 100;

-- Example with filters; replace division/status with real values from your DB.
EXPLAIN (ANALYZE, BUFFERS)
SELECT raw_data
FROM public.complaints
WHERE division = 'YOUR_DIVISION'
  AND status = 'YOUR_STATUS'
  AND complaint_date >= TIMESTAMPTZ '2026-05-01 00:00:00+05:30'
  AND complaint_date <  TIMESTAMPTZ '2026-06-01 00:00:00+05:30'
ORDER BY complaint_date DESC
LIMIT 100;

-- 5) Optional cleanup after testing:
-- Your DB has several exact/near duplicates. Drop only after confirming the
-- important indexes above exist and app reads are good. Keep primary key,
-- complaints_complaint_number_key, one complaint_date index, and useful
-- composite date indexes.
--
-- Exact duplicate date indexes. Choose exactly one DROP, not both:
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaint_date;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_date;
--
-- Redundant because complaints_complaint_number_key is already unique:
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_number;
--
-- Single-column duplicates:
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_division;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_division;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_status;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_status;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_subdiv;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_sub_division;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_substation;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_sub_station;
--
-- Covered for division + status queries by idx_complaints_filter:
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_division_status;
--
-- Usually covered by idx_closed_status_date for closed_status filters:
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_closed_status;

-- 6) Optional search acceleration:
-- The API uses ILIKE '%search%' across many columns. Normal btree indexes do
-- not help leading-wildcard searches. If search is slow, enable pg_trgm and add
-- targeted GIN indexes for the most-used search columns.
--
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_number_trgm
-- ON public.complaints USING gin (complaint_number gin_trgm_ops);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_mobile_trgm
-- ON public.complaints USING gin (consumer_mobile gin_trgm_ops);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_consumer_name_trgm
-- ON public.complaints USING gin (consumer_name gin_trgm_ops);
