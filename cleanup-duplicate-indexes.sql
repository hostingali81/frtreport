-- Cleanup Duplicate Indexes (Optional - Space Optimization)
-- Run this in Supabase SQL Editor to remove duplicate indexes

-- Remove duplicate complaint_date index
DROP INDEX IF EXISTS idx_complaints_date;

-- Remove duplicate division index
DROP INDEX IF EXISTS idx_complaints_division;

-- Remove duplicate status index
DROP INDEX IF EXISTS idx_complaints_status;

-- Remove duplicate complaint_number index
DROP INDEX IF EXISTS idx_complaints_number;

-- Remove duplicate sub_division index
DROP INDEX IF EXISTS idx_complaints_subdiv;

-- Remove duplicate sub_station index
DROP INDEX IF EXISTS idx_complaints_substation;

-- Verify remaining indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'complaints'
ORDER BY indexname;
