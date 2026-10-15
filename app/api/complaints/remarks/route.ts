import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { buildRpcFilterParams } from '../../../lib/statsParams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// An all-time range scans every complaint (~25s measured on 234k rows).
export const maxDuration = 60;

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

// Remarks Analysis tab: closing-remark aggregates from get_remarks_stats, with
// the same filters as /api/complaints/stats (so the tab follows the page's
// FilterBar). ?remark=<text> narrows to one remark for the drill-down.
// Aggregates only — no consumer data — same open model as the stats endpoint.

const CACHE_TTL = 60 * 1000;
const cache = new Map<string, { timestamp: number; payload: unknown }>();
const CACHE_MAX = 100;

export async function GET(request: Request) {
  if (!supabase) {
    return NextResponse.json({ success: false, error: 'Database not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get('refresh') === '1';
  const params = new URLSearchParams(searchParams);
  params.delete('refresh');
  const cacheKey = params.toString() || 'default';

  if (!forceRefresh) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.timestamp < CACHE_TTL) {
      return NextResponse.json(hit.payload, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
      });
    }
  }

  try {
    const remark = searchParams.get('remark');
    const rpcParams = {
      ...buildRpcFilterParams(searchParams),
      p_remark: remark && remark.trim() ? remark : null,
      // 6 series + Other: palette slots 7-8 fail the normal-vision separation check.
      p_top: 6
    };

    let { data, error } = await supabase.rpc('get_remarks_stats', rpcParams);
    // A cold scan can hit the statement timeout (57014); the retry runs on
    // warmed buffers, the same trick /api/complaints/stats uses.
    if (error && error.code === '57014') {
      ({ data, error } = await supabase.rpc('get_remarks_stats', rpcParams));
    }
    if (error) throw new Error(error.message);

    const payload = { success: true, remarks: data };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(cacheKey, { timestamp: Date.now(), payload });

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute remark stats';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
