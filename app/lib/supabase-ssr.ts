import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// Cookie-bound Supabase client for Server Components and Route Handlers. In a
// Server Component the cookie writes are no-ops (RSC can't set cookies) — the
// middleware refreshes the session there instead.
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* called from a Server Component — ignore, middleware handles refresh */
        }
      }
    }
  });
}

// Cookie-less client used only to verify a password (sign-in check) without
// disturbing the caller's own session cookies.
export function createSupabaseEphemeral() {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: () => {} }
  });
}
