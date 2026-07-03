import { requireSession } from '../lib/session';
import ReportsClient from './ReportsClient';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const session = await requireSession();
  return <ReportsClient role={session.role} displayName={session.displayName} email={session.email} />;
}
