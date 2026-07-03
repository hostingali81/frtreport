import { NextResponse } from 'next/server';

import { getSession } from '../../../lib/session';
import { updateDisplayName } from '../../../lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Self-service profile edit. Only the display name is editable here; changing the
// login email goes through Supabase's own email-change confirmation flow.
export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const body = await request.json().catch(() => null) as { display_name?: string } | null;
    if (!body || body.display_name === undefined) {
      return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await updateDisplayName(session.id, body.display_name);
    return NextResponse.json({ success: true, user: { email: updated.email, role: updated.role, displayName: updated.display_name } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
