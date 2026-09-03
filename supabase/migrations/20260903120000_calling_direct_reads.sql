-- Direct-from-Supabase reads for the Android calling app.
--
-- Why: every list poll, caller-ID refresh and history open went through a
-- Next.js /api/calling/* route on Vercel purely to hold the service-role key.
-- The rows come out of this database either way, so the round trip through
-- Vercel bought nothing but cost — a 30-second poll from a single handset kept
-- a Fluid instance alive around the clock (~48% of all function invocations).
-- With the policies below the app reads Supabase directly and Vercel keeps only
-- the routes that genuinely need a secret or a scrape (contact, sync, cron,
-- scrape, log POST).
--
-- Security note: this migration TIGHTENS access. `public.complaints` had no RLS
-- at all, so anyone holding the anon key — which ships inside every APK and is
-- therefore public — could read all 122k rows including consumer_name,
-- consumer_mobile, consumer_address and consumer_remarks. After this, reads
-- require a signed-in profile with active = true.

-- ---------------------------------------------------------------------------
-- 1. Who is allowed to read
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because `profiles` has RLS with no policy of its own — a
-- plain lookup from the `authenticated` role would come back empty and every
-- policy below would deny. STABLE so the planner evaluates it once per query
-- rather than once per row.
create or replace function public.is_active_app_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.active
  );
$fn$;

revoke all on function public.is_active_app_user() from public, anon;
grant execute on function public.is_active_app_user() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. complaints — close the anon hole, open it to signed-in operators
-- ---------------------------------------------------------------------------
alter table public.complaints enable row level security;
revoke select on public.complaints from anon;
grant   select on public.complaints to   authenticated;

-- Windowed on purpose. The app needs recent complaints only — the caller-ID
-- cache takes the newest 1000, caller lookup goes back 30 days, and the live
-- queue is today's — so there is no reason for a handset to be able to page the
-- full 122k-row consumer history. The report side is unaffected: it reads with
-- the service role, which bypasses RLS. Rows with no date stay visible so
-- nothing disappears from the app if the scraper leaves complaint_date blank.
drop policy if exists complaints_read_active_users on public.complaints;
create policy complaints_read_active_users on public.complaints
  for select to authenticated
  using (
    public.is_active_app_user()
    and (complaint_date is null or complaint_date > now() - interval '180 days')
  );

-- ---------------------------------------------------------------------------
-- 3. live_complaints / call_logs / profiles — read-only for operators
-- ---------------------------------------------------------------------------
grant select on public.live_complaints to authenticated;
drop policy if exists live_complaints_read_active_users on public.live_complaints;
create policy live_complaints_read_active_users on public.live_complaints
  for select to authenticated
  using (public.is_active_app_user());

grant select on public.call_logs to authenticated;
drop policy if exists call_logs_read_active_users on public.call_logs;
create policy call_logs_read_active_users on public.call_logs
  for select to authenticated
  using (public.is_active_app_user());

-- Own row only: the app reads its display name and role from here.
grant select on public.profiles to authenticated;
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- The joined view is security_invoker, so the policies above still apply to it.
grant select on public.live_complaints_full to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The list the app actually renders
-- ---------------------------------------------------------------------------
-- Same shape /api/calling/complaints returned: the joined live row plus the
-- call rollup. That rollup was a second query plus a JS group-by in the route;
-- a LATERAL does it per selected row through call_logs_dataid_idx, so only the
-- ~40 rows in the feed are touched, not all 14k logs.
create or replace view public.live_complaints_calls
with (security_invoker = true) as
select
  lcf.dataid,
  lcf.complaint_number,
  lcf.fault_id,
  lcf.district,
  lcf.action_status,
  lcf.first_seen_at,
  lcf.last_synced_at,
  lcf.still_in_feed,
  lcf.claimed_by,
  lcf.claimed_by_name,
  lcf.claimed_at,
  lcf.complaint_type,
  lcf.complaint_sub_type,
  lcf.area,
  lcf.area_type,
  lcf.feeder,
  lcf.complaint_date,
  coalesce(agg.call_count, 0) as call_count,
  agg.last_call_status,
  agg.last_call_time,
  agg.last_call_category
from public.live_complaints_full lcf
left join lateral (
  select
    count(*)                                                        as call_count,
    (array_agg(cl.call_status      order by cl.call_time desc))[1]  as last_call_status,
    max(cl.call_time)                                               as last_call_time,
    (array_agg(cl.problem_category order by cl.call_time desc))[1]  as last_call_category
  from public.call_logs cl
  where cl.dataid = lcf.dataid
) agg on true;

revoke all  on public.live_complaints_calls from anon;
grant select on public.live_complaints_calls to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Claiming — the one write the app makes directly
-- ---------------------------------------------------------------------------
-- An RPC rather than a column grant: the operator name is read from `profiles`
-- so a client cannot forge it, and SELECT ... FOR UPDATE makes the check-then-
-- write atomic (the /api/calling/claim version documented that race as
-- acceptable; here it costs nothing to close). No UPDATE grant on the table is
-- needed at all.
create or replace function public.claim_complaint(
  p_dataid  bigint,
  p_release boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_row  public.live_complaints%rowtype;
begin
  select coalesce(nullif(trim(p.display_name), ''), p.email)
    into v_name
    from public.profiles p
   where p.id = v_uid and p.active;

  if v_name is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if p_release then
    update public.live_complaints
       set claimed_by = null, claimed_by_name = null, claimed_at = null
     where dataid = p_dataid
       and claimed_by = v_uid;
    return jsonb_build_object('success', true, 'released', true);
  end if;

  select * into v_row
    from public.live_complaints
   where dataid = p_dataid
     for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Unknown complaint');
  end if;

  -- Someone else holds a claim younger than the 3-minute staleness window that
  -- the app and the API both assume.
  if v_row.claimed_by is not null
     and v_row.claimed_by <> v_uid
     and v_row.claimed_at is not null
     and now() - v_row.claimed_at < interval '3 minutes' then
    return jsonb_build_object(
      'success',         true,
      'claimed',         false,
      'claimed_by_name', coalesce(v_row.claimed_by_name, 'Another operator'),
      'claimed_at',      v_row.claimed_at
    );
  end if;

  update public.live_complaints
     set claimed_by      = v_uid,
         claimed_by_name = v_name,
         claimed_at      = now()
   where dataid = p_dataid;

  return jsonb_build_object('success', true, 'claimed', true);
end;
$fn$;

revoke all on function public.claim_complaint(bigint, boolean) from public, anon;
grant execute on function public.claim_complaint(bigint, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Realtime — replaces the 30-second poll
-- ---------------------------------------------------------------------------
-- The app subscribes to live_complaints and refetches on change, so a new
-- complaint or a colleague's claim shows up in about a second instead of up to
-- 30 — with no Vercel invocation at all. Realtime enforces the SELECT policy
-- above per subscriber. REPLICA IDENTITY stays DEFAULT: the payload is only a
-- signal to refetch, never the data the UI renders.
-- Non-fatal: if the publication is missing or not owned by the migrating role,
-- Realtime can still be switched on from the dashboard, and until it is the app
-- simply falls back to its 5-minute backstop poll.
do $mig$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'live_complaints'
     )
  then
    alter publication supabase_realtime add table public.live_complaints;
  end if;
exception when others then
  raise notice 'Could not add live_complaints to supabase_realtime (%). Enable Realtime for the table from the dashboard.', sqlerrm;
end
$mig$;
