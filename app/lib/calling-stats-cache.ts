// Precomputed cache for the Calling Report stats.
//
// get_calling_stats is cheap when the DB is warm (~0.5s) but slow on a cold
// cache (~4-8s) because it joins the 122k-row `complaints` table through the
// live_complaints_full view. The dashboard is opened only now and then, so the
// working set keeps getting evicted and almost every open pays the cold cost.
//
// Fix: the cron precomputes each preset range's stats and stores the jsonb in
// the existing `reports` table (key/payload). A dashboard open for a preset then
// reads one row (~50ms) instead of running the RPC. Custom date ranges still run
// the RPC live. Staleness is bounded by the cron interval.

import type { SupabaseClient } from '@supabase/supabase-js';

export const CALLING_STATS_KEY_PREFIX = 'calling_stats:';
// Precomputed rows older than this are ignored (fall back to the live RPC), so a
// stalled cron can never serve badly stale numbers.
export const CALLING_STATS_MAX_AGE_MS = 30 * 60 * 1000;

function istDateOnly(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const m = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}
function subtractDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export type PresetRange = { key: string; from: string | null; to: string | null };

// The exact ranges the report's preset buttons request (mirrors CallingReport.tsx).
export function presetRanges(now = new Date()): PresetRange[] {
  const today = istDateOnly(now);
  return [
    { key: 'today', from: today, to: today },
    { key: '7d', from: subtractDays(today, 6), to: today },
    { key: '30d', from: subtractDays(today, 29), to: today },
    { key: 'all', from: null, to: null }
  ];
}

// Map an incoming request range to a preset key, or null for a custom range.
export function matchPresetKey(opts: { allTime: boolean; from: string; to: string }, now = new Date()): string | null {
  if (opts.allTime) return 'all';
  const r = presetRanges(now).find((p) => p.from === opts.from && p.to === opts.to);
  return r ? r.key : null;
}

function rpcArgs(p: PresetRange) {
  return {
    p_from: p.from ? `${p.from}T00:00:00+05:30` : null,
    p_to: p.to ? `${p.to}T23:59:59+05:30` : null
  };
}

// How stale a preset may get before this warmer recomputes it. The pinger hits
// /api/cron every ~2 min to keep the live grid fresh, but each get_calling_stats
// call scans a large slice of the 124k-row `complaints` table — and the wider
// ranges ('30d', 'all') scan almost all of it through live_complaints_full.
// Recomputing all four presets on every 2-min ping saturates the free-tier
// disk-IO budget and throttles the whole database. So only 'today' (cheap, the
// number people watch) is refreshed every cycle; the heavy ranges recompute at
// most this often. All windows stay under CALLING_STATS_MAX_AGE_MS so cached
// reads are never rejected as stale.
const PRESET_MIN_INTERVAL_MS: Record<string, number> = {
  today: 0,
  '7d': 10 * 60 * 1000,
  '30d': 15 * 60 * 1000,
  all: 15 * 60 * 1000,
};

// Precompute + store every preset's stats. Best-effort per range so one failure
// doesn't sink the rest. Called from the cron after the live grid is synced.
// A preset whose cached row is still fresh (within PRESET_MIN_INTERVAL_MS) is
// skipped, so the steady-state cost of a ping is just the cheap 'today' pass.
export async function warmCallingStats(
  supabase: SupabaseClient
): Promise<{ warmed: string[]; skipped: string[]; failed: string[] }> {
  const warmed: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const p of presetRanges()) {
    try {
      const minInterval = PRESET_MIN_INTERVAL_MS[p.key] ?? 0;
      if (minInterval > 0) {
        const { data: existing } = await supabase
          .from('reports')
          .select('payload')
          .eq('key', `${CALLING_STATS_KEY_PREFIX}${p.key}`)
          .maybeSingle();
        const computedAt = (existing?.payload as { computedAt?: string } | undefined)?.computedAt;
        if (computedAt && Date.now() - new Date(computedAt).getTime() < minInterval) {
          skipped.push(p.key);
          continue;
        }
      }
      const { data, error } = await supabase.rpc('get_calling_stats', rpcArgs(p));
      if (error) throw new Error(error.message);
      const { error: upErr } = await supabase.from('reports').upsert(
        { key: `${CALLING_STATS_KEY_PREFIX}${p.key}`, payload: { stats: data, from: p.from, to: p.to, computedAt: new Date().toISOString() } },
        { onConflict: 'key' }
      );
      if (upErr) throw new Error(upErr.message);
      warmed.push(p.key);
    } catch {
      failed.push(p.key);
    }
  }
  return { warmed, skipped, failed };
}

// Read a fresh precomputed preset, or null if missing/stale.
export async function readCachedCallingStats(
  supabase: SupabaseClient,
  key: string
): Promise<{ stats: unknown; computedAt: string } | null> {
  const { data, error } = await supabase
    .from('reports')
    .select('payload')
    .eq('key', `${CALLING_STATS_KEY_PREFIX}${key}`)
    .maybeSingle();
  if (error || !data?.payload) return null;
  const payload = data.payload as { stats?: unknown; computedAt?: string };
  if (!payload.stats || !payload.computedAt) return null;
  if (Date.now() - new Date(payload.computedAt).getTime() > CALLING_STATS_MAX_AGE_MS) return null;
  return { stats: payload.stats, computedAt: payload.computedAt };
}
