'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AppNav from '../components/AppNav';

type Complaint = {
  dataid: number;
  complaint_number: string | null;
  complaint_type: string | null;
  complaint_sub_type: string | null;
  district: string | null;
  area: string | null;
  area_type: string | null;
  feeder: string | null;
  action_status: string | null;
  complaint_date: string | null;
  still_in_feed: boolean;
  call_count: number;
  last_call_status: string | null;
  last_call_time: string | null;
  last_call_category: string | null;
};

type Contact = {
  dataid: number;
  consumer_name: string | null;
  mobile: string | null;
  address: string | null;
  landmark: string | null;
  remarks: string | null;
  substation: string | null;
  assigned_crew: string | null;
  crew_mobile: string | null;
};

const CALL_STATUSES = ['Connected', 'No Answer', 'Switched Off', 'Busy', 'Wrong Number'];
// Kept in sync with the mobile app's list (mobile/lib/screens/detail_sheet.dart)
// so report tallies don't split across two naming schemes.
const PROBLEM_CATEGORIES = [
  '33 KV Line Fault',
  '11 KV Line Fault',
  'Transformer (DT) Fault',
  'Lead/Cable Cut from DT',
  'LT Line Fault',
  'Underground Cable Fault',
  'Service Cable Fault (Individual)',
  'Pole Damage',
  'Phase Missing',
  'Scheduled Rostering',
  'Emergency Rostering',
  'Low Voltage',
  'High Voltage',
  'Voltage Fluctuation',
  'Billing Issue',
  'Meter Issue',
  'Other',
];
const POLL_MS = 180_000;
const WARNING_MS = 15 * 60 * 1000; // last 15 min before the SLA deadline turns amber

