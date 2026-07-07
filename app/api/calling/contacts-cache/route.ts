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

    // Fetch the most recent 1000 contacts, joining with live_complaints to get base info.
    // This allows the mobile app to cache caller IDs for recent complaints, even if closed.
    const { data: contacts, error } = await supabase
      .from('complaint_contacts')
      .select('dataid, mobile, consumer_name, remarks, live_complaints ( complaint_number, complaint_sub_type, area )')
      .order('fetched_at', { ascending: false })
      .limit(1000);

    if (error) throw new Error(error.message);

    // Flatten the joined data to make it easier for the mobile app to consume
    const flattened = (contacts || []).map((c: any) => ({
      dataid: c.dataid,
      mobile: c.mobile,
      consumer_name: c.consumer_name,
      remarks: c.remarks,
      complaint_number: c.live_complaints?.complaint_number,
      complaint_sub_type: c.live_complaints?.complaint_sub_type,
      area: c.live_complaints?.area,
    }));

    return NextResponse.json({ success: true, count: flattened.length, contacts: flattened });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
