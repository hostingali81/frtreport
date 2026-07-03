import { requireSession } from '../lib/session';
import CallingClient from './CallingClient';

export const dynamic = 'force-dynamic';

export default async function CallingPage() {
  const session = await requireSession();
  return <CallingClient role={session.role} displayName={session.displayName} email={session.email} />;
}
