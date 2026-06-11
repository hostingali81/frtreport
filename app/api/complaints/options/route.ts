import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

const OPTIONS_CACHE_TTL = 15 * 60 * 1000;
let optionsCache: { timestamp: number; payload: any } | null = null;

export async function GET() {
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    if (optionsCache && Date.now() - optionsCache.timestamp < OPTIONS_CACHE_TTL) {
      return NextResponse.json(optionsCache.payload, {
        headers: {
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600'
        }
      });
    }

    // Distinct values are computed in the database (get_filter_options RPC).
    // Selecting whole columns through PostgREST silently capped at 1000 rows,
    // so the old dropdowns were built from an incomplete sample.
    const { data, error } = await supabase.rpc('get_filter_options');

    if (error) throw error;

    const months = ((data?.months || []) as string[]).map((month) => ({
      value: month,
      label: month
    }));

    const payload = {
      success: true,
      options: {
        divisions: data?.divisions || [],
        subDivisions: data?.subDivisions || [],
        subStations: data?.subStations || [],
        statuses: data?.statuses || [],
        closedStatuses: data?.closedStatuses || [],
        months: [{ value: 'All', label: 'All Months' }, ...months]
      }
    };

    optionsCache = {
      timestamp: Date.now(),
      payload
    };

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600'
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
