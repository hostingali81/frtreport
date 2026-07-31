'use client';

import { useState } from 'react';

type Props = { role: string; displayName: string | null; email?: string; active: 'calling' | 'reports' | 'users' | 'profile' };

export default function AppNav({ role, displayName, email, active }: Props) {
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    window.location.href = '/login';
  };

  const tab = (href: string, label: string, key: Props['active']) => (
    <a
      href={href}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active === key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {label}
    </a>
  );

  return (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex flex-wrap max-w-md items-center justify-between gap-2 px-3 py-2">
        <nav className="flex flex-wrap items-center gap-1">
          {tab('/calling', 'Calls', 'calling')}
          {tab('/reports', 'Reports', 'reports')}
          {role === 'super_admin' && tab('/admin/users', 'Users', 'users')}
        </nav>
        <div className="flex items-center gap-2">
          <a href="/profile" className={`hidden text-right text-[11px] leading-tight sm:block ${active === 'profile' ? 'text-indigo-600' : 'text-slate-500'}`}>
            {displayName || email}<br />
            <span className="uppercase tracking-wide">{role.replace('_', ' ')}</span>
          </a>
          <a href="/profile" className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${active === 'profile' ? 'border-indigo-300 text-indigo-600' : 'border-slate-300 text-slate-600'}`}>
            Profile
          </a>
          <button
            onClick={logout}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-60"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
