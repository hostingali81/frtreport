-- get_complaints_stats(): server-side aggregation for the chart pages.
--
-- The charts and deep-analysis pages used to download every matching row
-- (~60MB of raw_data for "All Months") and aggregate in the browser. This
-- function computes all chart groupings in one pass over the filtered set
-- and returns a few hundred KB of jsonb:
--
--   total              count of matching complaints
--   byDivision         [{k, n}] complaint count per division
--   bySubStation       [{k, n}] per sub station (client slices top 15 / top 5)
--   byAreaType         [{k, n}] per area type
--   beyondByDivision   [{k, n}] 'Closed Beyond' count per division
--   daily              [{d, n, cr, frt, resSum, resN}] per IST date:
--                      total, closed by control room, closed by FRT,
--                      resolution-minutes sum and count (for avg trends)
--   months             [{key, label, total, beyond, resSum, resN}]
--   monthHeat          [{m, dow, hr, n}] dow 0=Mon..6=Sun, IST hour
--   monthSubStation    [{m, k, n, resSum, resN}]
--   monthDivision      [{m, k, n, resSum, resN}]
--   repeatMobile       top 50 repeat consumers by mobile, complaint list embedded
--   repeatNameAddr     top 50 repeat consumers by name+address
--
-- "Closed" follows the same heuristics the frontend used (status text +
-- closed date present). Resolution time = closed_date - complaint_date in
-- minutes, only when positive. Filters and dynamic-SQL planning follow
-- get_complaints_page.

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
WITH base AS MATERIALIZED (
    SELECT
        coalesce(nullif(trim(division), ''), 'Unknown')    AS division,
        coalesce(nullif(trim(sub_station), ''), 'Unknown') AS sub_station,
        coalesce(nullif(trim(area_type), ''), 'Unknown')   AS area_type,
        lower(trim(coalesce(status, '')))                  AS status_l,
        trim(coalesce(closed_status, ''))                  AS closed_status_t,
        upper(trim(coalesce(closed_by, '')))               AS closed_by_u,
        (complaint_date AT TIME ZONE 'Asia/Kolkata')       AS ts,
        (closed_date AT TIME ZONE 'Asia/Kolkata')          AS closed_ts,
        nullif(trim(coalesce(consumer_mobile, '')), '')    AS mobile,
        nullif(trim(coalesce(consumer_name, '')), '')      AS cname,
        nullif(trim(coalesce(consumer_address, '')), '')   AS caddr,
        raw_data
    FROM public.complaints
    WHERE
$q$ || conditions || $q$
),
enriched AS MATERIALIZED (
    SELECT base.*,
        ts::date AS d,
        to_char(date_trunc('month', ts), 'YYYY-MM') AS mkey,
        extract(hour FROM ts)::int AS hr,
        (extract(isodow FROM ts)::int - 1) AS dow,
        (closed_by_u LIKE '%CONTROL_ROOM_1%' OR closed_by_u LIKE '%CONTROL_ROOM_2%') AS is_cr,
        CASE
            WHEN status_l = 'complaint closed' THEN true
            WHEN status_l = 'pending' THEN false
            WHEN closed_ts IS NOT NULL THEN true
            WHEN status_l LIKE '%closed%' OR status_l LIKE '%resolve%' THEN true
            WHEN status_l LIKE '%attend%' AND status_l LIKE '%confirm%' THEN true
            ELSE false
        END AS is_closed,
        CASE WHEN closed_ts IS NOT NULL AND closed_ts > ts
             THEN extract(epoch FROM (closed_ts - ts)) / 60.0
        END AS res_mins
    FROM base
)
SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM enriched),
    'byDivision', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC, k), '[]'::jsonb)
        FROM (SELECT division AS k, count(*) AS n FROM enriched GROUP BY division) t
    ),
    'bySubStation', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC, k), '[]'::jsonb)
        FROM (SELECT sub_station AS k, count(*) AS n FROM enriched GROUP BY sub_station) t
    ),
    'byAreaType', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC, k), '[]'::jsonb)
        FROM (SELECT area_type AS k, count(*) AS n FROM enriched GROUP BY area_type) t
    ),
    'beyondByDivision', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC, k), '[]'::jsonb)
        FROM (
            SELECT division AS k, count(*) AS n
            FROM enriched
            WHERE closed_status_t = 'Closed Beyond'
            GROUP BY division
        ) t
    ),
    'daily', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'd', d, 'n', n, 'cr', cr, 'frt', frt,
                   'resSum', resSum, 'resN', resN
               ) ORDER BY d), '[]'::jsonb)
        FROM (
            SELECT d::text AS d, count(*) AS n,
                   count(*) FILTER (WHERE is_closed AND is_cr) AS cr,
                   count(*) FILTER (WHERE is_closed AND NOT is_cr) AS frt,
                   round(coalesce(sum(res_mins), 0)::numeric, 2) AS resSum,
                   count(res_mins) AS resN
            FROM enriched GROUP BY d
        ) t
    ),
    'months', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'key', mkey, 'label', label, 'total', n, 'beyond', beyond,
                   'resSum', resSum, 'resN', resN
               ) ORDER BY mkey DESC), '[]'::jsonb)
        FROM (
            SELECT mkey,
                   min(to_char(date_trunc('month', ts), 'FMMonth YYYY')) AS label,
                   count(*) AS n,
                   count(*) FILTER (WHERE closed_status_t = 'Closed Beyond') AS beyond,
                   round(coalesce(sum(res_mins), 0)::numeric, 2) AS resSum,
                   count(res_mins) AS resN
            FROM enriched GROUP BY mkey
        ) t
    ),
    'monthHeat', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('m', m, 'dow', dow, 'hr', hr, 'n', n)
                   ORDER BY m, dow, hr), '[]'::jsonb)
        FROM (
            SELECT mkey AS m, dow, hr, count(*) AS n
            FROM enriched GROUP BY mkey, dow, hr
        ) t
    ),
    'monthSubStation', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'm', m, 'k', k, 'n', n, 'resSum', resSum, 'resN', resN
               ) ORDER BY m, n DESC), '[]'::jsonb)
        FROM (
            SELECT mkey AS m, sub_station AS k, count(*) AS n,
                   round(coalesce(sum(res_mins), 0)::numeric, 2) AS resSum,
                   count(res_mins) AS resN
            FROM enriched GROUP BY mkey, sub_station
        ) t
    ),
    'monthDivision', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'm', m, 'k', k, 'n', n, 'resSum', resSum, 'resN', resN
               ) ORDER BY m, n DESC), '[]'::jsonb)
        FROM (
            SELECT mkey AS m, division AS k, count(*) AS n,
                   round(coalesce(sum(res_mins), 0)::numeric, 2) AS resSum,
                   count(res_mins) AS resN
            FROM enriched GROUP BY mkey, division
        ) t
    ),
    'repeatMobile', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'mobile', mobile, 'name', name, 'address', address,
                   'total', total, 'pending', pending, 'closed', closed,
                   'complaints', (
                       SELECT coalesce(jsonb_agg(jsonb_build_object(
                                  'Complaint Number', e2.raw_data->>'Complaint Number',
                                  'Division', e2.raw_data->>'Division',
                                  'Sub Station', e2.raw_data->>'Sub Station',
                                  'Complaint Date and Time', e2.raw_data->>'Complaint Date and Time',
                                  'Status', e2.raw_data->>'Status',
                                  'Closed Status', e2.raw_data->>'Closed Status',
                                  'Closed Date', e2.raw_data->>'Closed Date',
                                  'Closing Remarks', e2.raw_data->>'Closing Remarks'
                              ) ORDER BY e2.ts DESC), '[]'::jsonb)
                       FROM enriched e2 WHERE e2.mobile = t.mobile
                   )
               ) ORDER BY total DESC), '[]'::jsonb)
        FROM (
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
        ) t
    ),
    'repeatNameAddr', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'mobile', mobile, 'name', name, 'address', address,
                   'total', total, 'pending', pending, 'closed', closed,
                   'complaints', (
                       SELECT coalesce(jsonb_agg(jsonb_build_object(
                                  'Complaint Number', e2.raw_data->>'Complaint Number',
                                  'Division', e2.raw_data->>'Division',
                                  'Sub Station', e2.raw_data->>'Sub Station',
                                  'Complaint Date and Time', e2.raw_data->>'Complaint Date and Time',
                                  'Status', e2.raw_data->>'Status',
                                  'Closed Status', e2.raw_data->>'Closed Status',
                                  'Closed Date', e2.raw_data->>'Closed Date',
                                  'Closing Remarks', e2.raw_data->>'Closing Remarks'
                              ) ORDER BY e2.ts DESC), '[]'::jsonb)
                       FROM enriched e2
                       WHERE e2.cname IS NOT NULL
                         AND lower(e2.cname || '|' || coalesce(e2.caddr, '')) = t.k
                   )
               ) ORDER BY total DESC), '[]'::jsonb)
        FROM (
            SELECT lower(cname || '|' || coalesce(caddr, '')) AS k,
                   max(cname) AS name,
                   coalesce(max(caddr), '') AS address,
                   coalesce(max(mobile), 'N/A') AS mobile,
                   count(*) AS total,
                   count(*) FILTER (WHERE status_l LIKE '%pending%') AS pending,
                   count(*) FILTER (WHERE status_l LIKE '%closed%') AS closed
            FROM enriched
            WHERE cname IS NOT NULL
            GROUP BY lower(cname || '|' || coalesce(caddr, ''))
            HAVING count(*) > 1
            ORDER BY count(*) DESC
            LIMIT 50
        ) t
    )
)
$q$
    INTO result;

    RETURN result;
END;
$func$;
