-- Add index on complaint_contacts.mobile for fast caller ID lookups.
-- The incoming-call caller-lookup API queries by mobile number; without this
-- index every lookup would scan the full table.
CREATE INDEX IF NOT EXISTS complaint_contacts_mobile_idx
ON public.complaint_contacts (mobile);
