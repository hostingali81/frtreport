import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

const OPTIONS_CACHE_TTL = 15 * 60 * 1000;
let optionsCache: { timestamp: number; payload: any } | null = null;

function formatMonthLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  });
}

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

    const { data, error } = await supabase
      .from('complaints')
      .select('division, sub_division, sub_station, status, closed_status, complaint_date');

    if (error) throw error;

    const divisions = [...new Set(data?.map((row) => row.division).filter(Boolean))].sort();
    const subDivisions = [...new Set(data?.map((row) => row.sub_division).filter(Boolean))].sort();
    const subStations = [...new Set(data?.map((row) => row.sub_station).filter(Boolean))].sort();
    const statuses = [...new Set(data?.map((row) => row.status).filter(Boolean))].sort();
    const closedStatuses = [...new Set(data?.map((row) => row.closed_status).filter(Boolean))].sort();
    const months = [...new Set(
      data
        ?.map((row) => formatMonthLabel(row.complaint_date))
        .filter(Boolean)
    )]
      .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())
      .map((month) => ({ value: month!, label: month! }));

    const payload = {
      success: true,
      options: {
        divisions,
        subDivisions,
        subStations,
        statuses,
        closedStatuses,
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
