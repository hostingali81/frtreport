-- get_calling_stats: stop the date range from disabling every index.
--
-- The Calling Report was taking 10-20s to open. The cause was not the data
-- volume -- EXPLAIN of the function's own body with literal dates runs in ~13ms.
-- It was the predicate:
--
--     where (p_from is null or lcf.complaint_date >= p_from)
--       and (p_to   is null or lcf.complaint_date <= p_to)
--
-- That OR form cannot use idx_complaints_stats_cover, so even a one-day window
-- walked the whole live_complaints x complaints join. Measured on the presets:
--
--     today      ~12-22s  ->  ~240ms
--     month        ~11s   ->  ~4s
--     lastMonth     ~9s   ->  ~7.5s
--     all time     ~10s   ->  ~10s   (unchanged, deliberately -- see below)
--
-- get_complaints_page already carries this exact fix (migration 20260611120000);
-- get_calling_stats was written later and reintroduced the pattern.
--
-- Verified equivalent before shipping: old and new output compared under one
-- snapshot for today, yesterday, current month and all time. The only
-- difference was element order inside four aggregates that sort by count with
-- no tiebreaker -- so their order was never defined in the first place. Those
-- four now carry a tiebreaker, which also stops a precomputed row and a live
-- call from disagreeing byte-for-byte.

create or replace function public.get_calling_stats(
    p_from timestamptz default null,
    p_to   timestamptz default null
)
returns jsonb
language plpgsql
stable
as $fn$
declare
  v_body  text := $q$with comps as (
    select
        lcf.dataid,
        coalesce(nullif(trim(lcf.complaint_type), ''), 'Unknown')      as ctype,
        coalesce(nullif(trim(lcf.complaint_sub_type), ''), 'Unknown')  as csub,
        coalesce(nullif(trim(lcf.feeder), ''), 'Unknown')              as feeder,
        nullif(trim(lcf.area), '')                                     as substation,
        ((lcf.complaint_date at time zone 'Asia/Kolkata')::date)::text as d
    from public.live_complaints_full lcf
    where true __RANGE__
),
logs as (
    select
        cl.dataid,
        coalesce(nullif(trim(cl.call_status), ''), 'Unspecified')   as status,
        nullif(trim(cl.problem_category), '')                       as fault,
        -- Old rows have connected=null; fall back to the recorded status.
        coalesce(cl.connected, cl.call_status = 'Connected', false) as conn,
        coalesce(cl.duration_seconds, 0)                            as dur
    from public.call_logs cl
    join comps c on c.dataid = cl.dataid
),
lstat as (
    select dataid,
           count(*)      as attempts,
           bool_or(conn) as connected
    from logs
    group by dataid
),
pc as (
    select c.*,
           (l.dataid is not null)       as called,
           coalesce(l.connected, false) as connected
    from comps c
    left join lstat l using (dataid)
),
-- One row per (complaint, fault category the operators recorded for it); a
-- complaint whose calls got two different categories counts under both.
comp_fault as (
    select distinct l.dataid, l.fault, c.feeder, c.substation
    from logs l
    join comps c using (dataid)
    where l.fault is not null
)
select jsonb_build_object(
    'total',             (select count(*) from comps),
    'called',            (select count(*) from pc where called),
    'connected',         (select count(*) from pc where connected),
    'attempts',          (select count(*) from logs),
    'attemptsConnected', (select count(*) from logs where conn),
    'talkSeconds',       (select coalesce(sum(dur), 0) from logs),
    'substationKnown',   (select count(*) from comps where substation is not null),
    -- Complaints we reached but where no call ever recorded a fault category.
    'uncategorizedConnected', (
        select count(*) from lstat s
        where s.connected
          and not exists (select 1 from comp_fault f where f.dataid = s.dataid)
    ),
    'byCallStatus', (
        select coalesce(jsonb_agg(jsonb_build_object('k', status, 'n', n) order by n desc, status), '[]'::jsonb)
        from (select status, count(*) as n from logs group by status) t
    ),
    'byFault', (
        select coalesce(jsonb_agg(jsonb_build_object('k', fault, 'n', n, 'attempts', att) order by n desc, fault), '[]'::jsonb)
        from (
            select fault, count(distinct dataid) as n, count(*) as att
            from logs
            where fault is not null
            group by fault
        ) t
    ),
    'byType', (
        select coalesce(jsonb_agg(jsonb_build_object('k', ctype, 'n', n, 'called', called, 'connected', connected) order by n desc, ctype), '[]'::jsonb)
        from (
            select ctype, count(*) as n,
                   count(*) filter (where called)    as called,
                   count(*) filter (where connected) as connected
            from pc group by ctype
        ) t
    ),
    'bySubType', (
        select coalesce(jsonb_agg(jsonb_build_object('k', csub, 't', ctype, 'n', n, 'called', called, 'connected', connected) order by n desc, csub), '[]'::jsonb)
        from (
            select csub, min(ctype) as ctype, count(*) as n,
                   count(*) filter (where called)    as called,
                   count(*) filter (where connected) as connected
            from pc group by csub
        ) t
    ),
    'byFeeder', (
        select coalesce(jsonb_agg(jsonb_build_object('k', feeder, 'n', n, 'called', called, 'connected', connected) order by n desc, feeder), '[]'::jsonb)
        from (
            select feeder, count(*) as n,
                   count(*) filter (where called)    as called,
                   count(*) filter (where connected) as connected
            from pc group by feeder
        ) t
    ),
    'bySubstation', (
        select coalesce(jsonb_agg(jsonb_build_object('k', substation, 'n', n, 'called', called, 'connected', connected) order by n desc, substation), '[]'::jsonb)
        from (
            select substation, count(*) as n,
                   count(*) filter (where called)    as called,
                   count(*) filter (where connected) as connected
            from pc
            where substation is not null
            group by substation
        ) t
    ),
    'typeByFeeder', (
        select coalesce(jsonb_agg(jsonb_build_object('f', feeder, 't', ctype, 'n', n) order by n desc, feeder, ctype), '[]'::jsonb)
        from (select feeder, ctype, count(*) as n from pc group by feeder, ctype) t
    ),
    'faultByFeeder', (
        select coalesce(jsonb_agg(jsonb_build_object('f', feeder, 'c', fault, 'n', n) order by n desc, feeder, fault), '[]'::jsonb)
        from (select feeder, fault, count(*) as n from comp_fault group by feeder, fault) t
    ),
    'typeBySubstation', (
        select coalesce(jsonb_agg(jsonb_build_object('s', substation, 't', ctype, 'n', n) order by n desc, substation, ctype), '[]'::jsonb)
        from (
            select substation, ctype, count(*) as n
            from pc where substation is not null
            group by substation, ctype
        ) t
    ),
    'faultBySubstation', (
        select coalesce(jsonb_agg(jsonb_build_object('s', substation, 'c', fault, 'n', n) order by n desc, substation, fault), '[]'::jsonb)
        from (
            select substation, fault, count(*) as n
            from comp_fault where substation is not null
            group by substation, fault
        ) t
    ),
    'daily', (
        select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n, 'called', called, 'connected', connected) order by d), '[]'::jsonb)
        from (
            select d, count(*) as n,
                   count(*) filter (where called)    as called,
                   count(*) filter (where connected) as connected
            from pc
            where d is not null
            group by d
        ) t
    )
)$q$;
  v_range text := '';
  v_out   jsonb;
