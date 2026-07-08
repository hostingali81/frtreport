import { NextResponse } from 'next/server';

import { getSession } from '../../../lib/session';
import { getSupabaseClient } from '../../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    // Fetch the most recent 1000 contacts from the optimized complaints table.
    // The mobile app caches these to show Caller ID for known complaints.
    const { data: contacts, error } = await supabase
      .from('complaints')
      .select('dataid, consumer_mobile, consumer_name, consumer_remarks, complaint_number, complaint_sub_type, sub_station')
      .not('consumer_mobile', 'is', null)
      .order('complaint_date', { ascending: false })
      .limit(1000);

    if (error) throw new Error(error.message);

    // Flatten/map to the format expected by the mobile app
    const flattened = (contacts || []).map((c: any) => ({
      dataid: c.dataid,
      mobile: c.consumer_mobile,
      consumer_name: c.consumer_name,
      remarks: c.consumer_remarks,
      complaint_number: c.complaint_number,
      complaint_sub_type: c.complaint_sub_type,
      area: c.sub_station,
    }));

    return NextResponse.json({ success: true, count: flattened.length, contacts: flattened });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
