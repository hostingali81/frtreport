'use client';

import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { FiBarChart2, FiFileText, FiLogOut, FiPhoneCall, FiUser, FiUsers } from 'react-icons/fi';

type Props = { role: string; displayName: string | null; email?: string; active: 'calling' | 'reports' | 'users' | 'profile' };

export default function AppNav({ role, displayName, email, active }: Props) {
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    window.location.href = '/login';
  };

  const tab = (href: string, label: string, key: Props['active'], icon: ReactNode) => (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${active === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-white">
            <FiBarChart2 />
          </span>
          <span className="hidden sm:inline">FRT Report Dashboard</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {tab('/calling', 'Calls', 'calling', <FiPhoneCall />)}
          {tab('/reports', 'Reports', 'reports', <FiFileText />)}
          {role === 'super_admin' && tab('/admin/users', 'Users', 'users', <FiUsers />)}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/profile" className={`hidden text-right text-[11px] leading-tight sm:block ${active === 'profile' ? 'text-indigo-600' : 'text-slate-500'}`}>
            {displayName || email}<br />
            <span className="uppercase tracking-wide">{role.replace('_', ' ')}</span>
          </Link>
          <Link href="/profile" className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold transition ${active === 'profile' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            <FiUser /> Profile
          </Link>
          <button
            onClick={logout}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <FiLogOut /> Logout
          </button>
        </div>
      </div>
    </div>
  );
}
