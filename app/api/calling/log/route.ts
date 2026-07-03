import { NextResponse } from 'next/server';

import { getSession } from '../../../lib/session';
import { getSupabaseClient } from '../../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Record a post-call outcome into call_logs (the app's value-add over FRT). The
// operator is taken from the session, never the client body.
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const body = await request.json().catch(() => null) as {
      dataid?: number;
      complaint_number?: string;
      call_status?: string;
      problem_category?: string;
      notes?: string;
    } | null;

    const dataid = Number(body?.dataid);
    if (!body || !Number.isFinite(dataid) || dataid <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid or missing dataid' }, { status: 400 });
    }
    if (!body.call_status) {
      return NextResponse.json({ success: false, error: 'call_status is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('call_logs')
      .insert({
        dataid,
        complaint_number: body.complaint_number ?? null,
        call_status: body.call_status,
        problem_category: body.problem_category ?? null,
        notes: body.notes ?? null,
        operator: session.displayName || session.email,
        operator_id: session.id
      })
      .select('id, call_time')
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, log: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
