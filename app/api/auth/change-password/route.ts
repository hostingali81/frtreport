import { NextResponse } from 'next/server';

import { getSession } from '../../../lib/session';
import { createSupabaseEphemeral, createSupabaseServer } from '../../../lib/supabase-ssr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const body = await request.json().catch(() => null) as { currentPassword?: string; newPassword?: string } | null;
    if (!body?.currentPassword || !body?.newPassword) {
      return NextResponse.json({ success: false, error: 'Current and new password required' }, { status: 400 });
    }

    // Verify the current password without disturbing the live session cookies.
    const check = createSupabaseEphemeral();
    const { error: checkError } = await check.auth.signInWithPassword({ email: session.email, password: body.currentPassword });
    if (checkError) {
      return NextResponse.json({ success: false, error: 'Current password is incorrect' }, { status: 400 });
    }

    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.updateUser({ password: body.newPassword });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
