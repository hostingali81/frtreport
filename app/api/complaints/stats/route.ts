import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { buildRpcFilterParams } from '../../../lib/statsParams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Cold full-table aggregation can take ~10s; Vercel Hobby defaults to 10s.
export const maxDuration = 60;

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

// Chart aggregates are computed in the database (get_complaints_stats RPC),
// so the chart pages no longer download every matching row.

const STATS_CACHE_TTL = 60 * 1000;
const statsCache = new Map<string, { timestamp: number; payload: any }>();

async function getLastScrapedAt() {
  const { data: metadata } = await supabase!
    .from('scrape_metadata')
    .select('last_scrape_at')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return metadata?.last_scrape_at
    ? new Date(metadata.last_scrape_at).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    : null;
}

export async function GET(request: Request) {
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get('refresh') === '1';

  const params = new URLSearchParams(searchParams);
  params.delete('refresh');
  const cacheKey = `stats:${params.toString() || 'default'}`;

  if (!forceRefresh) {
    const cached = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < STATS_CACHE_TTL) {
      return NextResponse.json(cached.payload, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
        }
      });
    }
  }

  try {
    const rpcParams = buildRpcFilterParams(searchParams);
    let [{ data, error }, lastScrapedAt] = await Promise.all([
      supabase.rpc('get_complaints_stats', rpcParams),
      getLastScrapedAt()
    ]);

    // A cold full-table aggregation can hit the statement timeout (57014);
    // the retry runs against warmed buffers and comfortably fits.
    if (error && (error as any).code === '57014') {
      ({ data, error } = await supabase.rpc('get_complaints_stats', rpcParams));
    }

    if (error) throw error;

    const payload = {
      success: true,
      stats: data,
      lastScrapedAt
    };

    statsCache.set(cacheKey, { timestamp: Date.now(), payload });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
      }
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message || 'Failed to compute stats'
    }, { status: 500 });
  }
}
