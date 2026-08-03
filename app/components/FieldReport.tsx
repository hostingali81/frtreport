'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiAlertCircle, FiChevronDown, FiDownload, FiInfo, FiPrinter } from 'react-icons/fi';
import {
  CAPACITY_BANDS, CAPACITY_LABELS, CIRCLE, DATA_NOTES, DIVISIONS, MONTHS, PAIRED_METRICS,
  SURVEY_ROWS, WORK_ONLY_METRICS, WORK_ROWS,
  averageCompletion, divisionScorecard, divisionSeries, dtCoverage, dtPopulation,
  headlineTotals, metricTotals, monthlySeries, monthLabel, monthLabelLong, standaloneMonthly,
  type Division, type Slice
} from '../lib/fieldData';
import { CAT, GRID, INK, NEUTRAL, SURFACE, TOOLTIP, axisTicks, hairlineGrid, nfmt, stackEndLabels } from './chartTheme';
import { loadExcelJS } from '../utils/lazyImports';

// Field Work & Survey report for EDC-Barabanki.
//
// Built to be walked through in front of a senior officer, so the material is
// split into four views that each answer one question - rather than one long
// scroll. Raw returns stay available under "Source data" instead of sitting in
// the middle of the story.
//
// Encoding convention: work DONE is the accent hue, the survey REQUIREMENT is a
// neutral track behind or beside it. That is a target-vs-actual pair, not two
// categories, so it never consumes a categorical slot.
const DONE = CAT[0];
const TRACK = NEUTRAL;

// Sequential ramp (one hue, light -> dark) for the completion scorecard.
const RAMP = [
  { max: 25, bg: '#eaf1fb', fg: INK.primary, label: 'Under 25%' },
  { max: 50, bg: '#c3d9f2', fg: INK.primary, label: '25 – 50%' },
  { max: 75, bg: '#8ab6e4', fg: INK.primary, label: '50 – 75%' },
  { max: 99.949, bg: '#4f90d6', fg: '#ffffff', label: '75 – 99%' },
  { max: Infinity, bg: '#2a78d6', fg: '#ffffff', label: '100% or above' }
];
const rampFor = (pct: number) => RAMP.find((r) => pct <= r.max) ?? RAMP[RAMP.length - 1];

// Ordinal ramp for the three transformer capacity bands (small -> large).
const BAND_RAMP = ['#c3d9f2', '#6ba3de', '#2a78d6'];

/**
 * Snaps to a clean "100%" only for genuine rounding noise. Anything actually
 * above target keeps its real value - a division that delivered 123% of its LT
 * ABC requirement must not be flattened to 100%.
 */
const pctText = (p: number) => {
  if (p >= 99.95 && p <= 100.05) return '100%';
  return `${p.toFixed(p < 10 ? 1 : 0)}%`;
};

type View = 'overview' | 'activities' | 'divisions' | 'data';

const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'activities', label: 'Activities' },
  { id: 'divisions', label: 'Divisions & Network' },
  { id: 'data', label: 'Source Data' }
];

/**
 * Chart.js sizes the y-axis to its longest tick, so full activity names eat the
 * plot area on a phone - short names from the metric catalogue go in instead.
 */
function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return narrow;
}

