'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { FiChevronDown, FiChevronRight, FiDownload, FiLoader, FiPhoneCall, FiPhoneIncoming, FiSearch, FiX } from 'react-icons/fi';

import { loadExcelJS } from '../utils/lazyImports';
import { nfmt } from './chartTheme';

// The per-complaint drill-down under the Calling Report. Everything above it
// answers "how many"; this table answers "which complaints, how many calls
// each, and what the operator heard". Fed by /api/calling/complaint-calls,
// which already groups the call log by complaint for the selected range.

type Call = {
  time: string;
  status: string | null;
  connected: boolean;
  seconds: number;
  fault: string | null;
  remark: string;
  operator: string | null;
  incoming: boolean;
  deskFilled: boolean;
};

type Row = {
  complaintNumber: string;
  complaintDate: string | null;
  closedDate: string | null;
  division: string | null;
  subDivision: string | null;
  substation: string | null;
  feeder: string | null;
  areaType: string | null;
  complaintType: string | null;
  complaintSubType: string | null;
  status: string | null;
  closedStatus: string | null;
  closingRemarks: string | null;
  consumerName: string | null;
  consumerMobile: string | null;
  consumerAddress: string | null;
  calls: Call[];
  totalCalls: number;
  connectedCalls: number;
  incomingCalls: number;
  outgoingCalls: number;
  talkSeconds: number;
  firstCall: string | null;
  lastCall: string | null;
  lastRemark: string;
  faults: string[];
  operators: string[];
  callStatuses: string[];
  everConnected: boolean;
};

type Payload = {
  success: boolean;
  error?: string;
  totals: { complaints: number; connectedComplaints: number; calls: number; connectedCalls: number; incomingCalls: number; talkSeconds: number };
  availableFilters: {
    divisions: string[]; subDivisions: string[]; substations: string[]; feeders: string[];
    complaintTypes: string[]; complaintSubTypes: string[]; closedStatuses: string[];
    faults: string[]; operators: string[]; callStatuses: string[];
  };
  rows: Row[];
};

type SortKey = 'date' | 'calls' | 'talk' | 'connected';
type Reached = 'any' | 'yes' | 'no';

const PAGE = 50;

const fmtTalk = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// FRT timestamps are IST-offset; render them as IST wall-clock whatever the
// viewer's timezone is.
const IST_DATE = { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' } as const;
const IST_TIME = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false } as const;
const fmtDateTime = (iso: string | null) =>
  iso ? `${new Intl.DateTimeFormat('en-GB', IST_DATE).format(new Date(iso))} ${new Intl.DateTimeFormat('en-GB', IST_TIME).format(new Date(iso))}` : '—';

