-- The unfiltered get_complaints_stats aggregation takes 5-10s when the
-- database cache is cold (index-only scan of ~30MB + grouping), which tripped
-- the default 8s statement timeout on production (HTTP 500 on the homepage /
-- charts "All Months" view). The app's API routes are the only service_role
-- consumer; give them 30s so cold full-table aggregations finish while still
-- guarding against runaway queries. Takes effect on new pooled connections.

ALTER ROLE service_role SET statement_timeout = '30s';
