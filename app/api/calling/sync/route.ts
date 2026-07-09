import { NextResponse } from 'next/server';

import { createFrtCallingClient, syncLiveComplaints } from '../../../lib/frt-calling';
import { getSession } from '../../../lib/session';
import { getSupabaseClient } from '../../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The scheduled calling-sync GitHub Action refreshes live_complaints every ~5
// min. If this on-demand pull can't reach FRT (its session went stale and the
// browser recapture overruns Vercel's limit), we fall back to "already fresh"
// as long as the background job synced within this window — the operator sees
// the current grid instead of a scary error.
const FRESH_WINDOW_MS = 12 * 60 * 1000;

async function lastSyncedAgeMs(): Promise<number | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from('live_complaints')
    .select('last_synced_at')
    .order('last_synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.last_synced_at) return null;
  return Date.now() - new Date(data.last_synced_at).getTime();
}

// Pull the live complaints grid (FormId 13339) and upsert into live_complaints,
// marking complaints that left the grid as no longer in the feed.
export async function GET() {
  const start = Date.now();
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

  try {
    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';

    const username = process.env.FRT_USERNAME;
    const password = process.env.FRT_PASSWORD;
    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'Missing FRT credentials' }, { status: 400 });
    }

    const client = await createFrtCallingClient(username, password);
    const rows = await client.fetchList();
    const result = await syncLiveComplaints(rows);

    return NextResponse.json({ success: true, durationMs: Date.now() - start, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CALLING] sync failed:', message);

    // On-demand FRT pull failed. If the background job kept the grid fresh, the
    // app can just reload it — no need to surface the failure to the operator.
    const ageMs = await lastSyncedAgeMs().catch(() => null);
    if (ageMs !== null && ageMs < FRESH_WINDOW_MS) {
      return NextResponse.json({
        success: true,
        stale: true,
        syncedAgoMs: ageMs,
        note: 'Live pull unavailable; showing the latest auto-synced grid.'
      });
    }

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
