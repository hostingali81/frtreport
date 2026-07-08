-- Restore columns to live_complaints because the mobile app UI heavily depends on them 
-- being returned by the live API, and they act as a temporary cache until the main scraper runs.
ALTER TABLE public.live_complaints
ADD COLUMN IF NOT EXISTS fault_id bigint,
ADD COLUMN IF NOT EXISTS complaint_type text,
ADD COLUMN IF NOT EXISTS complaint_sub_type text,
ADD COLUMN IF NOT EXISTS district text,
ADD COLUMN IF NOT EXISTS area text,
ADD COLUMN IF NOT EXISTS area_type text,
ADD COLUMN IF NOT EXISTS feeder text,
ADD COLUMN IF NOT EXISTS complaint_date timestamptz;

-- Restore complaint_contacts table TEMPORARILY. 
-- Since the remote API hasn't been updated yet, it's crashing. 
-- We'll restore it so the app works immediately, but the new API will ignore it.
CREATE TABLE IF NOT EXISTS public.complaint_contacts (
  dataid        bigint primary key references public.live_complaints(dataid) on delete cascade,
  consumer_name text,
  mobile        text,
  address       text,
  landmark      text,
  remarks       text,
  substation    text,
  assigned_crew text,
  crew_mobile   text,
  fetched_at    timestamptz not null default now()
);

-- Note: We are keeping the new columns on `complaints` and the new FK on `call_logs`
-- so the new API will work perfectly once deployed.
