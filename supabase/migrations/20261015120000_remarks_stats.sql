-- Remarks Analysis tab (/analytics): aggregates over complaints.closing_remarks.
--
-- Remarks are shown as written. Since early Aug 2026 most arrive from an FRT
-- dropdown (LT Line Fault, Phase Issue, ...); older ones are free text and are
-- deliberately NOT mapped onto the dropdown values (the user asked for them as
-- they are). The only folding is case and whitespace, so "Supply Normal" and
-- "supply  normal" count together; the label shown is the most common spelling.
--
-- Takes the same filters as get_complaints_stats, so the tab follows the
-- page's global FilterBar. p_remark narrows everything to one remark (the
-- drill-down); p_top is how many remarks get their own series in the cross-tabs
-- (the rest fold into '__other__').
--
-- Payload:
--   total, withRemark, blank, distinct
--   remarks: [{k, label, n, pending, beyond, within, resSum, resN}]  (top 2000 by n)
--   top:     [k, ...]
--   cross:   {dim: [[bucket, key, ss, n, pending, beyond, resSum, resN], ...]}
--            dims: division, subDivision, subStation, feeder (ss = its
--            substation), areaType, complaintType, closedStatus, closedBy, soc,
--            day, month, hour, dow (0 = Monday)

CREATE OR REPLACE FUNCTION public.get_remarks_stats(
    p_division text DEFAULT NULL,
    p_sub_division text DEFAULT NULL,
    p_sub_station text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_closed_status text DEFAULT NULL,
    p_from timestamptz DEFAULT NULL,
    p_to timestamptz DEFAULT NULL,
    p_remark text DEFAULT NULL,
    p_top integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
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

    EXECUTE
$q$
WITH raw AS (
    SELECT
        nullif(lower(regexp_replace(btrim(coalesce(closing_remarks, '')), '\s+', ' ', 'g')), '') AS rk,
        regexp_replace(btrim(coalesce(closing_remarks, '')), '\s+', ' ', 'g')                   AS rt,
        coalesce(nullif(btrim(division), ''), 'Unknown')           AS division,
        coalesce(nullif(btrim(sub_division), ''), 'Unknown')       AS sub_division,
        coalesce(nullif(btrim(sub_station), ''), 'Unknown')        AS sub_station,
        coalesce(nullif(btrim(feeder), ''), 'Unknown')             AS feeder,
        coalesce(nullif(btrim(area_type), ''), 'Unknown')          AS area_type,
        coalesce(nullif(btrim(complaint_sub_type), ''), nullif(btrim(complaint_type), ''), 'Unknown') AS csub,
        coalesce(nullif(btrim(closed_status), ''), 'Unknown')      AS cst,
        coalesce(nullif(btrim(closed_by), ''), 'Unknown')          AS cby,
        coalesce(nullif(btrim(soc), ''), 'Unknown')                AS soc,
        lower(btrim(coalesce(status, '')))                         AS status_l,
        btrim(coalesce(closed_status, ''))                         AS closed_status_t,
        (complaint_date AT TIME ZONE 'Asia/Kolkata')               AS ts,
        complaint_date,
        closed_date
    FROM public.complaints
    WHERE
$q$ || conditions || $q$
),
base AS MATERIALIZED (
    SELECT
        rk, rt, division, sub_division, sub_station, feeder, area_type, csub, cst, cby, soc,
        to_char(ts, 'YYYY-MM-DD')                AS d,
        to_char(ts, 'YYYY-MM')                   AS mkey,
        extract(hour FROM ts)::int::text         AS hr,
        (extract(isodow FROM ts)::int - 1)::text AS dow,
        closed_status_t = 'Closed Beyond'        AS is_beyond,
        closed_status_t = 'Closed Within'        AS is_within,
        -- Same "closed" rule as get_complaints_stats, so pending counts match
        -- the page's KPI strip.
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
        END AS res_mins
    FROM raw
    WHERE $1 IS NULL
       OR rk = nullif(lower(regexp_replace(btrim($1), '\s+', ' ', 'g')), '')
),
per_remark AS MATERIALIZED (
    SELECT
        rk,
        mode() WITHIN GROUP (ORDER BY rt) AS label,
        count(*)                          AS n,
        count(*) FILTER (WHERE NOT is_closed) AS pending,
        count(*) FILTER (WHERE is_beyond)     AS beyond,
        count(*) FILTER (WHERE is_within)     AS within,
        round(coalesce(sum(res_mins), 0)::numeric, 2) AS res_sum,
        count(res_mins)                   AS res_n
    FROM base
    WHERE rk IS NOT NULL
    GROUP BY rk
),
top_k AS (
    SELECT rk FROM per_remark ORDER BY n DESC, rk LIMIT greatest($2, 1)
),
bucketed AS (
    SELECT b.*, CASE WHEN t.rk IS NOT NULL THEN b.rk ELSE '__other__' END AS bucket
    FROM base b
    LEFT JOIN top_k t ON t.rk = b.rk
    WHERE b.rk IS NOT NULL
),
g AS (
    SELECT
        bucket,
        CASE
            WHEN grouping(feeder) = 0       THEN 'feeder'
            WHEN grouping(sub_station) = 0  THEN 'subStation'
            WHEN grouping(division) = 0     THEN 'division'
            WHEN grouping(sub_division) = 0 THEN 'subDivision'
            WHEN grouping(area_type) = 0    THEN 'areaType'
            WHEN grouping(csub) = 0         THEN 'complaintType'
            WHEN grouping(cst) = 0          THEN 'closedStatus'
            WHEN grouping(cby) = 0          THEN 'closedBy'
            WHEN grouping(soc) = 0          THEN 'soc'
            WHEN grouping(d) = 0            THEN 'day'
            WHEN grouping(mkey) = 0         THEN 'month'
            WHEN grouping(hr) = 0           THEN 'hour'
            WHEN grouping(dow) = 0          THEN 'dow'
        END AS dim,
        coalesce(
            CASE WHEN grouping(feeder) = 0 THEN feeder END,
            CASE WHEN grouping(sub_station) = 0 THEN sub_station END,
            CASE WHEN grouping(division) = 0 THEN division END,
            CASE WHEN grouping(sub_division) = 0 THEN sub_division END,
            CASE WHEN grouping(area_type) = 0 THEN area_type END,
            CASE WHEN grouping(csub) = 0 THEN csub END,
            CASE WHEN grouping(cst) = 0 THEN cst END,
            CASE WHEN grouping(cby) = 0 THEN cby END,
            CASE WHEN grouping(soc) = 0 THEN soc END,
            CASE WHEN grouping(d) = 0 THEN d END,
            CASE WHEN grouping(mkey) = 0 THEN mkey END,
            CASE WHEN grouping(hr) = 0 THEN hr END,
            CASE WHEN grouping(dow) = 0 THEN dow END
        ) AS k,
        CASE WHEN grouping(feeder) = 0 THEN sub_station END AS ss,
        count(*) AS n,
        count(*) FILTER (WHERE NOT is_closed) AS pending,
        count(*) FILTER (WHERE is_beyond)     AS beyond,
        round(coalesce(sum(res_mins), 0)::numeric, 2) AS res_sum,
        count(res_mins) AS res_n
    FROM bucketed
    GROUP BY GROUPING SETS (
        (bucket, division),
        (bucket, sub_division),
        (bucket, sub_station),
        (bucket, sub_station, feeder),
        (bucket, area_type),
        (bucket, csub),
        (bucket, cst),
        (bucket, cby),
        (bucket, soc),
        (bucket, d),
        (bucket, mkey),
        (bucket, hr),
        (bucket, dow)
    )
)
SELECT jsonb_build_object(
    'total',      (SELECT count(*) FROM base),
    'withRemark', (SELECT count(*) FROM base WHERE rk IS NOT NULL),
    'blank',      (SELECT count(*) FROM base WHERE rk IS NULL),
    'blankPending', (SELECT count(*) FROM base WHERE rk IS NULL AND NOT is_closed),
    'distinct',   (SELECT count(*) FROM per_remark),
    'remarks', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                   'k', rk, 'label', label, 'n', n, 'pending', pending, 'beyond', beyond,
                   'within', within, 'resSum', res_sum, 'resN', res_n)
               ORDER BY n DESC, rk)
        FROM (SELECT * FROM per_remark ORDER BY n DESC, rk LIMIT 2000) pr
    ), '[]'::jsonb),
    'top', coalesce((SELECT jsonb_agg(rk ORDER BY n DESC, rk)
                     FROM per_remark WHERE rk IN (SELECT rk FROM top_k)), '[]'::jsonb),
    'cross', coalesce((
        SELECT jsonb_object_agg(dim, rows)
        FROM (
            SELECT dim, jsonb_agg(jsonb_build_array(bucket, k, ss, n, pending, beyond, res_sum, res_n)
                                  ORDER BY n DESC) AS rows
            FROM g
            GROUP BY dim
        ) per_dim
    ), '{}'::jsonb)
)
$q$
    INTO result
    USING p_remark, p_top;

    RETURN result;
END;
$func$;

-- Called only by the Next.js route with the service-role key.
REVOKE ALL ON FUNCTION public.get_remarks_stats(text, text, text, text, text, timestamptz, timestamptz, text, integer)
    FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_remarks_stats(text, text, text, text, text, timestamptz, timestamptz, text, integer)
    TO service_role;
