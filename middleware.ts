import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase auth session cookie on navigation so tokens don't go
// stale (Server Components can't write cookies themselves). Only runs on the
// calling-app surface; the legacy report pages under other paths are untouched.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_ANON_KEY || '',
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/calling/:path*', '/reports/:path*', '/admin/:path*', '/profile/:path*']
};
