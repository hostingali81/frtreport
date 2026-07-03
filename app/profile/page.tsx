import { requireSession } from '../lib/session';
import ProfileClient from './ProfileClient';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await requireSession();
  return <ProfileClient role={session.role} email={session.email} displayName={session.displayName} />;
}
