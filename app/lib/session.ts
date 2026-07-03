import 'server-only';
import { type User } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { defaultPathForRole, isRole, roleAtLeast, type Role, type SessionUser } from './auth';
import { getSupabaseClient } from './shared-scraper';
import { createSupabaseServer } from './supabase-ssr';

// Resolve the signed-in Supabase user from either the cookie session (web) or an
// `Authorization: Bearer <access_token>` header (native app), then their app role
// from the profiles table. Returns null if not signed in or deactivated.
export async function getSession(): Promise<SessionUser | null> {
  let user: User | null = null;

  // 1. Cookie session (web). Guarded so a missing anon key / cookie can't break
  //    the Bearer path the mobile app uses.
  try {
    const supabase = await createSupabaseServer();
    user = (await supabase.auth.getUser()).data.user;
  } catch {
    user = null;
  }

  // 2. Bearer token (native app) — verified via the service-role client.
  if (!user) {
    const authz = (await headers()).get('authorization');
    const token = authz && /^bearer /i.test(authz) ? authz.slice(7).trim() : null;
    const svc = getSupabaseClient();
    if (token && svc) {
      try {
        user = (await svc.auth.getUser(token)).data.user;
      } catch {
        user = null;
      }
    }
  }
  if (!user) return null;

  const svc = getSupabaseClient();
  if (!svc) return null;
  const { data: profile } = await svc
    .from('profiles')
    .select('role, display_name, active, email')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !profile.active || !isRole(profile.role)) return null;

  return { id: user.id, email: user.email ?? profile.email ?? '', role: profile.role, displayName: profile.display_name };
}

// For Server Component pages: redirect to /login if unauthenticated, or to the
// user's own default page if they lack the required role.
export async function requireSession(minRole?: Role): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (minRole && !roleAtLeast(session.role, minRole)) redirect(defaultPathForRole(session.role));
  return session;
}
