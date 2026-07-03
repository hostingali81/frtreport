import { NextResponse } from 'next/server';

import { createSupabaseEphemeral } from '../../../lib/supabase-ssr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Asks Supabase Auth to send a password-recovery email. With the "Reset Password"
// email template set to include {{ .Token }}, that email carries a 6-digit OTP
// (configured to send over your Gmail SMTP in the Supabase dashboard).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { email?: string } | null;
    const email = body?.email?.trim().toLowerCase();
    // Always respond the same way, whether or not the email exists.
    const generic = NextResponse.json({ success: true, message: 'If that email is registered, a code has been sent.' });
    if (!email) return generic;

    const supabase = createSupabaseEphemeral();
    await supabase.auth.resetPasswordForEmail(email).catch(err => console.error('[forgot] error:', err?.message || err));
    return generic;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
