-- Website speedup: applied on 2026-06-11 via Supabase Management API.
-- Kept in the repo as the source of truth for what exists in the database.
--
-- 1. search_text generated column + trigram index
--    The search box used to OR 14 ILIKE conditions (sequential scan per query).
--    A single pre-concatenated column with a GIN trigram index makes
--    '%term%' searches index-assisted.
--
-- 2. (complaint_date DESC, id DESC) composite index
--    Supports keyset pagination used by get_complaints_page. Replaces the
--    redundant single-column idx_complaints_date.
--
-- 3. get_filter_options() RPC
--    The options endpoint used to select 6 columns of the whole table through
--    PostgREST, which silently caps at 1000 rows - dropdowns were built from a
--    1000-row sample (incomplete lists). The RPC computes the distinct values
--    with recursive loose index scans (a few ms) and returns a few KB.
--
-- 4. get_complaints_page() RPC
--    fetchAll used to walk the table in 1000-row OFFSET batches (deep offsets
--    re-scan everything before them). The RPC does keyset pagination and
--    returns 10k rows of raw_data per call as a single jsonb value
--    (PostgREST row cap does not apply to scalar function results). It builds
--    the WHERE clause dynamically so every call gets a plan for the actual
--    filters; static "(param IS NULL OR col = param)" chains were planned
--    generically and skipped all indexes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.complaints
ADD COLUMN IF NOT EXISTS search_text text GENERATED ALWAYS AS (
    lower(
        coalesce(complaint_number, '') || ' ' ||
        coalesce(division, '') || ' ' ||
        coalesce(sub_division, '') || ' ' ||
        coalesce(sub_station, '') || ' ' ||
        coalesce(consumer_name, '') || ' ' ||
        coalesce(consumer_mobile, '') || ' ' ||
        coalesce(consumer_address, '') || ' ' ||
        coalesce(complaint_type, '') || ' ' ||
        coalesce(complaint_sub_type, '') || ' ' ||
        coalesce(status, '') || ' ' ||
        coalesce(closed_status, '') || ' ' ||
        coalesce(closed_by, '') || ' ' ||
        coalesce(closing_remarks, '') || ' ' ||
        coalesce(area_type, '')
    )
) STORED;