/** Mounts a Chart.js chart and tears it down on every dependency change. */
function useChart(
  ref: React.RefObject<HTMLCanvasElement | null>,
  build: () => Record<string, unknown> | null,
  deps: unknown[]
) {
  const instance = useRef<{ destroy: () => void } | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { Chart } = await import('chart.js/auto');
      if (!mounted || !ref.current) return;
      const config = build();
      if (!config) return;
      instance.current?.destroy();
      instance.current = new Chart(ref.current, config as never) as unknown as { destroy: () => void };
    })();
    return () => {
      mounted = false;
      instance.current?.destroy();
      instance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// --- Presentational primitives ---------------------------------------------

function Panel({ title, hint, action, children }: {
  title?: string; hint?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
      {(title || action) && (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</h3>}
            {hint && <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{hint}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** A single bordered row of figures - reads far calmer than a grid of cards. */
function StatStrip({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <div className="grid grid-cols-2 divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
      {items.map((s) => (
        <div key={s.label} className="border-b border-slate-200 px-5 py-4 last:border-b-0 sm:border-b-0 lg:border-b-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">{s.label}</p>
          <p className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight text-slate-900">{s.value}</p>
          {s.sub && <p className="mt-1.5 text-[11px] text-slate-400">{s.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function FieldReport() {
  const [view, setView] = useState<View>('overview');
  const [selectedDivisions, setSelectedDivisions] = useState<Division[]>([...DIVISIONS]);
  const [fromMonth, setFromMonth] = useState<string>(MONTHS[0]);
  const [toMonth, setToMonth] = useState<string>(MONTHS[MONTHS.length - 1]);
  const [focusId, setFocusId] = useState<string>('tree');
  const [sortDesc, setSortDesc] = useState(true);
  const [rawSheet, setRawSheet] = useState<'survey' | 'work'>('survey');
  const [exporting, setExporting] = useState(false);
  const isNarrow = useIsNarrow();

  const slice: Slice = useMemo(() => {
    const lo = Math.min(MONTHS.indexOf(fromMonth as never), MONTHS.indexOf(toMonth as never));
    const hi = Math.max(MONTHS.indexOf(fromMonth as never), MONTHS.indexOf(toMonth as never));
    return {
      divisions: selectedDivisions.length ? selectedDivisions : [...DIVISIONS],
      months: MONTHS.slice(lo, hi + 1) as unknown as string[]
    };
  }, [selectedDivisions, fromMonth, toMonth]);

  const totals = useMemo(() => metricTotals(slice), [slice]);
  const head = useMemo(() => headlineTotals(slice), [slice]);
  const avg = useMemo(() => averageCompletion(slice), [slice]);
  const scorecard = useMemo(() => divisionScorecard(slice), [slice]);
  const focus = useMemo(() => PAIRED_METRICS.find((m) => m.id === focusId) ?? PAIRED_METRICS[0], [focusId]);

  const ranked = useMemo(
    () => [...totals.filter((t) => t.req > 0)].sort((a, b) => (sortDesc ? b.pct - a.pct : a.pct - b.pct)),
    [totals, sortDesc]
  );

  const allSelected = selectedDivisions.length === DIVISIONS.length;
  const monthCount = slice.months.length;
  const periodLabel = `${monthLabelLong(slice.months[0])} – ${monthLabelLong(slice.months[monthCount - 1])}`;

  const atTarget = ranked.filter((t) => t.pct >= 99.95).length;
  const laggards = ranked.filter((t) => t.pct < 75).length;
  const topGaps = useMemo(
    () => [...ranked].filter((t) => t.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 3),
    [ranked]
  );
  const rankedDivisions = useMemo(() => [...scorecard].sort((a, b) => b.average - a.average), [scorecard]);
  const best = rankedDivisions[0];
  const worst = rankedDivisions[rankedDivisions.length - 1];

  const dtPop = useMemo(() => dtPopulation(slice), [slice]);
  const dtCov = useMemo(() => dtCoverage(slice), [slice]);
  const dtTotal = dtPop.reduce((a, p) => a + p.total, 0);
  const bandTotals = CAPACITY_BANDS.map((_, i) => dtPop.reduce((a, p) => a + p.bands[i], 0));

  const toggleDivision = (d: Division) => {
    setSelectedDivisions((prev) => {
      if (prev.includes(d)) {
        const next = prev.filter((x) => x !== d);
        return next.length ? next : prev; // never allow an empty selection
      }
      return [...DIVISIONS].filter((x) => prev.includes(x) || x === d);
    });
  };

  // --- Overview: completion against survey, one row per activity ------------
  const completionRef = useRef<HTMLCanvasElement>(null);
  useChart(completionRef, () => ({
    type: 'bar',
    data: {
      labels: ranked.map((t) => (isNarrow ? t.metric.short : t.metric.label)),
      datasets: [
        {
          label: 'Work done',
          data: ranked.map((t) => Math.min(100, t.pct)),
          backgroundColor: DONE,
          borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 3, bottomRight: 3 },
          borderSkipped: false,
          barThickness: 14
        },
        {
          label: 'Pending against survey',
          data: ranked.map((t) => Math.max(0, 100 - Math.min(100, t.pct))),
          backgroundColor: TRACK,
          borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 3, bottomRight: 3 },
          borderSkipped: false,
          barThickness: 14
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 52 } },
      interaction: { mode: 'index', axis: 'y', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'rectRounded', color: INK.secondary, font: { size: 11 }, padding: 14 } },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            title: (items: { dataIndex: number }[]) => ranked[items[0].dataIndex]?.metric.label ?? '',
            label: (item: { dataIndex: number; datasetIndex: number }) => {
              const t = ranked[item.dataIndex];
              if (!t) return '';
              return item.datasetIndex === 0
                ? `${t.metric.doneLabel}: ${nfmt(t.done)} ${t.metric.unit}  (${pctText(t.pct)})`
                : `Balance: ${nfmt(t.gap)} of ${nfmt(t.req)} ${t.metric.unit} ${t.metric.reqLabel.toLowerCase()}`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true, min: 0, max: 100, grid: hairlineGrid, border: { display: false }, ticks: { ...axisTicks, callback: (v: number) => `${v}%` } },
        y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { ...axisTicks, autoSkip: false, crossAlign: 'far' } }
      }
    },
    // The value at the tip is this chart's relief for the low-contrast track -
    // and the number an officer reads off it.
    plugins: [{
      id: 'completionEndLabels',
      afterDatasetsDraw: (chart: { ctx: CanvasRenderingContext2D; getDatasetMeta: (i: number) => { data: { x: number; y: number }[] } }) => {
        const ctx = chart.ctx;
        chart.getDatasetMeta(1).data.forEach((bar, i) => {
          const t = ranked[i];
          if (!t) return;
          ctx.fillStyle = INK.primary;
          ctx.font = '600 12px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(pctText(t.pct), bar.x + 8, bar.y);
        });
      }
    }]
  }), [ranked, isNarrow, view]);

  // --- Activities: month by month for the focused activity ------------------
  const monthlyRef = useRef<HTMLCanvasElement>(null);
  const monthly = useMemo(() => monthlySeries(focus, slice), [focus, slice]);
  useChart(monthlyRef, () => {
    const datasets: Record<string, unknown>[] = [];
    if (!focus.periodReq) {
      datasets.push({
        label: `${focus.reqLabel} (survey)`,
        data: monthly.map((m) => m.req ?? 0),
        backgroundColor: TRACK,
        borderRadius: 3,
        borderSkipped: false,
        maxBarThickness: 20
      });
    }
    datasets.push({
      label: `${focus.doneLabel} (work)`,
      data: monthly.map((m) => m.done),
      backgroundColor: DONE,
      borderRadius: 3,
      borderSkipped: false,
      maxBarThickness: 20
    });
    return {
      type: 'bar',
      data: { labels: monthly.map((m) => monthLabel(m.month)), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: datasets.length > 1
            ? { position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'rectRounded', color: INK.secondary, font: { size: 11 }, padding: 14 } }
            : { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              label: (item: { dataset: { label: string }; parsed: { y: number } }) =>
                `${item.dataset.label}: ${nfmt(item.parsed.y)} ${focus.unit}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { color: GRID }, ticks: axisTicks },
          y: { beginAtZero: true, grid: hairlineGrid, border: { display: false }, ticks: { ...axisTicks, callback: (v: number) => nfmt(v) } }
        }
      }
    };
  }, [monthly, focus, view]);

  // --- Activities: division by division for the focused activity ------------
  const divisionRef = useRef<HTMLCanvasElement>(null);
  const byDivision = useMemo(() => divisionSeries(focus, slice), [focus, slice]);
  useChart(divisionRef, () => ({
    type: 'bar',
    data: {
      labels: byDivision.map((d) => d.division.replace('EDD-', '')),
      datasets: [
        {
          label: `${focus.reqLabel} (survey)`,
          data: byDivision.map((d) => d.req),
          backgroundColor: TRACK,
          borderRadius: 3,
          borderSkipped: false,
          barThickness: 12
        },
        {
          label: `${focus.doneLabel} (work)`,
          data: byDivision.map((d) => d.done),
          backgroundColor: DONE,
          borderRadius: 3,
          borderSkipped: false,
          barThickness: 12
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', axis: 'y', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'rectRounded', color: INK.secondary, font: { size: 11 }, padding: 14 } },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            title: (items: { dataIndex: number }[]) => byDivision[items[0].dataIndex]?.division ?? '',
            label: (item: { dataset: { label: string }; parsed: { x: number } }) =>
              `${item.dataset.label}: ${nfmt(item.parsed.x)} ${focus.unit}`,
            footer: (items: { dataIndex: number }[]) => {
              const d = byDivision[items[0].dataIndex];
              return d && d.req > 0 ? `Completion: ${pctText(d.pct)}` : '';
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, grid: hairlineGrid, border: { display: false }, ticks: { ...axisTicks, callback: (v: number) => nfmt(v) } },
        y: { grid: { display: false }, border: { display: false }, ticks: { ...axisTicks, autoSkip: false } }
      }
    }
  }), [byDivision, focus, view]);

  // --- Activities: work with no survey counterpart (small multiples) --------
  const oilRef = useRef<HTMLCanvasElement>(null);
  const damageRef = useRef<HTMLCanvasElement>(null);
  const jumperRef = useRef<HTMLCanvasElement>(null);
  const standaloneRefs = [oilRef, damageRef, jumperRef];
  const standaloneData = useMemo(
    () => WORK_ONLY_METRICS.map((m) => ({ metric: m, points: standaloneMonthly(m, slice) })),
    [slice]
  );
  useChart(oilRef, () => singleSeriesConfig(standaloneData[0]), [standaloneData, view]);
  useChart(damageRef, () => singleSeriesConfig(standaloneData[1]), [standaloneData, view]);
  useChart(jumperRef, () => singleSeriesConfig(standaloneData[2]), [standaloneData, view]);

  // --- Divisions & Network: installed DT population by capacity band --------
  const populationRef = useRef<HTMLCanvasElement>(null);
  useChart(populationRef, () => ({
    type: 'bar',
    data: {
      labels: dtPop.map((p) => p.division.replace('EDD-', '')),
      datasets: CAPACITY_BANDS.map((band, i) => ({
        label: `${band.label} (${band.range})`,
        data: dtPop.map((p) => p.bands[i]),
        // Capacity is an ordered scale, so an ordinal ramp - one hue, light to
        // dark - not categorical hues.
        backgroundColor: BAND_RAMP[i],
        borderRadius: 2,
        borderSkipped: false,
        borderWidth: 2,
        borderColor: SURFACE,
        barThickness: 18
      }))
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 60 } },
      interaction: { mode: 'index', axis: 'y', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'rectRounded', color: INK.secondary, font: { size: 11 }, padding: 14 } },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            title: (items: { dataIndex: number }[]) => {
              const p = dtPop[items[0].dataIndex];
              return p ? `${p.division} — ${nfmt(p.total)} DTs` : '';
            },
            label: (item: { dataset: { label: string }; parsed: { x: number } }) =>
              `${item.dataset.label}: ${nfmt(item.parsed.x)}`
          }
        }
      },
      scales: {
        x: { stacked: true, beginAtZero: true, grid: hairlineGrid, border: { display: false }, ticks: { ...axisTicks, callback: (v: number) => nfmt(v) } },
        y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { ...axisTicks, autoSkip: false } }
      }
    },
    plugins: [stackEndLabels]
  }), [dtPop, view]);

  const exportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { ExcelJS, saveAs } = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1E3A8A' } };
      const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };

      const summary = wb.addWorksheet('Summary');
      summary.addRow([`${CIRCLE} — Field Work & Survey Report`]);
      summary.addRow([`Period: ${periodLabel}  |  Divisions: ${slice.divisions.join(', ')}`]);
      summary.getRow(1).font = { bold: true, size: 13 };
      summary.addRow([]);
      const sh = summary.addRow(['Activity', 'Group', 'Unit', 'Required (survey)', 'Done (work)', 'Balance', 'Completion %']);
      sh.eachCell((c: { fill: unknown; font: unknown }) => { c.fill = headerFill; c.font = headerFont; });
      ranked.forEach((t) => {
        summary.addRow([t.metric.label, t.metric.group, t.metric.unit, t.req, t.done, t.gap, Number(t.pct.toFixed(1))]);
      });
      summary.columns = [{ width: 34 }, { width: 8 }, { width: 8 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 14 }];

      const surveyWs = wb.addWorksheet('Survey (Inspection)');
      const surveyHead = surveyWs.addRow([
        'Division', 'Month', 'DT Survey (Nos.)', 'Lug Required (Nos.)', 'Bushing Required (Nos.)',
        'Silica Gel Required (Kg)', 'Earthing Required', 'DT Lead Required (Mtr)',
        'Line Survey Done 33/11KV (KM)', 'Req. Tree Trimming 33+11KV (KM)', 'Req. 11KV Tree Trimming (KM)',
        'Req. 33KV Insulator (Nos.)', 'Req. 11KV Insulator (Nos.)', 'Req. Stay Set (Nos.)', 'Req. Pole Replacement'
      ]);
      surveyHead.eachCell((c: { fill: unknown; font: unknown }) => { c.fill = headerFill; c.font = headerFont; });
      SURVEY_ROWS.filter((r) => slice.divisions.includes(r.division) && slice.months.includes(r.month)).forEach((r) => {
        surveyWs.addRow([
          r.division, monthLabelLong(r.month), r.dtSurvey, r.lugReq, r.bushingReq, r.silicaReq,
          r.earthingReq, r.dtLeadReq, r.lineSurveyKm, r.treeTrimReq, r.trim11Req,
          r.ins33Req, r.ins11Req, r.stayReq, r.poleReq
        ]);
      });
      surveyWs.columns = Array.from({ length: 15 }, (_, i) => ({ width: i < 2 ? 22 : 16 }));

      const workWs = wb.addWorksheet('Maintenance (Work Done)');
      const workHead = workWs.addRow([
        'Division', 'Month', 'DT Maintenance (Nos.)', 'Lug Changed (Nos.)', 'Bushing Changed (Nos.)',
        'Silica Gel Replaced (Kg)', 'Oil Top-up (Ltr)', 'Earthing (Body/Neutral)', 'DT Lead Replacement (Mtr)',
        'Damage DT Replacement', '33KV Tree Trimming (KM)', '11KV Tree Trimming (KM)',
        '33KV Insulator Changed (Nos.)', '11KV Insulator Changed (Nos.)', 'LT ABC Cable Replaced (Mtr)',
        'Weasel Conductor (Mtr)', 'Stay Set (Nos.)', 'Jumper Repaired (Nos.)', 'Pole Replacement'
      ]);
      workHead.eachCell((c: { fill: unknown; font: unknown }) => { c.fill = headerFill; c.font = headerFont; });
      WORK_ROWS.filter((r) => slice.divisions.includes(r.division) && slice.months.includes(r.month)).forEach((r) => {
        workWs.addRow([
          r.division, monthLabelLong(r.month), r.dtMaint, r.lug, r.bushing, r.silica, r.oil,
          r.earthing, r.dtLead, r.damageDt, r.trim33, r.trim11, r.ins33, r.ins11,
          r.abc, r.weasel, r.stay, r.jumper, r.pole
        ]);
      });
      workWs.columns = Array.from({ length: 19 }, (_, i) => ({ width: i < 2 ? 22 : 16 }));

      const dtWs = wb.addWorksheet('DT Count');
      const dtHead = dtWs.addRow(['Division', ...CAPACITY_LABELS, 'Total DTs', 'Surveyed', 'Per 100 DTs', 'Maintained', 'Per 100 DTs']);
      dtHead.eachCell((c: { fill: unknown; font: unknown }) => { c.fill = headerFill; c.font = headerFont; });
      dtPop.forEach((p, i) => {
        const c = dtCov[i];
        dtWs.addRow([
          p.division, ...p.byCapacity, p.total,
          c.surveyed, Number(c.surveyedPer100.toFixed(1)),
          c.maintained, Number(c.maintainedPer100.toFixed(1))
        ]);
      });
      dtWs.addRow([
        'Circle total',
        ...CAPACITY_LABELS.map((_, i) => dtPop.reduce((a, p) => a + p.byCapacity[i], 0)),
        dtTotal, head.dtSurveyed,
        dtTotal > 0 ? Number(((head.dtSurveyed / dtTotal) * 100).toFixed(1)) : 0,
        head.dtMaintained,
        dtTotal > 0 ? Number(((head.dtMaintained / dtTotal) * 100).toFixed(1)) : 0
      ]).font = { bold: true };
      dtWs.columns = Array.from({ length: 15 }, (_, i) => ({ width: i === 0 ? 22 : 13 }));

      const notesWs = wb.addWorksheet('Data Notes');
      notesWs.addRow(['Note', 'Detail']).eachCell((c: { fill: unknown; font: unknown }) => { c.fill = headerFill; c.font = headerFont; });
      DATA_NOTES.forEach((n) => notesWs.addRow([n.title, n.body]));
      notesWs.columns = [{ width: 46 }, { width: 110 }];

      const buffer = await wb.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `Field_Work_Survey_Report_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-500">
      {/* Masthead */}
      <header className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 border-l-[3px] border-blue-600 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">{CIRCLE}</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">
              Field Work &amp; Survey Report
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              {periodLabel} · {slice.divisions.length} of {DIVISIONS.length} divisions · DT and Line inspection against maintenance carried out
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 print:hidden">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50 active:scale-95"
            >
              <FiPrinter /> Print
            </button>
            <button
              onClick={exportExcel}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-slate-800 active:scale-95 disabled:bg-slate-400"
            >
              <FiDownload /> {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
          </div>
        </div>

        {/* View switcher */}
        <nav className="flex gap-6 overflow-x-auto border-t border-slate-200 px-5 sm:px-6 print:hidden">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              aria-current={view === v.id ? 'page' : undefined}
              className={`-mb-px shrink-0 border-b-2 py-3 text-[13px] font-medium transition ${
                view === v.id
                  ? 'border-blue-600 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {v.label}
            </button>
          ))}
        </nav>
      </header>

      {/* One filter row scoping every view */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 lg:flex-row lg:items-center lg:justify-between print:hidden">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Division</span>
          {DIVISIONS.map((d) => {
            const on = selectedDivisions.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDivision(d)}
                className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition active:scale-95 ${
                  on
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white text-slate-400 hover:border-slate-400 hover:text-slate-600'
                }`}
              >
                {d.replace('EDD-', '')}
              </button>
            );
          })}
          {!allSelected && (
            <button
              type="button"
              onClick={() => setSelectedDivisions([...DIVISIONS])}
              className="ml-1 text-[12px] font-medium text-blue-700 underline-offset-2 transition hover:underline active:scale-95"
            >
              Select all
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Period</span>
          <select
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 focus:border-blue-500 focus:outline-none"
          >
            {MONTHS.map((m) => <option key={m} value={m}>{monthLabelLong(m)}</option>)}
          </select>
          <span className="text-slate-400">–</span>
          <select
            value={toMonth}
            onChange={(e) => setToMonth(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 focus:border-blue-500 focus:outline-none"
          >
            {MONTHS.map((m) => <option key={m} value={m}>{monthLabelLong(m)}</option>)}
          </select>
        </div>
      </div>

      {/* ------------------------------ OVERVIEW ------------------------------ */}
      {view === 'overview' && (
        <div className="flex flex-col gap-5">
          {/* Headline figure */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                  Overall completion against survey
                </p>
                <p className="mt-2 text-[64px] font-semibold leading-[0.95] tracking-tight text-slate-900 sm:text-[76px]">
                  {pctText(avg)}
                </p>
                <p className="mt-3 max-w-lg text-[13px] leading-relaxed text-slate-500">
                  Unweighted mean across {ranked.length} activities the inspection raised a requirement for.
                  Work beyond target counts as 100%, so over-delivery on one item never masks a shortfall on another.
                </p>
              </div>
              <div className="w-full lg:max-w-sm">
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, avg)}%`, backgroundColor: DONE }} />
                </div>
                <div className="mt-3 flex justify-between text-[12px]">
                  <span className="text-slate-500">
                    <b className="font-semibold text-slate-900">{atTarget}</b> of {ranked.length} fully closed
                  </span>
                  {laggards > 0 && (
                    <span className="text-slate-500">
                      <b className="font-semibold text-amber-700">{laggards}</b> below 75%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <StatStrip
            items={[
              { label: 'DTs surveyed', value: nfmt(head.dtSurveyed), sub: 'Nos.' },
              { label: 'DTs maintained', value: nfmt(head.dtMaintained), sub: head.dtSurveyed > 0 ? `${pctText((head.dtMaintained / head.dtSurveyed) * 100)} of surveyed` : 'Nos.' },
              { label: 'Line surveyed', value: nfmt(head.lineSurveyedKm), sub: 'KM · 33KV & 11KV' },
              { label: 'Tree trimming', value: nfmt(head.treeTrimmedKm), sub: 'KM · 33KV + 11KV' },
              { label: 'Installed DTs', value: nfmt(dtTotal), sub: 'transformers on ground' }
            ]}
          />

          <Panel
            title="Survey requirement vs work completed"
            hint="Every tracked activity as a share of what the inspection raised."
            action={
              <button
                onClick={() => setSortDesc((s) => !s)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50 active:scale-95 print:hidden"
              >
                <FiChevronDown className={sortDesc ? '' : 'rotate-180'} />
                {sortDesc ? 'Highest first' : 'Lowest first'}
              </button>
            }
          >
            <div style={{ height: `${ranked.length * 32 + 60}px` }}>
              <canvas ref={completionRef} />
            </div>
          </Panel>

          {/* The three things worth saying out loud */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Largest outstanding balance</p>
              {topGaps[0] ? (
                <>
                  <p className="mt-2 text-[17px] font-semibold tracking-tight text-slate-900">{topGaps[0].metric.short}</p>
                  <p className="mt-1 text-[13px] text-slate-500">
                    <b className="font-semibold text-amber-700">{nfmt(topGaps[0].gap)} {topGaps[0].metric.unit}</b> still open
                    of {nfmt(topGaps[0].req)} raised
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[15px] font-semibold text-emerald-700">Everything raised has been closed.</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Highest completion</p>
              {best && (
                <>
                  <p className="mt-2 text-[17px] font-semibold tracking-tight text-slate-900">{best.division.replace('EDD-', '')}</p>
                  <p className="mt-1 text-[13px] text-slate-500">
                    <b className="font-semibold text-emerald-700">{pctText(best.average)}</b> average across activities
                  </p>
                </>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Needs attention</p>
              {worst && (
                <>
                  <p className="mt-2 text-[17px] font-semibold tracking-tight text-slate-900">{worst.division.replace('EDD-', '')}</p>
                  <p className="mt-1 text-[13px] text-slate-500">
                    <b className="font-semibold text-amber-700">{pctText(worst.average)}</b> average across activities
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------- ACTIVITIES ----------------------------- */}
      {view === 'activities' && (
        <div className="flex flex-col gap-5">
          <Panel title="Activity summary" hint={`Requirement raised by the inspection against work delivered · ${periodLabel}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b border-slate-200 text-[11px] uppercase tracking-[0.06em] text-slate-500">
                  <tr>
                    <th className="py-2.5 pr-3 font-medium">Activity</th>
                    <th className="py-2.5 pr-3 font-medium">Unit</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Required</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Done</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Balance</th>
                    <th className="py-2.5 text-right font-medium">Completion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 [font-variant-numeric:tabular-nums]">
                  {ranked.map((t) => (
                    <tr key={t.metric.id} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-3 font-medium text-slate-900">
                        <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          t.metric.group === 'DT' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'
                        }`}>{t.metric.group}</span>
                        {t.metric.label}
                        {t.metric.periodScoped && <sup className="ml-1 text-[10px] font-semibold text-amber-600" title="Requirement is a period total, not monthly">†</sup>}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-400">{t.metric.unit}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-500">{nfmt(t.req)}</td>
                      <td className="py-2.5 pr-3 text-right font-medium text-slate-900">{nfmt(t.done)}</td>
                      <td className={`py-2.5 pr-3 text-right ${t.gap > 0 ? 'font-medium text-amber-700' : 'text-slate-300'}`}>{nfmt(t.gap)}</td>
                      <td className="py-2.5 text-right font-semibold text-slate-900">{pctText(t.pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ranked.some((t) => t.metric.periodScoped) && (
              <p className="mt-3 text-[11px] text-slate-500">
                † LT ABC Cable and Weasel Conductor requirements are recorded once for the whole period in the survey sheet, so they do not change with the period filter.
              </p>
            )}
          </Panel>

          <Panel
            title="Activity detail"
            hint="Pick one activity to see how it moved month to month and how it landed across divisions."
            action={
              <select
                value={focusId}
                onChange={(e) => setFocusId(e.target.value)}
                className="w-full max-w-[17rem] shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[13px] text-slate-700 focus:border-blue-500 focus:outline-none print:hidden"
              >
                <optgroup label="DT works">
                  {PAIRED_METRICS.filter((m) => m.group === 'DT').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </optgroup>
                <optgroup label="Line works">
                  {PAIRED_METRICS.filter((m) => m.group === 'Line').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </optgroup>
              </select>
            }
          >
            <div className="grid gap-6 xl:grid-cols-2">
              <div>
                <p className="mb-3 text-[12px] font-medium text-slate-600">Month by month <span className="text-slate-400">({focus.unit})</span></p>
                <div style={{ height: '280px' }}><canvas ref={monthlyRef} /></div>
                {focus.periodReq && (
                  <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-500">
                    <FiInfo className="mt-0.5 shrink-0" />
                    The survey sheet holds a single requirement for the entire period, so only work done is plotted by month.
                  </p>
                )}
              </div>
              <div>
                <p className="mb-3 text-[12px] font-medium text-slate-600">Division by division <span className="text-slate-400">({focus.unit})</span></p>
                <div style={{ height: '280px' }}><canvas ref={divisionRef} /></div>
              </div>
            </div>
          </Panel>

          <Panel
            title="Additional maintenance carried out"
            hint="Activities the maintenance return records but the inspection raises no requirement for — reported as volume delivered."
          >
            <div className="grid gap-6 md:grid-cols-3">
              {standaloneData.map((s, i) => (
                <div key={s.metric.id}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <p className="text-[12px] font-medium text-slate-600">{s.metric.label}</p>
                    <p className="text-[15px] font-semibold text-slate-900">
                      {nfmt(s.points.reduce((a, p) => a + p.value, 0))} <span className="text-[11px] font-normal text-slate-400">{s.metric.unit}</span>
                    </p>
                  </div>
                  <div style={{ height: '150px' }}><canvas ref={standaloneRefs[i]} /></div>
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-slate-100 pt-4 text-[12px] text-slate-500">
              The survey side has one such column too — <span className="font-medium text-slate-700">Line surveyed (33KV &amp; 11KV): {nfmt(head.lineSurveyedKm)} KM</span> — with no matching &ldquo;work done&rdquo; column, so it is reported as inspection coverage rather than a completion rate.
            </p>
          </Panel>
        </div>
      )}

      {/* ------------------------- DIVISIONS & NETWORK ------------------------- */}
      {view === 'divisions' && (
        <div className="flex flex-col gap-5">
          <Panel
            title="Division scorecard"
            hint="Completion against survey for every activity, ranked by average. Darker means more of the raised requirement was closed."
          >
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-500">
              {RAMP.map((r) => (
                <span key={r.label} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-4 rounded-sm" style={{ backgroundColor: r.bg }} />
                  {r.label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-4 rounded-sm bg-slate-100" />
                No requirement
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-separate border-spacing-0.5 text-[13px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">Division</th>
                    {PAIRED_METRICS.map((m) => (
                      <th key={m.id} className="px-1 py-2 text-center align-bottom text-[10px] font-medium leading-tight text-slate-500">
                        <span className={`mb-1 block text-[8px] font-semibold uppercase tracking-wider ${m.group === 'DT' ? 'text-blue-400' : 'text-slate-300'}`}>
                          {m.group}
                        </span>
                        {m.short}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedDivisions.map((row, rank) => (
                    <tr key={row.division}>
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-2 font-medium text-slate-900">
                        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">{rank + 1}</span>
                        {row.division.replace('EDD-', '')}
                      </td>
                      {row.cells.map((c) => {
                        const step = rampFor(c.pct);
                        return (
                          <td
                            key={c.id}
                            className="rounded px-1 py-2 text-center text-[11px] font-semibold [font-variant-numeric:tabular-nums]"
                            style={c.req > 0 ? { backgroundColor: step.bg, color: step.fg } : { backgroundColor: '#f1f5f9', color: '#94a3b8' }}
                            title={`${row.division} · ${PAIRED_METRICS.find((m) => m.id === c.id)?.label}: ${nfmt(c.done)} of ${nfmt(c.req)}`}
                          >
                            {c.req > 0 ? pctText(c.pct) : '—'}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right">
                        <span className="font-semibold text-slate-900 [font-variant-numeric:tabular-nums]">{pctText(row.average)}</span>
                        <span className="mt-1 block h-1 w-full overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
                          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, row.average)}%`, backgroundColor: DONE }} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Installed DT population" hint="Transformers on the ground, by division and capacity.">
            <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-4">
              {[
                { label: 'Total DTs', value: nfmt(dtTotal), sub: `across ${dtPop.length} division(s)` },
                ...CAPACITY_BANDS.map((band, i) => ({
                  label: `${band.label} capacity`,
                  value: nfmt(bandTotals[i]),
                  sub: `${band.range} · ${dtTotal > 0 ? Math.round((bandTotals[i] / dtTotal) * 100) : 0}%`
                }))
              ].map((t) => (
                <div key={t.label} className="bg-white px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">{t.label}</p>
                  <p className="mt-1 text-[20px] font-semibold leading-none tracking-tight text-slate-900">{t.value}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{t.sub}</p>
                </div>
              ))}
            </div>

            <div style={{ height: `${dtPop.length * 42 + 80}px` }}>
              <canvas ref={populationRef} />
            </div>

            {/* The chart shows three bands; the table carries all nine columns. */}
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-[0.06em] text-slate-500">Division</th>
                    {CAPACITY_LABELS.map((c) => (
                      <th key={c} className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.06em] text-slate-500">{c}</th>
                    ))}
                    <th className="px-2 py-2 text-right text-[10px] font-medium uppercase tracking-[0.06em] text-slate-500">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 [font-variant-numeric:tabular-nums]">
                  {dtPop.map((p) => (
                    <tr key={p.division} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-900">{p.division.replace('EDD-', '')}</td>
                      {p.byCapacity.map((n, i) => (
                        <td key={CAPACITY_LABELS[i]} className={`px-2 py-2 text-right ${n === 0 ? 'text-slate-300' : 'text-slate-600'}`}>{nfmt(n)}</td>
                      ))}
                      <td className="px-2 py-2 text-right font-semibold text-slate-900">{nfmt(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200">
                  <tr className="[font-variant-numeric:tabular-nums]">
                    <td className="px-2 py-2 text-left text-[12px] font-semibold text-slate-900">Circle total</td>
                    {CAPACITY_LABELS.map((c, i) => (
                      <td key={c} className="px-2 py-2 text-right text-[12px] font-semibold text-slate-900">
                        {nfmt(dtPop.reduce((a, p) => a + p.byCapacity[i], 0))}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right text-[12px] font-semibold text-slate-900">{nfmt(dtTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <Panel title="Field work against the installed base" hint="How much DT work the period delivered per 100 transformers on the ground.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-[13px]">
                <thead className="border-b border-slate-200 text-[11px] uppercase tracking-[0.06em] text-slate-500">
                  <tr>
                    <th className="py-2.5 pr-3 font-medium">Division</th>
                    <th className="py-2.5 pr-3 text-right font-medium">DTs installed</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Surveyed</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Per 100 DTs</th>
                    <th className="py-2.5 pr-3 text-right font-medium">Maintained</th>
                    <th className="py-2.5 text-right font-medium">Per 100 DTs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 [font-variant-numeric:tabular-nums]">
                  {dtCov.map((c) => (
                    <tr key={c.division} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-3 font-medium text-slate-900">{c.division.replace('EDD-', '')}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-500">{nfmt(c.population)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{nfmt(c.surveyed)}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-slate-900">{c.surveyedPer100.toFixed(1)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{nfmt(c.maintained)}</td>
                      <td className="py-2.5 text-right font-semibold text-slate-900">{c.maintainedPer100.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200">
                  <tr className="[font-variant-numeric:tabular-nums] text-[12px] font-semibold text-slate-900">
                    <td className="py-2.5 pr-3">Circle</td>
                    <td className="py-2.5 pr-3 text-right">{nfmt(dtTotal)}</td>
                    <td className="py-2.5 pr-3 text-right">{nfmt(head.dtSurveyed)}</td>
                    <td className="py-2.5 pr-3 text-right">{dtTotal > 0 ? ((head.dtSurveyed / dtTotal) * 100).toFixed(1) : '—'}</td>
                    <td className="py-2.5 pr-3 text-right">{nfmt(head.dtMaintained)}</td>
                    <td className="py-2.5 text-right">{dtTotal > 0 ? ((head.dtMaintained / dtTotal) * 100).toFixed(1) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-[11px] text-slate-500">
              <FiInfo className="mt-0.5 shrink-0" />
              A job rate, not a coverage percentage — the DT count has no month dimension, so a transformer attended in two different months counts twice.
            </p>
          </Panel>
        </div>
      )}

      {/* ----------------------------- SOURCE DATA ----------------------------- */}
      {view === 'data' && (
        <div className="flex flex-col gap-5">
          <Panel
            title="Monthly return, as recorded"
            hint={`${slice.divisions.length * monthCount} rows for the current filter. Use Export Excel for the complete workbook.`}
            action={
              <div className="inline-flex shrink-0 rounded-lg border border-slate-200 p-0.5 print:hidden">
                {(['survey', 'work'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setRawSheet(k)}
                    className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition active:scale-95 ${
                      rawSheet === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {k === 'survey' ? 'Survey / Inspection' : 'Maintenance / Work done'}
                  </button>
                ))}
              </div>
            }
          >
            <div className="max-h-[30rem] overflow-auto rounded-lg border border-slate-100 print:max-h-none print:overflow-visible">
              {rawSheet === 'survey' ? <SurveyTable slice={slice} /> : <WorkTable slice={slice} />}
            </div>
            {rawSheet === 'survey' && (
              <p className="mt-3 text-[11px] text-slate-500">
                ‡ Shown as recorded. This column exceeds the combined 33+11KV tree-trimming requirement in four of the five divisions, so it is not used in any completion figure.
              </p>
            )}
          </Panel>

          <Panel title="How to read these figures" hint="Caveats the source sheets imply but never state.">
            <ul className="space-y-4">
              {DATA_NOTES.map((n, i) => (
                <li key={n.title} className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-50 text-[11px] font-semibold text-amber-700">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-slate-900">{n.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{n.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-5 flex items-start gap-1.5 border-t border-slate-100 pt-4 text-[11px] text-slate-500">
              <FiAlertCircle className="mt-0.5 shrink-0" />
              Figures come straight from Key-Point.xlsx and DT-Count.xlsx; every cell is re-verified against those workbooks on each build.
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}

/** Column chart for an activity with no requirement to compare against. */
function singleSeriesConfig(entry: { metric: { label: string; unit: string }; points: { month: string; value: number }[] } | undefined) {
  if (!entry) return null;
  return {
    type: 'bar',
    data: {
      labels: entry.points.map((p) => monthLabel(p.month)),
      datasets: [{
        label: entry.metric.label,
        data: entry.points.map((p) => p.value),
        backgroundColor: DONE,
        borderRadius: 3,
        borderSkipped: false,
        maxBarThickness: 18
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: { label: (item: { parsed: { y: number } }) => `${nfmt(item.parsed.y)} ${entry.metric.unit}` }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { color: GRID }, ticks: { ...axisTicks, font: { size: 10 } } },
        y: { beginAtZero: true, grid: hairlineGrid, border: { display: false }, ticks: { ...axisTicks, font: { size: 10 }, maxTicksLimit: 4, callback: (v: number) => nfmt(v) } }
      }
    }
  };
}

// Header and totals stay put while the capped table body scrolls.
const thSticky = 'sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-white px-2 py-2 text-[10px] font-medium uppercase leading-tight tracking-[0.06em] text-slate-500';
const tdFoot = 'sticky bottom-0 whitespace-nowrap border-t-2 border-slate-200 bg-slate-50 px-2 py-2 text-[12px] font-semibold text-slate-900 [font-variant-numeric:tabular-nums]';
const td = 'whitespace-nowrap px-2 py-1.5 text-right text-slate-600 [font-variant-numeric:tabular-nums]';

function SurveyTable({ slice }: { slice: Slice }) {
  const rows = SURVEY_ROWS.filter((r) => slice.divisions.includes(r.division) && slice.months.includes(r.month));
  const cols = [
    ['DT Survey', 'dtSurvey'], ['Lug Req.', 'lugReq'], ['Bushing Req.', 'bushingReq'],
    ['Silica Gel Req. (Kg)', 'silicaReq'], ['Earthing Req.', 'earthingReq'], ['DT Lead Req. (Mtr)', 'dtLeadReq'],
    ['Line Survey (KM)', 'lineSurveyKm'], ['Tree Trim Req. (KM)', 'treeTrimReq'], ['11KV Tree Trim Req. (KM) ‡', 'trim11Req'],
    ['33KV Insulator Req.', 'ins33Req'], ['11KV Insulator Req.', 'ins11Req'], ['Stay Set Req.', 'stayReq'], ['Pole Req.', 'poleReq']
  ] as const;
  const total = (key: string) => rows.reduce((a, r) => a + (r[key as keyof typeof r] as number), 0);

  return (
    <table className="w-full min-w-[1100px] border-collapse text-[13px]">
      <thead>
        <tr>
          <th className={`${thSticky} text-left`}>Division</th>
          <th className={`${thSticky} text-left`}>Month</th>
          {cols.map(([label]) => <th key={label} className={`${thSticky} text-right`}>{label}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={`${r.division}|${r.month}`} className="hover:bg-slate-50">
            <td className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-900">{r.division.replace('EDD-', '')}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-slate-400">{monthLabel(r.month)}</td>
            {cols.map(([label, key]) => <td key={label} className={td}>{nfmt(r[key] as number)}</td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className={`${tdFoot} text-left`} colSpan={2}>Total</td>
          {cols.map(([label, key]) => <td key={label} className={`${tdFoot} text-right`}>{nfmt(total(key))}</td>)}
        </tr>
      </tfoot>
    </table>
  );
}

function WorkTable({ slice }: { slice: Slice }) {
  const rows = WORK_ROWS.filter((r) => slice.divisions.includes(r.division) && slice.months.includes(r.month));
  const cols = [
    ['DT Maint.', 'dtMaint'], ['Lug', 'lug'], ['Bushing', 'bushing'], ['Silica Gel (Kg)', 'silica'],
    ['Oil Top-up (Ltr)', 'oil'], ['Earthing', 'earthing'], ['DT Lead (Mtr)', 'dtLead'], ['Damaged DT', 'damageDt'],
    ['33KV Trim (KM)', 'trim33'], ['11KV Trim (KM)', 'trim11'], ['33KV Insulator', 'ins33'], ['11KV Insulator', 'ins11'],
    ['LT ABC (Mtr)', 'abc'], ['Weasel (Mtr)', 'weasel'], ['Stay Set', 'stay'], ['Jumper', 'jumper'], ['Pole', 'pole']
  ] as const;
  const total = (key: string) => rows.reduce((a, r) => a + (r[key as keyof typeof r] as number), 0);

  return (
    <table className="w-full min-w-[1300px] border-collapse text-[13px]">
      <thead>
        <tr>
          <th className={`${thSticky} text-left`}>Division</th>
          <th className={`${thSticky} text-left`}>Month</th>
          {cols.map(([label]) => <th key={label} className={`${thSticky} text-right`}>{label}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={`${r.division}|${r.month}`} className="hover:bg-slate-50">
            <td className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-900">{r.division.replace('EDD-', '')}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-slate-400">{monthLabel(r.month)}</td>
            {cols.map(([label, key]) => <td key={label} className={td}>{nfmt(r[key] as number)}</td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className={`${tdFoot} text-left`} colSpan={2}>Total</td>
          {cols.map(([label, key]) => <td key={label} className={`${tdFoot} text-right`}>{nfmt(total(key))}</td>)}
        </tr>
      </tfoot>
    </table>
  );
}

export default React.memo(FieldReport);
