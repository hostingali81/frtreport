-- ============================================
-- Performance Optimizations for 11000+ Rows
-- Run these in Supabase SQL Editor
-- ============================================

-- 1. Add composite indexes for common filter combinations
CREATE INDEX IF NOT EXISTS idx_division_status ON complaints(division, status);
CREATE INDEX IF NOT EXISTS idx_division_date ON complaints(division, complaint_date DESC);
CREATE INDEX IF NOT EXISTS idx_status_date ON complaints(status, complaint_date DESC);
CREATE INDEX IF NOT EXISTS idx_closed_status_date ON complaints(closed_status, complaint_date DESC);
CREATE INDEX IF NOT EXISTS idx_sub_division_date ON complaints(sub_division, complaint_date DESC);
CREATE INDEX IF NOT EXISTS idx_sub_station_date ON complaints(sub_station, complaint_date DESC);

-- 2. Add covering index for common queries
CREATE INDEX IF NOT EXISTS idx_complaints_covering ON complaints(
  complaint_date DESC,
  division,
  status
) INCLUDE (complaint_number, sub_division, sub_station, closed_status);

-- 2. Add GIN index for full-text search on multiple columns
CREATE INDEX IF NOT EXISTS idx_search_gin ON complaints USING GIN (
  to_tsvector('english', 
    COALESCE(complaint_number, '') || ' ' || 
    COALESCE(division, '') || ' ' || 
    COALESCE(sub_division, '') || ' ' || 
    COALESCE(sub_station, '')
  )
);

-- 3. Analyze tables for query optimization
ANALYZE complaints;
ANALYZE scrape_metadata;

-- 4. Create materialized view for dashboard stats (optional, for very fast reads)
CREATE MATERIALIZED VIEW IF NOT EXISTS dashboard_stats AS
SELECT 
  COUNT(*) as total_complaints,
  COUNT(*) FILTER (WHERE status = 'Complaint Closed') as closed_count,
  COUNT(*) FILTER (WHERE status != 'Complaint Closed') as pending_count,
  COUNT(*) FILTER (WHERE closed_status = 'Closed Within') as closed_within,
  COUNT(*) FILTER (WHERE closed_status = 'Closed Beyond') as closed_beyond,
  MAX(complaint_date) as latest_complaint,
  MIN(complaint_date) as oldest_complaint
FROM complaints;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_stats ON dashboard_stats ((1));

-- 5. Function to refresh materialized view (call after scraping)
CREATE OR REPLACE FUNCTION refresh_dashboard_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_stats;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Query Performance Tips
-- ============================================

-- Use EXPLAIN ANALYZE to check query performance:
-- EXPLAIN ANALYZE SELECT * FROM complaints WHERE division = 'XYZ' AND complaint_date > '2025-01-01';

-- Monitor slow queries:
-- SELECT query, calls, total_time, mean_time 
-- FROM pg_stat_statements 
-- ORDER BY mean_time DESC 
-- LIMIT 10;

-- ============================================
-- VACUUM Commands (Run separately, not in transaction)
-- ============================================
-- Note: VACUUM cannot run inside a transaction block
-- Run these commands separately in Supabase SQL Editor:
-- VACUUM ANALYZE complaints;
-- VACUUM ANALYZE scrape_metadata;
