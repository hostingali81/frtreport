/**
 * FRT Calling App — roles (auth itself is handled by Supabase Auth / GoTrue).
 */

export const ROLES = ['operator', 'admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { operator: 1, admin: 2, super_admin: 3 };
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// Where each role lands after login. Operators → calling screen; admins &
// super-admins → the operator-performance report.
export function defaultPathForRole(role: Role): string {
  return role === 'operator' ? '/calling' : '/reports';
}

// The signed-in user, resolved from the Supabase session + their profile row.
export type SessionUser = { id: string; email: string; role: Role; displayName: string | null };
