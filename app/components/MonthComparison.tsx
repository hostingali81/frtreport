'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

const Select = dynamic(() => import('react-select'), { ssr: false });

interface MonthComparisonProps {
    data: any[];
}

export default function MonthComparison({ data }: MonthComparisonProps) {
    const totalChartRef = useRef<HTMLCanvasElement>(null);
    const beyondChartRef = useRef<HTMLCanvasElement>(null);
    const timeChartRef = useRef<HTMLCanvasElement>(null);

    const totalInstance = useRef<any>(null);
    const beyondInstance = useRef<any>(null);
    const timeInstance = useRef<any>(null);

    const [monthA, setMonthA] = useState<string | null>(null);
    const [monthB, setMonthB] = useState<string | null>(null);

    // Helper to parse date
    const parsePossibleDate = (value: string) => {
        const clean = value.trim();
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

    // Get available months
    const monthOptions = useMemo(() => {
        const months = new Set<string>();
        data.forEach(r => {
            const val = String(r['Complaint Date and Time'] || r['Complaint Date'] || '');
            const d = parsePossibleDate(val);
            if (d) {
                const key = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
                months.add(key);
            }
        });
        return Array.from(months)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
            .map(m => ({ value: m, label: m }));
    }, [data]);

    // Set default selection
    useEffect(() => {
        if (!monthA && !monthB && monthOptions.length >= 1) {
            // User requested: 1st selector (Month A) = Current - 1 (Previous)
            // 2nd selector (Month B) = Current (Latest)
            const latest = monthOptions[monthOptions.length - 1];
            const previous = monthOptions.length >= 2 ? monthOptions[monthOptions.length - 2] : latest;

            setMonthA(previous.value);
            setMonthB(latest.value);
        }
    }, [monthOptions]);

    // Calculate metrics
    const getMetrics = (monthLabel: string | null) => {
        if (!monthLabel) return { total: 0, beyond: 0, avgTime: 0 };

        const rows = data.filter(r => {
            const val = String(r['Complaint Date and Time'] || r['Complaint Date'] || '');
            const d = parsePossibleDate(val);
            return d && d.toLocaleString('en-US', { month: 'long', year: 'numeric' }) === monthLabel;
        });

        const total = rows.length;
        const beyond = rows.filter(r => String(r['Closed Status'] || '').trim() === 'Closed Beyond').length;

        let totalTimeMs = 0;
        let countTime = 0;

        rows.forEach(r => {
            const open = parsePossibleDate(String(r['Complaint Date and Time'] || r['Complaint Date'] || ''));
            const close = parsePossibleDate(String(r['Closed Date'] || ''));
            if (open && close) {
                const diff = close.getTime() - open.getTime();
                if (diff > 0) {
                    totalTimeMs += diff;
                    countTime++;
                }
            }
        });

        const avgTime = countTime > 0 ? (totalTimeMs / countTime) / (1000 * 60 * 60) : 0;
        return { total, beyond, avgTime };
    };

    useEffect(() => {
        if (!monthA || !monthB) return;
        
        let mounted = true;
        
        (async () => {
            const { Chart } = await import('chart.js/auto');
            
            if (!mounted) return;

            // Cleanup
            if (totalInstance.current) totalInstance.current.destroy();
            if (beyondInstance.current) beyondInstance.current.destroy();
            if (timeInstance.current) timeInstance.current.destroy();

            if (!totalChartRef.current || !beyondChartRef.current || !timeChartRef.current) return;

            const m1 = getMetrics(monthA);
            const m2 = getMetrics(monthB);
            const labels = [monthA, monthB];

            const createChart = (ctx: any, label: string, data: number[], color: string, formatTime = false) => {

            const formatDuration = (val: number) => {
                const h = Math.floor(val);
                const m = Math.round((val - h) * 60);
                return `${h}h ${m}m`;
            };

            const maxValue = Math.max(...data, 0);

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
                                const text = formatTime ? formatDuration(value) : value + '';
                                ctx.fillStyle = '#374151'; // Gray-700
                                ctx.font = 'bold 12px sans-serif';
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'bottom';
                                ctx.fillText(text, bar.x, bar.y - 5);
                            }
                        });
                    });
                    ctx.restore();
                }
            };

            return new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: label,
                        data: data,
                        backgroundColor: [color, color], // Same color for simpler look, or differ if needed
                        borderWidth: 0,
                        barPercentage: 0.6,
                        categoryPercentage: 0.8,
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: {
                        padding: {
                            top: 20
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        title: { display: true, text: label, font: { size: 14, weight: 'bold' }, padding: { bottom: 20 } },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    let val = ctx.parsed.y;
                                    if (val === null) return '';
                                    return formatTime ? formatDuration(val) : val + '';
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { display: true, color: '#f3f4f6' },
                            suggestedMax: maxValue * 1.2
                        },
                        x: { grid: { display: false } }
                    }
                },
                plugins: [dataLabelPlugin]
            });
        };

        const ctx1 = totalChartRef.current.getContext('2d');
        const ctx2 = beyondChartRef.current.getContext('2d');
        const ctx3 = timeChartRef.current.getContext('2d');

        if (ctx1) totalInstance.current = createChart(ctx1, 'Total Complaints', [m1.total, m2.total], '#3b82f6');
        if (ctx2) beyondInstance.current = createChart(ctx2, 'Beyond Complaints', [m1.beyond, m2.beyond], '#ef4444');
        if (ctx3) timeInstance.current = createChart(ctx3, 'Avg Time (Hrs)', [m1.avgTime, m2.avgTime], '#f59e0b', true);
        })();

        return () => {
            mounted = false;
            if (totalInstance.current) totalInstance.current.destroy();
            if (beyondInstance.current) beyondInstance.current.destroy();
            if (timeInstance.current) timeInstance.current.destroy();
        };
    }, [monthA, monthB, data]);

    return (
        <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <h2 className="text-xl font-bold text-gray-800">📊 Simple Comparison</h2>
                <div className="flex gap-4 w-full md:w-auto">
                    <div className="w-48">
                        <Select
                            options={monthOptions}
                            value={monthOptions.find(o => o.value === monthA)}
                            onChange={(opt) => setMonthA(opt?.value || null)}
                            placeholder="Select Month A"
                            isSearchable={true}
                        />
                    </div>
                    <div className="flex items-center text-gray-400 font-bold">VS</div>
                    <div className="w-48">
                        <Select
                            options={monthOptions}
                            value={monthOptions.find(o => o.value === monthB)}
                            onChange={(opt) => setMonthB(opt?.value || null)}
                            placeholder="Select Month B"
                            isSearchable={true}
                        />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                    <div style={{ height: '250px' }}>
                        <canvas ref={totalChartRef} />
                    </div>
                </div>
                <div className="bg-red-50/50 p-4 rounded-xl border border-red-100">
                    <div style={{ height: '250px' }}>
                        <canvas ref={beyondChartRef} />
                    </div>
                </div>
                <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100">
                    <div style={{ height: '250px' }}>
                        <canvas ref={timeChartRef} />
                    </div>
                </div>
            </div>
        </div>
    );
}
