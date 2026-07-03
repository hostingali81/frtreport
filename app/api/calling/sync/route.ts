import { NextResponse } from 'next/server';

import { createFrtCallingClient, syncLiveComplaints } from '../../../lib/frt-calling';
import { getSession } from '../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Pull the live complaints grid (FormId 13339) and upsert into live_complaints,
// marking complaints that left the grid as no longer in the feed.
export async function GET() {
  const start = Date.now();
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

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
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
