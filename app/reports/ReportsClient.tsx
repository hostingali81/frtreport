'use client';

import { useCallback, useEffect, useState } from 'react';

import AppNav from '../components/AppNav';

type OperatorStat = { operator_id: string | null; operator: string; total: number; connected: number; last_call_time: string | null };
type RecentCall = { id: number; complaint_number: string | null; call_status: string | null; problem_category: string | null; operator: string | null; call_time: string };
type ReportData = {
  role: string;
  range: { from: string; to: string };
  totals: { total: number; byStatus: Record<string, number>; byCategory: Record<string, number> };
  operators: OperatorStat[];
  recent: RecentCall[];
};

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function daysAgoIso(n: number): string {
  const [y, m, d] = todayIso().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function ReportsClient({ role, displayName, email }: { role: string; displayName: string | null; email: string }) {
  const [from, setFrom] = useState(daysAgoIso(6));
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isManager = role === 'admin' || role === 'super_admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calling/reports?from=${from}&to=${to}`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load report');
      setData(json as ReportData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav role={role} displayName={displayName} email={email} active="reports" />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Calling Operations</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{isManager ? 'Operator Call Report' : 'My Call Report'}</h1>
              <p className="mt-1 text-sm text-slate-500">{isManager ? 'Calls by every operator' : `Your calls, ${displayName || email}`}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:w-[28rem]">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                From
                <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none" />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                To
                <input type="date" value={to} min={from} max={todayIso()} onChange={e => setTo(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none" />
              </label>
            </div>
          </div>
        </section>

        {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {loading || !data ? (
          <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-3xl font-bold">{data.totals.total.toLocaleString('en-IN')}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total calls</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                <p className="text-3xl font-bold text-emerald-700">{(data.totals.byStatus['Connected'] || 0).toLocaleString('en-IN')}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Connected</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(data.totals.byStatus).map(([k, v]) => (
                <span key={k} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">{k}: <b>{v.toLocaleString('en-IN')}</b></span>
              ))}
            </div>

            {isManager && (
              <section className="mt-5">
                <h2 className="text-sm font-semibold text-slate-700">By operator</h2>
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-3">Operator</th>
                        <th className="px-2 py-3 text-right">Calls</th>
                        <th className="px-2 py-3 text-right">Connected</th>
                        <th className="px-3 py-3 text-right">Last call</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.operators.length === 0 ? (
                        <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">No calls in range</td></tr>
                      ) : data.operators.map(op => (
                        <tr key={`${op.operator_id}-${op.operator}`} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-medium">{op.operator}</td>
                          <td className="px-2 py-2 text-right">{op.total.toLocaleString('en-IN')}</td>
                          <td className="px-2 py-2 text-right text-emerald-600">{op.connected.toLocaleString('en-IN')}</td>
                          <td className="px-3 py-2 text-right text-xs text-slate-400">{fmtTime(op.last_call_time)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="mt-5">
              <h2 className="text-sm font-semibold text-slate-700">Recent calls</h2>
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                {data.recent.length === 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-white py-6 text-center text-sm text-slate-400">No calls in range</p>
                ) : data.recent.map(c => (
                  <div key={c.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs text-slate-700">{c.complaint_number || '-'}</span>
                      <span className="text-xs text-slate-400">{fmtTime(c.call_time)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      <span className={c.call_status === 'Connected' ? 'text-emerald-600' : 'text-slate-600'}>{c.call_status}</span>
                      {c.problem_category && <span>| {c.problem_category}</span>}
                      {isManager && c.operator && <span>| {c.operator}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
