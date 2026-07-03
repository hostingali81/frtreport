'use client';

import { useCallback, useEffect, useState } from 'react';

import AppNav from '../../components/AppNav';

type AppUser = { id: string; email: string | null; role: string; display_name: string | null; active: boolean; last_login_at: string | null };
const ROLES = ['operator', 'admin', 'super_admin'];

export default function UsersClient({ role, displayName, email, selfId }: { role: string; displayName: string | null; email: string; selfId: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [nEmail, setNEmail] = useState('');
  const [nPass, setNPass] = useState('');
  const [nRole, setNRole] = useState('operator');
  const [nName, setNName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load users');
      setUsers(json.users as AppUser[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: nEmail, password: nPass, role: nRole, display_name: nName })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Create failed');
      setNEmail(''); setNPass(''); setNRole('operator'); setNName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const patch = async (id: string, changes: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...changes })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Update failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const resetPassword = (id: string) => {
    const pw = prompt('New password (min 6 chars):');
    if (pw) patch(id, { password: pw });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav role={role} displayName={displayName} email={email} active="users" />
      <div className="mx-auto max-w-md px-4 pb-16 pt-3">
        <h1 className="text-lg font-bold">Users</h1>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <form onSubmit={createUser} className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-700">Add user</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input value={nEmail} onChange={e => setNEmail(e.target.value)} placeholder="Email" type="email" autoCapitalize="none" required className="rounded-lg border border-slate-300 px-2 py-2 text-sm" />
            <input value={nName} onChange={e => setNName(e.target.value)} placeholder="Display name" className="rounded-lg border border-slate-300 px-2 py-2 text-sm" />
            <input value={nPass} onChange={e => setNPass(e.target.value)} placeholder="Password (min 6)" type="text" required className="rounded-lg border border-slate-300 px-2 py-2 text-sm" />
            <select value={nRole} onChange={e => setNRole(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button type="submit" disabled={creating} className="mt-2 w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </form>

        <div className="mt-4 space-y-2">
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : users.map(u => (
            <div key={u.id} className={`rounded-xl border p-3 ${u.active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-100 opacity-70'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{u.display_name || u.email}</p>
                  <p className="text-xs text-slate-500">{u.email}</p>
                  <p className="text-xs text-slate-400">last login: {u.last_login_at ? new Date(u.last_login_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : 'never'}</p>
                </div>
                {u.id === selfId && <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600">you</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={u.role}
                  onChange={e => patch(u.id, { role: e.target.value })}
                  disabled={u.id === selfId}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs disabled:opacity-50"
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <button onClick={() => resetPassword(u.id)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-600">Reset password</button>
                <button
                  onClick={() => patch(u.id, { active: !u.active })}
                  disabled={u.id === selfId}
                  className={`rounded-lg px-2 py-1.5 text-xs font-medium disabled:opacity-50 ${u.active ? 'border border-red-200 text-red-600' : 'border border-emerald-200 text-emerald-600'}`}
                >
                  {u.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
