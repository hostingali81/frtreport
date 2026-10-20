-- upsert_live_complaint_meta runs on every ~5-minute calling sync and rewrote
-- every complaint still in the live grid, even when nothing had changed. By
-- 2026-10-20 that was ~7.6M updates on ~242k rows (~31 per row), ~4.3M of them
-- non-HOT, so each one added an entry to all 12 indexes on complaints. That
-- churn grew the indexes to 433MB (idx_complaints_stats_cover alone 240MB vs
-- ~30MB when created) and pushed the database past the 500MB Free plan limit.
--
-- Same per-column coalesce semantics as before; the WHERE clause just skips
-- rows whose merged values equal what is already stored, so an unchanged grid
-- row costs nothing.

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
    complaint_date     = coalesce(excluded.complaint_date,     complaints.complaint_date)
  where (complaints.dataid, complaints.complaint_type, complaints.complaint_sub_type,
         complaints.sub_station, complaints.area_type, complaints.feeder, complaints.complaint_date)
        is distinct from
        (coalesce(excluded.dataid,             complaints.dataid),
         coalesce(excluded.complaint_type,     complaints.complaint_type),
         coalesce(excluded.complaint_sub_type, complaints.complaint_sub_type),
         coalesce(excluded.sub_station,        complaints.sub_station),
         coalesce(excluded.area_type,          complaints.area_type),
         coalesce(excluded.feeder,             complaints.feeder),
         coalesce(excluded.complaint_date,     complaints.complaint_date));
$$;

revoke all on function public.upsert_live_complaint_meta(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_live_complaint_meta(jsonb) to service_role;
