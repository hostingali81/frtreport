'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiDownload, FiLoader, FiPhoneCall, FiSearch } from 'react-icons/fi';
import { loadExcelJS } from '../utils/lazyImports';
import {
    CAT,
    GRID,
    INK,
    NEUTRAL,
    SURFACE,
    nfmt,
    TOOLTIP,
    axisTicks,
    hairlineGrid,
    barEndLabels,
    stackEndLabels,
    doughnutCenter,
    ChartCard
} from './chartTheme';

// ---------- types (mirror the get_calling_stats jsonb) ----------

type KN = { k: string; n: number };
type CallingStats = {
    total: number;
    called: number;
    connected: number;
    attempts: number;
    attemptsConnected: number;
    talkSeconds: number;
    substationKnown: number;
    uncategorizedConnected: number;
    byCallStatus: KN[];
    byFault: { k: string; n: number; attempts: number }[];
    byType: { k: string; n: number; called: number; connected: number }[];
    bySubType: { k: string; t: string; n: number; called: number; connected: number }[];
    byFeeder: { k: string; n: number; called: number; connected: number }[];
    bySubstation: { k: string; n: number; called: number; connected: number }[];
    typeByFeeder: { f: string; t: string; n: number }[];
    faultByFeeder: { f: string; c: string; n: number }[];
    typeBySubstation: { s: string; t: string; n: number }[];
    faultBySubstation: { s: string; c: string; n: number }[];
    daily: { d: string; n: number; called: number; connected: number }[];
};

// ---------- entity colors (stable across every chart in this report) ----------

const C_TOTAL = CAT[0]; // complaints
const C_CONNECTED = CAT[1]; // consumer answered
const C_CALLED = CAT[2]; // called but not reached
const C_NOT_CALLED = NEUTRAL; // remainder, not an entity

// Call statuses keep one hue each so filtering/ranking never repaints them.
const STATUS_COLORS: Record<string, string> = {
    Connected: CAT[1],
    'No Answer': CAT[2],
    'Switched Off': CAT[4],
    Busy: CAT[7],
    'Wrong Number': CAT[5]
};

// ---------- small helpers ----------

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

const fmtTalk = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const shortDate = (isoDate: string) => {
    const [, m, d] = isoDate.split('-');
    return `${d}/${m}`;
};
const fullDate = (isoDate: string) => {
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
};

function istToday(): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
}
function daysAgo(dateOnly: string, days: number): string {
    const [y, m, d] = dateOnly.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - days);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Top-N breakdown text ("11 KV Line Fault (12), Meter Issue (4)") for a
// feeder/substation from the flat matrix rows.
function topBreakdown<T extends { n: number }>(rows: T[], label: (r: T) => string, take = 2): string {
    if (rows.length === 0) return '—';
    return rows
        .slice(0, take)
        .map((r) => `${label(r)} (${r.n})`)
        .join(', ');
}

// ---------- chart canvas lifecycle ----------

function ChartCanvas({ build, deps }: { build: (ChartCtor: any, el: HTMLCanvasElement) => any; deps: unknown[] }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        let chart: any;
        let mounted = true;
        (async () => {
            const { Chart } = await import('chart.js/auto');
            if (!mounted || !ref.current) return;
            chart = build(Chart, ref.current);
        })();
        return () => {
            mounted = false;
            if (chart) chart.destroy();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return <canvas ref={ref} />;
}

// Stacked horizontal "contact funnel" rows: Connected / Called, not reached /
// Not called. One total at the row end; per-segment values in the tooltip.
function contactStackConfig(items: { k: string; n: number; called: number; connected: number }[]) {
    return (Chart: any, el: HTMLCanvasElement) =>
        new Chart(el, {
            type: 'bar',
            data: {
                labels: items.map((i) => i.k),
                datasets: [
                    { label: 'Connected', data: items.map((i) => i.connected), backgroundColor: C_CONNECTED, borderColor: SURFACE, borderWidth: 1, borderRadius: 3 },
                    { label: 'Called, not reached', data: items.map((i) => i.called - i.connected), backgroundColor: C_CALLED, borderColor: SURFACE, borderWidth: 1, borderRadius: 3 },
                    { label: 'Not called', data: items.map((i) => i.n - i.called), backgroundColor: C_NOT_CALLED, borderColor: SURFACE, borderWidth: 1, borderRadius: 3 }
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { right: 44 } },
                plugins: {
                    legend: { position: 'top', labels: { color: INK.secondary, usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
                    tooltip: { ...TOOLTIP, mode: 'index', intersect: false }
                },
                scales: {
                    x: { stacked: true, beginAtZero: true, ticks: axisTicks, grid: hairlineGrid, border: { color: GRID } },
                    y: { stacked: true, ticks: { ...axisTicks, autoSkip: false }, grid: { display: false }, border: { color: GRID } }
                }
            },
            plugins: [stackEndLabels]
        });
}

// ---------- component ----------

type Preset = 'today' | '7d' | '30d' | 'all' | 'custom';
type SubTab = 'overview' | 'types' | 'faults' | 'feeders' | 'substations';

const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'types', label: 'Complaint Types' },
    { id: 'faults', label: 'Fault Types' },
    { id: 'feeders', label: 'Feeders' },
    { id: 'substations', label: 'Substations' }
];

const PRESETS: { id: Preset; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: 'Last 7 Days' },
    { id: '30d', label: 'Last 30 Days' },
    { id: 'all', label: 'All Time' }
];

