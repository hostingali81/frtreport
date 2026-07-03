'use client';

import { useEffect, useState } from 'react';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEmail(new URLSearchParams(window.location.search).get('email') || '');
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token: code, password })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Reset failed');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Enter code &amp; new password</h1>
        {done ? (
          <>
            <p className="mt-2 text-sm text-emerald-700">Password updated. You can sign in now.</p>
            <a href="/login" className="mt-5 block rounded-xl bg-indigo-600 py-3 text-center text-sm font-bold text-white">Go to sign in</a>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="mt-1 text-sm text-slate-500">We sent a 6-digit code to your email.</p>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoCapitalize="none" required className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit code" required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.4em] outline-none focus:border-indigo-500" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password (min 6)" required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Confirm new password" required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={loading} className="mt-5 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white disabled:opacity-60">
              {loading ? 'Saving…' : 'Update password'}
            </button>
            <a href="/forgot-password" className="mt-4 block text-center text-sm text-indigo-600">Resend code</a>
          </form>
        )}
      </div>
    </div>
  );
}
