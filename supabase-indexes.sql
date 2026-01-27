-- Performance Optimization: Add indexes to complaints table
-- Run this in Supabase SQL Editor

-- Index for date-based queries (most common)
CREATE INDEX IF NOT EXISTS idx_complaints_date 
ON complaints(complaint_date DESC);

-- Index for division filtering
CREATE INDEX IF NOT EXISTS idx_complaints_division 
ON complaints(division);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_complaints_status 
ON complaints(status);

-- Index for complaint number lookups
CREATE INDEX IF NOT EXISTS idx_complaints_number 
ON complaints(complaint_number);

-- Composite index for common filter combinations
CREATE INDEX IF NOT EXISTS idx_complaints_filter 
ON complaints(division, status, complaint_date DESC);

-- Index for sub-division queries
CREATE INDEX IF NOT EXISTS idx_complaints_subdiv 
ON complaints(sub_division);

-- Index for sub-station queries
CREATE INDEX IF NOT EXISTS idx_complaints_substation 
ON complaints(sub_station);

-- Analyze table for query planner
ANALYZE complaints;
