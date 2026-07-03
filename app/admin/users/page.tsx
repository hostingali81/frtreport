import { requireSession } from '../../lib/session';
import UsersClient from './UsersClient';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const session = await requireSession('super_admin');
  return <UsersClient role={session.role} displayName={session.displayName} email={session.email} selfId={session.id} />;
}
