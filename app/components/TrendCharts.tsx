'use client';

import { useEffect, useRef, useMemo } from 'react';
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  LineController,
  BarController,
  PieController,
  DoughnutController
} from 'chart.js';
import type { ChartStats } from '../context/DataContext';

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  LineController,
  BarController,
  PieController,
  DoughnutController
);

interface TrendChartsProps {
  stats: ChartStats;
}

// '2026-06-11' -> '11/06/2026' (the label format the charts always used)
const formatDateLabel = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};

export default function TrendCharts({ stats }: TrendChartsProps) {
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

  const beyondData = useMemo(
    () => stats.beyondByDivision.map(({ k, n }) => [k, n] as [string, number]),
    [stats]
  );

  useEffect(() => {
    if (stats.total === 0) return;

    const total = stats.total;

    // daily is sorted by date ascending already
    const comparisonDays = stats.daily.filter((day) => day.cr > 0 || day.frt > 0);
    const divisionData = stats.byDivision.map(({ k, n }) => [k, n] as [string, number]);
    const subStationData = stats.bySubStation.slice(0, 15).map(({ k, n }) => [k, n] as [string, number]);
    const areaTypeData = stats.byAreaType.map(({ k, n }) => [k, n] as [string, number]);

    const divisionColors = divisionData.map((_, i) => {
      // Professional Palette: Blues, Teals, Indigos, Slates
      const palette = [
        'rgba(30, 64, 175, 0.8)', // Primary 800
        'rgba(14, 116, 144, 0.8)', // Cyan 700
        'rgba(71, 85, 105, 0.8)', // Slate 600
        'rgba(37, 99, 235, 0.8)', // Blue 600
        'rgba(15, 23, 42, 0.8)',  // Slate 900
        'rgba(3, 105, 161, 0.8)', // Sky 700
      ];
      return palette[i % palette.length];
    });
    const divisionBorderColors = divisionData.map((_, i) => {
      const palette = [
        '#1e40af', '#0e7490', '#475569', '#2563eb', '#0f172a', '#0369a1'
      ];
      return palette[i % palette.length];
    });

    if (comparisonChartInstance.current) comparisonChartInstance.current.destroy();
    if (divisionChartInstance.current) divisionChartInstance.current.destroy();
    if (beyondChartInstance.current) beyondChartInstance.current.destroy();
    if (subStationChartInstance.current) subStationChartInstance.current.destroy();
    if (dailyTrendChartInstance.current) dailyTrendChartInstance.current.destroy();
    if (areaTypeChartInstance.current) areaTypeChartInstance.current.destroy();

    if (comparisonChartRef.current && comparisonDays.length > 0) {
      const ctx = comparisonChartRef.current.getContext('2d');
      if (ctx) {
        comparisonChartInstance.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels: comparisonDays.map((day) => formatDateLabel(day.d)),
            datasets: [
              {
                label: 'Control Room Closed',
                data: comparisonDays.map((day) => day.cr),
                borderColor: '#0f172a', // Navy (Slate 900)
                backgroundColor: 'rgba(15, 23, 42, 0.1)',
                tension: 0.3,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
              },
              {
                label: 'FRT Closed',
                data: comparisonDays.map((day) => day.frt),
                borderColor: '#0284c7', // Sky 600
                backgroundColor: 'rgba(2, 132, 199, 0.1)',
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

    // Beyond Chart - Division-wise Closed Beyond

    if (beyondChartRef.current && beyondData.length > 0) {
      const ctx = beyondChartRef.current.getContext('2d');
      if (ctx) {
        // Professional Palette
        const colors = ['#1e3a8a', '#1d4ed8', '#3b82f6', '#64748b', '#94a3b8', '#0f172a', '#0ea5e9', '#0284c7'];
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
              title: { display: true, text: 'Closed Beyond - Division Wise', font: { size: 16, weight: 'bold' } },
              legend: { position: 'bottom' },
              tooltip: {
                callbacks: {
                  label: (context) => `${context.label}: ${context.parsed} (${((context.parsed / total) * 100).toFixed(1)}%)`
                }
              }
            }
          }
        });
      }
    }

    // Sub Station Bar Chart
    const professionalPalette = [
      'rgba(30, 58, 138, 0.8)',  // Primary 900
      'rgba(29, 78, 216, 0.8)',  // Primary 700
      'rgba(59, 130, 246, 0.8)', // Primary 500
      'rgba(15, 23, 42, 0.8)',   // Slate 900
      'rgba(51, 65, 85, 0.8)',   // Slate 700
      'rgba(100, 116, 139, 0.8)',// Slate 500
      'rgba(3, 105, 161, 0.8)',  // Sky 700
      'rgba(14, 165, 233, 0.8)', // Sky 500
    ];
    const professionalBorders = [
      '#1e3a8a', '#1d4ed8', '#3b82f6', '#0f172a', '#334155', '#64748b', '#0369a1', '#0ea5e9'
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
    if (dailyTrendChartRef.current && stats.daily.length > 0) {
      const ctx = dailyTrendChartRef.current.getContext('2d');
      if (ctx) {
        dailyTrendChartInstance.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels: stats.daily.map((day) => formatDateLabel(day.d)),
            datasets: [{
              label: 'Daily Complaints',
              data: stats.daily.map((day) => day.n),
              borderColor: '#64748b', // Slate 500
              backgroundColor: 'rgba(100, 116, 139, 0.2)',
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
    if (areaTypeChartRef.current && areaTypeData.length > 0) {
      const ctx = areaTypeChartRef.current.getContext('2d');
      if (ctx) {
        const areaTypePalette = [
          '#0c4a6e', // Navy
          '#0284c7', // Sky
          '#0d9488', // Teal
          '#4f46e5', // Indigo
          '#059669', // Emerald
          '#d97706', // Amber
          '#64748b', // Slate
          '#7c3aed', // Violet
          '#be185d', // Pink-Red (Professional)
          '#0891b2'  // Cyan
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
                  label: (context) => `${context.label}: ${context.parsed} (${((context.parsed / total) * 100).toFixed(1)}%)`
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
  }, [stats, beyondData]);

  if (stats.total === 0) return null;

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="bg-sky-50 p-3 rounded-xl">
              <span className="text-3xl text-primary-700">📊</span>
            </div>
            <div>
              <h2 className="text-3xl font-bold text-gray-900">
                Independent Analytics Dashboard
              </h2>
              <p className="text-sm text-gray-500 mt-1">Visual insights and trend analysis</p>
            </div>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg shadow-md border border-gray-200">
            <p className="text-xs text-gray-500">Total Records</p>
            <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300">
            <div style={{ height: '380px' }}>
              <canvas ref={comparisonChartRef}></canvas>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300">
            <div style={{ height: '380px' }}>
              <canvas ref={dailyTrendChartRef}></canvas>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300">
            <div style={{ height: '380px', position: 'relative' }}>
              {beyondData.length > 0 ? (
                <canvas ref={beyondChartRef}></canvas>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-gray-500 font-medium">No Beyond Complaints</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300">
            <div style={{ height: '380px' }}>
              <canvas ref={areaTypeChartRef}></canvas>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300">
            <div style={{ height: '380px' }}>
              <canvas ref={divisionChartRef}></canvas>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300">
            <div style={{ height: '380px' }}>
              <canvas ref={subStationChartRef}></canvas>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
