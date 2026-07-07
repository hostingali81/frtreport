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

    // Join complaint_contacts with live_complaints on dataid.
    // Filter contacts whose mobile ends with the 10-digit key.
    const { data, error } = await supabase
      .from('complaint_contacts')
      .select(`
        dataid,
        consumer_name,
        mobile,
        remarks,
        live_complaints!inner (
          complaint_number,
          complaint_type,
          complaint_sub_type,
          area,
          action_status,
          complaint_date,
          still_in_feed
        )
      `)
      .like('mobile', `%${key}`)
      .order('dataid', { ascending: false })
      .limit(10);

    if (error) throw new Error(error.message);

    // Flatten the nested live_complaints object for easier mobile consumption.
    const complaints = (data ?? []).flatMap(row => {
      const lcArray = Array.isArray(row.live_complaints) 
        ? row.live_complaints 
        : (row.live_complaints ? [row.live_complaints] : [null]);
        
      return lcArray.map((lcRaw: any) => {
        const lc = lcRaw as Record<string, unknown> | null;
        return {
          dataid: row.dataid,
          consumer_name: row.consumer_name,
          mobile: row.mobile,
          remarks: row.remarks,
          complaint_number: lc?.complaint_number ?? null,
          complaint_type: lc?.complaint_type ?? null,
          complaint_sub_type: lc?.complaint_sub_type ?? null,
          area: lc?.area ?? null,
          action_status: lc?.action_status ?? null,
          complaint_date: lc?.complaint_date ?? null,
          still_in_feed: lc?.still_in_feed ?? null,
        };
      });
    });

    // Sort by complaint_date descending (newest first).
    complaints.sort((a, b) => {
      const da = a.complaint_date ? new Date(a.complaint_date as string).getTime() : 0;
      const db = b.complaint_date ? new Date(b.complaint_date as string).getTime() : 0;
      return db - da;
    });

    return NextResponse.json({
      success: true,
      total_complaints: complaints.length,
      complaints,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CALLING] caller-lookup failed:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
