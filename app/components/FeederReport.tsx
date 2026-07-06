'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiDownload, FiSearch, FiZap } from 'react-icons/fi';
import type { ChartStats } from '../context/DataContext';
import { loadExcelJS } from '../utils/lazyImports';

interface Props {
    stats: ChartStats;
}

const formatMins = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h}h ${m}m`;
};

// Feeder-wise report. Feeder started appearing in the FRT report recently, so
// older complaints have no feeder - the coverage line makes that visible
// instead of silently under-counting.
function FeederReport({ stats }: Props) {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstance = useRef<any>(null);
    const [tableSearch, setTableSearch] = useState('');
    const [limit, setLimit] = useState(20);
    const [exporting, setExporting] = useState(false);

    const feeders = useMemo(() => stats.byFeeder ?? [], [stats]);
    const withFeeder = useMemo(() => feeders.reduce((sum, f) => sum + f.n, 0), [feeders]);
    const coverage = stats.total > 0 ? Math.round((withFeeder / stats.total) * 100) : 0;
    const totalPending = useMemo(() => feeders.reduce((sum, f) => sum + f.pending, 0), [feeders]);
    const totalBeyond = useMemo(() => feeders.reduce((sum, f) => sum + f.beyond, 0), [feeders]);

    const filteredFeeders = useMemo(() => {
        const q = tableSearch.trim().toLowerCase();
        if (!q) return feeders;
        return feeders.filter((f) => f.k.toLowerCase().includes(q));
    }, [feeders, tableSearch]);

    useEffect(() => {
        if (feeders.length === 0) return;
        let mounted = true;

        (async () => {
            const { Chart } = await import('chart.js/auto');
            if (!mounted || !chartRef.current) return;

            if (chartInstance.current) chartInstance.current.destroy();

            const top = feeders.slice(0, 15);
            chartInstance.current = new Chart(chartRef.current, {
                type: 'bar',
                data: {
                    labels: top.map((f) => f.k),
                    datasets: [
                        {
                            label: 'Closed',
                            data: top.map((f) => f.n - f.pending),
                            backgroundColor: 'rgba(16, 185, 129, 0.75)',
                            borderRadius: 4
                        },
                        {
                            label: 'Pending',
                            data: top.map((f) => f.pending),
                            backgroundColor: 'rgba(239, 68, 68, 0.75)',
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { right: 40 } },
                    plugins: {
                        title: { display: true, text: 'Top 15 Feeders by Complaints', font: { size: 15, weight: 'bold' } },
                        legend: { position: 'top' },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    scales: {
                        x: { stacked: true, beginAtZero: true, grid: { display: false } },
                        y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } }
                    }
                },
                plugins: [{
                    id: 'feederTotals',
                    afterDatasetsDraw: (chart: any) => {
                        const ctx = chart.ctx;
                        const meta = chart.getDatasetMeta(1);
                        meta.data.forEach((bar: any, index: number) => {
                            ctx.fillStyle = '#374151';
                            ctx.font = 'bold 11px sans-serif';
                            ctx.textAlign = 'left';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(String(top[index].n), bar.x + 5, bar.y);
                        });
                    }
                }]
            });
        })();

        return () => {
            mounted = false;
            if (chartInstance.current) chartInstance.current.destroy();
        };
    }, [feeders]);

    const exportExcel = async () => {
        if (exporting || feeders.length === 0) return;
        setExporting(true);
        try {
            const { ExcelJS, saveAs } = await loadExcelJS();
            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet('Feeder Report', { views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }] });

            ws.addRow([`Feeder-wise Complaint Report  |  ${withFeeder} of ${stats.total} complaints carry feeder info (${coverage}%)`]);
            ws.mergeCells(1, 1, 1, 7);
            ws.getRow(1).font = { bold: true, size: 12 };

            const header = ws.addRow(['Rank', 'Feeder', 'Total', 'Pending', 'Closed', 'Closed Beyond', 'Avg Resolution']);
            header.font = { bold: true };
            header.eachCell((cell: any) => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            });

            feeders.forEach((f, i) => {
                ws.addRow([
                    i + 1,
                    f.k,
                    f.n,
                    f.pending,
                    f.n - f.pending,
                    f.beyond,
                    f.resN > 0 ? formatMins(f.resSum / f.resN) : '-'
                ]);
            });

            ws.columns = [
                { width: 6 }, { width: 32 }, { width: 10 }, { width: 10 },
                { width: 10 }, { width: 14 }, { width: 16 }
            ];

            const buffer = await wb.xlsx.writeBuffer();
            saveAs(
                new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                `Feeder_Report_${new Date().toISOString().slice(0, 10)}.xlsx`
            );
        } finally {
            setExporting(false);
        }
    };

    if (stats.total === 0) return null;

    if (feeders.length === 0) {
        return (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
                <FiZap className="mx-auto mb-3 text-4xl text-amber-500" />
                <p className="text-lg font-bold text-amber-900">No feeder data in this range</p>
                <p className="mt-2 text-sm text-amber-800">
                    Feeder information started coming in the FRT report only recently, so older complaints
                    do not have it. Try a recent date range (e.g. Today / Last 24 Hours).
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
            {/* Header + coverage */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <span className="p-2 bg-amber-100 text-amber-600 rounded-lg"><FiZap /></span>
                        Feeder Report
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        {withFeeder} of {stats.total} complaints carry feeder info ({coverage}% coverage)
                    </p>
                </div>
                <button
                    onClick={exportExcel}
                    disabled={exporting}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:bg-gray-400"
                >
                    <FiDownload /> {exporting ? 'Exporting…' : 'Export Excel'}
                </button>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Feeders</p>
                    <p className="text-2xl font-bold text-gray-900">{feeders.length}</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Complaints (with feeder)</p>
                    <p className="text-2xl font-bold text-blue-700">{withFeeder}</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Pending</p>
                    <p className="text-2xl font-bold text-red-600">{totalPending}</p>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Closed Beyond</p>
                    <p className="text-2xl font-bold text-amber-600">{totalBeyond}</p>
                </div>
            </div>

            {/* Top feeders chart */}
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                <div style={{ height: `${Math.max(320, Math.min(15, feeders.length) * 34 + 90)}px` }}>
                    <canvas ref={chartRef} />
                </div>
            </div>

            {/* Feeder table */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <h3 className="text-lg font-bold text-gray-800">Feeder-wise Summary</h3>
                    <div className="relative w-full sm:w-64">
                        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={tableSearch}
                            onChange={(e) => { setTableSearch(e.target.value); setLimit(20); }}
                            placeholder="Search feeder…"
                            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-blue-400 focus:outline-none"
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
                                <th className="px-4 py-3 font-semibold text-right">Pending</th>
                                <th className="px-4 py-3 font-semibold text-right">Closed</th>
                                <th className="px-4 py-3 font-semibold text-right">Closed Beyond</th>
                                <th className="px-4 py-3 font-semibold text-right">Avg Resolution</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredFeeders.slice(0, limit).map((f, idx) => (
                                <tr key={f.k} className="hover:bg-amber-50/50 transition-colors">
                                    <td className="px-4 py-3 text-gray-400 font-semibold">{idx + 1}</td>
                                    <td className="px-4 py-3 font-semibold text-gray-900">{f.k}</td>
                                    <td className="px-4 py-3 text-right font-bold text-gray-900">{f.n}</td>
                                    <td className="px-4 py-3 text-right">
                                        <span className={`font-semibold ${f.pending > 0 ? 'text-red-600' : 'text-gray-400'}`}>{f.pending}</span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-semibold text-green-700">{f.n - f.pending}</td>
                                    <td className="px-4 py-3 text-right">
                                        <span className={`font-semibold ${f.beyond > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{f.beyond}</span>
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-700">
                                        {f.resN > 0 ? formatMins(f.resSum / f.resN) : '—'}
                                    </td>
                                </tr>
                            ))}
                            {filteredFeeders.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500 italic">
                                        No feeder matches “{tableSearch}”.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {filteredFeeders.length > limit && (
                    <div className="p-4 border-t border-gray-100 bg-gray-50 text-center">
                        <button onClick={() => setLimit((l) => l + 20)} className="text-blue-600 hover:text-blue-800 font-medium text-sm">
                            Show More ({filteredFeeders.length - limit} remaining)
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default React.memo(FeederReport);
