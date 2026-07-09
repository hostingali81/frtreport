import { NextResponse } from 'next/server';

import { getSession } from '../../../lib/session';
import { getSupabaseClient } from '../../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A claim only blocks others while fresh; a crashed app must not lock a
// complaint forever.
const CLAIM_FRESH_MS = 3 * 60 * 1000;

// Soft-claim a complaint before calling so two operators don't ring the same
// consumer. POST { dataid } claims, POST { dataid, release: true } releases.
// If someone else holds a fresh claim we return claimed:false with their name —
// the client shows a warning but may still proceed (it's advisory).
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const body = await request.json().catch(() => null) as { dataid?: number; release?: boolean } | null;
    const dataid = Number(body?.dataid);
    if (!body || !Number.isFinite(dataid) || dataid <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid or missing dataid' }, { status: 400 });
    }

    if (body.release) {
      await supabase
        .from('live_complaints')
        .update({ claimed_by: null, claimed_by_name: null, claimed_at: null })
        .eq('dataid', dataid)
        .eq('claimed_by', session.id);
      return NextResponse.json({ success: true, released: true });
    }

    // Atomic claim: the WHERE clause only matches when the row is unclaimed,
    // already ours, or the previous claim has gone stale — so two operators
    // claiming at once can't both win (no read-then-write race).
    const staleCutoff = new Date(Date.now() - CLAIM_FRESH_MS).toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('live_complaints')
      .update({
        claimed_by: session.id,
        claimed_by_name: session.displayName || session.email,
        claimed_at: new Date().toISOString()
      })
      .eq('dataid', dataid)
      .or(`claimed_by.is.null,claimed_by.eq.${session.id},claimed_at.lt.${staleCutoff}`)
      .select('dataid');
    if (updateError) throw new Error(updateError.message);

    if (!updated?.length) {
      // Someone else holds a fresh claim (or the complaint left the live table).
      const { data: row } = await supabase
        .from('live_complaints')
        .select('claimed_by_name, claimed_at')
        .eq('dataid', dataid)
        .maybeSingle();
      if (!row) return NextResponse.json({ success: true, claimed: true });
      return NextResponse.json({
        success: true,
        claimed: false,
        claimed_by_name: row.claimed_by_name || 'Another operator',
        claimed_at: row.claimed_at
      });
    }

    return NextResponse.json({ success: true, claimed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
