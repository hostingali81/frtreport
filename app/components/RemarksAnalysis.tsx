'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiDownload, FiMessageSquare, FiSearch, FiX } from 'react-icons/fi';
import type { Chart, ChartConfiguration } from 'chart.js';
import { buildFilterParams, useData } from '../context/DataContext';
import { loadExcelJS } from '../utils/lazyImports';
import {
  CAT, ChartCard, GRID, INK, NEUTRAL, TOOLTIP, axisTicks, barEndLabels, doughnutCenter, hairlineGrid, nfmt, stackEndLabels
} from './chartTheme';

// ---- payload of get_remarks_stats (via /api/complaints/remarks) ----
interface RemarkRow {
  k: string; // case/whitespace-folded key
  label: string; // most common spelling, shown as written
  n: number; pending: number; beyond: number; within: number; resSum: number; resN: number;
}
// [bucket (remark key or '__other__'), dimension value, substation (feeder dim only), n, pending, beyond, resSum, resN]
type CrossRow = [string, string, string | null, number, number, number, number, number];
interface RemarkStats {
  total: number;
  withRemark: number;
  blank: number;
  blankPending: number;
  distinct: number;
  remarks: RemarkRow[];
  top: string[];
  cross: Record<string, CrossRow[]>;
}

type DimId =
  | 'subStation' | 'feeder' | 'division' | 'subDivision' | 'areaType' | 'complaintType'
  | 'closedStatus' | 'closedBy' | 'soc' | 'month' | 'day' | 'hour' | 'dow';

const DIMS: { id: DimId; label: string; time?: boolean }[] = [
  { id: 'subStation', label: 'Substation' },
  { id: 'feeder', label: 'Feeder' },
  { id: 'division', label: 'Division' },
  { id: 'subDivision', label: 'Sub-division' },
  { id: 'areaType', label: 'Area type' },
  { id: 'complaintType', label: 'Complaint type' },
  { id: 'closedStatus', label: 'Closed status' },
  { id: 'closedBy', label: 'Closed by (ID)' },
  { id: 'soc', label: 'Source' },
  { id: 'month', label: 'Month', time: true },
  { id: 'day', label: 'Day', time: true },
  { id: 'hour', label: 'Hour of day', time: true },
  { id: 'dow', label: 'Weekday', time: true }
];

