-- ============================================
-- FRT Barabanki - Optimized Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Create complaints table
CREATE TABLE IF NOT EXISTS complaints (
  id BIGSERIAL PRIMARY KEY,
  complaint_number TEXT UNIQUE NOT NULL,
  complaint_date TIMESTAMPTZ,
  division TEXT,
  sub_division TEXT,
  sub_station TEXT,
  status TEXT,
  closed_status TEXT,
  closed_by TEXT,
  closed_date TIMESTAMPTZ,
  closing_remarks TEXT,
  area_type TEXT,
  raw_data JSONB, -- Store original row data
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_complaint_date ON complaints(complaint_date DESC);
CREATE INDEX IF NOT EXISTS idx_division ON complaints(division);
CREATE INDEX IF NOT EXISTS idx_sub_division ON complaints(sub_division);
CREATE INDEX IF NOT EXISTS idx_sub_station ON complaints(sub_station);
CREATE INDEX IF NOT EXISTS idx_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_closed_status ON complaints(closed_status);
CREATE INDEX IF NOT EXISTS idx_created_at ON complaints(created_at DESC);

-- 3. Create scrape metadata table
CREATE TABLE IF NOT EXISTS scrape_metadata (
  id SERIAL PRIMARY KEY,
  last_scrape_at TIMESTAMPTZ NOT NULL,
  total_rows INTEGER DEFAULT 0,
  new_rows INTEGER DEFAULT 0,
  updated_rows INTEGER DEFAULT 0,
  duration_seconds INTEGER,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Create trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_complaints_updated_at ON complaints;
CREATE TRIGGER update_complaints_updated_at
  BEFORE UPDATE ON complaints
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 6. Enable Row Level Security (optional, for production)
-- ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE scrape_metadata ENABLE ROW LEVEL SECURITY;

-- 7. Create policy for public read access (adjust as needed)
-- CREATE POLICY "Allow public read access" ON complaints FOR SELECT USING (true);
-- CREATE POLICY "Allow public read access" ON scrape_metadata FOR SELECT USING (true);

-- ============================================
-- Migration: Copy data from old reports table
-- ============================================

-- Run this AFTER creating the schema above
-- This will migrate existing data from the old JSON format

DO $$
DECLARE
  old_data JSONB;
  row_data JSONB;
BEGIN
  -- Get existing data from reports table
  SELECT payload INTO old_data 
  FROM reports 
  WHERE key = 'frt_supply' 
  LIMIT 1;

  -- If data exists, migrate it
  IF old_data IS NOT NULL AND old_data ? 'data' THEN
    -- Loop through each row in the data array
    FOR row_data IN SELECT * FROM jsonb_array_elements(old_data->'data')
    LOOP
      -- Insert or update complaint
      INSERT INTO complaints (
        complaint_number,
        complaint_date,
        division,
        sub_division,
        sub_station,
        status,
        closed_status,
        closed_by,
        closed_date,
        closing_remarks,
        area_type,
        raw_data
      ) VALUES (
        row_data->>'Complaint Number',
        CASE 
          WHEN row_data->>'Complaint Date and Time' ~ '^\d{2}/\d{2}/\d{4}' THEN
            TO_TIMESTAMP(row_data->>'Complaint Date and Time', 'DD/MM/YYYY HH12:MI AM')
          ELSE NULL
        END,
        row_data->>'Division',
        row_data->>'Sub Division',
        row_data->>'Sub Station',
        row_data->>'Status',
        row_data->>'Closed Status',
        row_data->>'Closed By',
        CASE 
          WHEN row_data->>'Closed Date' ~ '^\d{2}/\d{2}/\d{4}' THEN
            TO_TIMESTAMP(row_data->>'Closed Date', 'DD/MM/YYYY HH12:MI AM')
          ELSE NULL
        END,
        row_data->>'Closing Remarks',
        row_data->>'Area Type',
        row_data
      )
      ON CONFLICT (complaint_number) 
      DO UPDATE SET
        complaint_date = EXCLUDED.complaint_date,
        division = EXCLUDED.division,
        sub_division = EXCLUDED.sub_division,
        sub_station = EXCLUDED.sub_station,
        status = EXCLUDED.status,
        closed_status = EXCLUDED.closed_status,
        closed_by = EXCLUDED.closed_by,
        closed_date = EXCLUDED.closed_date,
        closing_remarks = EXCLUDED.closing_remarks,
        area_type = EXCLUDED.area_type,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW();
    END LOOP;

    -- Record migration in metadata
    INSERT INTO scrape_metadata (
      last_scrape_at,
      total_rows,
      new_rows,
      status
    ) VALUES (
      NOW(),
      (SELECT COUNT(*) FROM complaints),
      (SELECT COUNT(*) FROM complaints),
      'migration_complete'
    );

    RAISE NOTICE 'Migration completed successfully';
  ELSE
    RAISE NOTICE 'No data found in reports table to migrate';
  END IF;
END $$;
