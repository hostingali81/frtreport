'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { ChartStats } from '../context/DataContext';

// Dynamic imports
const Select = dynamic(() => import('react-select'), { ssr: false });

interface DeepAnalysisChartsProps {
    stats: ChartStats;
}

// Aggregate {m, k, resSum, resN} groups into per-key averages, optionally
// restricted to one month key. Only keys with at least one closed pair show up
// (same as the old row-based calculation).
function averageByKey(
    groups: { m: string; k: string; n: number; resSum: number; resN: number }[],
    monthKey: string | null
) {
    const map = new Map<string, { resSum: number; resN: number; count: number }>();
    for (const g of groups) {
        if (monthKey && g.m !== monthKey) continue;
        const curr = map.get(g.k) || { resSum: 0, resN: 0, count: 0 };
        curr.resSum += g.resSum;
        curr.resN += g.resN;
        curr.count += g.n;
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

function DeepAnalysisCharts({ stats }: DeepAnalysisChartsProps) {
    // Chart Refs
    const resolutionChartRef = useRef<HTMLCanvasElement>(null);
    const hourlyChartRef = useRef<HTMLCanvasElement>(null);
    const divisionEfficiencyChartRef = useRef<HTMLCanvasElement>(null);

    // Chart Instances
    const resolutionChartInstance = useRef<any>(null);
    const hourlyChartInstance = useRef<any>(null);
    const divisionEfficiencyChartInstance = useRef<any>(null);

    // State
    const [selectedMonth, setSelectedMonth] = useState<string>(() => {
        return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
    });

    const monthOptions = useMemo(() => {
        const options = stats.months.map((m) => ({ value: m.label, label: m.label }));
        return [{ value: 'All', label: 'All Months' }, ...options];
    }, [stats]);

    // 'June 2026' -> '2026-06' (null = All)
    const selectedMonthKey = useMemo(() => {
        if (selectedMonth === 'All') return null;
        return stats.months.find((m) => m.label === selectedMonth)?.key ?? null;
    }, [stats, selectedMonth]);

    const monthIsKnown = selectedMonth === 'All' || selectedMonthKey !== null;

    const resolutionData = useMemo(
        () => (monthIsKnown ? averageByKey(stats.monthSubStation, selectedMonthKey) : []),
        [stats, selectedMonthKey, monthIsKnown]
    );

    const hourlyData = useMemo(() => {
        const hours = new Array(24).fill(0);
        if (!monthIsKnown) return hours;
        for (const cell of stats.monthHeat) {
            if (selectedMonthKey && cell.m !== selectedMonthKey) continue;
            hours[cell.hr] += cell.n;
        }
        return hours;
    }, [stats, selectedMonthKey, monthIsKnown]);

    const divisionEfficiency = useMemo(
        () => (monthIsKnown ? averageByKey(stats.monthDivision, selectedMonthKey) : []),
        [stats, selectedMonthKey, monthIsKnown]
    );

    // Effect to render charts
    useEffect(() => {
        // Dynamic import Chart.js
        let mounted = true;

        (async () => {
            const { Chart } = await import('chart.js/auto');

            if (!mounted) return;

            // Cleanup old instances
            if (resolutionChartInstance.current) resolutionChartInstance.current.destroy();
            if (hourlyChartInstance.current) hourlyChartInstance.current.destroy();
            if (divisionEfficiencyChartInstance.current) divisionEfficiencyChartInstance.current.destroy();

            // 1. Avg Resolution Time Chart (Column Chart now)
            if (resolutionChartRef.current) {
                resolutionChartInstance.current = new Chart(resolutionChartRef.current, {
                    type: 'bar',
                    data: {
                        labels: resolutionData.map(d => d.key),
                        datasets: [{
                            label: 'Avg Resolution Time (Minutes)',
                            data: resolutionData.map(d => d.avgMins),
                            backgroundColor: 'rgba(239, 68, 68, 0.7)', // Red-500
                            borderColor: '#b91c1c',
                            borderWidth: 1,
                            barPercentage: 0.8, // Standard density
                            categoryPercentage: 0.9
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: 'x', // Vertical Column
                        plugins: {
                            title: { display: true, text: `Avg Resolution Time by Substation (${selectedMonth})`, font: { size: 14 } },
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const index = context.dataIndex;
                                        const item = resolutionData[index];
                                        const val = context.parsed.y as number || 0; // Value is Y for vertical
                                        const h = Math.floor(val / 60);
                                        const m = val % 60;
                                        return `Avg Time: ${h}h ${m}m (Count: ${item.count})`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                title: { display: true, text: 'Time (Hours)' },
                                ticks: {
                                    callback: (val) => {
                                        const m = Number(val);
                                        const h = Math.floor(m / 60);
                                        return `${h}h`;
                                    }
                                }
                            },
                            x: {
                                ticks: {
                                    autoSkip: false, // Show all labels
                                    maxRotation: 90,
                                    minRotation: 90
                                }
                            }
                        },
                        layout: {
                            padding: { top: 80 } // Increase top padding significantly for vertical rotated labels
                        }
                    },
                    plugins: [{
                        id: 'resolutionLabels',
                        afterDatasetsDraw: (chart) => {
                            const ctx = chart.ctx;
                            chart.data.datasets.forEach((dataset, i) => {
                                const meta = chart.getDatasetMeta(i);
                                meta.data.forEach((bar: any, index) => {
                                    const item = resolutionData[index];
                                    const val = dataset.data[index] as number;
                                    const h = Math.floor(val / 60);
                                    const m = val % 60;

                                    const timeText = `${h}h ${m}m`;
                                    const countText = `(${item.count})`;

                                    ctx.save();
                                    ctx.translate(bar.x, bar.y - 10); // Move to just above bar
                                    ctx.rotate(-Math.PI / 2); // Rotate -90 degrees

                                    ctx.font = 'bold 10px sans-serif'; // Slightly smaller font to fit
                                    ctx.textAlign = 'left'; // Align left (which is bottom after rotation)
                                    ctx.textBaseline = 'middle';

                                    // Draw Time (Black)
                                    ctx.fillStyle = '#1f2937';
                                    ctx.fillText(timeText, 0, 0); // Start at translated origin

                                    const timeWidth = ctx.measureText(timeText).width;

                                    // Draw Count (Blue)
                                    ctx.fillStyle = '#2563eb';
                                    ctx.fillText(countText, timeWidth + 4, 0); // Offset by time width

                                    ctx.restore();
                                });
                            });
                        }
                    }]
                });
            }

            // 2. Hourly Distribution Chart
            if (hourlyChartRef.current) {
                hourlyChartInstance.current = new Chart(hourlyChartRef.current, {
                    type: 'line',
                    data: {
                        labels: Array.from({ length: 24 }, (_, i) => {
                            const h = i % 12 || 12;
                            const ampm = i < 12 ? 'AM' : 'PM';
                            return `${h} ${ampm}`;
                        }),
                        datasets: [{
                            label: 'Complaints Received',
                            data: hourlyData,
                            fill: true,
                            backgroundColor: 'rgba(59, 130, 246, 0.2)', // Blue
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

            // 3. Division Efficiency Chart
            if (divisionEfficiencyChartRef.current) {
                divisionEfficiencyChartInstance.current = new Chart(divisionEfficiencyChartRef.current, {
                    type: 'bar',
                    data: {
                        labels: divisionEfficiency.map(d => d.key),
                        datasets: [{
                            label: 'Avg Resolution Time (Minutes)',
                            data: divisionEfficiency.map(d => d.avgMins),
                            backgroundColor: 'rgba(16, 185, 129, 0.7)', // Emerald
                            borderColor: '#047857',
                            borderWidth: 1
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
                                    label: (context) => {
                                        const val = context.parsed.y as number || 0;
                                        const h = Math.floor(val / 60);
                                        const m = val % 60;
                                        return `Avg Time: ${h}h ${m}m`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                title: { display: true, text: 'Time (Hours)' },
                                ticks: {
                                    callback: (val) => {
                                        const m = Number(val);
                                        const h = Math.floor(m / 60);
                                        return `${h}h`;
                                    }
                                }
                            }
                        },
                        layout: {
                            padding: { top: 20 }
                        }
                    },
                    plugins: [{
                        id: 'divLabels',
                        afterDatasetsDraw: (chart) => {
                            const ctx = chart.ctx;
                            chart.data.datasets.forEach((dataset, i) => {
                                const meta = chart.getDatasetMeta(i);
                                meta.data.forEach((bar: any, index) => {
                                    const val = dataset.data[index] as number;
                                    const h = Math.floor(val / 60);
                                    const m = val % 60;
                                    const label = `${h}h ${m}m`;

                                    ctx.fillStyle = '#1f2937';
                                    ctx.font = 'bold 11px sans-serif';
                                    ctx.textAlign = 'center';
                                    ctx.textBaseline = 'bottom';
                                    ctx.fillText(label, bar.x, bar.y - 5);
                                });
                            });
                        }
                    }]
                });
            }
        })();

        return () => {
            mounted = false;
            if (resolutionChartInstance.current) resolutionChartInstance.current.destroy();
            if (hourlyChartInstance.current) hourlyChartInstance.current.destroy();
            if (divisionEfficiencyChartInstance.current) divisionEfficiencyChartInstance.current.destroy();
        };

    }, [resolutionData, hourlyData, divisionEfficiency, selectedMonth]);

    if (stats.total === 0) return null;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Controls */}
            <div className="flex items-center justify-end bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6">
                <span className="mr-3 font-semibold text-gray-700">Filter Analysis by Month:</span>
                <div className="w-64">
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

            {/* Top Row: Resolution Time */}
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto pb-4">
                    <div style={{ width: `${Math.max(1000, resolutionData.length * 40)}px`, height: '700px' }}>
                        <canvas ref={resolutionChartRef} />
                    </div>
                </div>
                <p className="text-center text-sm text-gray-400 mt-2 italic">Showing all substations. Scroll horizontally to see more.</p>
            </div>

            {/* Second Row: Hourly & Division stats */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                    <div className="h-[350px]">
                        <canvas ref={hourlyChartRef} />
                    </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                    <div className="h-[350px]">
                        <canvas ref={divisionEfficiencyChartRef} />
                    </div>
                </div>
            </div>
        </div>
    );
}

export default React.memo(DeepAnalysisCharts);
