'use client';

import { useState } from 'react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Request failed');
      // Go enter the 6-digit code that was emailed.
      window.location.href = `/reset-password?email=${encodeURIComponent(email)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Reset password</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your email — we&apos;ll send a 6-digit code.</p>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoCapitalize="none"
          required
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={loading} className="mt-5 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white disabled:opacity-60">
          {loading ? 'Sending…' : 'Send code'}
        </button>
        <a href="/login" className="mt-4 block text-center text-sm text-indigo-600">Back to sign in</a>
      </form>
    </div>
  );
}
