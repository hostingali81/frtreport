'use client';

import React, { useMemo, useRef, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { ChartStats } from '../context/DataContext';

const Select = dynamic(() => import('react-select'), { ssr: false });

interface Props {
    stats: ChartStats;
}

const parseIsoDate = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
};

function AdvancedInsights({ stats }: Props) {
    const topAreasRef = useRef<HTMLCanvasElement>(null);
    const trendRef = useRef<HTMLCanvasElement>(null);
    const [selectedMonth, setSelectedMonth] = useState<string | null>(null); // 'Null' means All Time

    // Instances
    const topAreasInstance = useRef<any>(null);
    const trendInstance = useRef<any>(null);

    // Month Options
    const monthOptions = useMemo(() => {
        const opts = stats.months.map((m) => ({ value: m.label, label: m.label }));
        return [{ value: 'All', label: 'All Time' }, ...opts];
    }, [stats]);

    // 'June 2026' -> '2026-06' (null = All Time)
    const selectedMonthKey = useMemo(() => {
        if (!selectedMonth || selectedMonth === 'All') return null;
        return stats.months.find((m) => m.label === selectedMonth)?.key ?? null;
    }, [stats, selectedMonth]);

    // 1. Peak Time Heatmap Data (dow 0=Mon..6=Sun, IST hour)
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

    // 2. Top Problem Areas (Sub Station)
    const topAreas = useMemo(() => {
        const counts = new Map<string, number>();
        for (const g of stats.monthSubStation) {
            if (selectedMonthKey && g.m !== selectedMonthKey) continue;
            counts.set(g.k, (counts.get(g.k) || 0) + g.n);
        }
        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
    }, [stats, selectedMonthKey]);

    useEffect(() => {
        let mounted = true;

        (async () => {
            const { Chart } = await import('chart.js/auto');

            if (!mounted || !topAreasRef.current) return;

            // Destroy old
            if (topAreasInstance.current) topAreasInstance.current.destroy();

            const labels = topAreas.map(s => s[0]);
            const values = topAreas.map(s => s[1]);

            // Plugin to draw data labels
            const dataLabelPlugin = {
                id: 'dataLabelPlugin',
                afterDatasetsDraw(chart: any) {
                    const { ctx } = chart;
                    ctx.save();
                    chart.data.datasets.forEach((dataset: any, i: number) => {
                        const meta = chart.getDatasetMeta(i);
                        meta.data.forEach((bar: any, index: number) => {
                            const value = dataset.data[index];
                            if (value !== null && value !== undefined) {
                                ctx.fillStyle = '#374151'; // Gray-700
                                ctx.font = 'bold 11px sans-serif';
                                ctx.textAlign = 'left';
                                ctx.textBaseline = 'middle';
                                // Draw text slightly to the right of the bar end
                                ctx.fillText(value, bar.x + 5, bar.y);
                            }
                        });
                    });
                    ctx.restore();
                }
            };

            const maxValue = Math.max(...values, 0);

            topAreasInstance.current = new Chart(topAreasRef.current, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Complaints',
                        data: values,
                        backgroundColor: '#ef4444',
                        borderRadius: 6,
                        barPercentage: 0.6
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: {
                        padding: { right: 40 } // Space for labels
                    },
                    plugins: {
                        legend: { display: false },
                        title: { display: false }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            grid: { display: false },
                            suggestedMax: maxValue * 1.15 // Extend axis space
                        },
                        y: { grid: { display: false } }
                    }
                },
                plugins: [dataLabelPlugin]
            });
        })();

        return () => {
            mounted = false;
            if (topAreasInstance.current) topAreasInstance.current.destroy();
        };
    }, [topAreas]);

    // 3. Efficiency Trend (Responds to Filter)
    useEffect(() => {
        let mounted = true;

        (async () => {
            const { Chart } = await import('chart.js/auto');

            if (!mounted || !trendRef.current) return;
            if (trendInstance.current) trendInstance.current.destroy();

            // Daily resolution sums for the selected month (or everything)
            const days = stats.daily.filter((day) =>
                !selectedMonthKey || day.d.startsWith(selectedMonthKey)
            );

            if (days.length === 0) {
                return;
            }

            const minTime = parseIsoDate(days[0].d).getTime();
            const maxTime = parseIsoDate(days[days.length - 1].d).getTime();
            const spanDays = (maxTime - minTime) / (1000 * 60 * 60 * 24);

            // Granularity Logic
            let granularity: 'daily' | 'weekly' | 'monthly' = 'monthly';
            if (spanDays <= 35) granularity = 'daily';
            else if (spanDays <= 90) granularity = 'weekly';

            // Group daily resolution sums by the chosen granularity
            const groups: Record<string, { sumMins: number, count: number, order: number }> = {};

            for (const day of days) {
                if (day.resN === 0) continue;
                const open = parseIsoDate(day.d);

                let key = '';
                let sortKey = 0;

                if (granularity === 'daily') {
                    // Daily Grouping: "1 Nov", "2 Nov"
                    key = open.toLocaleString('en-US', { day: 'numeric', month: 'short' });
                    sortKey = open.getFullYear() * 10000 + open.getMonth() * 100 + open.getDate();
                } else if (granularity === 'weekly') {
                    // Weekly Grouping: Start of Week (Monday), clamped to range start
                    const d = new Date(open);
                    const dayOfWeek = d.getDay() || 7;
                    if (dayOfWeek !== 1) d.setHours(-24 * (dayOfWeek - 1));

                    if (d.getTime() < minTime) d.setTime(minTime);

                    key = d.toLocaleString('en-US', { day: 'numeric', month: 'short' });
                    sortKey = d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
                } else {
                    // Monthly Grouping
                    key = open.toLocaleString('en-US', { month: 'short', year: '2-digit' });
                    sortKey = open.getFullYear() * 100 + open.getMonth();
                }

                if (!groups[key]) groups[key] = { sumMins: 0, count: 0, order: sortKey };
                groups[key].sumMins += day.resSum;
                groups[key].count += day.resN;
            }

            // Format Data (avg in hours)
            const trendData = Object.entries(groups)
                .map(([label, val]) => ({
                    label,
                    avg: val.count > 0 ? (val.sumMins / val.count / 60) : 0,
                    order: val.order
                }))
                .sort((a, b) => a.order - b.order);

            // Helper to format hours to "1h 30m"
            const formatDuration = (val: number) => {
                const h = Math.floor(val);
                const m = Math.round((val - h) * 60);
                return `${h}h ${m}m`;
            };

            trendInstance.current = new Chart(trendRef.current, {
                type: 'line',
                data: {
                    labels: trendData.map(d => d.label),
                    datasets: [{
                        label: 'Avg Resolution Time',
                        data: trendData.map(d => d.avg),
                        borderColor: '#10b981', // Emerald
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
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    const val = ctx.parsed.y;
                                    return `Avg Time: ${val !== null ? formatDuration(val) : '0h'}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: '#f3f4f6' },
                            title: { display: true, text: 'Time' },
                            ticks: {
                                callback: (val) => formatDuration(Number(val))
                            }
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
        })();

        return () => {
            mounted = false;
            if (trendInstance.current) trendInstance.current.destroy();
        };

    }, [stats, selectedMonthKey]);

    // Heatmap Colors
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

    // Helper for AM/PM format
    const formatHour = (h: number) => {
        if (h === 0) return '12 AM';
        if (h === 12) return '12 PM';
        return h > 12 ? `${h - 12} PM` : `${h} AM`;
    };

    return (
        <div className="flex flex-col gap-8 mb-8 animate-in fade-in duration-700">
            {/* Header with Filter */}
            <div className="flex flex-col md:flex-row justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                <h2 className="text-xl font-bold text-gray-800">🔮 Advanced Insights</h2>
                <div className="w-64">
                    <Select
                        options={monthOptions}
                        value={monthOptions.find(o => o.value === (selectedMonth || 'All'))}
                        onChange={(opt: any) => setSelectedMonth(opt?.value || 'All')}
                        placeholder="Filter by Month"
                        isSearchable={true}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* 1. Top Problem Areas */}
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">🏆 Top Problem Areas (Sub Stations)</h3>
                    <div className="h-64">
                        <canvas ref={topAreasRef} />
                    </div>
                </div>

                {/* 2. Efficiency Trend */}
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">📈 Efficiency Trend (Avg Resolution Time)</h3>
                    <div className="h-64">
                        <canvas ref={trendRef} />
                    </div>
                </div>

                {/* 3. Peak Time Heatmap (Moved to Bottom) */}
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 lg:col-span-2">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-gray-800">🔥 Peak Time Heatmap ({selectedMonth === 'All' || !selectedMonth ? 'All Time' : selectedMonth})</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <div className="min-w-[600px]">
                            <div className="flex mb-2">
                                <div className="w-12"></div>
                                {Array.from({ length: 24 }).map((_, i) => (
                                    <div key={i} className="flex-1 text-[10px] text-center text-gray-400 font-mono transform -rotate-45 origin-bottom translate-y-2">
                                        {formatHour(i)}
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
                                                        {day} {formatHour(hIndex)} - {count} Calls
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
            </div>
        </div>
    );
}

export default React.memo(AdvancedInsights);
