-- Calling v2: accurate call metrics + complaint claiming (two operators should
-- not call the same consumer at once).

-- Exact call duration (from the device call log) and whether the consumer
-- actually answered. Old rows keep nulls; reports fall back to call_status.
alter table public.call_logs
  add column if not exists duration_seconds integer,
  add column if not exists connected boolean;

-- Soft claim: set when an operator opens a complaint to call. A claim is
-- considered stale after ~3 minutes (enforced in the API, not the DB).
alter table public.live_complaints
  add column if not exists claimed_by uuid,
  add column if not exists claimed_by_name text,
  add column if not exists claimed_at timestamptz;