function statusClasses(status: string | null): string {
  switch (status) {
    case 'FRT Assigned': return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'Acknowledged by FRT': return 'bg-sky-100 text-sky-800 border-sky-200';
    case 'In Progress': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    case 'Activity Completed': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

// SLA resolution window: Urban = 1 hour, Rural (default) = 2 hours (matches the
// FRT timer extension). Deadline = complaint time + that window.
function complaintDeadline(c: Complaint): number | null {
  if (!c.complaint_date) return null;
  const t = new Date(c.complaint_date).getTime();
  if (Number.isNaN(t)) return null;
  const limitHours = (c.area_type || '').toLowerCase().includes('urban') ? 1 : 2;
  return t + limitHours * 60 * 60 * 1000;
}

function formatDur(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function elapsedLabel(iso: string | null, now: number): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}

// Remaining-time badge text + colour for a complaint at time `now`.
function slaBadge(c: Complaint, now: number): { text: string; cls: string } {
  const deadline = complaintDeadline(c);
  if (deadline === null) return { text: 'N/A', cls: 'bg-slate-100 text-slate-500 border-slate-200' };
  const remaining = deadline - now;
  if (remaining < 0) return { text: `Overdue ${formatDur(remaining)}`, cls: 'bg-red-100 text-red-700 border-red-200' };
  if (remaining < WARNING_MS) return { text: `${formatDur(remaining)} left`, cls: 'bg-amber-100 text-amber-800 border-amber-200' };
  return { text: `${formatDur(remaining)} left`, cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
}

export default function CallingClient({ role, displayName, email }: { role: string; displayName: string | null; email: string }) {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [hideCalled, setHideCalled] = useState(false);
  const [sortBy, setSortBy] = useState<'urgent' | 'newest'>('urgent');

  const [selected, setSelected] = useState<Complaint | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick every second so remaining-time badges count down live.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadComplaints = useCallback(async () => {
    try {
      const res = await fetch('/api/calling/complaints', { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load');
      setComplaints(json.complaints as Complaint[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadComplaints();
    pollRef.current = setInterval(loadComplaints, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadComplaints]);

  const fetchLatest = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/calling/sync', { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Sync failed');
      setLastSync(new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }));
      await loadComplaints();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [loadComplaints]);

  const areas = useMemo(() => Array.from(new Set(complaints.map(c => c.area).filter(Boolean))).sort() as string[], [complaints]);
  const statuses = useMemo(() => Array.from(new Set(complaints.map(c => c.action_status).filter(Boolean))).sort() as string[], [complaints]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = complaints.filter(c => {
      if (statusFilter && c.action_status !== statusFilter) return false;
      if (areaFilter && c.area !== areaFilter) return false;
      if (hideCalled && c.call_count > 0) return false;
      if (q) {
        const hay = `${c.complaint_number} ${c.area} ${c.district} ${c.complaint_sub_type} ${c.feeder}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Urgent = by SLA deadline ascending (most overdue / least time left first;
    // complaints without a valid date sink to the bottom). Newest = by date desc.
    return list.sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.complaint_date || 0).getTime() - new Date(a.complaint_date || 0).getTime();
      const da = complaintDeadline(a) ?? Number.MAX_SAFE_INTEGER;
      const db = complaintDeadline(b) ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });
  }, [complaints, search, statusFilter, areaFilter, hideCalled, sortBy]);

  const pendingCount = complaints.filter(c => c.call_count === 0).length;
  const overdueCount = useMemo(() => complaints.filter(c => { const d = complaintDeadline(c); return d !== null && d - now < 0; }).length, [complaints, now]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav role={role} displayName={displayName} email={email} active="calling" />
      <div className="mx-auto max-w-md pb-24">
        <header className="border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold leading-none">Live Complaints</h1>
              <p className="mt-1 text-xs text-slate-500">
                {complaints.length} live · {pendingCount} uncalled{overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}{lastSync ? ` · synced ${lastSync}` : ''}
              </p>
            </div>
            <button
              onClick={fetchLatest}
              disabled={syncing}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition active:scale-95 disabled:opacity-60"
            >
              {syncing ? 'Syncing…' : 'Fetch Latest'}
            </button>
          </div>

          <div className="mt-3 space-y-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search complaint no, area, feeder…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <div className="flex gap-2">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm">
                <option value="">All statuses</option>
                {statuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm">
                <option value="">All areas</option>
                {areas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={hideCalled} onChange={e => setHideCalled(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                Hide already-called
              </label>
              <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs">
                <button onClick={() => setSortBy('urgent')} className={`px-2.5 py-1 font-medium ${sortBy === 'urgent' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}>Urgent</button>
                <button onClick={() => setSortBy('newest')} className={`px-2.5 py-1 font-medium ${sortBy === 'newest' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}>Newest</button>
              </div>
            </div>
          </div>
        </header>

        {error && <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <main className="space-y-2 px-4 pt-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No complaints match. Tap “Fetch Latest”.</p>
          ) : (
            filtered.map(c => {
              const sla = slaBadge(c, now);
              return (
                <button
                  key={c.dataid}
                  onClick={() => setSelected(c)}
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-800">{c.complaint_number || `#${c.dataid}`}</span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(c.action_status)}`}>{c.action_status || '—'}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{c.complaint_sub_type || c.complaint_type || 'Complaint'}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                    <span>{c.area || '—'}</span>
                    <span>·</span>
                    <span>{c.district || '—'}</span>
                    {c.area_type && <span className="rounded bg-slate-100 px-1.5 py-0.5">{c.area_type}</span>}
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div className="text-xs leading-tight text-slate-400">
                      <div>🕒 {fmtDateTime(c.complaint_date)}</div>
                      <div>{elapsedLabel(c.complaint_date, now)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums ${sla.cls}`}>{sla.text}</span>
                      {c.call_count > 0 && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">✓ {c.last_call_status || 'Called'}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </main>
      </div>

      {selected && (
        <DetailSheet
          complaint={selected}
          now={now}
          onClose={() => setSelected(null)}
          onLogged={() => { setSelected(null); loadComplaints(); }}
        />
      )}
    </div>
  );
}

function DetailSheet({ complaint, now, onClose, onLogged }: { complaint: Complaint; now: number; onClose: () => void; onLogged: () => void }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [loadingContact, setLoadingContact] = useState(true);
  const [contactError, setContactError] = useState<string | null>(null);

  const [callStatus, setCallStatus] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sla = slaBadge(complaint, now);
  const limitHours = (complaint.area_type || '').toLowerCase().includes('urban') ? 1 : 2;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingContact(true);
      setContactError(null);
      try {
        const res = await fetch(`/api/calling/contact?dataid=${complaint.dataid}`, { cache: 'no-store' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Failed to load contact');
        if (!cancelled) setContact(json.contact as Contact);
      } catch (e) {
        if (!cancelled) setContactError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingContact(false);
      }
    })();
    return () => { cancelled = true; };
  }, [complaint.dataid]);

  const saveLog = async () => {
    if (!callStatus) { setSaveError('Select a call outcome'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/calling/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataid: complaint.dataid,
          complaint_number: complaint.complaint_number,
          call_status: callStatus,
          problem_category: category || null,
          notes: notes || null
        })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Save failed');
      onLogged();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />

        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-sm font-semibold">{complaint.complaint_number || `#${complaint.dataid}`}</p>
            <p className="text-xs text-slate-500">{complaint.complaint_sub_type || complaint.complaint_type} · {complaint.area}</p>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(complaint.action_status)}`}>{complaint.action_status || '—'}</span>
        </div>

        {/* SLA / timing */}
        <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-xs leading-tight text-slate-500">
            <div className="text-slate-700">🕒 {fmtDateTime(complaint.complaint_date)}</div>
            <div>{elapsedLabel(complaint.complaint_date, now)} · SLA {limitHours}h ({complaint.area_type || 'Rural'})</div>
          </div>
          <span className={`rounded-md border px-2.5 py-1 font-mono text-sm font-bold tabular-nums ${sla.cls}`}>{sla.text}</span>
        </div>

        {/* contact */}
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          {loadingContact ? (
            <p className="py-4 text-center text-sm text-slate-400">Fetching consumer contact…</p>
          ) : contactError ? (
            <p className="text-sm text-red-600">{contactError}</p>
          ) : contact ? (
            <>
              <p className="text-base font-semibold text-slate-900">{contact.consumer_name || 'Unknown consumer'}</p>
              {contact.address && <p className="mt-0.5 text-sm text-slate-600">{contact.address}</p>}
              {contact.landmark && <p className="text-xs text-slate-500">Landmark: {contact.landmark}</p>}
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                {contact.substation && <span>SS: {contact.substation}</span>}
                {contact.assigned_crew && <span>Crew: {contact.assigned_crew}</span>}
              </div>
              {contact.remarks && <p className="mt-1 text-xs italic text-slate-500">“{contact.remarks}”</p>}

              {contact.mobile ? (
                <a href={`tel:${contact.mobile}`} className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-base font-bold text-white shadow-sm transition active:scale-95">
                  📞 Call {contact.mobile}
                </a>
              ) : (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-700">No mobile number on record</p>
              )}
            </>
          ) : null}
        </div>

        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-700">Call outcome</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {CALL_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setCallStatus(s)}
                className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${callStatus === s ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
              >
                {s}
              </button>
            ))}
          </div>

          <select value={category} onChange={e => setCategory(e.target.value)} className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Problem category (optional)</option>
            {PROBLEM_CATEGORIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes — what did the consumer say?"
            rows={2}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />

          {saveError && <p className="mt-2 text-sm text-red-600">{saveError}</p>}

          <div className="mt-3 flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-600">Cancel</button>
            <button onClick={saveLog} disabled={saving} className="flex-[2] rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-sm transition active:scale-95 disabled:opacity-60">
              {saving ? 'Saving…' : 'Save call log'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
