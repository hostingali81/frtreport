-- Create index on complaint_date to optimize the 30-day filter and sorting
CREATE INDEX IF NOT EXISTS idx_complaints_date ON public.complaints (complaint_date DESC);