begin
  -- Why this is plpgsql with a built-up WHERE instead of a plain SQL function:
  -- the body used to say `(p_from is null or lcf.complaint_date >= p_from)`, and
  -- that OR form cannot use idx_complaints_stats_cover. Every Calling Report
  -- open therefore walked the whole live_complaints x complaints join -- ~12s
  -- for a single day. With a real predicate the same call is ~150ms. This is the
  -- fix get_complaints_page already carries, for the same reason.
  if p_from is null and p_to is null then
    -- Unbounded. Emitting no predicate (or coalesce()ing to +/-infinity) is
    -- index-usable but talks the planner out of the join order this range wants:
    -- measured 10s -> 40-48s. So all-time keeps the historical parameterised
    -- form, which is exactly what it has always run.
    execute replace(v_body, '__RANGE__',
      ' and ($1 is null or lcf.complaint_date >= $1) and ($2 is null or lcf.complaint_date <= $2)')
      into v_out using p_from, p_to;
    return v_out;
  end if;

  if p_from is not null then
    v_range := v_range || format(' and lcf.complaint_date >= %L::timestamptz', p_from);
  end if;
  if p_to is not null then
    v_range := v_range || format(' and lcf.complaint_date <= %L::timestamptz', p_to);
  end if;

  execute replace(v_body, '__RANGE__', v_range) into v_out;
  return v_out;
end
$fn$;

drop function if exists public.get_calling_stats_v2(timestamptz, timestamptz);
