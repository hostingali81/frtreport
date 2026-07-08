-- Add consumer_remarks to complaints table and recover data from complaint_contacts
ALTER TABLE public.complaints
ADD COLUMN IF NOT EXISTS consumer_remarks text;

UPDATE public.complaints c
SET consumer_remarks = cc.remarks
FROM public.complaint_contacts cc
JOIN public.live_complaints lc ON cc.dataid = lc.dataid
WHERE c.complaint_number = lc.complaint_number
  AND cc.remarks IS NOT NULL
  AND cc.remarks <> '';
