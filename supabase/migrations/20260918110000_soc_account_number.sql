-- FRT's report API started sending two new columns: SOC (Source of Complaint —
-- phone number / CONSUMER APP / IVRS / CHATBOT) and Account Number (consumer's
-- electricity account number, blank on some rows). Store both as real columns.
-- Old rows will be NULL here until re-scraped; the scraper now writes both on
-- upsert, and — like the `feeder` column before it — adding these keys to the
-- upsert record changes every content_hash once, so the first scrape after
-- deploy rewrites the rows inside its window (expected).

ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS soc text;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS account_number text;

-- get_complaints_page feeds the report's "export all" / fetchAll path with
-- label-cased jsonb rows; add the two new columns so exports and the paged
-- table pick them up without an extra round trip.
CREATE OR REPLACE FUNCTION public.get_complaints_page(
    p_division text DEFAULT NULL,
    p_sub_division text DEFAULT NULL,
    p_sub_station text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_closed_status text DEFAULT NULL,
    p_from timestamptz DEFAULT NULL,
    p_to timestamptz DEFAULT NULL,
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
    IF p_after_date IS NOT NULL AND p_after_id IS NOT NULL THEN
        conditions := conditions || format(' AND (complaint_date, id) < (%L::timestamptz, %L::bigint)', p_after_date, p_after_id);
    END IF;

    EXECUTE format(
        'WITH page AS (
            SELECT
                jsonb_build_object(
                    ''Complaint Number'', complaint_number,
                    ''Division'', division,
                    ''Sub Division'', sub_division,
                    ''Sub Station'', sub_station,
                    ''Consumer Name'', consumer_name,
                    ''Consumer Mobile'', consumer_mobile,
                    ''Consumer Address'', consumer_address,
                    ''Complaint Type'', complaint_type,
                    ''Complaint Sub Type'', complaint_sub_type,
                    ''Status'', status,
                    ''Closed Status'', closed_status,
                    ''Closed By'', closed_by,
                    ''Complaint Date and Time'', to_char(complaint_date at time zone ''Asia/Kolkata'', ''MM/DD/YYYY HH12:MI AM''),
                    ''Closed Date'', CASE WHEN closed_date IS NOT NULL THEN to_char(closed_date at time zone ''Asia/Kolkata'', ''MM/DD/YYYY HH12:MI AM'') ELSE NULL END,
                    ''Closing Remarks'', closing_remarks,
                    ''Area Type'', area_type,
                    ''Feeder'', feeder,
                    ''SOC'', soc,
                    ''Account Number'', account_number
                ) as mapped_data,
                complaint_date, id
            FROM public.complaints
            WHERE %s
            ORDER BY complaint_date DESC, id DESC
            LIMIT %s
        )
        SELECT jsonb_build_object(
            ''rows'', coalesce((SELECT jsonb_agg(mapped_data ORDER BY complaint_date DESC, id DESC) FROM page), ''[]''::jsonb),
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
