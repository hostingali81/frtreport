-- Verify complaint report indexes after rebuild.
--
-- Run this in Supabase SQL Editor after supabase-rebuild-indexes.sql.
-- For EXPLAIN output:
-- - Good sign: Index Scan, Index Only Scan, or Bitmap Index Scan.
-- - Bad sign for large tables: only Seq Scan on complaints for date/filter queries.
-- - In dynamic sample tests, ignore scans used only to choose sample values.
--   Look at the final lookup on public.complaints / alias c.

-- ============================================================
-- 1) Final index list
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
-- 2) Required index PASS/FAIL check
-- ============================================================
WITH required_indexes(indexname) AS (
  VALUES
    ('complaints_pkey'),
    ('complaints_complaint_number_key'),
    ('idx_complaints_date'),
    ('idx_complaints_division_date'),
    ('idx_complaints_subdiv_date'),
    ('idx_complaints_substation_date'),
    ('idx_complaints_status_date'),
    ('idx_complaints_closed_status_date'),
    ('idx_complaints_division_status_date'),
    ('idx_complaints_location_date'),
    ('idx_scrape_metadata_success_created_at'),
    ('scrape_metadata_pkey')
)
SELECT
  r.indexname,
  CASE WHEN existing.indexname IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM required_indexes r
LEFT JOIN (
  SELECT c.relname AS indexname
  FROM pg_class c
  JOIN pg_namespace n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
) existing
  ON existing.indexname = r.indexname
ORDER BY status DESC, r.indexname;

-- ============================================================
-- 3) Old duplicate/redundant index cleanup check
-- Should return zero rows.
-- ============================================================
WITH old_indexes(indexname) AS (
  VALUES
    ('idx_closed_status'),
    ('idx_closed_status_date'),
    ('idx_complaint_date'),
    ('idx_complaints_filter'),
    ('idx_complaints_number'),
    ('idx_created_at'),
    ('idx_division'),
    ('idx_division_date'),
    ('idx_division_status'),
    ('idx_search_gin'),
    ('idx_status'),
    ('idx_status_date'),
    ('idx_sub_division'),
    ('idx_sub_station'),
    ('idx_complaints_division'),
    ('idx_complaints_status'),
    ('idx_complaints_subdiv'),
    ('idx_complaints_substation')
)
SELECT
  c.relname AS old_index_still_exists
FROM old_indexes o
JOIN pg_class c
  ON c.relname = o.indexname
JOIN pg_namespace n
  ON n.oid = c.relnamespace
 AND n.nspname = 'public'
ORDER BY c.relname;

-- ============================================================
-- 4) Index validity check
-- Should show all rows as is_valid=true and is_ready=true.
-- ============================================================
SELECT
  t.relname AS table_name,
  i.relname AS index_name,
  ix.indisunique AS is_unique,
  ix.indisvalid AS is_valid,
  ix.indisready AS is_ready,
  pg_size_pretty(pg_relation_size(i.oid)) AS index_size
FROM pg_index ix
JOIN pg_class t
  ON t.oid = ix.indrelid
JOIN pg_class i
  ON i.oid = ix.indexrelid
JOIN pg_namespace n
  ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN ('complaints', 'scrape_metadata')
ORDER BY t.relname, i.relname;

-- ============================================================
-- 5) Data bounds and sample filter values
-- Use this to confirm the EXPLAIN tests are hitting real data.
-- ============================================================
SELECT
  COUNT(*) AS total_rows,
  MIN(complaint_date) AS min_complaint_date,
  MAX(complaint_date) AS max_complaint_date,
  date_trunc('month', MAX(complaint_date)) AS latest_month_start,
  date_trunc('month', MAX(complaint_date)) + INTERVAL '1 month' AS latest_month_end
FROM public.complaints;

SELECT
  division,
  status,
  sub_division,
  sub_station,
  COUNT(*) AS rows_in_latest_month
