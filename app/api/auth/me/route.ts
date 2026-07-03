import { NextResponse } from 'next/server';

import { getSession } from '../../../lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: false, authenticated: false }, { status: 401 });
  return NextResponse.json({ success: true, authenticated: true, user: session });
}
