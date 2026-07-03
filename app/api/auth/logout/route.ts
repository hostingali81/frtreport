import { NextResponse } from 'next/server';

import { createSupabaseServer } from '../../../lib/supabase-ssr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  return NextResponse.json({ success: true });
}