CREATE INDEX IF NOT EXISTS idx_complaints_search_trgm
ON public.complaints USING gin (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_complaints_date_id
ON public.complaints (complaint_date DESC, id DESC);

DROP INDEX IF EXISTS public.idx_complaints_date;

CREATE OR REPLACE FUNCTION public.get_filter_options()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $func$
WITH RECURSIVE
div(v) AS (
    (SELECT division FROM public.complaints WHERE division IS NOT NULL AND division <> '' ORDER BY division LIMIT 1)
    UNION ALL
    SELECT (SELECT division FROM public.complaints WHERE division > d.v AND division <> '' ORDER BY division LIMIT 1)
    FROM div d WHERE d.v IS NOT NULL
),
subdiv(v) AS (
    (SELECT sub_division FROM public.complaints WHERE sub_division IS NOT NULL AND sub_division <> '' ORDER BY sub_division LIMIT 1)
    UNION ALL
    SELECT (SELECT sub_division FROM public.complaints WHERE sub_division > d.v AND sub_division <> '' ORDER BY sub_division LIMIT 1)
    FROM subdiv d WHERE d.v IS NOT NULL
),
substn(v) AS (
    (SELECT sub_station FROM public.complaints WHERE sub_station IS NOT NULL AND sub_station <> '' ORDER BY sub_station LIMIT 1)
    UNION ALL
    SELECT (SELECT sub_station FROM public.complaints WHERE sub_station > d.v AND sub_station <> '' ORDER BY sub_station LIMIT 1)
    FROM substn d WHERE d.v IS NOT NULL
),
stat(v) AS (
    (SELECT status FROM public.complaints WHERE status IS NOT NULL AND status <> '' ORDER BY status LIMIT 1)
    UNION ALL
    SELECT (SELECT status FROM public.complaints WHERE status > d.v AND status <> '' ORDER BY status LIMIT 1)
    FROM stat d WHERE d.v IS NOT NULL
),
cstat(v) AS (
    (SELECT closed_status FROM public.complaints WHERE closed_status IS NOT NULL AND closed_status <> '' ORDER BY closed_status LIMIT 1)
    UNION ALL
    SELECT (SELECT closed_status FROM public.complaints WHERE closed_status > d.v AND closed_status <> '' ORDER BY closed_status LIMIT 1)
    FROM cstat d WHERE d.v IS NOT NULL
),
bounds AS (
    SELECT min(complaint_date) AS min_d, max(complaint_date) AS max_d FROM public.complaints
),
months AS (
    SELECT
        to_char(gs, 'FMMonth YYYY') AS label,
        gs AS month_start
    FROM bounds,
         generate_series(
             date_trunc('month', min_d AT TIME ZONE 'Asia/Kolkata'),
             date_trunc('month', max_d AT TIME ZONE 'Asia/Kolkata'),
             interval '1 month'
         ) gs
    WHERE EXISTS (
        SELECT 1 FROM public.complaints c
        WHERE c.complaint_date >= gs AT TIME ZONE 'Asia/Kolkata'
          AND c.complaint_date < (gs + interval '1 month') AT TIME ZONE 'Asia/Kolkata'
    )
)
SELECT jsonb_build_object(
    'divisions',      (SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb) FROM div WHERE v IS NOT NULL),
    'subDivisions',   (SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb) FROM subdiv WHERE v IS NOT NULL),
    'subStations',    (SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb) FROM substn WHERE v IS NOT NULL),
    'statuses',       (SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb) FROM stat WHERE v IS NOT NULL),
    'closedStatuses', (SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb) FROM cstat WHERE v IS NOT NULL),
    'months',         (SELECT coalesce(jsonb_agg(label ORDER BY month_start DESC), '[]'::jsonb) FROM months)
);
$func$;

CREATE OR REPLACE FUNCTION public.get_complaints_page(
    p_division text DEFAULT NULL,
    p_sub_division text DEFAULT NULL,
    p_sub_station text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_closed_status text DEFAULT NULL,
    p_from timestamptz DEFAULT NULL,
    p_to timestamptz DEFAULT NULL,
    p_search text DEFAULT NULL,
    p_after_date timestamptz DEFAULT NULL,
    p_after_id bigint DEFAULT NULL,
    p_limit integer DEFAULT 10000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $func$
DECLARE
    conditions text := 'TRUE';
    result jsonb;
BEGIN
    -- Dynamic SQL so every call is planned with literal values; the generic
    -- plan for "(param IS NULL OR col = param)" chains skips all indexes.
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
    IF p_after_date IS NOT NULL AND p_after_id IS NOT NULL THEN
        conditions := conditions || format(' AND (complaint_date, id) < (%L::timestamptz, %L::bigint)', p_after_date, p_after_id);
    END IF;

    EXECUTE format(
        'WITH page AS (
            SELECT raw_data, complaint_date, id
            FROM public.complaints
            WHERE %s
            ORDER BY complaint_date DESC, id DESC
            LIMIT %s
        )
        SELECT jsonb_build_object(
            ''rows'', coalesce((SELECT jsonb_agg(raw_data ORDER BY complaint_date DESC, id DESC) FROM page), ''[]''::jsonb),
            ''row_count'', (SELECT count(*) FROM page),
            ''next_date'', (SELECT complaint_date FROM page ORDER BY complaint_date ASC, id ASC LIMIT 1),
            ''next_id'', (SELECT id FROM page ORDER BY complaint_date ASC, id ASC LIMIT 1)
        )',
        conditions,
        LEAST(GREATEST(coalesce(p_limit, 10000), 1), 20000)
    ) INTO result;

    RETURN result;
END;
$func$;

ANALYZE public.complaints;
