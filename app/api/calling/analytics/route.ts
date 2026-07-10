import { NextResponse } from 'next/server';

import { matchPresetKey, readCachedCallingStats } from '../../../lib/calling-stats-cache';
import { getSupabaseClient } from '../../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Aggregates for the Calling Report tab on /analytics. Everything is computed
// in the database (get_calling_stats RPC) and comes back as one jsonb doc, so
// no row downloads and no PostgREST row cap. Counts only - no consumer PII and
// no operator names - so like /api/complaints/stats (which feeds the same
// unauthenticated dashboard) this endpoint does not require a session.

const CACHE_TTL = 60 * 1000;
const cache = new Map<string, { timestamp: number; payload: any }>();

function istDateOnly(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function subtractDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const { searchParams } = new URL(request.url);
    const allTime = searchParams.get('all') === '1';
    const todayIst = istDateOnly(new Date());
    let from = searchParams.get('from') || subtractDays(todayIst, 6);
    let to = searchParams.get('to') || todayIst;
    if (!DATE_ONLY.test(from)) from = subtractDays(todayIst, 6);
    if (!DATE_ONLY.test(to)) to = todayIst;

    const cacheKey = allTime ? 'all' : `${from}|${to}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json(cached.payload);
    }

    // Fast path: the preset buttons (Today / 7d / 30d / All) are precomputed by
    // the cron into the `reports` table, so serve that single row instead of the
    // cold ~4-8s RPC. Custom date ranges fall through to the live RPC below.
    const presetKey = matchPresetKey({ allTime, from, to });
    if (presetKey) {
      const precomputed = await readCachedCallingStats(supabase, presetKey);
      if (precomputed) {
        const payload = { success: true, range: allTime ? null : { from, to }, stats: precomputed.stats, precomputedAt: precomputed.computedAt };
        cache.set(cacheKey, { timestamp: Date.now(), payload });
        return NextResponse.json(payload);
      }
    }

    const { data, error } = await supabase.rpc('get_calling_stats', {
      p_from: allTime ? null : `${from}T00:00:00+05:30`,
      p_to: allTime ? null : `${to}T23:59:59+05:30`
    });
    if (error) throw new Error(error.message);

    const payload = { success: true, range: allTime ? null : { from, to }, stats: data };
    cache.set(cacheKey, { timestamp: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
