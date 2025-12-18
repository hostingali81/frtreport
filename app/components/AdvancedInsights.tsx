'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { Chart } from 'chart.js/auto';
import Select from 'react-select';

interface Props {
    data: any[];
}

export default function AdvancedInsights({ data }: Props) {
    const topAreasRef = useRef<HTMLCanvasElement>(null);
    const trendRef = useRef<HTMLCanvasElement>(null);
    const [selectedMonth, setSelectedMonth] = useState<string | null>(null); // 'Null' means All Time

    // Instances
    const topAreasInstance = useRef<Chart | null>(null);
    const trendInstance = useRef<Chart | null>(null);

    // Helpers
    const parseDate = (val: string) => {
        const clean = val.trim();
        if (!clean) return null;
        const match = clean.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
        if (match) {
            const day = match[1].padStart(2, '0');
            const month = match[2].padStart(2, '0');
            const year = match[3];
            const timeMatch = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
            let hours = 0;
            let minutes = 0;
            if (timeMatch) {
                hours = parseInt(timeMatch[1], 10);
                minutes = parseInt(timeMatch[2], 10);
                if (timeMatch[3]) {
                    const ampm = timeMatch[3].toUpperCase();
                    if (ampm === 'PM' && hours < 12) hours += 12;
                    if (ampm === 'AM' && hours === 12) hours = 0;
                }
            }
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hours, minutes);
        }
        return null;
    };

    // Month Options
    const monthOptions = useMemo(() => {
        const months = new Set<string>();
        data.forEach(r => {
            const d = parseDate(String(r['Complaint Date and Time'] || r['Complaint Date'] || ''));
            if (d) {
                months.add(d.toLocaleString('en-US', { month: 'long', year: 'numeric' }));
            }
        });
        const opts = Array.from(months)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
            .map(m => ({ value: m, label: m }));

        return [{ value: 'All', label: 'All Time' }, ...opts];
    }, [data]);

    // Filter Data
    const filteredData = useMemo(() => {
        if (!selectedMonth || selectedMonth === 'All') return data;
        return data.filter(r => {
            const d = parseDate(String(r['Complaint Date and Time'] || r['Complaint Date'] || ''));
            return d && d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) === selectedMonth;
        });
    }, [data, selectedMonth]);

    // 1. Peak Time Heatmap Data
    const heatmapData = useMemo(() => {
        const grid = Array(7).fill(0).map(() => Array(24).fill(0));
        let maxCount = 0;

        filteredData.forEach(r => {
            const d = parseDate(String(r['Complaint Date and Time'] || r['Complaint Date'] || ''));
            if (d) {
                const day = d.getDay(); // 0 = Sun
                // Adjust to Make Monday = 0, Sunday = 6 for display
                const displayDay = day === 0 ? 6 : day - 1;
                const hour = d.getHours();
                grid[displayDay][hour]++;
                if (grid[displayDay][hour] > maxCount) maxCount = grid[displayDay][hour];
            }
        });
        return { grid, maxCount };
    }, [filteredData]);

    // 2. Top Problem Areas (Sub Division)
    useEffect(() => {
        if (!topAreasRef.current) return;

        // Destroy old
        if (topAreasInstance.current) topAreasInstance.current.destroy();

        // Calculate
        const counts: Record<string, number> = {};
        filteredData.forEach(r => {
            const div = String(r['Sub Division'] || 'Unknown').trim();
            counts[div] = (counts[div] || 0) + 1;
        });

        // Sort Top 5
        const sorted = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const labels = sorted.map(s => s[0]);
        const values = sorted.map(s => s[1]);

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
                plugins: {
                    legend: { display: false },
                    title: { display: false }
                },
                scales: {
                    x: { beginAtZero: true, grid: { display: false } },
                    y: { grid: { display: false } }
                }
            }
        });

        return () => {
            if (topAreasInstance.current) topAreasInstance.current.destroy();
        };
    }, [filteredData]);

    // 3. Efficiency Trend (Last 6 Months)
    // Always show historical trend regardless of filter
    useEffect(() => {
        if (!trendRef.current) return;
        if (trendInstance.current) trendInstance.current.destroy();

        // Group by Month
        const monthlyStats: Record<string, { totalTime: number, count: number, order: number }> = {};

        // Use global 'data' so trend lines show history even when a specific month is selected
        data.forEach(r => {
            const open = parseDate(String(r['Complaint Date and Time'] || ''));
            const close = parseDate(String(r['Closed Date'] || ''));

            if (open && close) {
                const key = open.toLocaleString('en-US', { month: 'short', year: '2-digit' });
                const sortKey = open.getFullYear() * 100 + open.getMonth(); // 202401

                if (!monthlyStats[key]) monthlyStats[key] = { totalTime: 0, count: 0, order: sortKey };

                const diff = close.getTime() - open.getTime();
                if (diff > 0) {
                    monthlyStats[key].totalTime += diff;
                    monthlyStats[key].count++;
                }
            }
        });

        // Convert to Array & Sort
        const trendData = Object.entries(monthlyStats)
            .map(([label, val]) => ({
                label,
                avg: val.count > 0 ? (val.totalTime / val.count / 3600000) : 0,
                order: val.order
            }))
            .sort((a, b) => a.order - b.order);
        // .slice(-6); // Remove slice if we are filtering, show whatever is relevant

        trendInstance.current = new Chart(trendRef.current, {
            type: 'line',
            data: {
                labels: trendData.map(d => d.label),
                datasets: [{
                    label: 'Avg Time (Hrs)',
                    data: trendData.map(d => d.avg),
                    borderColor: '#10b981', // Emerald
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#f3f4f6' }, title: { display: true, text: 'Hours' } },
                    x: { grid: { display: false } }
                }
            }
        });

        return () => {
            if (trendInstance.current) trendInstance.current.destroy();
        };

    }, [data]);

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
                        onChange={(opt) => setSelectedMonth(opt?.value || 'All')}
                        placeholder="Filter by Month"
                        isSearchable={true}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* 1. Top Problem Areas */}
                <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">🏆 Top Problem Areas (Sub Divisions)</h3>
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
                                        {heatmapData.grid[dIndex].map((count, hIndex) => (
                                            <div
                                                key={hIndex}
                                                className={`flex-1 h-8 mx-[1px] rounded-sm ${getHeatmapColor(count, heatmapData.maxCount)} group relative`}
                                            >
                                                <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-black text-white text-xs p-1 rounded z-10 whitespace-nowrap">
                                                    {day} {formatHour(hIndex)} - {count} Calls
                                                </div>
                                            </div>
                                        ))}
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
