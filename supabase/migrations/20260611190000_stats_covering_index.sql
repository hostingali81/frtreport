-- The complaints heap is ~131MB because raw_data jsonb is stored inline, so
-- the unfiltered get_complaints_stats scan was pure disk I/O (~12s on this
-- instance). This covering index holds every column the stats function (and
-- its filters) needs in ~30MB, letting the planner use an index-only scan
-- and skip the heap entirely. raw_data is only fetched by primary key for
-- the ~250 embedded repeat-consumer complaints.

CREATE INDEX IF NOT EXISTS idx_complaints_stats_cover
ON public.complaints (complaint_date)
INCLUDE (
    id, division, sub_division, sub_station, area_type,
    status, closed_status, closed_by, closed_date,
    consumer_mobile, consumer_name, consumer_address
);

ANALYZE public.complaints;
