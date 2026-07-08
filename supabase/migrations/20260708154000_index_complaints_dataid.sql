-- Create an index on dataid in the complaints table to optimize getCachedContact lookups
CREATE INDEX IF NOT EXISTS idx_complaints_dataid ON public.complaints (dataid);
