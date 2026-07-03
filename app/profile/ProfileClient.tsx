'use client';

import { useState } from 'react';

import AppNav from '../components/AppNav';

export default function ProfileClient({ role, email, displayName }: { role: string; email: string; displayName: string | null }) {
  const [name, setName] = useState(displayName || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Update failed');
      setProfileMsg({ ok: true, text: 'Profile updated' });
    } catch (err) {
      setProfileMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setPwMsg({ ok: false, text: 'New passwords do not match' }); return; }
    setSavingPw(true);
    setPwMsg(null);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: next })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Change failed');
      setPwMsg({ ok: true, text: 'Password changed' });
      setCur(''); setNext(''); setConfirm('');
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingPw(false);
    }
  };

  const msg = (m: { ok: boolean; text: string } | null) =>
    m && <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${m.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{m.text}</p>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav role={role} displayName={displayName} email={email} active="profile" />
      <div className="mx-auto max-w-md px-4 pb-16 pt-3">
        <h1 className="text-lg font-bold">Profile</h1>
        <p className="text-xs text-slate-500">Role: <span className="uppercase">{role.replace('_', ' ')}</span></p>

        <form onSubmit={saveProfile} className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-700">Account details</p>
          <label className="mt-3 block text-xs text-slate-500">Email (login id)</label>
          <input value={email} readOnly disabled className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
          <label className="mt-3 block text-xs text-slate-500">Display name</label>
          <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          {msg(profileMsg)}
          <button type="submit" disabled={savingProfile} className="mt-3 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {savingProfile ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <form onSubmit={changePassword} className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-700">Change password</p>
          <input type="password" value={cur} onChange={e => setCur(e.target.value)} placeholder="Current password" required className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          <input type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="New password (min 6)" required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Confirm new password" required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
          {msg(pwMsg)}
          <button type="submit" disabled={savingPw} className="mt-3 w-full rounded-xl bg-slate-800 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {savingPw ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  );
}
