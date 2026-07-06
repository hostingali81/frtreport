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
import {
  CAT,
  INK,
  GRID,
  SURFACE,
  nfmt,
  TOOLTIP,
  axisTicks,
  hairlineGrid,
  barTopLabels,
  barEndLabels,
  doughnutCenter,
  ChartCard
} from './chartTheme';

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

// Palette + shared plugins/card live in chartTheme.tsx (shared with the other
// /analytics tabs).

// '2026-06-11' -> '11/06' (short axis label); tooltip carries the full date.
const shortDate = (isoDate: string) => {
  const [, m, d] = isoDate.split('-');
  return `${d}/${m}`;
};
const fullDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};

export default function TrendCharts({ stats }: TrendChartsProps) {
  const comparisonChartRef = useRef<HTMLCanvasElement>(null);
  const dailyTrendChartRef = useRef<HTMLCanvasElement>(null);
  const beyondChartRef = useRef<HTMLCanvasElement>(null);
  const areaTypeChartRef = useRef<HTMLCanvasElement>(null);
  const divisionChartRef = useRef<HTMLCanvasElement>(null);
  const subStationChartRef = useRef<HTMLCanvasElement>(null);

  const instances = useRef<Chart[]>([]);

  const beyondData = useMemo(
    () => stats.beyondByDivision.map(({ k, n }) => [k, n] as [string, number]),
    [stats]
  );

  useEffect(() => {
    if (stats.total === 0) return;

    const total = stats.total;
    const comparisonDays = stats.daily.filter((day) => day.cr > 0 || day.frt > 0);
    const divisionData = stats.byDivision.map(({ k, n }) => [k, n] as [string, number]);
    const subStationData = stats.bySubStation.slice(0, 15).map(({ k, n }) => [k, n] as [string, number]);
    const areaTypeData = stats.byAreaType.map(({ k, n }) => [k, n] as [string, number]);

    instances.current.forEach((c) => c.destroy());
    instances.current = [];
    const track = (c: Chart | null) => { if (c) instances.current.push(c); };

    // 1. Control Room vs FRT — two entities, slots 1 & 2, clean lines.
    if (comparisonChartRef.current && comparisonDays.length > 0) {
      const ctx = comparisonChartRef.current.getContext('2d');
      if (ctx) {
        track(new Chart(ctx, {
          type: 'line',
          data: {
            labels: comparisonDays.map((day) => shortDate(day.d)),
            datasets: [
              {
                label: 'Control Room Closed',
                data: comparisonDays.map((day) => day.cr),
                borderColor: CAT[0],
                backgroundColor: CAT[0],
                borderWidth: 2,
                tension: 0.35,
                pointRadius: comparisonDays.length > 40 ? 0 : 2.5,
                pointHoverRadius: 5,
                pointBackgroundColor: CAT[0]
              },
              {
                label: 'FRT Closed',
                data: comparisonDays.map((day) => day.frt),
                borderColor: CAT[1],
                backgroundColor: CAT[1],
                borderWidth: 2,
                tension: 0.35,
                pointRadius: comparisonDays.length > 40 ? 0 : 2.5,
                pointHoverRadius: 5,
                pointBackgroundColor: CAT[1]
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                display: true,
                position: 'top',
                align: 'end',
                labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, color: INK.secondary, font: { size: 11 } }
              },
              tooltip: {
                ...TOOLTIP,
                callbacks: {
                  title: (items: any[]) => fullDate(comparisonDays[items[0].dataIndex].d)
                }
              }
            },
            scales: {
              y: { beginAtZero: true, ticks: { ...axisTicks, precision: 0 }, grid: hairlineGrid, border: { display: false } },
              x: { ticks: { ...axisTicks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { display: false }, border: { color: GRID } }
            }
          }
        }));
      }
    }

    // 2. Daily trend — single series, slot 1 with a whisper of fill.
    if (dailyTrendChartRef.current && stats.daily.length > 0) {
      const ctx = dailyTrendChartRef.current.getContext('2d');
      if (ctx) {
        track(new Chart(ctx, {
          type: 'line',
          data: {
            labels: stats.daily.map((day) => shortDate(day.d)),
            datasets: [{
              label: 'Complaints',
              data: stats.daily.map((day) => day.n),
              borderColor: CAT[0],
              backgroundColor: 'rgba(42, 120, 214, 0.08)',
              borderWidth: 2,
              tension: 0.35,
              fill: true,
              pointRadius: stats.daily.length > 40 ? 0 : 2.5,
              pointHoverRadius: 5,
              pointBackgroundColor: CAT[0]
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: {
                ...TOOLTIP,
                callbacks: {
                  title: (items: any[]) => fullDate(stats.daily[items[0].dataIndex].d)
                }
              }
            },
            scales: {
              y: { beginAtZero: true, ticks: { ...axisTicks, precision: 0 }, grid: hairlineGrid, border: { display: false } },
              x: { ticks: { ...axisTicks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { display: false }, border: { color: GRID } }
            }
          }
        }));
      }
    }

    // 3. Closed Beyond by division — part-to-whole, fixed slot order.
    if (beyondChartRef.current && beyondData.length > 0) {
      const ctx = beyondChartRef.current.getContext('2d');
      if (ctx) {
        track(new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: beyondData.map(([name]) => name),
            datasets: [{
              data: beyondData.map(([, count]) => count),
              backgroundColor: beyondData.map((_, i) => CAT[i % CAT.length]),
              borderColor: SURFACE,
              borderWidth: 2,
              hoverBorderColor: SURFACE,
              hoverBorderWidth: 2,
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '64%',
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  usePointStyle: true, boxWidth: 8, boxHeight: 8, color: INK.secondary, font: { size: 11 },
                  generateLabels: (chart: any) =>
                    chart.data.labels.map((label: string, i: number) => ({
                      text: `${label} (${nfmt(chart.data.datasets[0].data[i])})`,
                      fillStyle: chart.data.datasets[0].backgroundColor[i],
                      strokeStyle: SURFACE,
                      pointStyle: 'circle',
                      fontColor: INK.secondary,
                      index: i
                    }))
                }
              },
              tooltip: {
                ...TOOLTIP,
                callbacks: {
                  label: (context: any) => {
                    const sum = (context.dataset.data as number[]).reduce((a, b) => a + b, 0);
                    return ` ${context.label}: ${nfmt(context.parsed)} (${((context.parsed / sum) * 100).toFixed(1)}%)`;
                  }
                }
              }
            }
          },
          plugins: [doughnutCenter('Beyond')]
        }));
      }
    }

    // 4. Area type — part-to-whole of the whole selection.
    if (areaTypeChartRef.current && areaTypeData.length > 0) {
      const ctx = areaTypeChartRef.current.getContext('2d');
      if (ctx) {
        track(new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: areaTypeData.map(([name]) => name),
            datasets: [{
              data: areaTypeData.map(([, count]) => count),
              backgroundColor: areaTypeData.map((_, i) => CAT[i % CAT.length]),
              borderColor: SURFACE,
              borderWidth: 2,
              hoverBorderColor: SURFACE,
              hoverBorderWidth: 2,
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '64%',
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  usePointStyle: true, boxWidth: 8, boxHeight: 8, color: INK.secondary, font: { size: 11 },
                  generateLabels: (chart: any) =>
                    chart.data.labels.map((label: string, i: number) => ({
                      text: `${label} (${nfmt(chart.data.datasets[0].data[i])})`,
                      fillStyle: chart.data.datasets[0].backgroundColor[i],
                      strokeStyle: SURFACE,
                      pointStyle: 'circle',
                      fontColor: INK.secondary,
                      index: i
                    }))
                }
              },
              tooltip: {
                ...TOOLTIP,
                callbacks: {
                  label: (context: any) =>
                    ` ${context.label}: ${nfmt(context.parsed)} (${((context.parsed / total) * 100).toFixed(1)}%)`
                }
              }
            }
          },
          plugins: [doughnutCenter('Total')]
        }));
      }
    }

    // 5. Divisions — one series, one color (slot 1); the bar length is the data.
    if (divisionChartRef.current && divisionData.length > 0) {
      const ctx = divisionChartRef.current.getContext('2d');
      if (ctx) {
        track(new Chart(ctx, {
          type: 'bar',
          data: {
            labels: divisionData.map(([name]) => name),
            datasets: [{
              label: 'Complaints',
              data: divisionData.map(([, count]) => count),
              backgroundColor: CAT[0],
              borderRadius: 4,
              borderSkipped: 'bottom' as const,
              barPercentage: 0.6,
              categoryPercentage: 0.8,
              maxBarThickness: 56
            }]
          },
          plugins: [barTopLabels],
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 18 } },
            plugins: {
              legend: { display: false },
              tooltip: { ...TOOLTIP, callbacks: { label: (c: any) => ` ${nfmt(c.parsed.y)} complaints` } }
            },
            scales: {
              y: { beginAtZero: true, ticks: { ...axisTicks, precision: 0 }, grid: hairlineGrid, border: { display: false } },
              x: { ticks: { ...axisTicks, autoSkip: false, maxRotation: 45, minRotation: 45, font: { size: 10 } }, grid: { display: false }, border: { color: GRID } }
            }
          }
        }));
      }
    }

    // 6. Top substations — ranked, one color; counts at the bar end.
    if (subStationChartRef.current && subStationData.length > 0) {
      const ctx = subStationChartRef.current.getContext('2d');
      if (ctx) {
        track(new Chart(ctx, {
          type: 'bar',
          plugins: [barEndLabels],
          data: {
            labels: subStationData.map(([name]) => name),
            datasets: [{
              label: 'Complaints',
              data: subStationData.map(([, count]) => count),
              backgroundColor: CAT[0],
              borderRadius: 4,
              borderSkipped: 'start' as const,
              barPercentage: 0.65,
              categoryPercentage: 0.8
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            layout: { padding: { right: 44 } },
            plugins: {
              legend: { display: false },
              tooltip: { ...TOOLTIP, callbacks: { label: (c: any) => ` ${nfmt(c.parsed.x)} complaints` } }
            },
            scales: {
              x: { beginAtZero: true, ticks: { ...axisTicks, precision: 0 }, grid: hairlineGrid, border: { display: false } },
              y: { ticks: { ...axisTicks, autoSkip: false, font: { size: 10 } }, grid: { display: false }, border: { color: GRID } }
            }
          }
        }));
      }
    }

    return () => {
      instances.current.forEach((c) => c.destroy());
      instances.current = [];
    };
  }, [stats, beyondData]);

  if (stats.total === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 animate-in fade-in duration-500">
      <ChartCard
        title="Control Room vs FRT"
        subtitle="Complaints closed per day, by who closed them"
        height={300}
      >
        <canvas ref={comparisonChartRef}></canvas>
      </ChartCard>

      <ChartCard
        title="Daily Complaint Trend"
        subtitle="Complaints received per day"
        height={300}
      >
        <canvas ref={dailyTrendChartRef}></canvas>
      </ChartCard>

      <ChartCard
        title="Closed Beyond — Division wise"
        subtitle="Where the beyond-SLA closures are coming from"
        height={300}
      >
        {beyondData.length > 0 ? (
          <canvas ref={beyondChartRef}></canvas>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-gray-400 font-medium">No beyond complaints 🎉</p>
          </div>
        )}
      </ChartCard>

      <ChartCard
        title="Area Type"
        subtitle="Urban vs rural split of the selection"
        height={300}
      >
        <canvas ref={areaTypeChartRef}></canvas>
      </ChartCard>

      <ChartCard
        title="Divisions"
        subtitle="Total complaints per division"
        height={320}
      >
        <canvas ref={divisionChartRef}></canvas>
      </ChartCard>

      <ChartCard
        title="Top 15 Substations"
        subtitle="Ranked by complaint count"
        height={400}
      >
        <canvas ref={subStationChartRef}></canvas>
      </ChartCard>
    </div>
  );
}
