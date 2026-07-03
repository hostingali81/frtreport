import { isRole, type Role } from './auth';
import { getSupabaseClient } from './shared-scraper';

export type AppUser = {
  id: string;
  email: string | null;
  role: Role;
  display_name: string | null;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
};

const PROFILE_COLUMNS = 'id, email, role, display_name, active, created_at, last_login_at';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function svc() {
  const s = getSupabaseClient();
  if (!s) throw new Error('Supabase not configured');
  return s;
}

export async function listUsers(): Promise<AppUser[]> {
  const { data, error } = await svc().from('profiles').select(PROFILE_COLUMNS).order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as AppUser[]) || [];
}

export async function getProfile(id: string): Promise<AppUser | null> {
  const { data, error } = await svc().from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AppUser) || null;
}

// Create a Supabase Auth user (email pre-confirmed so admin-created accounts can
// sign in immediately) plus their profile row. Rolls back the auth user if the
// profile insert fails.
export async function createUser(input: { email: string; password: string; role: Role; display_name?: string | null }): Promise<AppUser> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('A valid email is required');
  if (!input.password || input.password.length < 6) throw new Error('Password must be at least 6 characters');
  if (!isRole(input.role)) throw new Error('Invalid role');

  const s = svc();
  const { data: created, error } = await s.auth.admin.createUser({ email, password: input.password, email_confirm: true });
  if (error || !created?.user) {
    if (error && /already|registered|exists/i.test(error.message)) throw new Error(`Email "${email}" is already registered`);
    throw new Error(error?.message || 'Failed to create user');
  }

  const { data: profile, error: pErr } = await s
    .from('profiles')
    .insert({ id: created.user.id, email, role: input.role, display_name: input.display_name?.trim() || null })
    .select(PROFILE_COLUMNS)
    .single();
  if (pErr) {
    await s.auth.admin.deleteUser(created.user.id).catch(() => {});
    throw new Error(pErr.message);
  }
  return profile as AppUser;
}

// Admin edit (super-admin): role / active / password / display_name.
export async function updateUser(id: string, changes: { role?: Role; active?: boolean; password?: string; display_name?: string | null }): Promise<AppUser> {
  const s = svc();

  if (changes.password !== undefined) {
    if (!changes.password || changes.password.length < 6) throw new Error('Password must be at least 6 characters');
    const { error } = await s.auth.admin.updateUserById(id, { password: changes.password });
    if (error) throw new Error(error.message);
  }

  const patch: Record<string, unknown> = {};
  if (changes.role !== undefined) {
    if (!isRole(changes.role)) throw new Error('Invalid role');
    patch.role = changes.role;
  }
  if (changes.active !== undefined) patch.active = changes.active;
  if (changes.display_name !== undefined) patch.display_name = changes.display_name?.trim() || null;

  if (Object.keys(patch).length === 0) {
    const profile = await getProfile(id);
    if (!profile) throw new Error('User not found');
    return profile;
  }

  const { data, error } = await s.from('profiles').update(patch).eq('id', id).select(PROFILE_COLUMNS).single();
  if (error) throw new Error(error.message);
  return data as AppUser;
}

// Self-service: update own display name.
export async function updateDisplayName(id: string, displayName: string | null): Promise<AppUser> {
  const { data, error } = await svc().from('profiles').update({ display_name: displayName?.trim() || null }).eq('id', id).select(PROFILE_COLUMNS).single();
  if (error) throw new Error(error.message);
  return data as AppUser;
}

export async function touchLastLogin(id: string): Promise<void> {
  await svc().from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', id);
}
