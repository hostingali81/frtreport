'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { ChartStats } from '../context/DataContext';

const Select = dynamic(() => import('react-select'), { ssr: false });

interface Props {
    stats: ChartStats;
}

// Aggregate {m, k, resSum, resN} groups into per-key averages, optionally
// restricted to one month key. Only keys with at least one closed pair show up.
function averageByKey(
    groups: { m: string; k: string; n: number; resSum: number; resN: number }[],
    monthKey: string | null
) {
    const map = new Map<string, { resSum: number; resN: number }>();
    for (const g of groups) {
        if (monthKey && g.m !== monthKey) continue;
        const curr = map.get(g.k) || { resSum: 0, resN: 0 };
        curr.resSum += g.resSum;
        curr.resN += g.resN;
        map.set(g.k, curr);
    }
    return Array.from(map.entries())
        .filter(([, v]) => v.resN > 0)
        .map(([k, v]) => ({
            key: k,
            avgMins: Math.round(v.resSum / v.resN),
            count: v.resN
        }))
        .sort((a, b) => b.avgMins - a.avgMins);
}

const parseIsoDate = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const formatMins = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h}h ${m}m`;
};

const formatHourLabel = (h: number) => {
    if (h === 0) return '12 AM';
    if (h === 12) return '12 PM';
    return h > 12 ? `${h - 12} PM` : `${h} AM`;
};

// Deep-dive analysis: peak hours, heatmap, resolution efficiency - everything
// month-filterable from ONE selector (this replaces the old DeepAnalysisCharts
// + AdvancedInsights pair, which each carried their own month dropdown).
function DeepDivePanel({ stats }: Props) {
    const hourlyRef = useRef<HTMLCanvasElement>(null);
    const trendRef = useRef<HTMLCanvasElement>(null);
    const resolutionRef = useRef<HTMLCanvasElement>(null);
    const divisionRef = useRef<HTMLCanvasElement>(null);

    const hourlyInstance = useRef<any>(null);
    const trendInstance = useRef<any>(null);
    const resolutionInstance = useRef<any>(null);
    const divisionInstance = useRef<any>(null);

    const [selectedMonth, setSelectedMonth] = useState<string>('All');

    const monthOptions = useMemo(() => {
        const options = stats.months.map((m) => ({ value: m.label, label: m.label }));
        return [{ value: 'All', label: 'All Months' }, ...options];
    }, [stats]);

    // 'June 2026' -> '2026-06' (null = All)
    const selectedMonthKey = useMemo(() => {
        if (selectedMonth === 'All') return null;
        return stats.months.find((m) => m.label === selectedMonth)?.key ?? null;
    }, [stats, selectedMonth]);

    const hourlyData = useMemo(() => {
        const hours = new Array(24).fill(0);
        for (const cell of stats.monthHeat) {
            if (selectedMonthKey && cell.m !== selectedMonthKey) continue;
            hours[cell.hr] += cell.n;
        }
        return hours;
    }, [stats, selectedMonthKey]);

    const heatmapData = useMemo(() => {
        const grid = Array(7).fill(0).map(() => Array(24).fill(0));
        let maxCount = 0;
        for (const cell of stats.monthHeat) {
            if (selectedMonthKey && cell.m !== selectedMonthKey) continue;
            grid[cell.dow][cell.hr] += cell.n;
            if (grid[cell.dow][cell.hr] > maxCount) maxCount = grid[cell.dow][cell.hr];
        }
        return { grid, maxCount };
    }, [stats, selectedMonthKey]);

    const resolutionData = useMemo(
        () => averageByKey(stats.monthSubStation, selectedMonthKey),
        [stats, selectedMonthKey]
    );

    const divisionEfficiency = useMemo(
        () => averageByKey(stats.monthDivision, selectedMonthKey),
        [stats, selectedMonthKey]
    );

    // Efficiency trend points (daily avg resolution grouped by span-appropriate buckets)
    const trendData = useMemo(() => {
        const days = stats.daily.filter((day) => !selectedMonthKey || day.d.startsWith(selectedMonthKey));
        if (days.length === 0) return [] as { label: string; avg: number }[];

        const minTime = parseIsoDate(days[0].d).getTime();
        const maxTime = parseIsoDate(days[days.length - 1].d).getTime();
        const spanDays = (maxTime - minTime) / (1000 * 60 * 60 * 24);

        let granularity: 'daily' | 'weekly' | 'monthly' = 'monthly';
        if (spanDays <= 35) granularity = 'daily';
        else if (spanDays <= 90) granularity = 'weekly';

        const groups: Record<string, { sumMins: number; count: number; order: number }> = {};
        for (const day of days) {
            if (day.resN === 0) continue;
            const open = parseIsoDate(day.d);

            let key = '';
            let sortKey = 0;
            if (granularity === 'daily') {
                key = open.toLocaleString('en-US', { day: 'numeric', month: 'short' });
                sortKey = open.getFullYear() * 10000 + open.getMonth() * 100 + open.getDate();
            } else if (granularity === 'weekly') {
                const d = new Date(open);
                const dayOfWeek = d.getDay() || 7;
                if (dayOfWeek !== 1) d.setHours(-24 * (dayOfWeek - 1));
                if (d.getTime() < minTime) d.setTime(minTime);
                key = d.toLocaleString('en-US', { day: 'numeric', month: 'short' });
                sortKey = d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
            } else {
                key = open.toLocaleString('en-US', { month: 'short', year: '2-digit' });
                sortKey = open.getFullYear() * 100 + open.getMonth();
            }

            if (!groups[key]) groups[key] = { sumMins: 0, count: 0, order: sortKey };
            groups[key].sumMins += day.resSum;
            groups[key].count += day.resN;
        }

        return Object.entries(groups)
            .map(([label, val]) => ({
                label,
                avg: val.count > 0 ? val.sumMins / val.count / 60 : 0,
                order: val.order
            }))
            .sort((a, b) => a.order - b.order);
    }, [stats, selectedMonthKey]);

    useEffect(() => {
        let mounted = true;

        (async () => {
            const { Chart } = await import('chart.js/auto');
            if (!mounted) return;

            if (hourlyInstance.current) hourlyInstance.current.destroy();
            if (trendInstance.current) trendInstance.current.destroy();
            if (resolutionInstance.current) resolutionInstance.current.destroy();
            if (divisionInstance.current) divisionInstance.current.destroy();

            const formatDurationHrs = (val: number) => {
                const h = Math.floor(val);
                const m = Math.round((val - h) * 60);
                return `${h}h ${m}m`;
            };

            // 1. Peak Complaint Hours (line)
            if (hourlyRef.current) {
                hourlyInstance.current = new Chart(hourlyRef.current, {
                    type: 'line',
                    data: {
                        labels: Array.from({ length: 24 }, (_, i) => formatHourLabel(i)),
                        datasets: [{
                            label: 'Complaints Received',
                            data: hourlyData,
                            fill: true,
                            backgroundColor: 'rgba(59, 130, 246, 0.2)',
                            borderColor: '#2563eb',
                            tension: 0.4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            title: { display: true, text: `Peak Complaint Hours (${selectedMonth})`, font: { size: 14 } },
                            legend: { display: false }
                        }
                    }
                });
            }

            // 2. Efficiency Trend (avg resolution over time)
            if (trendRef.current && trendData.length > 0) {
                trendInstance.current = new Chart(trendRef.current, {
                    type: 'line',
                    data: {
                        labels: trendData.map(d => d.label),
                        datasets: [{
                            label: 'Avg Resolution Time',
                            data: trendData.map(d => d.avg),
                            borderColor: '#10b981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 4,
                            pointHoverRadius: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            title: { display: true, text: `Efficiency Trend - Avg Resolution (${selectedMonth})`, font: { size: 14 } },
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx: any) => `Avg Time: ${ctx.parsed.y !== null ? formatDurationHrs(ctx.parsed.y) : '0h'}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: { color: '#f3f4f6' },
                                title: { display: true, text: 'Time' },
                                ticks: { callback: (val: any) => formatDurationHrs(Number(val)) }
                            },
                            x: { grid: { display: false } }
                        }
                    }
                });
            }

            // 3. Avg Resolution Time by Substation (scrollable columns)
            if (resolutionRef.current) {
                resolutionInstance.current = new Chart(resolutionRef.current, {
                    type: 'bar',
                    data: {
                        labels: resolutionData.map(d => d.key),
                        datasets: [{
                            label: 'Avg Resolution Time (Minutes)',
                            data: resolutionData.map(d => d.avgMins),
                            backgroundColor: 'rgba(239, 68, 68, 0.7)',
                            borderColor: '#b91c1c',
                            borderWidth: 1,
                            barPercentage: 0.8,
                            categoryPercentage: 0.9
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: 'x',
                        plugins: {
                            title: { display: true, text: `Avg Resolution Time by Substation (${selectedMonth})`, font: { size: 14 } },
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (context: any) => {
                                        const item = resolutionData[context.dataIndex];
                                        return `Avg Time: ${formatMins(context.parsed.y || 0)} (Count: ${item.count})`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                title: { display: true, text: 'Time (Hours)' },
                                ticks: { callback: (val: any) => `${Math.floor(Number(val) / 60)}h` }
                            },
                            x: {
                                ticks: { autoSkip: false, maxRotation: 90, minRotation: 90 }
                            }
                        },
                        layout: { padding: { top: 80 } }
                    },
                    plugins: [{
                        id: 'resolutionLabels',
                        afterDatasetsDraw: (chart: any) => {
                            const ctx = chart.ctx;
                            chart.data.datasets.forEach((dataset: any, i: number) => {
                                const meta = chart.getDatasetMeta(i);
                                meta.data.forEach((bar: any, index: number) => {
                                    const item = resolutionData[index];
                                    if (!item) return;
                                    const timeText = formatMins(dataset.data[index] as number);
                                    const countText = `(${item.count})`;

                                    ctx.save();
                                    ctx.translate(bar.x, bar.y - 10);
                                    ctx.rotate(-Math.PI / 2);
                                    ctx.font = 'bold 10px sans-serif';
                                    ctx.textAlign = 'left';
                                    ctx.textBaseline = 'middle';
                                    ctx.fillStyle = '#1f2937';
                                    ctx.fillText(timeText, 0, 0);
                                    ctx.fillStyle = '#2563eb';
                                    ctx.fillText(countText, ctx.measureText(timeText).width + 4, 0);
                                    ctx.restore();
                                });
                            });
                        }
                    }]
                });
            }

            // 4. Avg Resolution Time by Division
            if (divisionRef.current) {
                divisionInstance.current = new Chart(divisionRef.current, {
                    type: 'bar',
                    data: {
                        labels: divisionEfficiency.map(d => d.key),
                        datasets: [{
                            label: 'Avg Resolution Time (Minutes)',
                            data: divisionEfficiency.map(d => d.avgMins),
                            backgroundColor: 'rgba(16, 185, 129, 0.7)',
                            borderColor: '#047857',
                            borderWidth: 1,
                            borderRadius: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            title: { display: true, text: `Avg Resolution Time by Division (${selectedMonth})`, font: { size: 14 } },
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (context: any) => `Avg Time: ${formatMins(context.parsed.y || 0)}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                title: { display: true, text: 'Time (Hours)' },
                                ticks: { callback: (val: any) => `${Math.floor(Number(val) / 60)}h` }
                            }
                        },
                        layout: { padding: { top: 20 } }
                    },
                    plugins: [{
                        id: 'divLabels',
                        afterDatasetsDraw: (chart: any) => {
                            const ctx = chart.ctx;
                            chart.data.datasets.forEach((dataset: any, i: number) => {
                                const meta = chart.getDatasetMeta(i);
                                meta.data.forEach((bar: any, index: number) => {
                                    ctx.fillStyle = '#1f2937';
                                    ctx.font = 'bold 11px sans-serif';
                                    ctx.textAlign = 'center';
                                    ctx.textBaseline = 'bottom';
                                    ctx.fillText(formatMins(dataset.data[index] as number), bar.x, bar.y - 5);
                                });
                            });
                        }
                    }]
                });
            }
        })();

        return () => {
            mounted = false;
            if (hourlyInstance.current) hourlyInstance.current.destroy();
            if (trendInstance.current) trendInstance.current.destroy();
            if (resolutionInstance.current) resolutionInstance.current.destroy();
            if (divisionInstance.current) divisionInstance.current.destroy();
        };
    }, [hourlyData, trendData, resolutionData, divisionEfficiency, selectedMonth]);

    const getHeatmapColor = (count: number, max: number) => {
        if (count === 0) return 'bg-gray-50';
        const intensity = max > 0 ? count / max : 0;
        if (intensity < 0.2) return 'bg-blue-100';
        if (intensity < 0.4) return 'bg-blue-300';
        if (intensity < 0.6) return 'bg-blue-500';
        if (intensity < 0.8) return 'bg-blue-700';
        return 'bg-blue-900';
    };

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    if (stats.total === 0) return null;

    return (
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
            {/* One month selector drives every chart below */}
            <div className="flex flex-col md:flex-row justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100 gap-3">
                <div>
                    <h2 className="text-xl font-bold text-gray-800">🔬 Deep Analysis</h2>
                    <p className="text-sm text-gray-500">Peak hours, heatmap and resolution efficiency</p>
                </div>
                <div className="w-full md:w-64">
                    <Select
                        options={monthOptions}
                        value={monthOptions.find(o => o.value === selectedMonth)}
                        onChange={(opt: any) => setSelectedMonth(opt?.value || 'All')}
                        className="basic-single text-black"
                        classNamePrefix="select"
                        isClearable={false}
                        isSearchable={true}
                    />
                </div>
            </div>

            {/* Peak hours + efficiency trend */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                    <div className="h-[320px]">
                        <canvas ref={hourlyRef} />
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                    {trendData.length > 0 ? (
                        <div className="h-[320px]">
                            <canvas ref={trendRef} />
                        </div>
                    ) : (
                        <div className="h-[320px] flex items-center justify-center text-gray-400 font-medium">
                            No resolved complaints in this period
                        </div>
                    )}
                </div>
            </div>

            {/* Peak time heatmap */}
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                <h3 className="text-lg font-bold text-gray-800 mb-4">
                    🔥 Peak Time Heatmap ({selectedMonth === 'All' ? 'All Time' : selectedMonth})
                </h3>
                <div className="overflow-x-auto">
                    <div className="min-w-[600px]">
                        <div className="flex mb-2">
                            <div className="w-12"></div>
                            {Array.from({ length: 24 }).map((_, i) => (
                                <div key={i} className="flex-1 text-[10px] text-center text-gray-400 font-mono transform -rotate-45 origin-bottom translate-y-2">
                                    {formatHourLabel(i)}
                                </div>
                            ))}
                        </div>
                        <div className="mt-4">
                            {days.map((day, dIndex) => (
                                <div key={day} className="flex items-center mb-1">
                                    <div className="w-12 text-xs font-bold text-gray-500">{day}</div>
                                    {heatmapData.grid[dIndex].map((count, hIndex) => {
                                        const intensity = heatmapData.maxCount > 0 ? count / heatmapData.maxCount : 0;
                                        const textColor = intensity > 0.5 ? 'text-white' : 'text-gray-600';
                                        return (
                                            <div
                                                key={hIndex}
                                                className={`flex-1 h-8 mx-[1px] rounded-sm ${getHeatmapColor(count, heatmapData.maxCount)} flex items-center justify-center text-[9px] font-medium ${textColor} cursor-default group relative`}
                                            >
                                                {count > 0 ? count : ''}
                                                <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-black text-white text-xs p-1 rounded z-10 whitespace-nowrap pointer-events-none">
                                                    {day} {formatHourLabel(hIndex)} - {count} Calls
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Resolution by substation (scrollable) */}
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto pb-4">
                    <div style={{ width: `${Math.max(1000, resolutionData.length * 40)}px`, height: '600px' }}>
                        <canvas ref={resolutionRef} />
                    </div>
                </div>
                <p className="text-center text-sm text-gray-400 mt-2 italic">Showing all substations. Scroll horizontally to see more.</p>
            </div>

            {/* Division efficiency */}
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                <div className="h-[350px]">
                    <canvas ref={divisionRef} />
                </div>
            </div>
        </div>
    );
}

export default React.memo(DeepDivePanel);
