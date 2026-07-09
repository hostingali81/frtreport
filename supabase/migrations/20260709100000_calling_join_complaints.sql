-- Normalize the calling app's data: `complaints` is the single source of truth
-- for descriptive complaint data; `live_complaints` keeps only live-queue state
-- (still_in_feed, action_status, claims). The API reads the joined view below.
-- A follow-up migration (20260709100100) drops the now-duplicated columns from
-- live_complaints AFTER the new API code is deployed.

-- 1. Push everything live_complaints knows into the main complaints table:
--    creates rows missing from `complaints` (fresh live complaints the report
--    scraper hasn't seen yet) and fills NULL columns on existing rows.
--    Never overwrites a non-NULL value the report scraper already wrote.
insert into public.complaints
  (complaint_number, dataid, complaint_type, complaint_sub_type, sub_station, area_type, feeder, complaint_date)
select lc.complaint_number, lc.dataid, lc.complaint_type, lc.complaint_sub_type,
       lc.area, lc.area_type, lc.feeder, lc.complaint_date
from public.live_complaints lc
where lc.complaint_number is not null
on conflict (complaint_number) do update set
  dataid             = coalesce(public.complaints.dataid,             excluded.dataid),
  complaint_type     = coalesce(public.complaints.complaint_type,     excluded.complaint_type),
  complaint_sub_type = coalesce(public.complaints.complaint_sub_type, excluded.complaint_sub_type),
  sub_station        = coalesce(public.complaints.sub_station,        excluded.sub_station),
  area_type          = coalesce(public.complaints.area_type,          excluded.area_type),
  feeder             = coalesce(public.complaints.feeder,             excluded.feeder),
  complaint_date     = coalesce(public.complaints.complaint_date,     excluded.complaint_date);

-- 2. The view the calling API reads: live-queue state + descriptive data from
--    complaints. `district` stays on live_complaints (complaints has no such
--    column). security_invoker so RLS still applies to non-service callers,
--    and explicit revoke as belt-and-braces (these tables hold consumer PII).
create or replace view public.live_complaints_full
with (security_invoker = true) as
select
  lc.dataid,
  lc.complaint_number,
  lc.fault_id,
  lc.district,
  lc.action_status,
  lc.first_seen_at,
  lc.last_synced_at,
  lc.still_in_feed,
  lc.claimed_by,
  lc.claimed_by_name,
  lc.claimed_at,
  c.complaint_type,
  c.complaint_sub_type,
  c.sub_station as area,
  c.area_type,
  c.feeder,
  c.complaint_date
from public.live_complaints lc
left join public.complaints c using (complaint_number);

revoke all on public.live_complaints_full from anon, authenticated;

-- 3. RPC used by /api/calling/sync to upsert grid metadata into complaints with
--    per-column freshness: grid values win when present, but a transiently blank
--    grid cell never NULLs out data the report scraper already stored.
create or replace function public.upsert_live_complaint_meta(rows jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into complaints
    (complaint_number, dataid, complaint_type, complaint_sub_type, sub_station, area_type, feeder, complaint_date)
  select r.complaint_number, r.dataid, r.complaint_type, r.complaint_sub_type,
         r.sub_station, r.area_type, r.feeder, r.complaint_date
  from jsonb_to_recordset(rows) as r(
    complaint_number text, dataid bigint, complaint_type text, complaint_sub_type text,
    sub_station text, area_type text, feeder text, complaint_date timestamptz)
  where r.complaint_number is not null
  on conflict (complaint_number) do update set
    dataid             = coalesce(excluded.dataid,             complaints.dataid),
    complaint_type     = coalesce(excluded.complaint_type,     complaints.complaint_type),
    complaint_sub_type = coalesce(excluded.complaint_sub_type, complaints.complaint_sub_type),
    sub_station        = coalesce(excluded.sub_station,        complaints.sub_station),
    area_type          = coalesce(excluded.area_type,          complaints.area_type),
    feeder             = coalesce(excluded.feeder,             complaints.feeder),
    complaint_date     = coalesce(excluded.complaint_date,     complaints.complaint_date);
$$;

revoke all on function public.upsert_live_complaint_meta(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_live_complaint_meta(jsonb) to service_role;
