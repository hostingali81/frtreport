import { NextResponse } from 'next/server';

import { defaultPathForRole, isRole } from '../../../lib/auth';
import { getSupabaseClient } from '../../../lib/shared-scraper';
import { createSupabaseServer } from '../../../lib/supabase-ssr';
import { touchLastLogin } from '../../../lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password;
    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password required' }, { status: 400 });
    }

    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      return NextResponse.json({ success: false, error: 'Invalid email or password' }, { status: 401 });
    }

    const svc = getSupabaseClient();
    const { data: profile } = svc
      ? await svc.from('profiles').select('role, active, display_name').eq('id', data.user.id).maybeSingle()
      : { data: null };
    if (!profile || !profile.active || !isRole(profile.role)) {
      await supabase.auth.signOut();
      return NextResponse.json({ success: false, error: 'Account is not active' }, { status: 401 });
    }

    touchLastLogin(data.user.id).catch(() => {});
    return NextResponse.json({
      success: true,
      redirect: defaultPathForRole(profile.role),
      user: { email: data.user.email, role: profile.role, displayName: profile.display_name }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
