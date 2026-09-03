-- Defence in depth: take the table grants away from `anon` as well.
--
-- These three already return nothing to the anon key -- RLS is on and no policy
-- names `anon` -- but they return an empty list rather than a refusal, because
-- the SELECT grant is still there and only the policy stops the rows. Revoking
-- the grant makes the denial explicit, and means a permissive policy added by
-- mistake later cannot quietly open them up. `complaints` was already revoked in
-- 20260903120000; this brings the rest in line.
--
-- Nothing reads these with the anon key: every Next.js route uses the service
-- role (which bypasses both), and the app authenticates.
revoke select on public.live_complaints from anon;
revoke select on public.call_logs       from anon;
revoke select on public.profiles        from anon;