// Resolution SLA, same rule as the calling app: Urban 1h, Rural (default) 2h.
const slaMinutes = (areaType: string | null) => (String(areaType ?? '').toLowerCase().startsWith('urban') ? 60 : 120);
function resolutionMinutes(r: Row): number | null {
  if (!r.complaintDate || !r.closedDate) return null;
  return Math.round((new Date(r.closedDate).getTime() - new Date(r.complaintDate).getTime()) / 60000);
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={label}
      className={`rounded-lg border px-2.5 py-2 text-sm focus:border-sky-400 focus:outline-none ${
        value ? 'border-sky-300 bg-sky-50 font-semibold text-sky-900' : 'border-gray-200 bg-white text-gray-600'
      }`}
    >
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function CalledComplaints({ from, to, rangeLabel }: { from: string; to: string; rangeLabel: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [search, setSearch] = useState('');
  const [division, setDivision] = useState('');
  const [subDivision, setSubDivision] = useState('');
  const [substation, setSubstation] = useState('');
  const [feeder, setFeeder] = useState('');
  const [complaintType, setComplaintType] = useState('');
  const [fault, setFault] = useState('');
  const [operator, setOperator] = useState('');
  const [closedStatus, setClosedStatus] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [reached, setReached] = useState<Reached>('any');
  const [minCalls, setMinCalls] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/calling/complaint-calls?from=${from}&to=${to}`);
        const json = (await res.json()) as Payload;
        if (!json.success) throw new Error(json.error || 'Failed to load called complaints');
        if (!cancelled) setData(json);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load called complaints');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [from, to]);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = search.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (division && r.division !== division) return false;
      if (subDivision && r.subDivision !== subDivision) return false;
      if (substation && r.substation !== substation) return false;
      if (feeder && r.feeder !== feeder) return false;
      if (complaintType && r.complaintType !== complaintType) return false;
      if (closedStatus && r.closedStatus !== closedStatus) return false;
      if (fault && !r.faults.includes(fault)) return false;
      if (operator && !r.operators.includes(operator)) return false;
      if (callStatus && !r.callStatuses.includes(callStatus)) return false;
      if (reached === 'yes' && !r.everConnected) return false;
      if (reached === 'no' && r.everConnected) return false;
      if (r.totalCalls < minCalls) return false;
      if (q) {
        const hay = [r.complaintNumber, r.consumerName, r.consumerMobile, r.consumerAddress, r.substation, r.feeder, r.lastRemark]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
      date: (a, b) => (b.complaintDate ?? '').localeCompare(a.complaintDate ?? ''),
      calls: (a, b) => b.totalCalls - a.totalCalls || (b.complaintDate ?? '').localeCompare(a.complaintDate ?? ''),
      talk: (a, b) => b.talkSeconds - a.talkSeconds,
      connected: (a, b) => b.connectedCalls - a.connectedCalls || b.totalCalls - a.totalCalls
    };
    return [...out].sort(cmp[sortKey]);
  }, [data, search, division, subDivision, substation, feeder, complaintType, fault, operator, closedStatus, callStatus, reached, minCalls, sortKey]);

  // Reset paging whenever the result set changes under the user.
  useEffect(() => { setLimit(PAGE); }, [filtered.length]);

  const shown = useMemo(() => ({
    complaints: filtered.length,
    calls: filtered.reduce((a, r) => a + r.totalCalls, 0),
    connected: filtered.reduce((a, r) => a + r.connectedCalls, 0),
    reached: filtered.filter((r) => r.everConnected).length,
    talkSeconds: filtered.reduce((a, r) => a + r.talkSeconds, 0)
  }), [filtered]);

  const activeFilters = [division, subDivision, substation, feeder, complaintType, fault, operator, closedStatus, callStatus].filter(Boolean).length
    + (reached !== 'any' ? 1 : 0) + (minCalls > 1 ? 1 : 0) + (search.trim() ? 1 : 0);

  const clearFilters = () => {
    setSearch(''); setDivision(''); setSubDivision(''); setSubstation(''); setFeeder('');
    setComplaintType(''); setFault(''); setOperator(''); setClosedStatus(''); setCallStatus('');
    setReached('any'); setMinCalls(1);
  };

  // Exports exactly what the filters currently select, on two sheets: one row
  // per complaint, and one row per individual call.
  const exportExcel = async () => {
    if (exporting || filtered.length === 0) return;
    setExporting(true);
    try {
      const { ExcelJS, saveAs } = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      // ExcelJS ships no usable row/cell types through the lazy loader, so the
      // header styler declares just the shape it touches.
      type XlCell = { fill: unknown; font: unknown };
      type XlRow = { eachCell: (cb: (cell: XlCell) => void) => void };
      const headerStyle = (row: XlRow) => {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        });
      };

      const ws = wb.addWorksheet('Called Complaints');
      ws.addRow([`Called Complaints  |  ${rangeLabel}  |  ${filtered.length} complaints, ${shown.calls} calls`]);
      ws.mergeCells(1, 1, 1, 6);
      ws.getRow(1).font = { bold: true, size: 12 };
      ws.addRow([]);
      headerStyle(ws.addRow([
        'Sr No', 'Complaint No', 'Complaint Date', 'Consumer', 'Consumer Mobile', 'Address', 'Substation', 'Feeder',
        'Division', 'Sub Division', 'Area Type', 'Complaint Type', 'Sub Type', 'Status', 'Closed Status', 'Closed Date',
        'Resolution (min)', 'SLA (min)', 'Total Calls', 'Connected', 'Incoming', 'Outgoing', 'Talk Time',
        'First Call', 'Last Call', 'Fault(s)', 'Operator(s)', 'Calling Remark', 'FRT Closing Remark'
      ]));
      filtered.forEach((r, i) => {
        const mins = resolutionMinutes(r);
        ws.addRow([
          i + 1, r.complaintNumber, fmtDateTime(r.complaintDate), r.consumerName ?? '', r.consumerMobile ?? '',
          r.consumerAddress ?? '', r.substation ?? '', r.feeder ?? '', r.division ?? '', r.subDivision ?? '',
          r.areaType ?? '', r.complaintType ?? '', r.complaintSubType ?? '', r.status ?? '', r.closedStatus ?? '',
          fmtDateTime(r.closedDate), mins ?? '', slaMinutes(r.areaType), r.totalCalls, r.connectedCalls,
          r.incomingCalls, r.outgoingCalls, fmtTalk(r.talkSeconds), fmtDateTime(r.firstCall), fmtDateTime(r.lastCall),
          r.faults.join(', '), r.operators.join(', '), r.lastRemark, r.closingRemarks ?? ''
        ]);
      });
      ws.columns = [
        { width: 7 }, { width: 17 }, { width: 20 }, { width: 22 }, { width: 14 }, { width: 44 }, { width: 22 },
        { width: 18 }, { width: 24 }, { width: 20 }, { width: 11 }, { width: 20 }, { width: 26 }, { width: 18 },
        { width: 15 }, { width: 20 }, { width: 15 }, { width: 10 }, { width: 11 }, { width: 11 }, { width: 10 },
        { width: 10 }, { width: 11 }, { width: 20 }, { width: 20 }, { width: 28 }, { width: 22 }, { width: 34 }, { width: 34 }
      ];

      const cs = wb.addWorksheet('Call Log');
      headerStyle(cs.addRow([
        'Complaint No', 'Complaint Date', 'Consumer', 'Consumer Mobile', 'Substation',
        'Call Time', 'Direction', 'Call Status', 'Connected', 'Duration (sec)', 'Fault Category',
        'Operator Remark', 'Operator', 'Dialled From App'
      ]));
      filtered.forEach((r) => {
        r.calls.forEach((c) => {
          cs.addRow([
            r.complaintNumber, fmtDateTime(r.complaintDate), r.consumerName ?? '', r.consumerMobile ?? '', r.substation ?? '',
            fmtDateTime(c.time), c.incoming ? 'Incoming' : 'Outgoing', c.status ?? '', c.connected ? 'Yes' : 'No',
            c.seconds, c.fault ?? '', c.remark, c.operator ?? '', c.deskFilled ? 'No' : 'Yes'
          ]);
        });
      });
      cs.columns = [
        { width: 17 }, { width: 20 }, { width: 22 }, { width: 14 }, { width: 22 }, { width: 20 }, { width: 11 },
        { width: 14 }, { width: 11 }, { width: 13 }, { width: 28 }, { width: 40 }, { width: 20 }, { width: 15 }
      ];

      const buffer = await wb.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `Called_Complaints_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } finally {
      setExporting(false);
    }
  };

  if (loading && !data) {
    return <div className="h-96 w-full animate-pulse rounded-2xl bg-gray-100 flex items-center justify-center font-medium text-gray-400">Loading called complaints…</div>;
  }
  if (error) {
    return (
      <div className="rounded-xl border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-800">
        <p className="font-semibold">{error}</p>
      </div>
    );
  }
  if (!data || data.rows.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
        <FiPhoneCall className="mx-auto mb-3 text-4xl text-amber-500" />
        <p className="text-lg font-bold text-amber-900">No complaint was called in this range</p>
        <p className="mt-2 text-sm text-amber-800">The calling app started logging on 03/07/2026 — try a later range.</p>
      </div>
    );
  }

  const f = data.availableFilters;

  return (
    <div className="flex flex-col gap-4">
      {/* This table's universe is complaints, not calls: the call numbers below
          cover every call on the listed complaints, including calls placed on a
          later day. They are therefore NOT the "Calls" block upstairs, and people
          did compare the two — so the scope is spelled out. */}
      <p className="text-xs leading-relaxed text-gray-500">
        One row per complaint that arrived in this range and got at least one call. The call figures here count{' '}
        <b>every call on these complaints</b>, including calls made on a later day — so they differ from the{' '}
        <b>Calls</b> cards above, which count calls made inside the range.
      </p>

      {/* Summary of what the current filters select */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Complaints Shown', value: nfmt(shown.complaints), sub: `of ${nfmt(data.totals.complaints)} called in range`, color: 'text-gray-900' },
          { label: 'Consumers Reached', value: nfmt(shown.reached), sub: `${shown.complaints ? Math.round((shown.reached / shown.complaints) * 100) : 0}% of shown`, color: 'text-green-600' },
          { label: 'Calls On These', value: nfmt(shown.calls), sub: `${(shown.complaints ? shown.calls / shown.complaints : 0).toFixed(1)} per complaint · any day`, color: 'text-indigo-600' },
          { label: 'Of Those, Connected', value: nfmt(shown.connected), sub: `${shown.calls ? Math.round((shown.connected / shown.calls) * 100) : 0}% of those calls`, color: 'text-sky-700' },
          { label: 'Talk Time On These', value: fmtTalk(shown.talkSeconds), sub: 'shown rows', color: 'text-blue-700' }
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[11px] text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search complaint no, consumer, mobile, address, remark…"
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Sort</label>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-600 focus:border-sky-400 focus:outline-none"
            >
              <option value="date">Newest complaint</option>
              <option value="calls">Most calls</option>
              <option value="connected">Most connected</option>
              <option value="talk">Longest talk time</option>
            </select>
            <button
              onClick={exportExcel}
              disabled={exporting || filtered.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-emerald-800 active:scale-95 disabled:bg-gray-400"
            >
              {exporting ? <FiLoader className="animate-spin" /> : <FiDownload />} {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select label="Division" value={division} onChange={setDivision} options={f.divisions} />
          <Select label="Sub Division" value={subDivision} onChange={setSubDivision} options={f.subDivisions} />
          <Select label="Substation" value={substation} onChange={setSubstation} options={f.substations} />
          <Select label="Feeder" value={feeder} onChange={setFeeder} options={f.feeders} />
          <Select label="Complaint Type" value={complaintType} onChange={setComplaintType} options={f.complaintTypes} />
          <Select label="Fault" value={fault} onChange={setFault} options={f.faults} />
          <Select label="Call Status" value={callStatus} onChange={setCallStatus} options={f.callStatuses} />
          <Select label="Operator" value={operator} onChange={setOperator} options={f.operators} />
          <Select label="Closed Status" value={closedStatus} onChange={setClosedStatus} options={f.closedStatuses} />
          <select
            value={reached}
            onChange={(e) => setReached(e.target.value as Reached)}
            className={`rounded-lg border px-2.5 py-2 text-sm focus:border-sky-400 focus:outline-none ${
              reached !== 'any' ? 'border-sky-300 bg-sky-50 font-semibold text-sky-900' : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            <option value="any">Reached: Any</option>
            <option value="yes">Reached: Yes</option>
            <option value="no">Reached: No</option>
          </select>
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-600">
            Min calls
            <input
              type="number"
              min={1}
              value={minCalls}
              onChange={(e) => setMinCalls(Math.max(1, Number(e.target.value) || 1))}
              className="w-14 rounded border border-gray-200 px-1.5 py-0.5 text-sm focus:border-sky-400 focus:outline-none"
            />
          </label>
          {activeFilters > 0 && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-200 active:scale-95"
            >
              <FiX /> Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-3 font-semibold">#</th>
                <th className="px-3 py-3 font-semibold">Complaint No</th>
                <th className="px-3 py-3 font-semibold">Complaint Date</th>
                <th className="px-3 py-3 font-semibold">Consumer</th>
                <th className="px-3 py-3 font-semibold">Substation</th>
                <th className="px-3 py-3 text-right font-semibold">Calls</th>
                <th className="px-3 py-3 text-right font-semibold">Connected</th>
                <th className="px-3 py-3 text-right font-semibold">Talk</th>
                <th className="px-3 py-3 font-semibold">Last Remark</th>
                <th className="px-3 py-3 font-semibold">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.slice(0, limit).map((r, idx) => {
                const isOpen = open === r.complaintNumber;
                const mins = resolutionMinutes(r);
                const sla = slaMinutes(r.areaType);
                return (
                  <React.Fragment key={r.complaintNumber}>
                    <tr
                      onClick={() => setOpen(isOpen ? null : r.complaintNumber)}
                      className={`cursor-pointer transition-colors ${isOpen ? 'bg-sky-50' : 'hover:bg-sky-50/50'}`}
                    >
                      <td className="px-3 py-3 font-semibold text-gray-400">
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? <FiChevronDown /> : <FiChevronRight />} {idx + 1}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-semibold text-gray-900">{r.complaintNumber}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{fmtDateTime(r.complaintDate)}</td>
                      <td className="px-3 py-3 text-gray-700">
                        <div className="font-medium">{r.consumerName || '—'}</div>
                        <div className="text-xs text-gray-400">{r.consumerMobile || '—'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600">{r.substation || '—'}</td>
                      <td className="px-3 py-3 text-right font-bold text-gray-900">{r.totalCalls}</td>
                      <td className={`px-3 py-3 text-right font-semibold ${r.connectedCalls ? 'text-green-700' : 'text-gray-400'}`}>{r.connectedCalls}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.talkSeconds ? fmtSecs(r.talkSeconds) : '—'}</td>
                      <td className="max-w-[16rem] truncate px-3 py-3 text-gray-700" title={r.lastRemark}>{r.lastRemark || <span className="text-gray-300">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {r.closedStatus ? (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            r.closedStatus === 'Closed Within' ? 'bg-green-100 text-green-800'
                              : r.closedStatus === 'Closed Beyond' ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}>{r.closedStatus}</span>
                        ) : <span className="text-gray-300">—</span>}
                        {mins != null && <div className="mt-0.5 text-[11px] text-gray-400">{mins}m / {sla}m</div>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-sky-50/40">
                        <td colSpan={10} className="px-3 pb-4 pt-1">
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                            <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Complaint</p>
                              <dl className="space-y-1 text-gray-700">
                                <div><dt className="inline text-gray-500">Type: </dt><dd className="inline">{r.complaintType || '—'}{r.complaintSubType ? ` / ${r.complaintSubType}` : ''}</dd></div>
                                <div><dt className="inline text-gray-500">Division: </dt><dd className="inline">{r.division || '—'}</dd></div>
                                <div><dt className="inline text-gray-500">Sub Division: </dt><dd className="inline">{r.subDivision || '—'}</dd></div>
                                <div><dt className="inline text-gray-500">Feeder: </dt><dd className="inline">{r.feeder || '—'}</dd></div>
                                <div><dt className="inline text-gray-500">Area: </dt><dd className="inline">{r.areaType || '—'}</dd></div>
                                <div><dt className="inline text-gray-500">Status: </dt><dd className="inline">{r.status || '—'}</dd></div>
                                <div><dt className="inline text-gray-500">Closed: </dt><dd className="inline">{fmtDateTime(r.closedDate)}</dd></div>
                                <div><dt className="inline text-gray-500">FRT closing remark: </dt><dd className="inline">{r.closingRemarks || '—'}</dd></div>
                              </dl>
                            </div>
                            <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Consumer</p>
                              <dl className="space-y-1 text-gray-700">
                                <div><dt className="inline text-gray-500">Name: </dt><dd className="inline">{r.consumerName || '—'}</dd></div>
                                <div><dt className="inline text-gray-500">Mobile: </dt><dd className="inline">{r.consumerMobile || '—'}</dd></div>
                                <div><dt className="inline text-gray-500">Address: </dt><dd className="inline">{r.consumerAddress || '—'}</dd></div>
                                <div><dt className="inline text-gray-500">Substation: </dt><dd className="inline">{r.substation || '—'}</dd></div>
                                <div><dt className="inline text-gray-500">Fault(s) recorded: </dt><dd className="inline">{r.faults.join(', ') || '—'}</dd></div>
                              </dl>
                            </div>
                            <div className="rounded-xl border border-gray-200 bg-white p-3 lg:col-span-1">
                              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Call history ({r.totalCalls})</p>
                              <ol className="space-y-2">
                                {r.calls.map((c, i) => (
                                  <li key={i} className="rounded-lg border border-gray-100 bg-gray-50/60 p-2 text-xs">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-semibold text-gray-700">{fmtDateTime(c.time)}</span>
                                      {c.incoming && <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700"><FiPhoneIncoming /> Incoming</span>}
                                      <span className={`rounded px-1.5 py-0.5 font-semibold ${c.connected ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                                        {c.status || (c.connected ? 'Connected' : 'Not connected')}
                                      </span>
                                      {c.seconds > 0 && <span className="text-gray-500">{fmtSecs(c.seconds)}</span>}
                                      {c.deskFilled && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800" title="Logged at the desk — not dialled from the app">Not dialled from app</span>}
                                    </div>
                                    {c.fault && <div className="mt-1 text-gray-600">Fault: <b>{c.fault}</b></div>}
                                    {c.remark && <div className="mt-1 text-gray-800">“{c.remark}”</div>}
                                    {c.operator && <div className="mt-0.5 text-gray-400">— {c.operator}</div>}
                                  </li>
                                ))}
                              </ol>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center italic text-gray-500">No complaint matches the current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > limit && (
          <div className="border-t border-gray-100 bg-gray-50 p-4 text-center">
            <button onClick={() => setLimit((l) => l + PAGE)} className="text-sm font-medium text-sky-600 transition hover:text-sky-800 active:scale-95">
              Show More ({nfmt(filtered.length - limit)} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(CalledComplaints);
