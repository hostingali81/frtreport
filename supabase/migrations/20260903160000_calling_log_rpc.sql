-- Move the post-call write off Vercel.
--
-- /api/calling/log POST existed to hold the service-role key and to take the
-- operator's identity from the session rather than the request body. A
-- SECURITY DEFINER RPC does both without a function invocation: the name and id
-- come from `profiles`, so a client still cannot claim to be someone else, and
-- `call_logs` needs no INSERT grant for `authenticated` at all.
--
-- Two behaviours from the route are carried over deliberately:
--   * the foreign-key fallback — a complaint the scraper has not stored yet must
--     never cost the operator their log, so the link is dropped rather than the
--     insert failing. The route caught error 23503 after the fact; checking
--     first is the same outcome without burning a failed statement.
--   * logging a call ends that operator's claim on the complaint.

create or replace function public.log_call(
  p_dataid           bigint,
  p_call_status      text,
  p_complaint_number text    default null,
  p_problem_category text    default null,
  p_notes            text    default null,
  p_duration_seconds integer default null,
  p_connected        boolean default null,
  p_is_incoming      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_number text;
  v_row    record;
begin
  select coalesce(nullif(trim(p.display_name), ''), p.email)
    into v_name
    from public.profiles p
   where p.id = v_uid and p.active;

  if v_name is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;
  if p_dataid is null or p_dataid <= 0 then
    return jsonb_build_object('success', false, 'error', 'Invalid or missing dataid');
  end if;
  if p_call_status is null or trim(p_call_status) = '' then
    return jsonb_build_object('success', false, 'error', 'call_status is required');
  end if;

  -- call_logs.complaint_number references complaints(complaint_number).
  v_number := p_complaint_number;
  if v_number is not null
     and not exists (select 1 from public.complaints c where c.complaint_number = v_number)
  then
    v_number := null;
  end if;

  insert into public.call_logs (
    dataid, complaint_number, call_status, problem_category, notes,
    duration_seconds, connected, is_incoming, operator, operator_id
  ) values (
    p_dataid, v_number, p_call_status, p_problem_category, p_notes,
    case when p_duration_seconds is not null and p_duration_seconds >= 0
         then p_duration_seconds end,
    p_connected, coalesce(p_is_incoming, false), v_name, v_uid
  )
  returning id, call_time into v_row;

  update public.live_complaints
     set claimed_by = null, claimed_by_name = null, claimed_at = null
   where dataid = p_dataid
     and claimed_by = v_uid;

  return jsonb_build_object(
    'success', true,
    'log', jsonb_build_object('id', v_row.id, 'call_time', v_row.call_time)
  );
end;
$fn$;

revoke all on function public.log_call(bigint, text, text, text, text, integer, boolean, boolean)
  from public, anon;
grant execute on function public.log_call(bigint, text, text, text, text, integer, boolean, boolean)
  to authenticated, service_role;
