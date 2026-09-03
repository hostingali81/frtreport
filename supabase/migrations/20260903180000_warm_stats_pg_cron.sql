-- Warm the Calling Report presets from inside the database, on pg_cron.
--
-- Earlier today this warming was put on a GitHub Actions schedule (*/15). It
-- turns out GitHub's scheduler does not honour short intervals on this repo at
-- all: `frt-refresh.yml` asks for every 5 minutes and its last 20 scheduled runs
-- averaged a 239-minute gap (min 108, max 468). The new warm workflow never
-- fired on schedule even once, so the precomputed rows aged past
-- CALLING_STATS_MAX_AGE_MS (30 min) and every dashboard open went back to
-- computing live -- exactly the problem the warming exists to prevent.
--
-- pg_cron runs in the database, so there is no scheduler to be throttled, no
-- runner to boot and no Vercel function involved. And since get_calling_stats is
-- now fast (migration 20260903140000), the whole pass is a few seconds:
-- today ~110ms, month ~2s, lastMonth ~3s.
--
-- The ranges must match presetRange() in app/lib/calling-ranges.ts byte for
-- byte -- /api/calling/analytics only finds a precomputed row when the requested
-- from/to equal a preset exactly -- and the payload shape must match what
-- readCachedCallingStats() expects: { stats, from, to, computedAt }.

create extension if not exists pg_cron;

create or replace function public.warm_calling_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- "Today" is the operators' today: complaint dates are IST, so the day has to
  -- be resolved in IST whatever the server's timezone is.
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_warmed text[] := '{}';
  r record;
begin
  for r in
    select * from (values
      ('today',     v_today,                                                    v_today),
      ('yesterday', v_today - 1,                                                v_today - 1),
      ('month',     date_trunc('month', v_today::timestamp)::date,              v_today),
      ('lastMonth', date_trunc('month', (v_today - interval '1 month')::timestamp)::date,
                    date_trunc('month', v_today::timestamp)::date - 1)
    ) as t(key, d_from, d_to)
  loop
    insert into public.reports (key, payload, updated_at)
    values (
      'calling_stats:' || r.key,
      jsonb_build_object(
        'stats', public.get_calling_stats(
                   (r.d_from::text || 'T00:00:00+05:30')::timestamptz,
                   (r.d_to::text   || 'T23:59:59+05:30')::timestamptz),
        'from', r.d_from::text,
        'to',   r.d_to::text,
        -- Read back by Date.parse() in JS, so emit the same ISO-8601 Z form
        -- the Node warmer wrote.
        'computedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      now()
    )
    on conflict (key) do update
      set payload = excluded.payload, updated_at = excluded.updated_at;

    v_warmed := v_warmed || r.key;
  end loop;

  return jsonb_build_object('warmed', to_jsonb(v_warmed), 'at', now());
end;
$fn$;

revoke all on function public.warm_calling_stats() from public, anon, authenticated;

-- Every 15 minutes, comfortably inside the 30-minute staleness window even if a
-- run is skipped.
select cron.unschedule('warm-calling-stats')
  where exists (select 1 from cron.job where jobname = 'warm-calling-stats');

select cron.schedule('warm-calling-stats', '*/15 * * * *', $job$select public.warm_calling_stats()$job$);
