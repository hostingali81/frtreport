import { NextResponse } from 'next/server';

import { getSession } from '../../../lib/session';
import { getSupabaseClient } from '../../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One complaint by dataid — used by the incoming-call flow to open the log form
// fast (a single indexed lookup) instead of pulling the whole grid + the 1000-row
// resolved list. Tries the live view first, then the main complaints table for
// complaints that have left the feed, and attaches the call_count/last-call.
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const dataid = Number(new URL(request.url).searchParams.get('dataid'));
    if (!Number.isFinite(dataid) || dataid <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid or missing dataid' }, { status: 400 });
    }

    // Live grid first (queue state + descriptive data, via the view).
    let row = (await supabase.from('live_complaints_full').select('*').eq('dataid', dataid).maybeSingle()).data as Record<string, unknown> | null;

    // Not in the live feed — reconstruct from the main complaints table.
    if (!row) {
      const { data: c } = await supabase
        .from('complaints')
        .select('dataid, complaint_number, complaint_type, complaint_sub_type, sub_station, area_type, feeder, complaint_date, status')
        .eq('dataid', dataid)
        .maybeSingle();
      if (c) {
        row = {
          dataid: c.dataid,
          complaint_number: c.complaint_number,
          complaint_type: c.complaint_type,
          complaint_sub_type: c.complaint_sub_type,
          area: c.sub_station,
          area_type: c.area_type,
          feeder: c.feeder,
          complaint_date: c.complaint_date,
          action_status: c.status,
          still_in_feed: false
        };
      }
    }

    if (!row) return NextResponse.json({ success: false, error: 'Complaint not found' }, { status: 404 });

    // Call count + latest attempt for the form's history header.
    const { data: logs } = await supabase
      .from('call_logs')
      .select('call_status, problem_category, call_time')
      .eq('dataid', dataid)
      .order('call_time', { ascending: false });
    const last = logs?.[0];

    return NextResponse.json({
      success: true,
      complaint: {
        ...row,
        call_count: logs?.length ?? 0,
        last_call_status: last?.call_status ?? null,
        last_call_time: last?.call_time ?? null,
        last_call_category: last?.problem_category ?? null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
