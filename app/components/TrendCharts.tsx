'use client';

import { useEffect, useRef } from 'react';
import { Chart, ChartConfiguration } from 'chart.js/auto';

interface TrendChartsProps {
  data: any[];
  isClosedRow: (row: any) => boolean;
}

export default function TrendCharts({ data, isClosedRow }: TrendChartsProps) {
  const comparisonChartRef = useRef<HTMLCanvasElement>(null);
  const divisionChartRef = useRef<HTMLCanvasElement>(null);
  const beyondChartRef = useRef<HTMLCanvasElement>(null);
  const subStationChartRef = useRef<HTMLCanvasElement>(null);
  const dailyTrendChartRef = useRef<HTMLCanvasElement>(null);
  const areaTypeChartRef = useRef<HTMLCanvasElement>(null);
  
  const comparisonChartInstance = useRef<Chart | null>(null);
  const divisionChartInstance = useRef<Chart | null>(null);
  const beyondChartInstance = useRef<Chart | null>(null);
  const subStationChartInstance = useRef<Chart | null>(null);
  const dailyTrendChartInstance = useRef<Chart | null>(null);
  const areaTypeChartInstance = useRef<Chart | null>(null);

  useEffect(() => {
    if (data.length === 0) return;

    const controlRoomClosed = data.filter(r => {
      const isClosed = isClosedRow(r);
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      return isClosed && isControlRoom;
    });

    const frtClosed = data.filter(r => {
      const isClosed = isClosedRow(r);
      const closedBy = String(r['Closed By'] ?? '').trim().toUpperCase();
      const isControlRoom = closedBy.includes('CONTROL_ROOM_1') || closedBy.includes('CONTROL_ROOM_2');
      return isClosed && !isControlRoom;
    });

    const controlRoomMap = new Map<string, number>();
    for (const r of controlRoomClosed) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const key = m ? m[1] : 'Unknown';
      controlRoomMap.set(key, (controlRoomMap.get(key) || 0) + 1);
    }

    const frtMap = new Map<string, number>();
    for (const r of frtClosed) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const key = m ? m[1] : 'Unknown';
      frtMap.set(key, (frtMap.get(key) || 0) + 1);
    }

    const allDates = new Set([...controlRoomMap.keys(), ...frtMap.keys()]);
    const sortedDates = Array.from(allDates).sort((a, b) => {
      const pa = a.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const pb = b.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const da = pa ? new Date(`${pa[2]}-${pa[1]}-${pa[0]}`) : new Date(0);
      const db = pb ? new Date(`${pb[2]}-${pb[1]}-${pb[0]}`) : new Date(0);
      return da.getTime() - db.getTime();
    });

    const divisionMap = new Map<string, number>();
    for (const r of data) {
      const division = String(r['Division'] || '').trim() || 'Unknown';
      divisionMap.set(division, (divisionMap.get(division) || 0) + 1);
    }
    const divisionData = Array.from(divisionMap.entries()).sort((a, b) => b[1] - a[1]);
    const divisionColors = divisionData.map((_, i) => {
      const hue = (i * 360 / divisionData.length) % 360;
      return `hsla(${hue}, 70%, 60%, 0.8)`;
    });
    const divisionBorderColors = divisionData.map((_, i) => {
      const hue = (i * 360 / divisionData.length) % 360;
      return `hsla(${hue}, 70%, 50%, 1)`;
    });

    if (comparisonChartInstance.current) comparisonChartInstance.current.destroy();
    if (divisionChartInstance.current) divisionChartInstance.current.destroy();
    if (beyondChartInstance.current) beyondChartInstance.current.destroy();
    if (subStationChartInstance.current) subStationChartInstance.current.destroy();
    if (dailyTrendChartInstance.current) dailyTrendChartInstance.current.destroy();
    if (areaTypeChartInstance.current) areaTypeChartInstance.current.destroy();

    if (comparisonChartRef.current && sortedDates.length > 0) {
      const ctx = comparisonChartRef.current.getContext('2d');
      if (ctx) {
        comparisonChartInstance.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels: sortedDates,
            datasets: [
              {
                label: 'Control Room Closed',
                data: sortedDates.map(date => controlRoomMap.get(date) || 0),
                borderColor: 'rgb(239, 68, 68)',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                tension: 0.3,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
              },
              {
                label: 'FRT Closed',
                data: sortedDates.map(date => frtMap.get(date) || 0),
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.3,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              title: { display: true, text: 'Control Room vs FRT Comparison', font: { size: 16, weight: 'bold' } },
              legend: { display: true, position: 'top' }
            },
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: 'Complaints' } },
              x: { title: { display: true, text: 'Date' } }
            }
          }
        });
      }
    }

    if (divisionChartRef.current && divisionData.length > 0) {
      const ctx = divisionChartRef.current.getContext('2d');
      if (ctx) {
        divisionChartInstance.current = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: divisionData.map(([name]) => name),
            datasets: [{
              label: 'Total Complaints',
              data: divisionData.map(([, count]) => count),
              backgroundColor: divisionColors,
              borderColor: divisionBorderColors,
              borderWidth: 2,
            }]
          },
          plugins: [{
            id: 'divisionLabels',
            afterDatasetsDraw: (chart: any) => {
              const ctx = chart.ctx;
              chart.data.datasets.forEach((dataset: any, i: number) => {
                const meta = chart.getDatasetMeta(i);
                meta.data.forEach((bar: any, index: number) => {
                  const data = dataset.data[index];
                  ctx.fillStyle = '#374151';
                  ctx.font = 'bold 11px sans-serif';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'bottom';
                  ctx.fillText(data, bar.x, bar.y - 5);
                });
              });
            }
          }],
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              title: { display: true, text: 'All Divisions', font: { size: 16, weight: 'bold' } },
              legend: { display: false }
            },
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: 'Complaints' } },
              x: { title: { display: true, text: 'Division' }, ticks: { autoSkip: false, maxRotation: 45, minRotation: 45, font: { size: 10 } } }
            }
          }
        });
      }
    }

    // Beyond Chart (using Closed Status)
    const beyondMap = new Map<string, number>();
    for (const r of data) {
      const closedStatus = String(r['Closed Status'] || '').trim();
      if (closedStatus === 'Closed Within') {
        beyondMap.set('Closed Within', (beyondMap.get('Closed Within') || 0) + 1);
      } else if (closedStatus === 'Closed Beyond') {
        beyondMap.set('Closed Beyond', (beyondMap.get('Closed Beyond') || 0) + 1);
      } else if (closedStatus) {
        beyondMap.set(closedStatus, (beyondMap.get(closedStatus) || 0) + 1);
      }
    }
    const beyondData = Array.from(beyondMap.entries()).sort((a, b) => b[1] - a[1]);

    if (beyondChartRef.current && beyondData.length > 0) {
      const ctx = beyondChartRef.current.getContext('2d');
      if (ctx) {
        const colors = ['#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
        beyondChartInstance.current = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: beyondData.map(([name, count]) => `${name} (${count})`),
            datasets: [{
              data: beyondData.map(([, count]) => count),
              backgroundColor: colors.slice(0, beyondData.length),
              borderWidth: 4,
              borderColor: '#ffffff',
              hoverBorderWidth: 6,
              hoverBorderColor: '#f3f4f6'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              title: { display: true, text: 'Beyond Distribution', font: { size: 16, weight: 'bold' } },
              legend: { position: 'bottom' },
              tooltip: {
                callbacks: {
                  label: (context) => `${context.label}: ${context.parsed} (${((context.parsed / data.length) * 100).toFixed(1)}%)`
                }
              }
            }
          }
        });
      }
    }

    // Sub Station Bar Chart
    const subStationMap = new Map<string, number>();
    for (const r of data) {
      const subStation = String(r['Sub Station'] || '').trim() || 'Unknown';
      subStationMap.set(subStation, (subStationMap.get(subStation) || 0) + 1);
    }
    const subStationData = Array.from(subStationMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const professionalPalette = [
      'rgba(59, 130, 246, 0.8)', 'rgba(16, 185, 129, 0.8)', 'rgba(245, 158, 11, 0.8)',
      'rgba(139, 92, 246, 0.8)', 'rgba(236, 72, 153, 0.8)', 'rgba(20, 184, 166, 0.8)',
      'rgba(251, 146, 60, 0.8)', 'rgba(99, 102, 241, 0.8)', 'rgba(34, 197, 94, 0.8)',
      'rgba(234, 179, 8, 0.8)', 'rgba(168, 85, 247, 0.8)', 'rgba(244, 63, 94, 0.8)',
      'rgba(6, 182, 212, 0.8)', 'rgba(249, 115, 22, 0.8)', 'rgba(124, 58, 237, 0.8)'
    ];
    const professionalBorders = [
      'rgb(59, 130, 246)', 'rgb(16, 185, 129)', 'rgb(245, 158, 11)',
      'rgb(139, 92, 246)', 'rgb(236, 72, 153)', 'rgb(20, 184, 166)',
      'rgb(251, 146, 60)', 'rgb(99, 102, 241)', 'rgb(34, 197, 94)',
      'rgb(234, 179, 8)', 'rgb(168, 85, 247)', 'rgb(244, 63, 94)',
      'rgb(6, 182, 212)', 'rgb(249, 115, 22)', 'rgb(124, 58, 237)'
    ];
    const subStationColors = subStationData.map((_, i) => professionalPalette[i % professionalPalette.length]);
    const subStationBorderColors = subStationData.map((_, i) => professionalBorders[i % professionalBorders.length]);

    if (subStationChartRef.current && subStationData.length > 0) {
      const ctx = subStationChartRef.current.getContext('2d');
      if (ctx) {
        subStationChartInstance.current = new Chart(ctx, {
          type: 'bar',
          plugins: [{
            id: 'subStationLabels',
            afterDatasetsDraw: (chart: any) => {
              const ctx = chart.ctx;
              chart.data.datasets.forEach((dataset: any, i: number) => {
                const meta = chart.getDatasetMeta(i);
                meta.data.forEach((bar: any, index: number) => {
                  const data = dataset.data[index];
                  ctx.fillStyle = '#374151';
                  ctx.font = 'bold 10px sans-serif';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(data, bar.x + 20, bar.y);
                });
              });
            }
          }],
          data: {
            labels: subStationData.map(([name]) => name),
            datasets: [{
              label: 'Complaints',
              data: subStationData.map(([, count]) => count),
              backgroundColor: subStationColors,
              borderColor: subStationBorderColors,
              borderWidth: 2,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
              title: { display: true, text: 'Top 15 Sub Stations', font: { size: 16, weight: 'bold' } },
              legend: { display: false }
            },
            scales: {
              x: { beginAtZero: true, title: { display: true, text: 'Complaints' } },
              y: { ticks: { autoSkip: false, font: { size: 10 } } }
            }
          }
        });
      }
    }

    // Daily Trend Area Chart
    const dailyMap = new Map<string, number>();
    for (const r of data) {
      const s = String(r['Complaint Date and Time'] || '');
      const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
      const key = m ? m[1] : 'Unknown';
      dailyMap.set(key, (dailyMap.get(key) || 0) + 1);
    }
    const dailyDates = Array.from(dailyMap.keys()).sort((a, b) => {
      const pa = a.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const pb = b.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const da = pa ? new Date(`${pa[2]}-${pa[1]}-${pa[0]}`) : new Date(0);
      const db = pb ? new Date(`${pb[2]}-${pb[1]}-${pb[0]}`) : new Date(0);
      return da.getTime() - db.getTime();
    });

    if (dailyTrendChartRef.current && dailyDates.length > 0) {
      const ctx = dailyTrendChartRef.current.getContext('2d');
      if (ctx) {
        dailyTrendChartInstance.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels: dailyDates,
            datasets: [{
              label: 'Daily Complaints',
              data: dailyDates.map(date => dailyMap.get(date) || 0),
              borderColor: 'rgb(139, 92, 246)',
              backgroundColor: 'rgba(139, 92, 246, 0.2)',
              tension: 0.4,
              fill: true,
              pointRadius: 3,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              title: { display: true, text: 'Daily Complaint Trend', font: { size: 16, weight: 'bold' } },
              legend: { display: true, position: 'top' }
            },
            scales: {
              y: { beginAtZero: true, title: { display: true, text: 'Complaints' } },
              x: { title: { display: true, text: 'Date' } }
            }
          }
        });
      }
    }

    // Area Type Chart
    const areaTypeMap = new Map<string, number>();
    for (const r of data) {
      const areaType = String(r['Area Type'] || '').trim() || 'Unknown';
      areaTypeMap.set(areaType, (areaTypeMap.get(areaType) || 0) + 1);
    }
    const areaTypeData = Array.from(areaTypeMap.entries()).sort((a, b) => b[1] - a[1]);

    if (areaTypeChartRef.current && areaTypeData.length > 0) {
      const ctx = areaTypeChartRef.current.getContext('2d');
      if (ctx) {
        const areaTypePalette = [
          '#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', 
          '#3b82f6', '#f97316', '#14b8a6', '#6366f1', '#eab308'
        ];
        areaTypeChartInstance.current = new Chart(ctx, {
          type: 'pie',
          data: {
            labels: areaTypeData.map(([name, count]) => `${name} (${count})`),
            datasets: [{
              data: areaTypeData.map(([, count]) => count),
              backgroundColor: areaTypePalette.slice(0, areaTypeData.length),
              borderWidth: 4,
              borderColor: '#ffffff',
              hoverBorderWidth: 6,
              hoverBorderColor: '#f3f4f6'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              title: { display: true, text: 'Area Type Distribution', font: { size: 16, weight: 'bold' } },
              legend: { position: 'bottom' },
              tooltip: {
                callbacks: {
                  label: (context) => `${context.label}: ${context.parsed} (${((context.parsed / data.length) * 100).toFixed(1)}%)`
                }
              }
            }
          }
        });
      }
    }

    return () => {
      if (comparisonChartInstance.current) comparisonChartInstance.current.destroy();
      if (divisionChartInstance.current) divisionChartInstance.current.destroy();
      if (beyondChartInstance.current) beyondChartInstance.current.destroy();
      if (subStationChartInstance.current) subStationChartInstance.current.destroy();
      if (dailyTrendChartInstance.current) dailyTrendChartInstance.current.destroy();
      if (areaTypeChartInstance.current) areaTypeChartInstance.current.destroy();
    };
  }, [data, isClosedRow]);

  if (data.length === 0) return null;

  return (
    <div className="space-y-8">
      <div className="bg-gradient-to-br from-white via-blue-50/30 to-purple-50/30 rounded-2xl shadow-2xl p-8 border border-gray-100">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-blue-500 to-purple-600 p-3 rounded-xl shadow-lg">
              <span className="text-3xl">📊</span>
            </div>
            <div>
              <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Interactive Analytics Dashboard
              </h2>
              <p className="text-sm text-gray-500 mt-1">Visual insights and trend analysis</p>
            </div>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg shadow-md border border-gray-200">
            <p className="text-xs text-gray-500">Total Records</p>
            <p className="text-2xl font-bold text-blue-600">{data.length}</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border-2 border-blue-100 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div style={{ height: '380px' }}>
              <canvas ref={comparisonChartRef}></canvas>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border-2 border-purple-100 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div style={{ height: '380px' }}>
              <canvas ref={dailyTrendChartRef}></canvas>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border-2 border-emerald-100 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div style={{ height: '380px' }}>
              <canvas ref={beyondChartRef}></canvas>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border-2 border-cyan-100 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div style={{ height: '380px' }}>
              <canvas ref={areaTypeChartRef}></canvas>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border-2 border-indigo-100 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div style={{ height: '380px' }}>
              <canvas ref={divisionChartRef}></canvas>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border-2 border-teal-100 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div style={{ height: '380px' }}>
              <canvas ref={subStationChartRef}></canvas>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
