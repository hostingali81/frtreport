-- FRT Calling App tables (Phase 1). See PROJECT-PLAN.md §4.
-- The session cache reuses the existing `reports` table (key 'frt_calling_session'),
-- so no session table is needed here.

-- Live complaints from FormId 13339 (the live grid).
create table if not exists public.live_complaints (
  dataid             bigint primary key,          -- FRT DATAID
  complaint_number   text unique,                 -- e.g. MV02072602766
  fault_id           bigint,
  complaint_type     text,
  complaint_sub_type text,
  district           text,
  area               text,
  area_type          text,                        -- Rural / Urban
  feeder             text,
  action_status      text,                        -- FRT Assigned / In Progress / ...
  complaint_date     timestamptz,
  first_seen_at      timestamptz not null default now(),
  last_synced_at     timestamptz not null default now(),
  still_in_feed      boolean     not null default true
);

create index if not exists live_complaints_still_in_feed_idx on public.live_complaints (still_in_feed);
create index if not exists live_complaints_action_status_idx  on public.live_complaints (action_status);
create index if not exists live_complaints_complaint_date_idx on public.live_complaints (complaint_date desc);
create index if not exists live_complaints_area_idx           on public.live_complaints (area);
create index if not exists live_complaints_district_idx       on public.live_complaints (district);

-- Consumer contact from FormId 13340 (lazily fetched & cached on tap).
create table if not exists public.complaint_contacts (
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

-- The value-add: post-call record (absent from the official FRT system).
create table if not exists public.call_logs (
  id               bigserial primary key,
  dataid           bigint references public.live_complaints(dataid) on delete set null,
  complaint_number text,
  call_time        timestamptz not null default now(),
  call_status      text,   -- Connected / No Answer / Switched Off / Busy / Wrong Number
  problem_category text,   -- Meter fault / Wire tuta / Transformer / Voltage / Other
  notes            text,
  operator         text,
  created_at       timestamptz not null default now()
);

create index if not exists call_logs_dataid_idx     on public.call_logs (dataid);
create index if not exists call_logs_created_at_idx on public.call_logs (created_at desc);

-- These tables hold consumer PII. Enable RLS so nothing is readable with the
-- anon key; the backend accesses them with the service role (which bypasses RLS).
-- Client-facing policies (e.g. authenticated operators) can be added in Phase 2.
alter table public.live_complaints   enable row level security;
alter table public.complaint_contacts enable row level security;
alter table public.call_logs         enable row level security;