FROM public.complaints
WHERE complaint_date >= (
  SELECT date_trunc('month', MAX(complaint_date))
  FROM public.complaints
)
GROUP BY division, status, sub_division, sub_station
ORDER BY rows_in_latest_month DESC
LIMIT 10;

-- ============================================================
-- 6) Query plan test: month/date retrieval
-- Expected: idx_complaints_date
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS)
SELECT raw_data
FROM public.complaints
WHERE complaint_date >= (
    SELECT date_trunc('month', MAX(complaint_date))
    FROM public.complaints
  )
  AND complaint_date < (
    SELECT date_trunc('month', MAX(complaint_date)) + INTERVAL '1 month'
    FROM public.complaints
  )
ORDER BY complaint_date DESC
LIMIT 100;

-- ============================================================
-- 7) Query plan test: division + month
-- Expected: idx_complaints_division_date
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS)
WITH sample AS (
  SELECT
    division,
    date_trunc('month', MAX(complaint_date)) AS month_start
  FROM public.complaints
  WHERE division IS NOT NULL
  GROUP BY division
  ORDER BY COUNT(*) DESC
  LIMIT 1
)
SELECT c.raw_data
FROM public.complaints c
JOIN sample s
  ON c.division = s.division
WHERE c.complaint_date >= s.month_start
  AND c.complaint_date < s.month_start + INTERVAL '1 month'
ORDER BY c.complaint_date DESC
LIMIT 100;

-- ============================================================
-- 8) Query plan test: status + month
-- Expected: idx_complaints_status_date
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS)
WITH sample AS (
  SELECT
    status,
    date_trunc('month', MAX(complaint_date)) AS month_start
  FROM public.complaints
  WHERE status IS NOT NULL
  GROUP BY status
  ORDER BY COUNT(*) DESC
  LIMIT 1
)
SELECT c.raw_data
FROM public.complaints c
JOIN sample s
  ON c.status = s.status
WHERE c.complaint_date >= s.month_start
  AND c.complaint_date < s.month_start + INTERVAL '1 month'
ORDER BY c.complaint_date DESC
LIMIT 100;

-- ============================================================
-- 9) Query plan test: division + status + month
-- Expected: idx_complaints_division_status_date
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS)
WITH sample AS (
  SELECT
    division,
    status,
    date_trunc('month', MAX(complaint_date)) AS month_start
  FROM public.complaints
  WHERE division IS NOT NULL
    AND status IS NOT NULL
  GROUP BY division, status
  ORDER BY COUNT(*) DESC
  LIMIT 1
)
SELECT c.raw_data
FROM public.complaints c
JOIN sample s
  ON c.division = s.division
 AND c.status = s.status
WHERE c.complaint_date >= s.month_start
  AND c.complaint_date < s.month_start + INTERVAL '1 month'
ORDER BY c.complaint_date DESC
LIMIT 100;

-- ============================================================
-- 10) Query plan test: location + month
-- Expected: idx_complaints_location_date
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS)
WITH sample AS (
  SELECT
    division,
    sub_division,
    sub_station,
    date_trunc('month', MAX(complaint_date)) AS month_start
  FROM public.complaints
  WHERE division IS NOT NULL
    AND sub_division IS NOT NULL
    AND sub_station IS NOT NULL
  GROUP BY division, sub_division, sub_station
  ORDER BY COUNT(*) DESC
  LIMIT 1
)
SELECT c.raw_data
FROM public.complaints c
JOIN sample s
  ON c.division = s.division
 AND c.sub_division = s.sub_division
 AND c.sub_station = s.sub_station
WHERE c.complaint_date >= s.month_start
  AND c.complaint_date < s.month_start + INTERVAL '1 month'
ORDER BY c.complaint_date DESC
LIMIT 100;

-- ============================================================
-- 11) Query plan test: latest successful scrape metadata
-- Expected: idx_scrape_metadata_success_created_at
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS)
SELECT last_scrape_at
FROM public.scrape_metadata
WHERE status = 'success'
ORDER BY created_at DESC
LIMIT 1;