function CallingReport() {
    const today = istToday();
    const [preset, setPreset] = useState<Preset>('7d');
    const [from, setFrom] = useState(daysAgo(today, 6));
    const [to, setTo] = useState(today);
    const [stats, setStats] = useState<CallingStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [subTab, setSubTab] = useState<SubTab>('overview');
    const [feederSearch, setFeederSearch] = useState('');
    const [feederLimit, setFeederLimit] = useState(20);
    const [ssSearch, setSsSearch] = useState('');
    const [ssLimit, setSsLimit] = useState(20);
    const [exporting, setExporting] = useState(false);

    const rangeLabel = preset === 'all' ? 'All time' : `${fullDate(from)} – ${fullDate(to)}`;

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError('');
            try {
                const qs = preset === 'all' ? 'all=1' : `from=${from}&to=${to}`;
                const res = await fetch(`/api/calling/analytics?${qs}`);
                const json = await res.json();
                if (!json.success) throw new Error(json.error || 'Failed to load calling data');
                if (!cancelled) setStats(json.stats as CallingStats);
            } catch (err: any) {
                if (!cancelled) setError(err.message || 'Failed to load calling data');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [preset, from, to]);

    const applyPreset = (p: Preset) => {
        setPreset(p);
        if (p === 'today') {
            setFrom(today);
            setTo(today);
        } else if (p === '7d') {
            setFrom(daysAgo(today, 6));
            setTo(today);
        } else if (p === '30d') {
            setFrom(daysAgo(today, 29));
            setTo(today);
        }
    };

    // Top fault / top type per feeder & substation (matrices come pre-sorted by n desc).
    const feederFaults = useMemo(() => {
        const map = new Map<string, { c: string; n: number }[]>();
        for (const r of stats?.faultByFeeder ?? []) {
            if (!map.has(r.f)) map.set(r.f, []);
            map.get(r.f)!.push(r);
        }
        return map;
    }, [stats]);
    const feederTypes = useMemo(() => {
        const map = new Map<string, { t: string; n: number }[]>();
        for (const r of stats?.typeByFeeder ?? []) {
            if (!map.has(r.f)) map.set(r.f, []);
            map.get(r.f)!.push(r);
        }
        return map;
    }, [stats]);
    const ssFaults = useMemo(() => {
        const map = new Map<string, { c: string; n: number }[]>();
        for (const r of stats?.faultBySubstation ?? []) {
            if (!map.has(r.s)) map.set(r.s, []);
            map.get(r.s)!.push(r);
        }
        return map;
    }, [stats]);
    const ssTypes = useMemo(() => {
        const map = new Map<string, { t: string; n: number }[]>();
        for (const r of stats?.typeBySubstation ?? []) {
            if (!map.has(r.s)) map.set(r.s, []);
            map.get(r.s)!.push(r);
        }
        return map;
    }, [stats]);
    // Top feeders per fault (for the fault table).
    const faultFeeders = useMemo(() => {
        const map = new Map<string, { f: string; n: number }[]>();
        for (const r of stats?.faultByFeeder ?? []) {
            if (!map.has(r.c)) map.set(r.c, []);
            map.get(r.c)!.push(r);
        }
        return map;
    }, [stats]);

    const filteredFeeders = useMemo(() => {
        const list = stats?.byFeeder ?? [];
        const q = feederSearch.trim().toLowerCase();
        return q ? list.filter((f) => f.k.toLowerCase().includes(q)) : list;
    }, [stats, feederSearch]);
    const filteredSs = useMemo(() => {
        const list = stats?.bySubstation ?? [];
        const q = ssSearch.trim().toLowerCase();
        return q ? list.filter((s) => s.k.toLowerCase().includes(q)) : list;
    }, [stats, ssSearch]);

    const exportExcel = async () => {
        if (exporting || !stats) return;
        setExporting(true);
        try {
            const { ExcelJS, saveAs } = await loadExcelJS();
            const wb = new ExcelJS.Workbook();
            const headerStyle = (row: any) => {
                row.font = { bold: true };
                row.eachCell((cell: any) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
                    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                });
            };

            const summary = wb.addWorksheet('Summary');
            summary.addRow([`Calling Report  |  ${rangeLabel}`]);
            summary.mergeCells(1, 1, 1, 2);
            summary.getRow(1).font = { bold: true, size: 12 };
            const kv: [string, string | number][] = [
                ['Total complaints (live feed)', stats.total],
                ['Complaints called', stats.called],
                ['Complaints connected', stats.connected],
                ['Connect rate (of called)', `${pct(stats.connected, stats.called)}%`],
                ['Not called', stats.total - stats.called],
                ['Call attempts', stats.attempts],
                ['Attempts connected', stats.attemptsConnected],
                ['Total talk time', fmtTalk(stats.talkSeconds)],
                ['Connected but no fault recorded', stats.uncategorizedConnected]
            ];
            kv.forEach(([k, v]) => summary.addRow([k, v]));
            summary.addRow([]);
            headerStyle(summary.addRow(['Call Status (attempts)', 'Count']));
            stats.byCallStatus.forEach((s) => summary.addRow([s.k, s.n]));
            summary.columns = [{ width: 36 }, { width: 16 }];

            const types = wb.addWorksheet('Complaint Types');
            headerStyle(types.addRow(['Complaint Type', 'Total', 'Called', 'Connected', 'Connect %']));
            stats.byType.forEach((t) => types.addRow([t.k, t.n, t.called, t.connected, `${pct(t.connected, t.n)}%`]));
            types.addRow([]);
            headerStyle(types.addRow(['Sub Type', 'Parent Type', 'Total', 'Called', 'Connected']));
            stats.bySubType.forEach((t) => types.addRow([t.k, t.t, t.n, t.called, t.connected]));
            types.columns = [{ width: 34 }, { width: 24 }, { width: 10 }, { width: 10 }, { width: 12 }];

            const faults = wb.addWorksheet('Fault Types');
            headerStyle(faults.addRow(['Fault (from calls)', 'Complaints', 'Attempts', 'Top Feeders']));
            stats.byFault.forEach((f) =>
                faults.addRow([f.k, f.n, f.attempts, topBreakdown(faultFeeders.get(f.k) ?? [], (r) => r.f, 3)])
            );
            faults.columns = [{ width: 32 }, { width: 12 }, { width: 10 }, { width: 50 }];

            const feeders = wb.addWorksheet('Feeders');
            headerStyle(feeders.addRow(['Feeder', 'Total', 'Called', 'Connected', 'Top Fault', 'Top Complaint Type']));
            stats.byFeeder.forEach((f) =>
                feeders.addRow([
                    f.k, f.n, f.called, f.connected,
                    topBreakdown(feederFaults.get(f.k) ?? [], (r) => r.c),
                    topBreakdown(feederTypes.get(f.k) ?? [], (r) => r.t)
                ])
            );
            feeders.columns = [{ width: 32 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 40 }, { width: 40 }];

            const subs = wb.addWorksheet('Substations');
            headerStyle(subs.addRow(['Substation', 'Total', 'Called', 'Connected', 'Top Fault', 'Top Complaint Type']));
            stats.bySubstation.forEach((s) =>
                subs.addRow([
                    s.k, s.n, s.called, s.connected,
                    topBreakdown(ssFaults.get(s.k) ?? [], (r) => r.c),
                    topBreakdown(ssTypes.get(s.k) ?? [], (r) => r.t)
                ])
            );
            subs.columns = [{ width: 32 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 40 }, { width: 40 }];

            const buffer = await wb.xlsx.writeBuffer();
            saveAs(
                new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                `Calling_Report_${new Date().toISOString().slice(0, 10)}.xlsx`
            );
        } finally {
            setExporting(false);
        }
    };

    // ---------- render ----------

    const header = (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <span className="p-2 bg-sky-100 text-sky-600 rounded-lg"><FiPhoneCall /></span>
                        Calling Report
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Live-feed complaints + operator call outcomes from the calling app · {rangeLabel}
                    </p>
                </div>
                <button
                    onClick={exportExcel}
                    disabled={exporting || !stats || stats.total === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-emerald-800 active:scale-95 disabled:bg-gray-400"
                >
                    {exporting ? <FiLoader className="animate-spin" /> : <FiDownload />} {exporting ? 'Exporting…' : 'Export Excel'}
                </button>
            </div>
            {/* One filter row above everything it scopes. */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
                {PRESETS.map((p) => (
                    <button
                        key={p.id}
                        onClick={() => applyPreset(p.id)}
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition active:scale-95 ${
                            preset === p.id ? 'bg-sky-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300'
                        }`}
                    >
                        {p.label}
                    </button>
                ))}
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                        type="date"
                        value={preset === 'all' ? '' : from}
                        max={to}
                        onChange={(e) => { if (e.target.value) { setPreset('custom'); setFrom(e.target.value); } }}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 focus:border-sky-400 focus:outline-none"
                    />
                    <span>to</span>
                    <input
                        type="date"
                        value={preset === 'all' ? '' : to}
                        min={from}
                        max={today}
                        onChange={(e) => { if (e.target.value) { setPreset('custom'); setTo(e.target.value); } }}
                        className="rounded-lg border border-gray-200 px-2 py-1.5 focus:border-sky-400 focus:outline-none"
                    />
                </div>
            </div>
        </div>
    );

    if (error) {
        return (
            <div className="flex flex-col gap-6">
                {header}
                <div className="bg-red-50 border-l-4 border-red-500 text-red-800 px-4 py-3 rounded">
                    <p className="font-semibold">⚠️ {error}</p>
                    {error.includes('get_calling_stats') && (
                        <p className="mt-1 text-sm">The calling-stats database migration has not been applied yet (supabase db push).</p>
                    )}
                </div>
            </div>
        );
    }

    if (loading && !stats) {
        return (
            <div className="flex flex-col gap-6">
                {header}
                <div className="w-full h-96 bg-gray-100 rounded-2xl animate-pulse flex items-center justify-center text-gray-400 font-medium">
                    Loading Calling Report...
                </div>
            </div>
        );
    }

    if (!stats || stats.total === 0) {
        return (
            <div className="flex flex-col gap-6">
                {header}
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
                    <FiPhoneCall className="mx-auto mb-3 text-4xl text-amber-500" />
                    <p className="text-lg font-bold text-amber-900">No live-feed complaints in this range</p>
                    <p className="mt-2 text-sm text-amber-800">
                        The calling app only tracks complaints from the live FRT feed (started 03/07/2026), so older
                        dates have no data — try Today / Last 7 Days.
                    </p>
                </div>
            </div>
        );
    }

    const notCalled = stats.total - stats.called;
    const calledNotReached = stats.called - stats.connected;
    const dailyData = stats.daily;
    // The live feed is almost entirely one type ("Supply Related"), so the
    // sub-types carry the real signal - chart those; both tables stay.
    const subTypeItems = stats.bySubType.slice(0, 12);
    const faultItems = stats.byFault.slice(0, 15);
    // The Unknown bucket (rows the feed sent without feeder) would crush the
    // chart scale; it stays visible in the table below.
    const feederItems = stats.byFeeder.filter((f) => f.k !== 'Unknown').slice(0, 15);
    const unknownFeeder = stats.byFeeder.find((f) => f.k === 'Unknown');
    const ssItems = stats.bySubstation.slice(0, 15);

    const kpis: { label: string; value: string; sub?: string; color: string }[] = [
        { label: 'Total Complaints', value: nfmt(stats.total), sub: 'live feed', color: 'text-gray-900' },
        { label: 'Called', value: nfmt(stats.called), sub: `${pct(stats.called, stats.total)}% of total`, color: 'text-amber-600' },
        { label: 'Connected', value: nfmt(stats.connected), sub: `${pct(stats.connected, stats.total)}% of total`, color: 'text-green-600' },
        { label: 'Connect Rate', value: `${pct(stats.connected, stats.called)}%`, sub: 'of called', color: 'text-sky-700' },
        { label: 'Call Attempts', value: nfmt(stats.attempts), sub: `${nfmt(stats.attemptsConnected)} connected`, color: 'text-indigo-600' },
        { label: 'Talk Time', value: fmtTalk(stats.talkSeconds), sub: 'total', color: 'text-blue-700' }
    ];

    return (
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
            {header}

            <div className={loading ? 'opacity-60 pointer-events-none transition-opacity flex flex-col gap-6' : 'flex flex-col gap-6'}>
                {/* KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {kpis.map((kpi) => (
                        <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                            <p className="text-xs text-gray-500 uppercase tracking-wide">{kpi.label}</p>
                            <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                            {kpi.sub && <p className="text-[11px] text-gray-400">{kpi.sub}</p>}
                        </div>
                    ))}
                </div>

                {/* Contact coverage bar */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-200" title={`${stats.connected} connected · ${calledNotReached} called but not reached · ${notCalled} not called`}>
                        <div style={{ width: `${pct(stats.connected, stats.total)}%`, backgroundColor: C_CONNECTED }}></div>
                        <div style={{ width: `${pct(calledNotReached, stats.total)}%`, backgroundColor: C_CALLED }}></div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: C_CONNECTED }}></span>
                            Connected: <b className="text-gray-700">{nfmt(stats.connected)}</b>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: C_CALLED }}></span>
                            Called, not reached: <b className="text-gray-700">{nfmt(calledNotReached)}</b>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-gray-300"></span>
                            Not called: <b className="text-gray-700">{nfmt(notCalled)}</b>
                        </span>
                    </div>
                </div>

                {/* Sub tabs */}
                <div className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
                    {SUB_TABS.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => setSubTab(t.id)}
                            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                                subTab === t.id ? 'bg-sky-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 active:bg-gray-200'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* ---------- Overview ---------- */}
                {subTab === 'overview' && (
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                        <ChartCard
                            className="lg:col-span-3"
                            title="Daily: complaints vs calling"
                            subtitle="Complaints arrived, how many were called, how many answered"
                            height={300}
                        >
                            <ChartCanvas
                                deps={[dailyData]}
                                build={(Chart, el) =>
                                    new Chart(el, {
                                        type: 'line',
                                        data: {
                                            labels: dailyData.map((d) => shortDate(d.d)),
                                            datasets: [
                                                { label: 'Complaints', data: dailyData.map((d) => d.n), borderColor: C_TOTAL, backgroundColor: C_TOTAL, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3 },
                                                { label: 'Called', data: dailyData.map((d) => d.called), borderColor: C_CALLED, backgroundColor: C_CALLED, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3 },
                                                { label: 'Connected', data: dailyData.map((d) => d.connected), borderColor: C_CONNECTED, backgroundColor: C_CONNECTED, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3 }
                                            ]
                                        },
                                        options: {
                                            responsive: true,
                                            maintainAspectRatio: false,
                                            interaction: { mode: 'index', intersect: false },
                                            plugins: {
                                                legend: { position: 'top', labels: { color: INK.secondary, usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
                                                tooltip: {
                                                    ...TOOLTIP,
                                                    callbacks: { title: (items: any[]) => fullDate(dailyData[items[0]?.dataIndex]?.d ?? '') }
                                                }
                                            },
                                            scales: {
                                                y: { beginAtZero: true, ticks: axisTicks, grid: hairlineGrid, border: { display: false } },
                                                x: { ticks: { ...axisTicks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { display: false }, border: { color: GRID } }
                                            }
                                        }
                                    })
                                }
                            />
                        </ChartCard>
                        <ChartCard
                            className="lg:col-span-2"
                            title="Call attempts by result"
                            subtitle="Every attempt operators logged in this range"
                            height={300}
                        >
                            <ChartCanvas
                                deps={[stats.byCallStatus]}
                                build={(Chart, el) =>
                                    new Chart(el, {
                                        type: 'doughnut',
                                        data: {
                                            labels: stats.byCallStatus.map((s) => s.k),
                                            datasets: [
                                                {
                                                    data: stats.byCallStatus.map((s) => s.n),
                                                    backgroundColor: stats.byCallStatus.map((s) => STATUS_COLORS[s.k] ?? NEUTRAL),
                                                    borderColor: SURFACE,
                                                    borderWidth: 2,
                                                    hoverBorderColor: SURFACE
                                                }
                                            ]
                                        },
                                        options: {
                                            responsive: true,
                                            maintainAspectRatio: false,
                                            cutout: '62%',
                                            plugins: {
                                                legend: { position: 'right', labels: { color: INK.secondary, usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
                                                tooltip: TOOLTIP
                                            }
                                        },
                                        plugins: [doughnutCenter('attempts')]
                                    })
                                }
                            />
                        </ChartCard>
                    </div>
                )}

                {/* ---------- Complaint Types ---------- */}
                {subTab === 'types' && (
                    <>
                        <ChartCard
                            title="Complaint sub-types × contact outcome"
                            subtitle="What kind of complaints came in, and how far the calling reached them"
                            height={Math.max(280, subTypeItems.length * 36 + 90)}
                        >
                            <ChartCanvas deps={[subTypeItems]} build={contactStackConfig(subTypeItems)} />
                        </ChartCard>
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 border-b border-gray-100">
                                <h3 className="text-lg font-bold text-gray-800">Complaint Type Summary</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold">Type</th>
                                            <th className="px-4 py-3 font-semibold text-right">Total</th>
                                            <th className="px-4 py-3 font-semibold text-right">Called</th>
                                            <th className="px-4 py-3 font-semibold text-right">Connected</th>
                                            <th className="px-4 py-3 font-semibold text-right">Connect %</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {stats.byType.map((t) => (
                                            <tr key={t.k} className="hover:bg-sky-50/50 transition-colors">
                                                <td className="px-4 py-3 font-semibold text-gray-900">{t.k}</td>
                                                <td className="px-4 py-3 text-right font-bold text-gray-900">{nfmt(t.n)}</td>
                                                <td className="px-4 py-3 text-right text-amber-600 font-semibold">{nfmt(t.called)}</td>
                                                <td className="px-4 py-3 text-right text-green-700 font-semibold">{nfmt(t.connected)}</td>
                                                <td className="px-4 py-3 text-right text-gray-700">{pct(t.connected, t.n)}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 border-b border-gray-100">
                                <h3 className="text-lg font-bold text-gray-800">Sub-type Breakdown</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold">Sub Type</th>
                                            <th className="px-4 py-3 font-semibold">Type</th>
                                            <th className="px-4 py-3 font-semibold text-right">Total</th>
                                            <th className="px-4 py-3 font-semibold text-right">Called</th>
                                            <th className="px-4 py-3 font-semibold text-right">Connected</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {stats.bySubType.map((t) => (
                                            <tr key={t.k} className="hover:bg-sky-50/50 transition-colors">
                                                <td className="px-4 py-3 font-semibold text-gray-900">{t.k}</td>
                                                <td className="px-4 py-3 text-gray-600">{t.t}</td>
                                                <td className="px-4 py-3 text-right font-bold text-gray-900">{nfmt(t.n)}</td>
                                                <td className="px-4 py-3 text-right text-amber-600 font-semibold">{nfmt(t.called)}</td>
                                                <td className="px-4 py-3 text-right text-green-700 font-semibold">{nfmt(t.connected)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}

                {/* ---------- Fault Types ---------- */}
                {subTab === 'faults' && (
                    <>
                        {stats.byFault.length === 0 ? (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
                                <p className="text-lg font-bold text-amber-900">No fault categories recorded yet</p>
                                <p className="mt-2 text-sm text-amber-800">
                                    Operators record the fault type after a connected call — nothing has been recorded in this range.
                                </p>
                            </div>
                        ) : (
                            <>
                                <ChartCard
                                    title="Fault types found on calls"
                                    subtitle={`What consumers reported when operators reached them · ${nfmt(stats.uncategorizedConnected)} connected complaints have no fault recorded`}
                                    height={Math.max(280, faultItems.length * 32 + 70)}
                                >
                                    <ChartCanvas
                                        deps={[faultItems]}
                                        build={(Chart, el) =>
                                            new Chart(el, {
                                                type: 'bar',
                                                data: {
                                                    labels: faultItems.map((f) => f.k),
                                                    datasets: [{ label: 'Complaints', data: faultItems.map((f) => f.n), backgroundColor: C_TOTAL, borderRadius: 4, barThickness: 'flex' as const, maxBarThickness: 22 }]
                                                },
                                                options: {
                                                    indexAxis: 'y',
                                                    responsive: true,
                                                    maintainAspectRatio: false,
                                                    layout: { padding: { right: 44 } },
                                                    plugins: { legend: { display: false }, tooltip: TOOLTIP },
                                                    scales: {
                                                        x: { beginAtZero: true, ticks: axisTicks, grid: hairlineGrid, border: { color: GRID } },
                                                        y: { ticks: { ...axisTicks, autoSkip: false }, grid: { display: false }, border: { color: GRID } }
                                                    }
                                                },
                                                plugins: [barEndLabels]
                                            })
                                        }
                                    />
                                </ChartCard>
                                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                    <div className="p-4 border-b border-gray-100">
                                        <h3 className="text-lg font-bold text-gray-800">Fault-wise Summary</h3>
                                        <p className="text-xs text-gray-400 mt-0.5">Complaints = unique complaints where a call recorded this fault</p>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                                                <tr>
                                                    <th className="px-4 py-3 font-semibold">#</th>
                                                    <th className="px-4 py-3 font-semibold">Fault</th>
                                                    <th className="px-4 py-3 font-semibold text-right">Complaints</th>
                                                    <th className="px-4 py-3 font-semibold text-right">Attempts</th>
                                                    <th className="px-4 py-3 font-semibold">Top Feeders</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {stats.byFault.map((f, idx) => (
                                                    <tr key={f.k} className="hover:bg-sky-50/50 transition-colors">
                                                        <td className="px-4 py-3 text-gray-400 font-semibold">{idx + 1}</td>
                                                        <td className="px-4 py-3 font-semibold text-gray-900">{f.k}</td>
                                                        <td className="px-4 py-3 text-right font-bold text-gray-900">{nfmt(f.n)}</td>
                                                        <td className="px-4 py-3 text-right text-gray-700">{nfmt(f.attempts)}</td>
                                                        <td className="px-4 py-3 text-gray-600 text-xs">{topBreakdown(faultFeeders.get(f.k) ?? [], (r) => r.f, 3)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </>
                        )}
                    </>
                )}

                {/* ---------- Feeders ---------- */}
                {subTab === 'feeders' && (
                    <>
                        <ChartCard
                            title="Top feeders × contact outcome"
                            subtitle={`Feeders with the most live-feed complaints in this range${
                                unknownFeeder ? ` · ${nfmt(unknownFeeder.n)} complaints came without feeder info (in the table below)` : ''
                            }`}
                            height={Math.max(280, feederItems.length * 34 + 90)}
                        >
                            <ChartCanvas deps={[feederItems]} build={contactStackConfig(feederItems)} />
                        </ChartCard>
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                <h3 className="text-lg font-bold text-gray-800">Feeder-wise Summary</h3>
                                <div className="relative w-full sm:w-64">
                                    <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        value={feederSearch}
                                        onChange={(e) => { setFeederSearch(e.target.value); setFeederLimit(20); }}
                                        placeholder="Search feeder…"
                                        className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-sky-400 focus:outline-none"
                                    />
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold">#</th>
                                            <th className="px-4 py-3 font-semibold">Feeder</th>
                                            <th className="px-4 py-3 font-semibold text-right">Total</th>
                                            <th className="px-4 py-3 font-semibold text-right">Called</th>
                                            <th className="px-4 py-3 font-semibold text-right">Connected</th>
                                            <th className="px-4 py-3 font-semibold">Top Fault (from calls)</th>
                                            <th className="px-4 py-3 font-semibold">Top Complaint Type</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {filteredFeeders.slice(0, feederLimit).map((f, idx) => (
                                            <tr key={f.k} className="hover:bg-sky-50/50 transition-colors">
                                                <td className="px-4 py-3 text-gray-400 font-semibold">{idx + 1}</td>
                                                <td className="px-4 py-3 font-semibold text-gray-900">{f.k}</td>
                                                <td className="px-4 py-3 text-right font-bold text-gray-900">{nfmt(f.n)}</td>
                                                <td className="px-4 py-3 text-right text-amber-600 font-semibold">{nfmt(f.called)}</td>
                                                <td className="px-4 py-3 text-right text-green-700 font-semibold">{nfmt(f.connected)}</td>
                                                <td className="px-4 py-3 text-gray-600 text-xs">{topBreakdown(feederFaults.get(f.k) ?? [], (r) => r.c)}</td>
                                                <td className="px-4 py-3 text-gray-600 text-xs">{topBreakdown(feederTypes.get(f.k) ?? [], (r) => r.t)}</td>
                                            </tr>
                                        ))}
                                        {filteredFeeders.length === 0 && (
                                            <tr>
                                                <td colSpan={7} className="px-4 py-8 text-center text-gray-500 italic">No feeder matches “{feederSearch}”.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            {filteredFeeders.length > feederLimit && (
                                <div className="p-4 border-t border-gray-100 bg-gray-50 text-center">
                                    <button onClick={() => setFeederLimit((l) => l + 20)} className="text-sky-600 hover:text-sky-800 active:text-sky-900 font-medium text-sm transition active:scale-95">
                                        Show More ({filteredFeeders.length - feederLimit} remaining)
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* ---------- Substations ---------- */}
                {subTab === 'substations' && (
                    <>
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 text-sm text-gray-600">
                            Substation is known for <b className="text-gray-800">{nfmt(stats.substationKnown)}</b> of{' '}
                            <b className="text-gray-800">{nfmt(stats.total)}</b> complaints ({pct(stats.substationKnown, stats.total)}%) —
                            it comes from the consumer-contact record, which the calling app fetches only when a complaint is opened.
                        </div>
                        {ssItems.length === 0 ? (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
                                <p className="text-lg font-bold text-amber-900">No substation data in this range</p>
                                <p className="mt-2 text-sm text-amber-800">Open complaints in the calling app to collect substation info.</p>
                            </div>
                        ) : (
                            <>
                                <ChartCard
                                    title="Top substations × contact outcome"
                                    subtitle="Among complaints whose substation is known"
                                    height={Math.max(280, ssItems.length * 34 + 90)}
                                >
                                    <ChartCanvas deps={[ssItems]} build={contactStackConfig(ssItems)} />
                                </ChartCard>
                                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                    <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                        <h3 className="text-lg font-bold text-gray-800">Substation-wise Summary</h3>
                                        <div className="relative w-full sm:w-64">
                                            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                value={ssSearch}
                                                onChange={(e) => { setSsSearch(e.target.value); setSsLimit(20); }}
                                                placeholder="Search substation…"
                                                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-sky-400 focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                                                <tr>
                                                    <th className="px-4 py-3 font-semibold">#</th>
                                                    <th className="px-4 py-3 font-semibold">Substation</th>
                                                    <th className="px-4 py-3 font-semibold text-right">Total</th>
                                                    <th className="px-4 py-3 font-semibold text-right">Called</th>
                                                    <th className="px-4 py-3 font-semibold text-right">Connected</th>
                                                    <th className="px-4 py-3 font-semibold">Top Fault (from calls)</th>
                                                    <th className="px-4 py-3 font-semibold">Top Complaint Type</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {filteredSs.slice(0, ssLimit).map((s, idx) => (
                                                    <tr key={s.k} className="hover:bg-sky-50/50 transition-colors">
                                                        <td className="px-4 py-3 text-gray-400 font-semibold">{idx + 1}</td>
                                                        <td className="px-4 py-3 font-semibold text-gray-900">{s.k}</td>
                                                        <td className="px-4 py-3 text-right font-bold text-gray-900">{nfmt(s.n)}</td>
                                                        <td className="px-4 py-3 text-right text-amber-600 font-semibold">{nfmt(s.called)}</td>
                                                        <td className="px-4 py-3 text-right text-green-700 font-semibold">{nfmt(s.connected)}</td>
                                                        <td className="px-4 py-3 text-gray-600 text-xs">{topBreakdown(ssFaults.get(s.k) ?? [], (r) => r.c)}</td>
                                                        <td className="px-4 py-3 text-gray-600 text-xs">{topBreakdown(ssTypes.get(s.k) ?? [], (r) => r.t)}</td>
                                                    </tr>
                                                ))}
                                                {filteredSs.length === 0 && (
                                                    <tr>
                                                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500 italic">No substation matches “{ssSearch}”.</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    {filteredSs.length > ssLimit && (
                                        <div className="p-4 border-t border-gray-100 bg-gray-50 text-center">
                                            <button onClick={() => setSsLimit((l) => l + 20)} className="text-sky-600 hover:text-sky-800 active:text-sky-900 font-medium text-sm transition active:scale-95">
                                                Show More ({filteredSs.length - ssLimit} remaining)
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default React.memo(CallingReport);
