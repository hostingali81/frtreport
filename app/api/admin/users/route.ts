import { NextResponse } from 'next/server';

import { isRole, type Role } from '../../../lib/auth';
import { getSession } from '../../../lib/session';
import { createUser, listUsers, updateUser } from '../../../lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireSuperAdmin() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 }) };
  if (session.role !== 'super_admin') return { error: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  return { session };
}

export async function GET() {
  const { error } = await requireSuperAdmin();
  if (error) return error;
  try {
    return NextResponse.json({ success: true, users: await listUsers() });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error } = await requireSuperAdmin();
  if (error) return error;
  try {
    const body = await request.json().catch(() => null) as { email?: string; password?: string; role?: string; display_name?: string } | null;
    if (!body?.email || !body?.password || !isRole(body.role)) {
      return NextResponse.json({ success: false, error: 'email, password and valid role required' }, { status: 400 });
    }
    const user = await createUser({ email: body.email, password: body.password, role: body.role, display_name: body.display_name });
    return NextResponse.json({ success: true, user });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const { session, error } = await requireSuperAdmin();
  if (error) return error;
  try {
    const body = await request.json().catch(() => null) as { id?: string; role?: Role; active?: boolean; password?: string; display_name?: string } | null;
    const id = body?.id;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ success: false, error: 'Valid user id required' }, { status: 400 });
    }
    // Guard against a super-admin locking themselves out.
    if (session && id === session.id && (body?.active === false || (body?.role && body.role !== 'super_admin'))) {
      return NextResponse.json({ success: false, error: 'You cannot demote or deactivate your own account' }, { status: 400 });
    }
    const user = await updateUser(id, { role: body?.role, active: body?.active, password: body?.password, display_name: body?.display_name });
    return NextResponse.json({ success: true, user });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
