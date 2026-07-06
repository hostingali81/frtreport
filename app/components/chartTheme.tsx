'use client';

import React from 'react';

// Shared chart styling for the /analytics dashboard (TrendCharts, CallingReport,
// ...). Validated categorical palette (fixed slot order — the ordering is the
// CVD-safety mechanism, don't shuffle). Single-series charts always use slot 1.
export const CAT = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
export const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781' };
export const GRID = '#e7e6e0';
export const SURFACE = '#ffffff';
// Neutral fill for "remainder" segments (not an entity, just context).
export const NEUTRAL = '#d6d4cd';

export const nfmt = (n: number) => n.toLocaleString('en-IN');

export const TOOLTIP = {
  backgroundColor: 'rgba(11, 11, 11, 0.92)',
  titleFont: { size: 12, weight: 'bold' as const },
  bodyFont: { size: 12 },
  padding: 10,
  cornerRadius: 8,
  boxPadding: 4,
  displayColors: true,
  usePointStyle: true
};

export const axisTicks = { color: INK.muted, font: { size: 11 } };
export const hairlineGrid = { color: GRID, drawTicks: false };

// Muted count labels above vertical bars (relief for the sub-3:1 palette slots
// and the counts operators read off these reports).
export const barTopLabels = {
  id: 'barTopLabels',
  afterDatasetsDraw: (chart: any) => {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((dataset: any, i: number) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.type !== 'bar' || chart.options.indexAxis === 'y') return;
      meta.data.forEach((bar: any, index: number) => {
        ctx.fillStyle = INK.secondary;
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(nfmt(dataset.data[index]), bar.x, bar.y - 4);
      });
    });
  }
};

export const barEndLabels = {
  id: 'barEndLabels',
  afterDatasetsDraw: (chart: any) => {
    if (chart.options.indexAxis !== 'y') return;
    const ctx = chart.ctx;
    chart.data.datasets.forEach((dataset: any, i: number) => {
      const meta = chart.getDatasetMeta(i);
      meta.data.forEach((bar: any, index: number) => {
        ctx.fillStyle = INK.secondary;
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(nfmt(dataset.data[index]), bar.x + 6, bar.y);
      });
    });
  }
};

// Stacked horizontal bars: one total at the end of each row (per-segment values
// live in the tooltip; a number on every segment is noise).
export const stackEndLabels = {
  id: 'stackEndLabels',
  afterDatasetsDraw: (chart: any) => {
    if (chart.options.indexAxis !== 'y') return;
    const ctx = chart.ctx;
    const last = chart.data.datasets.length - 1;
    const meta = chart.getDatasetMeta(last);
    meta.data.forEach((bar: any, index: number) => {
      const total = chart.data.datasets.reduce((sum: number, ds: any) => sum + (ds.data[index] || 0), 0);
      ctx.fillStyle = INK.secondary;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(nfmt(total), bar.x + 6, bar.y);
    });
  }
};

// Total in the doughnut hole, in ink (never a series color).
export const doughnutCenter = (label: string) => ({
  id: 'doughnutCenter',
  afterDraw: (chart: any) => {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data?.[0]) return;
    const { x, y } = meta.data[0];
    const total = (chart.data.datasets[0].data as number[]).reduce((a, b) => a + b, 0);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = INK.primary;
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText(nfmt(total), x, y + 2);
    ctx.fillStyle = INK.muted;
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x, y + 6);
    ctx.restore();
  }
});

export function ChartCard({
  title,
  subtitle,
  height,
  children,
  className = ''
}: {
  title: string;
  subtitle: string;
  height: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm p-5 ${className}`}>
      <div className="mb-4">
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      <div style={{ height: `${height}px`, position: 'relative' }}>{children}</div>
    </div>
  );
}
