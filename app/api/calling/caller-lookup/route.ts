import { NextResponse } from 'next/server';

import { getSession } from '../../../lib/session';
import { getSupabaseClient } from '../../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Look up all complaints linked to a phone number (active + closed).
// The mobile app calls this after loading a contact so the native caller-ID
// banner can show complaint history ("3 complaints · last: resolved").
//
// GET /api/calling/caller-lookup?mobile=9876543210
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const { searchParams } = new URL(request.url);
    const rawMobile = searchParams.get('mobile') ?? '';
    // Normalise to last 10 digits (strip country code / non-digits).
    const digits = rawMobile.replace(/\D/g, '');
    const key = digits.length > 10 ? digits.slice(-10) : digits;
    if (key.length < 10) {
      return NextResponse.json({ success: false, error: 'Invalid mobile number' }, { status: 400 });
    }

    // Fetch complaints from the main complaints table for the last 30 days.
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, count, error } = await supabase
      .from('complaints')
      .select(`
        dataid,
        consumer_name,
        consumer_mobile,
        closing_remarks,
        complaint_number,
        complaint_type,
        complaint_sub_type,
        area_type,
        status,
        complaint_date
      `, { count: 'exact' })
      .like('consumer_mobile', `%${key}`)
      .gte('complaint_date', thirtyDaysAgo.toISOString())
      .order('complaint_date', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);

    // Format the response to exactly match what the mobile app expects.
    // The mobile app checks `last['still_in_feed'] == true` to show 'Pending' vs 'Resolved'.
    const complaints = (data ?? []).map((c: any) => ({
      dataid: c.dataid ?? 0,
      consumer_name: c.consumer_name ?? '',
      mobile: c.consumer_mobile ?? '',
      remarks: c.closing_remarks ?? '',
      complaint_number: c.complaint_number ?? null,
      complaint_type: c.complaint_type ?? null,
      complaint_sub_type: c.complaint_sub_type ?? null,
      area: c.area_type ?? null,
      action_status: c.status ?? null,
      complaint_date: c.complaint_date ?? null,
      still_in_feed: c.status !== 'Closed',
    }));

    return NextResponse.json({
      success: true,
      total_complaints: count ?? 0,
      complaints,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CALLING] caller-lookup failed:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
