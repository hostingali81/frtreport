import { NextResponse } from 'next/server';

import { getSession } from '../../../lib/session';
import { getSupabaseClient } from '../../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read the current live complaints from Supabase (fast — no FRT call), each
// annotated with whether/how it has already been called. Filtering/search happen
// client-side (the live feed is only ~100 rows), so this just returns everything
// still in the feed, newest first. Pass ?include_resolved=1 to also include
// complaints that have left the grid.
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const { searchParams } = new URL(request.url);
    const includeResolved = searchParams.get('include_resolved') === '1';

    let query = supabase
      .from('live_complaints')
      .select('*')
      .order('complaint_date', { ascending: false, nullsFirst: false })
      .limit(1000);
    if (!includeResolved) query = query.eq('still_in_feed', true);

    const { data: complaints, error } = await query;
    if (error) throw new Error(error.message);

    const ids = (complaints || []).map(c => c.dataid);
    const callsByDataId: Record<number, { count: number; last_status: string | null; last_time: string | null; last_category: string | null }> = {};
    if (ids.length) {
      const { data: logs } = await supabase
        .from('call_logs')
        .select('dataid, call_status, problem_category, call_time')
        .in('dataid', ids)
        .order('call_time', { ascending: false });
      for (const l of logs || []) {
        if (l.dataid == null) continue;
        const existing = callsByDataId[l.dataid];
        if (existing) existing.count += 1;
        else callsByDataId[l.dataid] = { count: 1, last_status: l.call_status, last_time: l.call_time, last_category: l.problem_category };
      }
    }

    const merged = (complaints || []).map(c => ({
      ...c,
      call_count: callsByDataId[c.dataid]?.count ?? 0,
      last_call_status: callsByDataId[c.dataid]?.last_status ?? null,
      last_call_time: callsByDataId[c.dataid]?.last_time ?? null,
      last_call_category: callsByDataId[c.dataid]?.last_category ?? null
    }));

    return NextResponse.json({ success: true, count: merged.length, complaints: merged });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
