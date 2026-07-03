import { NextResponse } from 'next/server';

import { createSupabaseServer } from '../../../lib/supabase-ssr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Verify the 6-digit OTP from the recovery email, then set the new password.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { email?: string; token?: string; password?: string } | null;
    const email = body?.email?.trim().toLowerCase();
    const token = body?.token?.trim();
    const password = body?.password;
    if (!email || !token || !password) {
      return NextResponse.json({ success: false, error: 'Email, code and new password required' }, { status: 400 });
    }

    const supabase = await createSupabaseServer();
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (verifyError) {
      return NextResponse.json({ success: false, error: 'The code is invalid or has expired' }, { status: 400 });
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 400 });
    }

    // Force a fresh sign-in with the new password.
    await supabase.auth.signOut();
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
