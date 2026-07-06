-- Feeder report: a feeder only makes sense within its substation (the same
-- feeder name can exist under two substations and those are different
-- feeders), so the feeder grouping becomes (sub_station, feeder) and byFeeder
-- rows gain 'ss'. bySubStation needs an "AND feeder IS NULL" guard now that
-- the feeder grouping-set rows also carry a non-null sub_station.

CREATE OR REPLACE FUNCTION public.get_complaints_stats(
    p_division text DEFAULT NULL,
    p_sub_division text DEFAULT NULL,
    p_sub_station text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_closed_status text DEFAULT NULL,
    p_from timestamptz DEFAULT NULL,
    p_to timestamptz DEFAULT NULL,
    p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $func$
DECLARE
    conditions text := 'TRUE';
    result jsonb;
BEGIN
    IF p_division IS NOT NULL AND p_division <> '' THEN
        conditions := conditions || format(' AND division = %L', p_division);
    END IF;
    IF p_sub_division IS NOT NULL AND p_sub_division <> '' THEN
        conditions := conditions || format(' AND sub_division = %L', p_sub_division);
    END IF;
    IF p_sub_station IS NOT NULL AND p_sub_station <> '' THEN
        conditions := conditions || format(' AND sub_station = %L', p_sub_station);
    END IF;
    IF p_status IS NOT NULL AND p_status <> '' THEN
        conditions := conditions || format(' AND status = %L', p_status);
    END IF;
    IF p_closed_status IS NOT NULL AND p_closed_status <> '' THEN
        conditions := conditions || format(' AND closed_status = %L', p_closed_status);
    END IF;
    IF p_from IS NOT NULL THEN
        conditions := conditions || format(' AND complaint_date >= %L::timestamptz', p_from);
    END IF;
    IF p_to IS NOT NULL THEN
        conditions := conditions || format(' AND complaint_date <= %L::timestamptz', p_to);
    END IF;
    IF p_search IS NOT NULL AND p_search <> '' THEN
        conditions := conditions || format(' AND search_text LIKE %L', '%' || lower(p_search) || '%');
    END IF;

    EXECUTE
$q$
WITH raw AS (
    SELECT
        id,
        coalesce(nullif(trim(division), ''), 'Unknown')    AS division,
        coalesce(nullif(trim(sub_station), ''), 'Unknown') AS sub_station,
        coalesce(nullif(trim(area_type), ''), 'Unknown')   AS area_type,
        coalesce(nullif(trim(feeder), ''), 'Unknown')      AS feeder,
        lower(trim(coalesce(status, '')))                  AS status_l,
        trim(coalesce(closed_status, ''))                  AS closed_status_t,
        upper(trim(coalesce(closed_by, '')))               AS closed_by_u,
        (complaint_date AT TIME ZONE 'Asia/Kolkata')       AS ts,
        closed_date,
        complaint_date,
        nullif(trim(coalesce(consumer_mobile, '')), '')    AS mobile,
        nullif(trim(coalesce(consumer_name, '')), '')      AS cname,
        nullif(trim(coalesce(consumer_address, '')), '')   AS caddr
    FROM public.complaints
    WHERE
$q$ || conditions || $q$
),
enriched AS MATERIALIZED (
    SELECT
        id, division, sub_station, area_type, feeder, status_l, closed_status_t,
        mobile, cname, caddr, ts,
        ts::date AS d,
        substr((ts::date)::text, 1, 7) AS mkey,
        extract(hour FROM ts)::int AS hr,
        (extract(isodow FROM ts)::int - 1) AS dow,
        (closed_by_u LIKE '%CONTROL_ROOM_1%' OR closed_by_u LIKE '%CONTROL_ROOM_2%') AS is_cr,
        CASE
            WHEN status_l = 'complaint closed' THEN true
            WHEN status_l = 'pending' THEN false
            WHEN closed_date IS NOT NULL THEN true
            WHEN status_l LIKE '%closed%' OR status_l LIKE '%resolve%' THEN true
            WHEN status_l LIKE '%attend%' AND status_l LIKE '%confirm%' THEN true
            ELSE false
        END AS is_closed,
        CASE WHEN closed_date IS NOT NULL AND closed_date > complaint_date
             THEN extract(epoch FROM (closed_date - complaint_date)) / 60.0
        END AS res_mins,
        CASE WHEN cname IS NOT NULL
             THEN lower(cname || '|' || coalesce(caddr, ''))
        END AS nkey
    FROM raw
),
-- One pass for every dimensional grouping the charts need.
g AS MATERIALIZED (
    SELECT
        division, sub_station, area_type, feeder, closed_status_t AS closed_status_g, d, mkey, dow, hr,
        count(*) AS n,
        count(*) FILTER (WHERE closed_status_t = 'Closed Beyond') AS beyond,
        count(*) FILTER (WHERE NOT is_closed) AS pending,
        count(*) FILTER (WHERE is_closed AND is_cr) AS cr,
        count(*) FILTER (WHERE is_closed AND NOT is_cr) AS frt,
        round(coalesce(sum(res_mins), 0)::numeric, 2) AS res_sum,
        count(res_mins) AS res_n
    FROM enriched
    GROUP BY GROUPING SETS (
        (),
        (division),
        (sub_station),
        (area_type),
        (sub_station, feeder),
        (closed_status_t),
        (d),
        (mkey),
        (mkey, dow, hr),
        (mkey, sub_station),
        (mkey, division)
    )
),
gm AS MATERIALIZED (
    SELECT mobile,
           coalesce(max(cname), 'Unknown') AS name,
           coalesce(max(caddr), 'Unknown') AS address,
           count(*) AS total,
           count(*) FILTER (WHERE status_l LIKE '%pending%') AS pending,
           count(*) FILTER (WHERE status_l LIKE '%closed%') AS closed
    FROM enriched
    WHERE mobile IS NOT NULL AND length(mobile) >= 5
    GROUP BY mobile
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 50
),
gn AS MATERIALIZED (
    SELECT nkey,
           max(cname) AS name,
           coalesce(max(caddr), '') AS address,
           coalesce(max(mobile), 'N/A') AS mobile,
           count(*) AS total,
           count(*) FILTER (WHERE status_l LIKE '%pending%') AS pending,
           count(*) FILTER (WHERE status_l LIKE '%closed%') AS closed
    FROM enriched
    WHERE nkey IS NOT NULL
    GROUP BY nkey
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 50
),
mob_lists AS (
    SELECT e2.mobile,
           jsonb_agg(jsonb_build_object(
               'Complaint Number', c.raw_data->>'Complaint Number',
               'Division', c.raw_data->>'Division',
               'Sub Station', c.raw_data->>'Sub Station',
               'Feeder', c.raw_data->>'Feeder',
               'Complaint Date and Time', c.raw_data->>'Complaint Date and Time',
               'Status', c.raw_data->>'Status',
               'Closed Status', c.raw_data->>'Closed Status',
               'Closed Date', c.raw_data->>'Closed Date',
               'Closing Remarks', c.raw_data->>'Closing Remarks'
           ) ORDER BY e2.ts DESC) AS complaints
    FROM enriched e2
    JOIN public.complaints c ON c.id = e2.id
    WHERE e2.mobile IN (SELECT mobile FROM gm)
    GROUP BY e2.mobile
),
name_lists AS (
    SELECT e2.nkey,
           jsonb_agg(jsonb_build_object(
               'Complaint Number', c.raw_data->>'Complaint Number',
               'Division', c.raw_data->>'Division',
               'Sub Station', c.raw_data->>'Sub Station',
               'Feeder', c.raw_data->>'Feeder',
               'Complaint Date and Time', c.raw_data->>'Complaint Date and Time',
               'Status', c.raw_data->>'Status',
               'Closed Status', c.raw_data->>'Closed Status',
               'Closed Date', c.raw_data->>'Closed Date',
               'Closing Remarks', c.raw_data->>'Closing Remarks'
           ) ORDER BY e2.ts DESC) AS complaints
    FROM enriched e2
    JOIN public.complaints c ON c.id = e2.id
    WHERE e2.nkey IN (SELECT nkey FROM gn)
    GROUP BY e2.nkey
)
SELECT jsonb_build_object(
    'total', (
        SELECT coalesce(max(n), 0) FROM g
        WHERE division IS NULL AND sub_station IS NULL AND area_type IS NULL
          AND feeder IS NULL AND closed_status_g IS NULL AND d IS NULL AND mkey IS NULL
    ),
    'byClosedStatus', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('k', closed_status_g, 'n', n) ORDER BY n DESC, closed_status_g), '[]'::jsonb)
        FROM g WHERE closed_status_g IS NOT NULL
    ),
    'byDivision', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('k', division, 'n', n) ORDER BY n DESC, division), '[]'::jsonb)
        FROM g WHERE division IS NOT NULL AND mkey IS NULL
    ),
    'bySubStation', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('k', sub_station, 'n', n) ORDER BY n DESC, sub_station), '[]'::jsonb)
        FROM g WHERE sub_station IS NOT NULL AND mkey IS NULL AND feeder IS NULL
    ),
    'byAreaType', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('k', area_type, 'n', n) ORDER BY n DESC, area_type), '[]'::jsonb)
        FROM g WHERE area_type IS NOT NULL
    ),
    'byFeeder', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'k', feeder, 'ss', sub_station, 'n', n, 'pending', pending, 'beyond', beyond,
                   'resSum', res_sum, 'resN', res_n
               ) ORDER BY n DESC, feeder, sub_station), '[]'::jsonb)
        FROM g WHERE feeder IS NOT NULL AND feeder <> 'Unknown'
    ),
    'beyondByDivision', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('k', division, 'n', beyond) ORDER BY beyond DESC, division), '[]'::jsonb)
        FROM g WHERE division IS NOT NULL AND mkey IS NULL AND beyond > 0
    ),
    'daily', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'd', d::text, 'n', n, 'cr', cr, 'frt', frt,
                   'resSum', res_sum, 'resN', res_n
               ) ORDER BY d), '[]'::jsonb)
        FROM g WHERE d IS NOT NULL
    ),
    'months', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'key', mkey,
                   'label', to_char(to_date(mkey || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY'),
                   'total', n, 'beyond', beyond,
                   'resSum', res_sum, 'resN', res_n
               ) ORDER BY mkey DESC), '[]'::jsonb)
        FROM g WHERE mkey IS NOT NULL AND dow IS NULL AND sub_station IS NULL AND division IS NULL
    ),
    'monthHeat', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('m', mkey, 'dow', dow, 'hr', hr, 'n', n)
                   ORDER BY mkey, dow, hr), '[]'::jsonb)
        FROM g WHERE mkey IS NOT NULL AND dow IS NOT NULL
    ),
    'monthSubStation', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'm', mkey, 'k', sub_station, 'n', n, 'resSum', res_sum, 'resN', res_n
               ) ORDER BY mkey, n DESC), '[]'::jsonb)
        FROM g WHERE mkey IS NOT NULL AND sub_station IS NOT NULL
    ),
    'monthDivision', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'm', mkey, 'k', division, 'n', n, 'resSum', res_sum, 'resN', res_n
               ) ORDER BY mkey, n DESC), '[]'::jsonb)
        FROM g WHERE mkey IS NOT NULL AND division IS NOT NULL
    ),
    'repeatMobile', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'mobile', t.mobile, 'name', t.name, 'address', t.address,
                   'total', t.total, 'pending', t.pending, 'closed', t.closed,
                   'complaints', coalesce(l.complaints, '[]'::jsonb)
               ) ORDER BY t.total DESC), '[]'::jsonb)
        FROM gm t
        LEFT JOIN mob_lists l ON l.mobile = t.mobile
    ),
    'repeatNameAddr', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'mobile', t.mobile, 'name', t.name, 'address', t.address,
                   'total', t.total, 'pending', t.pending, 'closed', t.closed,
                   'complaints', coalesce(l.complaints, '[]'::jsonb)
               ) ORDER BY t.total DESC), '[]'::jsonb)
        FROM gn t
        LEFT JOIN name_lists l ON l.nkey = t.nkey
    )
)
$q$
    INTO result;

    RETURN result;
END;
$func$;
