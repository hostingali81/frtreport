import { NextResponse } from 'next/server';

import { createFrtCallingClient, getCachedContact, saveContact } from '../../../lib/frt-calling';
import { getSession } from '../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Lazily fetch one complaint's consumer contact (FormId 13340) on tap, caching it
// in the main complaints table. Pass ?refresh=1 to bypass the cache.
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const dataId = Number(searchParams.get('dataid'));
    if (!Number.isFinite(dataId) || dataId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid or missing dataid' }, { status: 400 });
    }

    const refresh = searchParams.get('refresh') === '1';
    if (!refresh) {
      const cached = await getCachedContact(dataId);
      if (cached) return NextResponse.json({ success: true, cached: true, contact: cached });
    }

    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';
    const username = process.env.FRT_USERNAME;
    const password = process.env.FRT_PASSWORD;
    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'Missing FRT credentials' }, { status: 400 });
    }

    const client = await createFrtCallingClient(username, password);
    const contact = await client.fetchContact(dataId);
    await saveContact(contact);

    return NextResponse.json({ success: true, cached: false, contact });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CALLING] contact fetch failed:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
