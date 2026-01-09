import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

export async function GET() {
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const { data, error } = await supabase
      .from('complaints')
      .select('division, sub_division, sub_station, status, closed_status');

    if (error) throw error;

    const divisions = [...new Set(data?.map(r => r.division).filter(Boolean))].sort();
    const subDivisions = [...new Set(data?.map(r => r.sub_division).filter(Boolean))].sort();
    const subStations = [...new Set(data?.map(r => r.sub_station).filter(Boolean))].sort();
    const statuses = [...new Set(data?.map(r => r.status).filter(Boolean))].sort();
    const closedStatuses = [...new Set(data?.map(r => r.closed_status).filter(Boolean))].sort();

    return NextResponse.json({
      success: true,
      options: {
        divisions,
        subDivisions,
        subStations,
        statuses,
        closedStatuses
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