const OTHER = '__other__';
const OTHER_LABEL = 'Other remarks';
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const fmtMins = (mins: number) => `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
const avgRes = (sum: number, n: number) => (n > 0 ? sum / n : null);
// Hindi free-text remarks can be a full sentence; trim for axis ticks only.
const short = (s: string, max = 38) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function timeLabel(dim: DimId, k: string): string {
  if (dim === 'dow') return DOW[Number(k)] ?? k;
  if (dim === 'hour') return `${k.padStart(2, '0')}:00`;
  if (dim === 'month') {
    const [y, m] = k.split('-');
    return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
  }
  if (dim === 'day') {
    const [, m, d] = k.split('-');
    return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
  }
  return k;
}

function timeOrder(dim: DimId, k: string): number {
  if (dim === 'dow' || dim === 'hour') return Number(k);
  return Number(k.replace(/-/g, '')); // YYYY-MM or YYYY-MM-DD
}

interface DimEntry {
  key: string; // unique row key (feeder: "substation|feeder")
  label: string;
  total: number; pending: number; beyond: number; resSum: number; resN: number;
  byBucket: Map<string, number>;
}

// Fold the RPC's cross rows for one dimension into one entry per dimension value.
function aggregate(rows: CrossRow[] | undefined, dim: DimId): DimEntry[] {
  const map = new Map<string, DimEntry>();
  for (const [bucket, k, ss, n, pending, beyond, resSum, resN] of rows ?? []) {
    const key = dim === 'feeder' ? `${ss ?? 'Unknown'}|${k}` : k;
    let e = map.get(key);
    if (!e) {
      const label = dim === 'feeder' ? `${k} ↳ ${ss ?? 'Unknown'}` : timeLabel(dim, k);
      e = { key, label, total: 0, pending: 0, beyond: 0, resSum: 0, resN: 0, byBucket: new Map() };
      map.set(key, e);
    }
    e.total += n;
    e.pending += pending;
    e.beyond += beyond;
    e.resSum += Number(resSum);
    e.resN += resN;
    e.byBucket.set(bucket, (e.byBucket.get(bucket) ?? 0) + n);
  }
  const list = Array.from(map.values());
  const def = DIMS.find((d) => d.id === dim);
  if (def?.time) {
    list.sort((a, b) => timeOrder(dim, a.key) - timeOrder(dim, b.key));
  } else {
    list.sort((a, b) => b.total - a.total);
  }
  return list;
}

// One Chart.js instance bound to a canvas, rebuilt when deps change.
function useChart(build: () => ChartConfiguration | null, deps: React.DependencyList) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let chart: Chart | null = null;
    let cancelled = false;
    const config = build();
    if (!config) return;
    import('chart.js/auto').then(({ Chart: ChartJS }) => {
      if (cancelled || !ref.current) return;
      chart = new ChartJS(ref.current, config);
    });
    return () => {
      cancelled = true;
      chart?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

type TopMetric = 'n' | 'beyondPct' | 'avgRes';
type SortKey = 'label' | 'n' | 'pending' | 'beyond' | 'beyondPct' | 'avgRes';

function RemarksAnalysis() {
  const { currentFilters } = useData();
  const [data, setData] = useState<RemarkStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Drill-down: one remark (by its label, which the RPC folds the same way).
  const [focus, setFocus] = useState<RemarkRow | null>(null);
  const [focusData, setFocusData] = useState<RemarkStats | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);

  const [dim, setDim] = useState<DimId>('subStation');
  const [share, setShare] = useState(false); // 100% stacked
  const [topMetric, setTopMetric] = useState<TopMetric>('n');
  const [dimSearch, setDimSearch] = useState('');
  const [dimLimit, setDimLimit] = useState(15);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'n', desc: true });
  const [limit, setLimit] = useState(25);
  const [exporting, setExporting] = useState(false);

  const filterQuery = useMemo(() => buildFilterParams(currentFilters).toString(), [currentFilters]);

  // Overview for the current filters. A drill-down belongs to the filters it
  // was opened under, so a filter change closes it.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setFocus(null);
    setFocusData(null);
    fetch(`/api/complaints/remarks?${filterQuery}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.success) throw new Error(j.error || 'Failed to load remarks');
        setData(j.remarks as RemarkStats);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load remarks');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterQuery]);

  useEffect(() => {
    if (!focus) return;
    let cancelled = false;
    setFocusLoading(true);
    const qs = new URLSearchParams(filterQuery);
    qs.set('remark', focus.label);
    fetch(`/api/complaints/remarks?${qs.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.success) throw new Error(j.error || 'Failed to load remark');
        setFocusData(j.remarks as RemarkStats);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load remark');
      })
      .finally(() => {
        if (!cancelled) setFocusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [focus, filterQuery]);

  const openRemark = (r: RemarkRow) => {
    setFocus(r);
    setFocusData(null);
    setDimSearch('');
    setDimLimit(15);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data?.remarks ?? []) m.set(r.k, r.label);
    return (k: string) => (k === OTHER ? OTHER_LABEL : m.get(k) ?? k);
  }, [data]);

  // Series for the cross-tab charts: the top remarks in rank order, then Other.
  // Colour follows the remark (its slot in the overview's top list), never its
  // rank inside one dimension, so a remark is the same colour on every chart.
  const series = useMemo(() => {
    const top = data?.top ?? [];
    return [
      ...top.map((k, i) => ({ k, label: labelOf(k), color: CAT[i] })),
      { k: OTHER, label: OTHER_LABEL, color: NEUTRAL }
    ];
  }, [data, labelOf]);

  const view = focus ? focusData : data;
  const dimEntries = useMemo(() => aggregate(view?.cross?.[dim], dim), [view, dim]);
  const dimDef = DIMS.find((d) => d.id === dim)!;

  // ---------------- charts ----------------

  const topRemarks = useMemo(() => {
    const rows = [...(data?.remarks ?? [])];
    if (topMetric === 'beyondPct') {
      // Rates on a handful of complaints are noise; rank only remarks with volume.
      return rows.filter((r) => r.n >= 20).sort((a, b) => pct(b.beyond, b.n) - pct(a.beyond, a.n)).slice(0, 15);
    }
    if (topMetric === 'avgRes') {
      return rows
        .filter((r) => r.resN >= 20)
        .sort((a, b) => (avgRes(b.resSum, b.resN) ?? 0) - (avgRes(a.resSum, a.resN) ?? 0))
        .slice(0, 15);
    }
    return rows.slice(0, 15);
  }, [data, topMetric]);

  const topRef = useChart(() => {
    if (focus || topRemarks.length === 0) return null;
    const values = topRemarks.map((r) =>
      topMetric === 'n' ? r.n : topMetric === 'beyondPct' ? pct(r.beyond, r.n) : Math.round(avgRes(r.resSum, r.resN) ?? 0)
    );
    return {
      type: 'bar',
      data: {
        labels: topRemarks.map((r) => short(r.label)),
        datasets: [{ label: 'Remarks', data: values, backgroundColor: CAT[0], borderRadius: 4, borderSkipped: 'start', barPercentage: 0.75 }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 56 } },
        interaction: { mode: 'index', axis: 'y', intersect: false },
        onClick: (_e, els) => {
          const r = topRemarks[els[0]?.index ?? -1];
          if (r) openRemark(r);
        },
        onHover: (e, els) => {
          const t = e.native?.target as HTMLElement | undefined;
          if (t) t.style.cursor = els.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP,
            displayColors: false,
            callbacks: {
              title: (items) => topRemarks[items[0].dataIndex]?.label ?? '',
              label: (item) => {
                const r = topRemarks[item.dataIndex];
                return [
                  `Complaints: ${nfmt(r.n)} (${pct(r.n, data?.withRemark ?? 0)}% of remarks)`,
                  `Closed beyond: ${nfmt(r.beyond)} (${pct(r.beyond, r.n)}%)`,
                  `Avg resolution: ${r.resN ? fmtMins(r.resSum / r.resN) : '—'}`,
                  'Click to analyse this remark'
                ];
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true, grid: hairlineGrid, border: { display: false }, ticks: axisTicks },
          y: { grid: { display: false }, border: { color: GRID }, ticks: { ...axisTicks, color: INK.secondary, autoSkip: false } }
        }
      },
      plugins: [
        topMetric === 'n'
          ? barEndLabels
          : {
              id: 'metricEndLabels',
              afterDatasetsDraw: (chart: Chart) => {
                const ctx = chart.ctx;
                chart.getDatasetMeta(0).data.forEach((bar, i) => {
                  ctx.fillStyle = INK.secondary;
                  ctx.font = '600 11px system-ui, sans-serif';
                  ctx.textAlign = 'left';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(topMetric === 'beyondPct' ? `${values[i]}%` : fmtMins(values[i]), bar.x + 6, bar.y);
                });
              }
            }
      ]
    } as ChartConfiguration;
  }, [topRemarks, topMetric, focus, data]);

  const shareRef = useChart(() => {
    if (focus || !data || data.withRemark === 0) return null;
    const topSum = data.top.reduce((s, k) => s + (data.remarks.find((r) => r.k === k)?.n ?? 0), 0);
    const values = [...data.top.map((k) => data.remarks.find((r) => r.k === k)?.n ?? 0), Math.max(0, data.withRemark - topSum)];
    return {
      type: 'doughnut',
      data: {
        labels: series.map((s) => s.label),
        datasets: [{ data: values, backgroundColor: series.map((s) => s.color), borderColor: '#ffffff', borderWidth: 2 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '64%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: INK.secondary, font: { size: 11 }, generateLabels: (chart) => {
            const base = (chart.data.labels as string[]).map((l, i) => ({
              text: `${short(l, 30)} · ${pct(values[i], data.withRemark)}%`,
              fillStyle: series[i].color,
              strokeStyle: series[i].color,
              fontColor: INK.secondary,
              pointStyle: 'circle' as const,
              index: i,
              hidden: false
            }));
            return base;
          } } },
          tooltip: {
            ...TOOLTIP,
            callbacks: { label: (item) => ` ${series[item.dataIndex].label}: ${nfmt(values[item.dataIndex])} (${pct(values[item.dataIndex], data.withRemark)}%)` }
          }
        }
      },
      plugins: [doughnutCenter('with remark')]
    } as ChartConfiguration<'doughnut'> as ChartConfiguration;
  }, [data, series, focus]);

  // Analyze-by chart: stacked by remark in the overview, one series when a
  // remark is focused. Time dimensions keep their natural order and run along
  // x; categorical ones are the top values by volume, horizontal.
  const chartEntries = useMemo(() => {
    if (dimDef.time) return dimEntries;
    // Feeder's Unknown bucket is mostly complaints scraped before FRT exposed
    // the column; it would dwarf every real feeder. It stays in the table.
    const list = dim === 'feeder' ? dimEntries.filter((e) => !e.label.startsWith('Unknown ↳')) : dimEntries;
    return list.slice(0, 15);
  }, [dimEntries, dimDef, dim]);

  const dimRef = useChart(() => {
    if (!view || chartEntries.length === 0) return null;
    const horizontal = !dimDef.time;
    const datasets = focus
      ? [{ label: focus.label, data: chartEntries.map((e) => e.total), backgroundColor: CAT[0], borderRadius: 4, borderSkipped: 'start' as const }]
      : series.map((s) => ({
          label: s.label,
          data: chartEntries.map((e) => {
            const v = e.byBucket.get(s.k) ?? 0;
            return share ? pct(v, e.total) : v;
          }),
          backgroundColor: s.color,
          // 2px surface gap between stacked segments.
          borderColor: '#ffffff',
          borderWidth: horizontal ? { right: 2 } : { top: 2 },
          borderSkipped: false as const
        }));
    return {
      type: 'bar',
      data: { labels: chartEntries.map((e) => (horizontal ? short(e.label, 32) : e.label)), datasets },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: horizontal ? { right: 56 } : { top: 18 } },
        interaction: { mode: 'index', axis: horizontal ? 'y' : 'x', intersect: false },
        plugins: {
          legend: focus ? { display: false } : { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: INK.secondary, font: { size: 11 }, generateLabels: (chart) =>
            chart.data.datasets.map((ds, i) => ({ text: short(String(ds.label), 28), fillStyle: series[i]?.color, strokeStyle: series[i]?.color, fontColor: INK.secondary, pointStyle: 'circle' as const, datasetIndex: i, hidden: !chart.isDatasetVisible(i) })) } },
          tooltip: {
            ...TOOLTIP,
            filter: (item) => Number(item.raw) > 0,
            callbacks: {
              title: (items) => chartEntries[items[0].dataIndex]?.label ?? '',
              label: (item) => {
                const e = chartEntries[item.dataIndex];
                if (focus) return ` ${nfmt(e.total)} complaints · beyond ${pct(e.beyond, e.total)}%`;
                const s = series[item.datasetIndex];
                const v = e.byBucket.get(s.k) ?? 0;
                return ` ${short(s.label, 40)}: ${nfmt(v)} (${pct(v, e.total)}%)`;
              },
              footer: (items) => {
                const e = chartEntries[items[0]?.dataIndex];
                return e ? `Total ${nfmt(e.total)}` : '';
              }
            }
          }
        },
        scales: {
          x: horizontal
            ? { stacked: true, beginAtZero: true, max: share && !focus ? 100 : undefined, grid: hairlineGrid, border: { display: false }, ticks: { ...axisTicks, callback: (v) => (share && !focus ? `${v}%` : nfmt(Number(v))) } }
            : { stacked: true, grid: { display: false }, border: { color: GRID }, ticks: { ...axisTicks, maxRotation: 0, autoSkip: true } },
          y: horizontal
            ? { stacked: true, grid: { display: false }, border: { color: GRID }, ticks: { ...axisTicks, color: INK.secondary, autoSkip: false } }
            : { stacked: true, beginAtZero: true, max: share && !focus ? 100 : undefined, grid: hairlineGrid, border: { display: false }, ticks: { ...axisTicks, callback: (v) => (share && !focus ? `${v}%` : nfmt(Number(v))) } }
        }
      },
      plugins: horizontal && !share ? [focus ? barEndLabels : stackEndLabels] : []
    } as ChartConfiguration;
  }, [view, chartEntries, dimDef, series, share, focus]);

  // Trend: day grain for up to ~2 months, month grain beyond.
  const trendDim: DimId = (view?.cross?.day?.length ?? 0) > 0 && new Set((view?.cross?.day ?? []).map((r) => r[1])).size <= 62 ? 'day' : 'month';
  const trendEntries = useMemo(() => aggregate(view?.cross?.[trendDim], trendDim), [view, trendDim]);

  const trendRef = useChart(() => {
    if (!view || trendEntries.length < 2) return null;
    const lines = focus ? [{ k: '__all__', label: focus.label, color: CAT[0] }] : series.filter((s) => s.k !== OTHER);
    return {
      type: 'line',
      data: {
        labels: trendEntries.map((e) => e.label),
        datasets: lines.map((s) => ({
          label: s.label,
          data: trendEntries.map((e) => (s.k === '__all__' ? e.total : e.byBucket.get(s.k) ?? 0)),
          borderColor: s.color,
          backgroundColor: s.color,
          borderWidth: 2,
          pointRadius: trendEntries.length > 40 ? 0 : 3,
          pointHoverRadius: 5,
          tension: 0.25
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: focus ? { display: false } : { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: INK.secondary, font: { size: 11 }, generateLabels: (chart) =>
            chart.data.datasets.map((ds, i) => ({ text: short(String(ds.label), 28), fillStyle: lines[i].color, strokeStyle: lines[i].color, fontColor: INK.secondary, pointStyle: 'circle' as const, datasetIndex: i, hidden: !chart.isDatasetVisible(i) })) } },
          tooltip: { ...TOOLTIP, callbacks: { label: (item) => ` ${short(String(item.dataset.label), 40)}: ${nfmt(Number(item.raw))}` } }
        },
        scales: {
          x: { grid: { display: false }, border: { color: GRID }, ticks: { ...axisTicks, maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, grid: hairlineGrid, border: { display: false }, ticks: axisTicks }
        }
      }
    } as ChartConfiguration;
  }, [view, trendEntries, series, focus]);

  // ---------------- tables ----------------

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (data?.remarks ?? []).filter((r) => !q || r.label.toLowerCase().includes(q));
    const val = (r: RemarkRow): number | string => {
      switch (sort.key) {
        case 'label': return r.label.toLowerCase();
        case 'pending': return r.pending;
        case 'beyond': return r.beyond;
        case 'beyondPct': return pct(r.beyond, r.n);
        case 'avgRes': return avgRes(r.resSum, r.resN) ?? -1;
        default: return r.n;
      }
    };
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
      return sort.desc ? -c : c;
    });
  }, [data, search, sort]);

  const dimTableRows = useMemo(() => {
    const q = dimSearch.trim().toLowerCase();
    return q ? dimEntries.filter((e) => e.label.toLowerCase().includes(q)) : dimEntries;
  }, [dimEntries, dimSearch]);

  // Per-column max for the heatmap shading (sequential, one hue).
  const colMax = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of dimEntries) for (const s of series) m.set(s.k, Math.max(m.get(s.k) ?? 0, share ? pct(e.byBucket.get(s.k) ?? 0, e.total) : e.byBucket.get(s.k) ?? 0));
    return m;
  }, [dimEntries, series, share]);

  // ---------------- export ----------------

  const exportExcel = async () => {
    if (!data || exporting) return;
    setExporting(true);
    try {
      const { ExcelJS, saveAs } = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      const headerStyle = (row: { eachCell: (cb: (cell: { fill: unknown; font: unknown }) => void) => void }) =>
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        });

      const ws = wb.addWorksheet('Remarks', { views: [{ state: 'frozen', ySplit: 2 }] });
      ws.addRow([`Closing remarks  |  ${nfmt(data.total)} complaints  |  ${nfmt(data.withRemark)} with remark  |  ${nfmt(data.blank)} without  |  ${nfmt(data.distinct)} distinct remarks`]);
      ws.getRow(1).font = { bold: true, size: 12 };
      headerStyle(ws.addRow(['#', 'Remark', 'Complaints', 'Share %', 'Pending', 'Closed Within', 'Closed Beyond', 'Beyond %', 'Avg Resolution']));
      data.remarks.forEach((r, i) =>
        ws.addRow([i + 1, r.label, r.n, pct(r.n, data.withRemark), r.pending, r.within, r.beyond, pct(r.beyond, r.n), r.resN ? fmtMins(r.resSum / r.resN) : '-'])
      );
      ws.columns = [{ width: 6 }, { width: 60 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 16 }];

      // One sheet per dimension: remark mix (top remarks + Other) per value.
      for (const d of DIMS) {
        const entries = aggregate(data.cross?.[d.id], d.id);
        if (!entries.length) continue;
        const sheet = wb.addWorksheet(`By ${d.label}`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
        headerStyle(sheet.addRow([d.label, 'Total', ...series.map((s) => s.label), 'Pending', 'Closed Beyond', 'Avg Resolution']));
        for (const e of entries) {
          sheet.addRow([e.label, e.total, ...series.map((s) => e.byBucket.get(s.k) ?? 0), e.pending, e.beyond, e.resN ? fmtMins(e.resSum / e.resN) : '-']);
        }
        sheet.columns = [{ width: 36 }, { width: 10 }, ...series.map(() => ({ width: 18 })), { width: 10 }, { width: 14 }, { width: 16 }];
      }

      const buffer = await wb.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `Remarks_Analysis_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } finally {
      setExporting(false);
    }
  };

  // ---------------- render ----------------

  if (loading) {
    return <div className="flex h-72 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-400 shadow-sm">Loading remarks…</div>;
  }
  if (error && !data) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 font-semibold text-red-800">{error}</div>;
  }
  if (!data || data.total === 0) return null;
  if (data.withRemark === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center">
        <FiMessageSquare className="mx-auto mb-3 text-4xl text-amber-500" />
        <p className="text-lg font-bold text-amber-900">No closing remarks in this range</p>
        <p className="mt-2 text-sm text-amber-800">All {nfmt(data.total)} complaints here are still without a remark (usually because they are pending).</p>
      </div>
    );
  }

  const top1 = data.remarks[0];
  const remarkedBeyond = data.remarks.reduce((s, r) => s + r.beyond, 0);
  const fr = focusData?.remarks?.[0];
  const topSubstation = focusData ? aggregate(focusData.cross?.subStation, 'subStation')[0] : null;

  const kpis = focus
    ? [
        { label: 'Complaints', value: fr ? nfmt(fr.n) : '…', sub: fr ? `${pct(fr.n, data.withRemark)}% of all remarks` : '' },
        { label: 'Pending', value: fr ? nfmt(fr.pending) : '…', sub: '', tone: 'text-red-600' },
        { label: 'Closed Beyond', value: fr ? nfmt(fr.beyond) : '…', sub: fr ? `${pct(fr.beyond, fr.n)}% of this remark` : '', tone: 'text-amber-600' },
        { label: 'Avg Resolution', value: fr?.resN ? fmtMins(fr.resSum / fr.resN) : '—', sub: '', tone: 'text-blue-700' },
        { label: 'Top Substation', value: topSubstation ? short(topSubstation.label, 22) : '—', sub: topSubstation ? `${nfmt(topSubstation.total)} complaints` : '', small: true }
      ]
    : [
        { label: 'Complaints', value: nfmt(data.total), sub: 'in current filters' },
        { label: 'With Remark', value: nfmt(data.withRemark), sub: `${pct(data.withRemark, data.total)}%`, tone: 'text-blue-700' },
        { label: 'Without Remark', value: nfmt(data.blank), sub: `${nfmt(data.blankPending)} of them pending`, tone: 'text-slate-500' },
        { label: 'Distinct Remarks', value: nfmt(data.distinct), sub: 'as written' },
        { label: 'Top Remark', value: short(top1?.label ?? '—', 22), sub: top1 ? `${pct(top1.n, data.withRemark)}% · ${nfmt(top1.n)}` : '', small: true },
        { label: 'Closed Beyond', value: `${pct(remarkedBeyond, data.withRemark)}%`, sub: 'of remarked complaints', tone: 'text-amber-600' }
      ];

  const sortHeader = (key: SortKey, label: string, right = true) => (
    <th
      className={`cursor-pointer select-none px-4 py-3 font-semibold hover:text-gray-800 ${right ? 'text-right' : ''}`}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'label' }))}
    >
      {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  );

  const dimChartHeight = dimDef.time ? 340 : Math.max(280, chartEntries.length * 30 + 80);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800">
              <span className="rounded-lg bg-blue-50 p-2 text-blue-700"><FiMessageSquare /></span>
              Remarks Analysis
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Closing remarks exactly as written in FRT (dropdown values since Aug 2026, free text before). Same text in different case/spacing counts together.
            </p>
          </div>
          <button
            onClick={exportExcel}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-emerald-800 active:scale-95 disabled:bg-gray-400"
          >
            <FiDownload /> {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>
        {focus && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
            <span className="font-semibold text-blue-900">Analysing one remark:</span>
            <span className="rounded-md bg-white px-2 py-0.5 font-semibold text-gray-900 shadow-sm">{focus.label}</span>
            {focusLoading && <span className="text-blue-700">loading…</span>}
            <button onClick={() => { setFocus(null); setFocusData(null); }} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-blue-700 hover:bg-blue-100">
              <FiX /> Back to all remarks
            </button>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${focus ? 'lg:grid-cols-5' : 'lg:grid-cols-6'}`}>
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k.label}</p>
            <p className={`${k.small ? 'text-base leading-6' : 'text-2xl'} font-bold ${k.tone ?? 'text-slate-900'} truncate`} title={String(k.value)}>{k.value}</p>
            {k.sub && <p className="text-[11px] text-gray-400">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Top remarks + share */}
      {!focus && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Top 15 remarks</h3>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {topMetric === 'n' ? 'By number of complaints' : topMetric === 'beyondPct' ? 'Highest Closed Beyond rate (remarks with 20+ complaints)' : 'Slowest average resolution (remarks with 20+ closed)'} · click a bar to analyse it
                  </p>
                </div>
                <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5 text-xs font-semibold">
                  {([['n', 'Count'], ['beyondPct', 'Beyond %'], ['avgRes', 'Avg resolution']] as [TopMetric, string][]).map(([m, l]) => (
                    <button key={m} onClick={() => setTopMetric(m)} className={`rounded px-2.5 py-1 transition ${topMetric === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div style={{ height: `${Math.max(300, topRemarks.length * 30 + 40)}px`, position: 'relative' }}>
                <canvas ref={topRef} />
              </div>
            </div>
          </div>
          <ChartCard title="Share of remarks" subtitle={`Top ${data.top.length} remarks vs the rest`} height={Math.max(340, topRemarks.length * 30 + 40) - 20}>
            <canvas ref={shareRef} />
          </ChartCard>
        </div>
      )}

      {/* Analyze by */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-gray-900">
              {focus ? `"${short(focus.label, 50)}" by ${dimDef.label.toLowerCase()}` : `Remarks by ${dimDef.label.toLowerCase()}`}
            </h3>
            <p className="mt-0.5 text-xs text-gray-400">
              {dimDef.time
                ? 'In time order'
                : `Top ${chartEntries.length} by complaints${dim === 'feeder' ? ' (Unknown feeder hidden from the chart — it is in the table)' : ''}`}
              {!focus && ` · stacked by the top ${data.top.length} remarks + other`}
            </p>
          </div>
          {!focus && (
            <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5 text-xs font-semibold">
              {([[false, 'Count'], [true, '% share']] as [boolean, string][]).map(([v, l]) => (
                <button key={l} onClick={() => setShare(v)} className={`rounded px-2.5 py-1 transition ${share === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>{l}</button>
              ))}
            </div>
          )}
        </div>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {DIMS.map((d) => (
            <button
              key={d.id}
              onClick={() => { setDim(d.id); setDimSearch(''); setDimLimit(15); }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition active:scale-95 ${dim === d.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'}`}
            >
              {d.label}
            </button>
          ))}
        </div>
        {focus && !focusData ? (
          <div className="flex h-64 items-center justify-center text-sm text-gray-400">Loading…</div>
        ) : chartEntries.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-gray-400">No data for this view.</div>
        ) : (
          <div style={{ height: `${dimChartHeight}px`, position: 'relative' }}>
            <canvas ref={dimRef} />
          </div>
        )}

        {/* Matrix / heatmap table for the same view */}
        {dimEntries.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-lg border border-gray-100">
            <div className="flex flex-col items-start justify-between gap-2 border-b border-gray-100 p-3 sm:flex-row sm:items-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {dimEntries.length} {dimDef.label.toLowerCase()} values{!focus && share ? ' · cells show % of the row' : ''}
              </p>
              <div className="relative w-full sm:w-64">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={dimSearch}
                  onChange={(e) => { setDimSearch(e.target.value); setDimLimit(15); }}
                  placeholder={`Search ${dimDef.label.toLowerCase()}…`}
                  className="w-full rounded-lg border border-gray-200 py-1.5 pl-9 pr-3 text-sm focus:border-blue-400 focus:outline-none"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              {/* nowrap: squeezed columns used to wrap "1h 22m" onto two lines,
                  doubling every row's height. Wide views scroll instead. */}
              <table className="w-full whitespace-nowrap text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="sticky left-0 z-[1] bg-gray-50 px-3 py-2.5 font-semibold">{dimDef.label}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                    {!focus && series.map((s) => (
                      <th key={s.k} className="min-w-[120px] px-3 py-2.5 text-right font-semibold normal-case" title={s.label}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                          <span>{short(s.label, 16)}</span>
                        </span>
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-semibold">Pending</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Beyond %</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Avg Res.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dimTableRows.slice(0, dimLimit).map((e) => (
                    <tr key={e.key} className="hover:bg-slate-50">
                      <td className="sticky left-0 z-[1] max-w-[260px] truncate bg-white px-3 py-2 font-semibold text-gray-900" title={e.label}>{e.label}</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-900">{nfmt(e.total)}</td>
                      {!focus && series.map((s) => {
                        const raw = e.byBucket.get(s.k) ?? 0;
                        const v = share ? pct(raw, e.total) : raw;
                        const max = colMax.get(s.k) ?? 0;
                        // Sequential single-hue shading (slot-1 blue), strength by
                        // the value relative to its column's max.
                        const alpha = max > 0 && v > 0 ? 0.08 + 0.5 * (v / max) : 0;
                        return (
                          <td key={s.k} className="px-3 py-2 text-right tabular-nums text-gray-800" style={{ background: alpha ? `rgba(42, 120, 214, ${alpha.toFixed(2)})` : undefined }}>
                            {v ? (share ? `${v}%` : nfmt(v)) : <span className="text-gray-300">·</span>}
                          </td>
                        );
                      })}
                      <td className={`px-3 py-2 text-right ${e.pending ? 'font-semibold text-red-600' : 'text-gray-400'}`}>{nfmt(e.pending)}</td>
                      <td className={`px-3 py-2 text-right ${e.beyond ? 'font-semibold text-amber-600' : 'text-gray-400'}`}>{pct(e.beyond, e.total)}%</td>
                      <td className="px-3 py-2 text-right text-gray-700">{e.resN ? fmtMins(e.resSum / e.resN) : '—'}</td>
                    </tr>
                  ))}
                  {dimTableRows.length === 0 && (
                    <tr><td colSpan={series.length + 5} className="px-4 py-6 text-center italic text-gray-500">Nothing matches “{dimSearch}”.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {dimTableRows.length > dimLimit && (
              <div className="border-t border-gray-100 bg-gray-50 p-3 text-center">
                <button onClick={() => setDimLimit((l) => l + 25)} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                  Show more ({dimTableRows.length - dimLimit} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Trend */}
      {trendEntries.length >= 2 && (
        <ChartCard
          title={focus ? `"${short(focus.label, 50)}" over time` : 'Top remarks over time'}
          subtitle={`${trendDim === 'day' ? 'Daily' : 'Monthly'} complaints${focus ? '' : ` for the top ${data.top.length} remarks`}`}
          height={320}
        >
          <canvas ref={trendRef} />
        </ChartCard>
      )}

      {/* All remarks */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col items-start justify-between gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-lg font-bold text-gray-800">All remarks</h3>
            <p className="text-xs text-gray-400">
              {nfmt(data.distinct)} distinct{data.distinct > data.remarks.length ? ` · showing the top ${nfmt(data.remarks.length)}` : ''} · click a row to analyse that remark
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setLimit(25); }}
              placeholder="Search remark text…"
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-blue-400 focus:outline-none"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold">#</th>
                {sortHeader('label', 'Remark', false)}
                {sortHeader('n', 'Complaints')}
                <th className="px-4 py-3 text-right font-semibold">Share</th>
                {sortHeader('pending', 'Pending')}
                {sortHeader('beyond', 'Closed Beyond')}
                {sortHeader('beyondPct', 'Beyond %')}
                {sortHeader('avgRes', 'Avg Resolution')}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tableRows.slice(0, limit).map((r, i) => (
                <tr
                  key={r.k}
                  onClick={() => openRemark(r)}
                  className={`cursor-pointer transition-colors hover:bg-blue-50/60 ${focus?.k === r.k ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-4 py-2.5 font-semibold text-gray-400">{i + 1}</td>
                  <td className="max-w-[420px] px-4 py-2.5 font-semibold text-gray-900">
                    <span className="line-clamp-2" title={r.label}>{r.label}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-900">{nfmt(r.n)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">
                    <span className="inline-flex items-center justify-end gap-2">
                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 sm:inline-block">
                        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct(r.n, data.remarks[0]?.n ?? 1))}%`, background: CAT[0] }} />
                      </span>
                      {pct(r.n, data.withRemark)}%
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 text-right ${r.pending ? 'font-semibold text-red-600' : 'text-gray-400'}`}>{nfmt(r.pending)}</td>
                  <td className={`px-4 py-2.5 text-right ${r.beyond ? 'font-semibold text-amber-600' : 'text-gray-400'}`}>{nfmt(r.beyond)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{pct(r.beyond, r.n)}%</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{r.resN ? fmtMins(r.resSum / r.resN) : '—'}</td>
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center italic text-gray-500">No remark matches “{search}”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {tableRows.length > limit && (
          <div className="border-t border-gray-100 bg-gray-50 p-4 text-center">
            <button onClick={() => setLimit((l) => l + 50)} className="text-sm font-medium text-blue-600 hover:text-blue-800">
              Show more ({tableRows.length - limit} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(RemarksAnalysis);
