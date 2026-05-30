-- Rebuild complaint report indexes from a clean baseline.
--
-- Safe rule:
-- - Do NOT drop complaints_pkey.
-- - Do NOT drop complaints_complaint_number_key.
--
-- The app's scraper uses:
--   upsert(..., { onConflict: 'complaint_number' })
-- so complaint_number must stay UNIQUE.
--
-- If Supabase SQL Editor reports:
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction block
-- run each DROP/CREATE statement one by one, or remove CONCURRENTLY during
-- off-peak time.

-- ============================================================
-- STEP 1: Check current indexes before cleanup
-- ============================================================
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('complaints', 'scrape_metadata')
ORDER BY tablename, indexname;

-- ============================================================
-- STEP 2: Clean existing non-constraint indexes
-- Keep:
--   complaints_pkey
--   complaints_complaint_number_key
--   scrape_metadata_pkey
-- ============================================================
DROP INDEX CONCURRENTLY IF EXISTS public.idx_closed_status;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_closed_status_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaint_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_division;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_filter;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_number;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_status;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_subdiv;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_substation;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_created_at;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_division;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_division_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_division_status;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_search_gin;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_status;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_status_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sub_division;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_sub_station;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_subdiv_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_substation_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_complaints_location_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_scrape_metadata_success_created_at;

-- ============================================================
-- STEP 3: Fresh recommended indexes for this app
-- ============================================================

-- Main query pattern:
-- WHERE complaint_date between from/to
-- ORDER BY complaint_date DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_date
ON public.complaints (complaint_date DESC);

-- Common filter + date patterns used by /api/complaints.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_division_date
ON public.complaints (division, complaint_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_subdiv_date
ON public.complaints (sub_division, complaint_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_substation_date
ON public.complaints (sub_station, complaint_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_status_date
ON public.complaints (status, complaint_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_closed_status_date
ON public.complaints (closed_status, complaint_date DESC);

-- When division + status are selected together.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_division_status_date
ON public.complaints (division, status, complaint_date DESC);

-- When full location filters are selected together.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_complaints_location_date
ON public.complaints (division, sub_division, sub_station, complaint_date DESC);

-- Latest successful scrape metadata lookup.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scrape_metadata_success_created_at
ON public.scrape_metadata (status, created_at DESC)
WHERE status = 'success';

-- Refresh planner stats after rebuild.
ANALYZE public.complaints;
ANALYZE public.scrape_metadata;

-- ============================================================
-- STEP 4: Verify final indexes
-- ============================================================
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('complaints', 'scrape_metadata')
ORDER BY tablename, indexname;

-- ============================================================
-- STEP 5: Test date/month query plan
-- Change dates as needed.
-- Good sign: plan should show Index Scan / Bitmap Index Scan, not only Seq Scan.
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS)
SELECT raw_data
FROM public.complaints
WHERE complaint_date >= TIMESTAMPTZ '2026-05-01 00:00:00+05:30'
  AND complaint_date <  TIMESTAMPTZ '2026-06-01 00:00:00+05:30'
ORDER BY complaint_date DESC
LIMIT 100;
