-- Migrate mobile caller data to the main complaints table

-- 1. Add missing columns to `complaints`
ALTER TABLE public.complaints
ADD COLUMN IF NOT EXISTS dataid bigint,
ADD COLUMN IF NOT EXISTS landmark text,
ADD COLUMN IF NOT EXISTS assigned_crew text,
ADD COLUMN IF NOT EXISTS crew_mobile text;

-- 2. Create an index on `consumer_mobile` for fast caller ID lookups
CREATE INDEX IF NOT EXISTS idx_complaints_consumer_mobile 
ON public.complaints (consumer_mobile) 
WHERE consumer_mobile IS NOT NULL AND consumer_mobile <> '';

-- 3. Update existing call_logs FK to point to complaint_number instead of dataid
--    Because we are going to drop complaint_contacts and we want call_logs to rely on complaints
ALTER TABLE public.call_logs
DROP CONSTRAINT IF EXISTS call_logs_dataid_fkey;

ALTER TABLE public.call_logs
ADD CONSTRAINT call_logs_complaint_number_fkey 
FOREIGN KEY (complaint_number) 
REFERENCES public.complaints (complaint_number) 
ON DELETE SET NULL;

-- 4. Migrate data from complaint_contacts to complaints
UPDATE public.complaints c
SET
  consumer_name = COALESCE(nullif(trim(c.consumer_name), ''), nullif(trim(cc.consumer_name), '')),
  consumer_mobile = COALESCE(nullif(trim(c.consumer_mobile), ''), nullif(trim(cc.mobile), '')),
  consumer_address = COALESCE(nullif(trim(c.consumer_address), ''), nullif(trim(cc.address), '')),
  landmark = cc.landmark,
  assigned_crew = cc.assigned_crew,
  crew_mobile = cc.crew_mobile,
  dataid = cc.dataid
FROM public.complaint_contacts cc
JOIN public.live_complaints lc ON cc.dataid = lc.dataid
WHERE c.complaint_number = lc.complaint_number;

-- 5. Drop the old table
DROP TABLE IF EXISTS public.complaint_contacts;

-- 6. Clean up live_complaints to only keep live routing/queue state
-- Note: We drop columns that are now completely sourced from the main complaints table
ALTER TABLE public.live_complaints
DROP COLUMN IF EXISTS fault_id,
DROP COLUMN IF EXISTS complaint_type,
DROP COLUMN IF EXISTS complaint_sub_type,
DROP COLUMN IF EXISTS district,
DROP COLUMN IF EXISTS area,
DROP COLUMN IF EXISTS area_type,
DROP COLUMN IF EXISTS feeder,
DROP COLUMN IF EXISTS complaint_date;
