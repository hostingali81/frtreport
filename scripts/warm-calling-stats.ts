import { createClient } from '@supabase/supabase-js';

import { warmCallingStats } from '../app/lib/calling-stats-cache';

// ---------------------------------------------------------------------------
// Precompute the Calling Report's preset stats into the `reports` table.
// ---------------------------------------------------------------------------
// /api/calling/analytics serves a preset range from one precomputed row instead
// of running get_calling_stats live. This used to be a side effect of the Vercel
// /api/cron route, which an external pinger (cron-job.org) hit every ~2 minutes.
// That pinger was removed to cut Vercel usage — and the precompute silently went
// with it, so every dashboard open fell back to the live RPC and the rows sat 12
// days stale. This script puts the warming back on the GitHub runner, where it
// costs nothing (the repo is public, so Actions minutes are free) and never
// touches a Vercel function.
//
// Cost per run is bounded by PRESET_MIN_INTERVAL_MS in calling-stats-cache.ts:
// a preset whose row is still fresh is skipped. Keep the schedule and those
// intervals in step with CALLING_STATS_MAX_AGE_MS (30 min) — a row older than
// that is rejected as stale and the dashboard pays the live RPC anyway.
// ---------------------------------------------------------------------------

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE missing');

  const started = Date.now();
  const result = await warmCallingStats(createClient(url, key));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`[WARM] done in ${seconds}s`, result);
  // A failure here is not worth failing the workflow over — the dashboard just
  // falls back to computing the range live, exactly as it does for a custom
  // range. But do surface it so a persistent failure is visible in the log.
  if (result.failed.length) console.warn(`[WARM] failed presets: ${result.failed.join(', ')}`);
}

main().catch((e) => {
  console.error(`[WARM] ${e?.message ?? e}`);
  process.exit(1);
});
