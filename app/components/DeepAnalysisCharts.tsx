'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';

// Dynamic imports
const Select = dynamic(() => import('react-select'), { ssr: false });

interface DeepAnalysisChartsProps {
    data: any[];
}

function DeepAnalysisCharts({ data }: DeepAnalysisChartsProps) {
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

    // Helpers
    const parseDate = (val: string) => {
        if (!val) return null;
        const clean = val.trim();

        // Try DD/MM/YYYY or DD-MM-YYYY
        let day, month, year;
        const dmy = clean.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
        if (dmy) {
            day = parseInt(dmy[1]);
            month = parseInt(dmy[2]);
            year = parseInt(dmy[3]);
        } else {
            // Try YYYY-MM-DD
            const ymd = clean.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
            if (ymd) {
                year = parseInt(ymd[1]);
                month = parseInt(ymd[2]);
                day = parseInt(ymd[3]);
            } else {
                return null;
            }
        }

        let h = 0, m = 0;
        const timeMatch = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (timeMatch) {
            h = parseInt(timeMatch[1]);
            m = parseInt(timeMatch[2]);
            if (timeMatch[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
            if (timeMatch[3]?.toLowerCase() === 'am' && h === 12) h = 0;
        }
        return new Date(year, month - 1, day, h, m);
    };

    // Extract available months from data
    const monthOptions = useMemo(() => {
        const months = new Set<string>();
        data.forEach(r => {
            const d = parseDate(String(r['Complaint Date and Time'] || ''));
            if (d) {
                // Use consistent formatting
                const key = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
                months.add(key);
            }
        });
        const options = Array.from(months)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
            .map(m => ({ value: m, label: m }));
        return [{ value: 'All', label: 'All Months' }, ...options];
    }, [data]);

    // Derived Data for Resolution Chart
    const resolutionData = useMemo(() => {
        // Filter by month first
        let filteredData = data;
        if (selectedMonth !== 'All') {
            filteredData = data.filter(r => {
                const d = parseDate(String(r['Complaint Date and Time'] || ''));
                if (!d) return false;
                return d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) === selectedMonth;
            });
        }

        const subMap = new Map<string, { totalMs: number; count: number }>();
        filteredData.forEach(r => {
            const sub = String(r['Sub Station'] || '').trim() || 'Unknown';
            const open = parseDate(String(r['Complaint Date and Time'] || ''));
            // Try 'Closed Date' first, fall back to checking if row is closed some other way?
            // User reports calculation error. Assume strictly filtered closed rows.
            const closedRaw = String(r['Closed Date'] || '');
            const close = parseDate(closedRaw);

            if (sub && open && close && close.getTime() > open.getTime()) {
                const diff = close.getTime() - open.getTime();
                const curr = subMap.get(sub) || { totalMs: 0, count: 0 };
                subMap.set(sub, { totalMs: curr.totalMs + diff, count: curr.count + 1 });
            }
        });

        // Calculate Average
        const result = Array.from(subMap.entries()).map(([sub, val]) => ({
            sub,
            avgMins: Math.round((val.totalMs / val.count) / 60000), // minutes
            count: val.count
        }));

        // Sort by avg time
        return result.sort((a, b) => b.avgMins - a.avgMins); // Show All
    }, [data, selectedMonth]);

    // Hourly Distribution (Global or filtered by month? Let's obey filteredMonth for consistency)
    const hourlyData = useMemo(() => {
        let filteredData = data;
        if (selectedMonth !== 'All') {
            filteredData = data.filter(r => {
                const d = parseDate(String(r['Complaint Date and Time'] || ''));
                if (!d) return false;
                return d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) === selectedMonth;
            });
        }
        const hours = new Array(24).fill(0);
        filteredData.forEach(r => {
            const d = parseDate(String(r['Complaint Date and Time'] || ''));
            if (d) {
                hours[d.getHours()]++;
            }
        });
        return hours;
    }, [data, selectedMonth]);

    // Division Efficiency (Global or filtered? consistency -> filtered)
    const divisionEfficiency = useMemo(() => {
        let filteredData = data;
        if (selectedMonth !== 'All') {
            filteredData = data.filter(r => {
                const d = parseDate(String(r['Complaint Date and Time'] || ''));
                if (!d) return false;
                return d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) === selectedMonth;
            });
        }
        const divMap = new Map<string, { totalMs: number; count: number }>();
        filteredData.forEach(r => {
            const div = String(r['Division'] || '').trim() || 'Unknown';
            const open = parseDate(String(r['Complaint Date and Time'] || ''));
            // Try 'Closed Date' first, fall back to 'Closed Date and Time' if needed? 
            // Using existing logic for consistency
            const closedRaw = String(r['Closed Date'] || '');
            const close = parseDate(closedRaw);

            if (div && open && close && close.getTime() > open.getTime()) {
                const diff = close.getTime() - open.getTime();
                const curr = divMap.get(div) || { totalMs: 0, count: 0 };
                divMap.set(div, { totalMs: curr.totalMs + diff, count: curr.count + 1 });
            }
        });
        return Array.from(divMap.entries()).map(([div, val]) => ({
            div,
            avgMins: Math.round((val.totalMs / val.count) / 60000), // Change to minutes for consistent int math
            count: val.count
        })).sort((a, b) => b.avgMins - a.avgMins);
    }, [data, selectedMonth]);


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
                        labels: resolutionData.map(d => d.sub),
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
                        labels: divisionEfficiency.map(d => d.div),
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

    if (data.length === 0) return null;

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
