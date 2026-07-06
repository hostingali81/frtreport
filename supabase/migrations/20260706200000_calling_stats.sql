-- Calling Report tab on /analytics: aggregates over the calling-app data.
-- Universe = complaints that ARRIVED in [p_from, p_to] (live_complaints, the
-- FRT live feed) plus every call attempt logged against them (call_logs).
-- Substation comes from complaint_contacts and is only known for complaints
-- whose contact was opened in the calling app - the client shows coverage
-- (substationKnown) instead of silently under-counting.
-- These tables are small (the live feed only started 2026-07-03), so plain
-- GROUP BYs are fine; returning one jsonb keeps the route free of the
-- PostgREST 1000-row cap like get_complaints_stats.

create or replace function public.get_calling_stats(
    p_from timestamptz default null,
    p_to timestamptz default null
)
returns jsonb
language sql
stable
as $func$
with comps as (
    select
        lc.dataid,
        coalesce(nullif(trim(lc.complaint_type), ''), 'Unknown')      as ctype,
        coalesce(nullif(trim(lc.complaint_sub_type), ''), 'Unknown')  as csub,
        coalesce(nullif(trim(lc.feeder), ''), 'Unknown')              as feeder,
        nullif(trim(cc.substation), '')                               as substation,
        ((lc.complaint_date at time zone 'Asia/Kolkata')::date)::text as d
    from public.live_complaints lc
    left join public.complaint_contacts cc using (dataid)
    where (p_from is null or lc.complaint_date >= p_from)
      and (p_to   is null or lc.complaint_date <= p_to)
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
        select coalesce(jsonb_agg(jsonb_build_object('f', feeder, 't', ctype, 'n', n) order by n desc), '[]'::jsonb)
        from (select feeder, ctype, count(*) as n from pc group by feeder, ctype) t
    ),
    'faultByFeeder', (
        select coalesce(jsonb_agg(jsonb_build_object('f', feeder, 'c', fault, 'n', n) order by n desc), '[]'::jsonb)
        from (select feeder, fault, count(*) as n from comp_fault group by feeder, fault) t
    ),
    'typeBySubstation', (
        select coalesce(jsonb_agg(jsonb_build_object('s', substation, 't', ctype, 'n', n) order by n desc), '[]'::jsonb)
        from (
            select substation, ctype, count(*) as n
            from pc where substation is not null
            group by substation, ctype
        ) t
    ),
    'faultBySubstation', (
        select coalesce(jsonb_agg(jsonb_build_object('s', substation, 'c', fault, 'n', n) order by n desc), '[]'::jsonb)
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
)
$func$;
