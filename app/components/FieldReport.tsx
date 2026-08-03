'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiAlertCircle, FiAward, FiChevronDown, FiDownload, FiInfo, FiPrinter, FiScissors, FiSearch, FiTool, FiZap } from 'react-icons/fi';
import {
  CIRCLE, DATA_NOTES, DIVISIONS, MONTHS, PAIRED_METRICS,
  SURVEY_ROWS, WORK_ONLY_METRICS, WORK_ROWS,
  averageCompletion, divisionScorecard, divisionSeries, headlineTotals,
  metricTotals, monthlySeries, monthLabel, monthLabelLong, standaloneMonthly,
  type Division, type Slice
} from '../lib/fieldData';
import { CAT, GRID, INK, NEUTRAL, TOOLTIP, axisTicks, hairlineGrid, nfmt } from './chartTheme';
import { loadExcelJS } from '../utils/lazyImports';

// Field Work & Survey report for EDC-Barabanki. Unlike the other analytics tabs
// this one is not driven by complaint stats at all - it renders the monthly
// DT/Line inspection and maintenance return (app/lib/fieldData.ts), so it owns
// its own division/month filter.
//
// Encoding convention across every chart here: work DONE is the accent hue,
// the survey REQUIREMENT is a neutral track behind/beside it. That is a
// target-vs-actual pair, not two categories, so it never eats a categorical slot.
const DONE = CAT[0];
const TRACK = NEUTRAL;

// Sequential ramp (one hue, light -> dark) for the completion scorecard. Bins
// rather than a continuous scale so adjacent classes stay distinguishable.
const RAMP = [
  { max: 25, bg: '#eaf1fb', fg: INK.primary, label: 'Under 25%' },
  { max: 50, bg: '#c3d9f2', fg: INK.primary, label: '25 – 50%' },
  { max: 75, bg: '#8ab6e4', fg: INK.primary, label: '50 – 75%' },
  { max: 99.949, bg: '#4f90d6', fg: '#ffffff', label: '75 – 99%' },
  { max: Infinity, bg: '#2a78d6', fg: '#ffffff', label: '100% or above' }
];
const rampFor = (pct: number) => RAMP.find((r) => pct <= r.max) ?? RAMP[RAMP.length - 1];

/**
 * Snaps to a clean "100%" only for genuine rounding noise. Anything actually
 * above target keeps its real value - a division that delivered 123% of its LT
 * ABC requirement must not be flattened to 100%.
 */
const pctText = (p: number) => {
  if (p >= 99.95 && p <= 100.05) return '100%';
  return `${p.toFixed(p < 10 ? 1 : 0)}%`;
};

/**
 * Tracks the narrow breakpoint. Chart.js sizes the y-axis to its longest tick,
 * so full activity names eat the plot area on a phone - the short names from the
 * metric catalogue go in instead (the tooltip and the table keep the full name).
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

function Card({ title, subtitle, children, className = '' }: {
  title: string; subtitle?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      <header className="mb-4">
        <h3 className="text-sm font-bold text-gray-900 sm:text-base">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function FieldReport() {
  const [selectedDivisions, setSelectedDivisions] = useState<Division[]>([...DIVISIONS]);
  const [fromMonth, setFromMonth] = useState<string>(MONTHS[0]);
  const [toMonth, setToMonth] = useState<string>(MONTHS[MONTHS.length - 1]);
  const [focusId, setFocusId] = useState<string>('tree');
  const [sortDesc, setSortDesc] = useState(true);
  const [rawSheet, setRawSheet] = useState<'survey' | 'work'>('survey');
  const [showNotes, setShowNotes] = useState(false);
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

  const ranked = useMemo(() => {
    const rows = totals.filter((t) => t.req > 0);
    return [...rows].sort((a, b) => (sortDesc ? b.pct - a.pct : a.pct - b.pct));
  }, [totals, sortDesc]);

  const laggards = useMemo(() => ranked.filter((t) => t.pct < 75).length, [ranked]);
  const monthCount = slice.months.length;
  const periodLabel = `${monthLabelLong(slice.months[0])} – ${monthLabelLong(slice.months[monthCount - 1])}`;

  const toggleDivision = (d: Division) => {
    setSelectedDivisions((prev) => {
      if (prev.includes(d)) {
        const next = prev.filter((x) => x !== d);
        return next.length ? next : prev; // never allow an empty selection
      }
      return [...DIVISIONS].filter((x) => prev.includes(x) || x === d);
    });
  };

  // --- Chart 1: completion against survey, one row per activity -------------
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
          borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
          borderSkipped: false,
          barThickness: 16
        },
        {
          label: 'Pending against survey',
          data: ranked.map((t) => Math.max(0, 100 - Math.min(100, t.pct))),
          backgroundColor: TRACK,
          borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
          borderSkipped: false,
          barThickness: 16
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
        legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', color: INK.secondary, font: { size: 11 } } },
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
          ctx.font = '700 12px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(pctText(t.pct), bar.x + 8, bar.y);
        });
      }
    }]
  }), [ranked, isNarrow]);

  // --- Chart 2: month-by-month for the focused activity ---------------------
  const monthlyRef = useRef<HTMLCanvasElement>(null);
  const monthly = useMemo(() => monthlySeries(focus, slice), [focus, slice]);
  useChart(monthlyRef, () => {
    const datasets: Record<string, unknown>[] = [];
    if (!focus.periodReq) {
      datasets.push({
        label: `${focus.reqLabel} (survey)`,
        data: monthly.map((m) => m.req ?? 0),
        backgroundColor: TRACK,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 24
      });
    }
    datasets.push({
      label: `${focus.doneLabel} (work)`,
      data: monthly.map((m) => m.done),
      backgroundColor: DONE,
      borderRadius: 4,
      borderSkipped: false,
      maxBarThickness: 24
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
            ? { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', color: INK.secondary, font: { size: 11 } } }
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
  }, [monthly, focus]);

  // --- Chart 3: division-by-division for the focused activity ---------------
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
          borderRadius: 4,
          borderSkipped: false,
          barThickness: 14
        },
        {
          label: `${focus.doneLabel} (work)`,
          data: byDivision.map((d) => d.done),
          backgroundColor: DONE,
          borderRadius: 4,
          borderSkipped: false,
          barThickness: 14
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', axis: 'y', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', color: INK.secondary, font: { size: 11 } } },
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
  }), [byDivision, focus]);

  // --- Charts 4-6: activities with no survey requirement (small multiples) --
  const oilRef = useRef<HTMLCanvasElement>(null);
  const damageRef = useRef<HTMLCanvasElement>(null);
  const jumperRef = useRef<HTMLCanvasElement>(null);
  const standaloneRefs = [oilRef, damageRef, jumperRef];

  const standaloneData = useMemo(
    () => WORK_ONLY_METRICS.map((m) => ({ metric: m, points: standaloneMonthly(m, slice) })),
    [slice]
  );

  useChart(oilRef, () => singleSeriesConfig(standaloneData[0]), [standaloneData]);
  useChart(damageRef, () => singleSeriesConfig(standaloneData[1]), [standaloneData]);
  useChart(jumperRef, () => singleSeriesConfig(standaloneData[2]), [standaloneData]);

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
        summary.addRow([
          t.metric.label, t.metric.group, t.metric.unit,
          t.req, t.done, t.gap, Number(t.pct.toFixed(1))
        ]);
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

  const kpis = [
    { label: 'DTs surveyed', value: head.dtSurveyed, unit: 'Nos.', icon: <FiSearch />, context: 'inspection coverage' },
    {
      label: 'DTs maintained', value: head.dtMaintained, unit: 'Nos.', icon: <FiTool />,
      context: head.dtSurveyed > 0 ? `${pctText((head.dtMaintained / head.dtSurveyed) * 100)} of surveyed` : undefined
    },
    { label: 'Line surveyed', value: head.lineSurveyedKm, unit: 'KM', icon: <FiSearch />, context: '33KV & 11KV' },
    { label: 'Tree trimming done', value: head.treeTrimmedKm, unit: 'KM', icon: <FiScissors />, context: '33KV + 11KV combined' },
    { label: 'Damaged DTs replaced', value: head.damagedDtReplaced, unit: 'Nos.', icon: <FiZap />, context: 'no survey requirement' },
    { label: 'Jumpers repaired', value: head.jumperRepaired, unit: 'Nos.', icon: <FiZap />, context: 'no survey requirement' }
  ];

  const atTarget = ranked.filter((t) => t.pct >= 99.95).length;
  const topGaps = [...ranked].filter((t) => t.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 3);
  const rankedDivisions = [...scorecard].sort((a, b) => b.average - a.average);
  const best = rankedDivisions[0];
  const worst = rankedDivisions[rankedDivisions.length - 1];

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-500">
      {/* Report cover strip - the first thing on screen and on a printout */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3.5">
            <span className="rounded-lg bg-white/10 p-2.5 text-white ring-1 ring-white/15"><FiTool className="text-xl" /></span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{CIRCLE}</p>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight text-white sm:text-2xl">Field Work &amp; Survey Report</h2>
              <p className="mt-1 text-sm text-slate-300">DT and Line inspection against maintenance carried out</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10 active:scale-95"
            >
              <FiPrinter /> Print
            </button>
            <button
              onClick={exportExcel}
              disabled={exporting}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95 disabled:bg-slate-600"
            >
              <FiDownload /> {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 sm:grid-cols-4">
          {[
            ['Period', periodLabel],
            ['Divisions', `${slice.divisions.length} of ${DIVISIONS.length}`],
            ['Months', String(monthCount)],
            ['Activities tracked', `${PAIRED_METRICS.length} paired + ${WORK_ONLY_METRICS.length} standalone`]
          ].map(([k, v]) => (
            <div key={k} className="bg-slate-900 px-5 py-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-white">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* One filter row scoping every chart and table below it */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm print:hidden">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Division</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedDivisions([...DIVISIONS])}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
                  selectedDivisions.length === DIVISIONS.length ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All ({DIVISIONS.length})
              </button>
              {DIVISIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => toggleDivision(d)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
                    selectedDivisions.includes(d) && selectedDivisions.length !== DIVISIONS.length
                      ? 'bg-blue-600 text-white'
                      : selectedDivisions.includes(d)
                        ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                  }`}
                >
                  {d.replace('EDD-', '')}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">From</span>
              <select
                value={fromMonth}
                onChange={(e) => setFromMonth(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {MONTHS.map((m) => <option key={m} value={m}>{monthLabelLong(m)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">To</span>
              <select
                value={toMonth}
                onChange={(e) => setToMonth(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {MONTHS.map((m) => <option key={m} value={m}>{monthLabelLong(m)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Activity focus</span>
              <select
                value={focusId}
                onChange={(e) => setFocusId(e.target.value)}
                className="w-full max-w-[16rem] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <optgroup label="DT works">
                  {PAIRED_METRICS.filter((m) => m.group === 'DT').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </optgroup>
                <optgroup label="Line works">
                  {PAIRED_METRICS.filter((m) => m.group === 'Line').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </optgroup>
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Headline: one hero figure + the raw volumes behind it */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Average completion against survey</p>
          <p className="mt-1 text-5xl font-bold leading-none text-gray-900">{pctText(avg)}</p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, avg)}%`, backgroundColor: DONE }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800">
              {atTarget} of {ranked.length} at 100%
            </span>
            {laggards > 0 && (
              <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
                {laggards} below 75%
              </span>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
            Unweighted mean across {ranked.length} activities the survey raised a requirement for.
            Work beyond target counts as 100%, so over-delivery on one item never masks a shortfall on another.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-2">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k.label}</p>
                <span className="shrink-0 text-gray-300">{k.icon}</span>
              </div>
              <p className="mt-1 text-2xl font-bold text-gray-900">{nfmt(k.value)}</p>
              <p className="text-[11px] text-gray-400">
                {k.unit}{k.context && <> · {k.context}</>}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* What an officer acts on: the biggest shortfalls and the standings */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-bold text-gray-900">Largest outstanding balances</h3>
          <p className="mt-0.5 text-xs text-gray-500">Where the survey raised the most work that is still open.</p>
          {topGaps.length === 0 ? (
            <p className="mt-4 text-sm font-semibold text-emerald-700">Every raised requirement has been closed.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {topGaps.map((t) => (
                <li key={t.metric.id} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm font-semibold text-gray-900" title={t.metric.label}>
                    {t.metric.short}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
                    <span className="block h-full rounded-full" style={{ width: `${Math.min(100, t.pct)}%`, backgroundColor: DONE }} />
                  </span>
                  <span className="w-32 shrink-0 text-right text-xs text-gray-500 [font-variant-numeric:tabular-nums]">
                    <b className="text-amber-700">{nfmt(t.gap)}</b> {t.metric.unit} left
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-900"><FiAward className="text-gray-400" /> Division standings</h3>
          {best && worst && (
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Highest completion</dt>
                <dd className="mt-0.5 font-bold text-gray-900">
                  {best.division.replace('EDD-', '')} <span className="text-emerald-700">{pctText(best.average)}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Needs attention</dt>
                <dd className="mt-0.5 font-bold text-gray-900">
                  {worst.division.replace('EDD-', '')} <span className="text-amber-700">{pctText(worst.average)}</span>
                </dd>
              </div>
            </dl>
          )}
          <p className="mt-3 text-[11px] text-gray-500">Full breakdown in the division scorecard below.</p>
        </div>
      </div>

      {/* Hero chart */}
      <Card
        title="Survey requirement vs work completed"
        subtitle={`Every tracked activity as a share of what the inspection raised · ${slice.divisions.length} division(s) · ${monthCount} month(s)`}
      >
        <div className="mb-3 flex justify-end print:hidden">
          <button
            onClick={() => setSortDesc((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 active:scale-95"
          >
            <FiChevronDown className={sortDesc ? '' : 'rotate-180'} />
            {sortDesc ? 'Highest completion first' : 'Needs attention first'}
          </button>
        </div>
        <div style={{ height: `${ranked.length * 34 + 70}px` }}>
          <canvas ref={completionRef} />
        </div>

        {/* Table view twin - every plotted value is readable without the chart */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="py-2 pr-3 font-semibold">Activity</th>
                <th className="py-2 pr-3 font-semibold">Unit</th>
                <th className="py-2 pr-3 text-right font-semibold">Required</th>
                <th className="py-2 pr-3 text-right font-semibold">Done</th>
                <th className="py-2 pr-3 text-right font-semibold">Balance</th>
                <th className="py-2 text-right font-semibold">Completion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 [font-variant-numeric:tabular-nums]">
              {ranked.map((t) => (
                <tr key={t.metric.id} className="hover:bg-blue-50/40">
                  <td className="py-2 pr-3 font-semibold text-gray-900">
                    <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      t.metric.group === 'DT' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>{t.metric.group}</span>
                    {t.metric.label}
                    {t.metric.periodScoped && <sup className="ml-1 text-[10px] font-bold text-amber-600" title="Requirement is a period total, not monthly">†</sup>}
                  </td>
                  <td className="py-2 pr-3 text-gray-500">{t.metric.unit}</td>
                  <td className="py-2 pr-3 text-right text-gray-600">{nfmt(t.req)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-gray-900">{nfmt(t.done)}</td>
                  <td className={`py-2 pr-3 text-right ${t.gap > 0 ? 'font-semibold text-amber-700' : 'text-gray-400'}`}>{nfmt(t.gap)}</td>
                  <td className="py-2 text-right font-bold text-gray-900">{pctText(t.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ranked.some((t) => t.metric.periodScoped) && (
            <p className="mt-2 text-[11px] text-gray-500">
              † LT ABC Cable and Weasel Conductor requirements are recorded once for the whole period in the survey sheet, so they do not change with the month filter.
            </p>
          )}
        </div>
      </Card>

      {/* Focused activity: by month and by division */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title={`${focus.label} — month by month`} subtitle={`${focus.unit} · ${slice.divisions.length} division(s) selected`}>
          <div style={{ height: '320px' }}><canvas ref={monthlyRef} /></div>
          {focus.periodReq && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-gray-500">
              <FiInfo className="mt-0.5 shrink-0" />
              The survey sheet holds a single {focus.label.toLowerCase()} requirement for the entire period, so only work done is plotted by month.
            </p>
          )}
        </Card>
        <Card title={`${focus.label} — division by division`} subtitle={`${focus.unit} · ${periodLabel}`}>
          <div style={{ height: '320px' }}><canvas ref={divisionRef} /></div>
        </Card>
      </div>

      {/* Division scorecard */}
      <Card
        title="Division scorecard"
        subtitle="Completion against survey for every activity, ranked by average. Darker means more of the raised requirement was closed."
      >
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
          <span className="font-semibold uppercase tracking-wide">Completion</span>
          {RAMP.map((r) => (
            <span key={r.label} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-5 rounded-sm" style={{ backgroundColor: r.bg }} />
              {r.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded-sm bg-gray-100" />
            No requirement
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0.5 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Division</th>
                {PAIRED_METRICS.map((m) => (
                  <th key={m.id} className="px-1 py-2 text-center align-bottom text-[10px] font-semibold leading-tight text-gray-500">
                    <span className={`mb-1 block text-[8px] font-bold uppercase tracking-wider ${m.group === 'DT' ? 'text-blue-400' : 'text-gray-300'}`}>
                      {m.group}
                    </span>
                    {m.short}
                  </th>
                ))}
                <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Average</th>
              </tr>
            </thead>
            <tbody>
              {rankedDivisions.map((row, rank) => (
                <tr key={row.division}>
                  <td className="sticky left-0 z-10 bg-white px-2 py-2 font-semibold text-gray-900">
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500">{rank + 1}</span>
                    {row.division.replace('EDD-', '')}
                  </td>
                  {row.cells.map((c) => {
                    const step = rampFor(c.pct);
                    return (
                      <td
                        key={c.id}
                        className="rounded px-1 py-2 text-center text-[11px] font-bold [font-variant-numeric:tabular-nums]"
                        style={c.req > 0
                          ? { backgroundColor: step.bg, color: step.fg }
                          : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                        title={`${row.division} · ${PAIRED_METRICS.find((m) => m.id === c.id)?.label}: ${nfmt(c.done)} of ${nfmt(c.req)}`}
                      >
                        {c.req > 0 ? pctText(c.pct) : '—'}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-right">
                    <span className="font-bold text-gray-900 [font-variant-numeric:tabular-nums]">{pctText(row.average)}</span>
                    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, row.average)}%`, backgroundColor: DONE }} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Work with no survey counterpart */}
      <Card
        title="Additional maintenance carried out"
        subtitle="Activities the maintenance return records but the inspection sheet raises no requirement for — reported as volume delivered."
      >
        <div className="grid gap-5 md:grid-cols-3">
          {standaloneData.map((s, i) => (
            <div key={s.metric.id}>
              <div className="mb-1 flex items-baseline justify-between">
                <p className="text-xs font-semibold text-gray-700">{s.metric.label}</p>
                <p className="text-sm font-bold text-gray-900">
                  {nfmt(s.points.reduce((a, p) => a + p.value, 0))} <span className="text-[11px] font-medium text-gray-400">{s.metric.unit}</span>
                </p>
              </div>
              <div style={{ height: '180px' }}><canvas ref={standaloneRefs[i]} /></div>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
          The survey side has one such column too — <span className="font-semibold text-gray-700">Line surveyed (33KV &amp; 11KV): {nfmt(head.lineSurveyedKm)} KM</span> — with no matching &ldquo;work done&rdquo; column, so it is reported as inspection coverage rather than a completion rate.
        </p>
      </Card>

      {/* Source data */}
      <Card title="Source data" subtitle="Exactly as recorded in the monthly return, for the current filter.">
        <div className="mb-3 inline-flex rounded-lg border border-gray-200 p-1 print:hidden">
          {(['survey', 'work'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setRawSheet(k)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
                rawSheet === k ? 'bg-slate-900 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {k === 'survey' ? 'Survey / Inspection' : 'Maintenance / Work done'}
            </button>
          ))}
        </div>
        {/* Capped so 45 raw rows don't bury the charts above; header and totals
            stay pinned while scrolling. */}
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-gray-100 print:max-h-none print:overflow-visible">
          {rawSheet === 'survey' ? <SurveyTable slice={slice} /> : <WorkTable slice={slice} />}
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          {slice.divisions.length * slice.months.length} rows · scroll inside the table, or use Export Excel for the full sheet.
          {rawSheet === 'survey' && (
            <> <br />‡ Shown as recorded. This column exceeds the combined 33+11KV tree-trimming requirement in four of the five divisions, so it is not used in any completion figure.</>
          )}
        </p>
      </Card>

      {/* Caveats */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <button
          onClick={() => setShowNotes((s) => !s)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold text-amber-900">
            <FiAlertCircle /> How to read these figures ({DATA_NOTES.length} notes)
          </span>
          <FiChevronDown className={`shrink-0 text-amber-700 transition ${showNotes ? 'rotate-180' : ''}`} />
        </button>
        {showNotes && (
          <ul className="mt-3 space-y-3">
            {DATA_NOTES.map((n) => (
              <li key={n.title} className="text-sm">
                <p className="font-semibold text-amber-900">{n.title}</p>
                <p className="mt-0.5 text-amber-800">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
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
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 22
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            label: (item: { parsed: { y: number } }) => `${nfmt(item.parsed.y)} ${entry.metric.unit}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { color: GRID }, ticks: { ...axisTicks, font: { size: 10 } } },
        y: { beginAtZero: true, grid: hairlineGrid, border: { display: false }, ticks: { ...axisTicks, font: { size: 10 }, maxTicksLimit: 5, callback: (v: number) => nfmt(v) } }
      }
    }
  };
}

// Header and totals stay put while the capped table body scrolls.
const thStickyBase = 'sticky top-0 z-10 whitespace-nowrap border-b border-gray-200 bg-white px-2 py-2 text-[10px] font-semibold uppercase leading-tight tracking-wide text-gray-500';
const tdStickyFoot = 'sticky bottom-0 whitespace-nowrap border-t-2 border-gray-300 bg-gray-50 px-2 py-2 text-xs font-bold text-gray-900 [font-variant-numeric:tabular-nums]';
const tdBase = 'whitespace-nowrap px-2 py-1.5 text-right text-gray-700 [font-variant-numeric:tabular-nums]';

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
    <table className="w-full min-w-[1100px] border-collapse text-sm">
      <thead>
        <tr>
          <th className={`${thStickyBase} text-left`}>Division</th>
          <th className={`${thStickyBase} text-left`}>Month</th>
          {cols.map(([label]) => <th key={label} className={`${thStickyBase} text-right`}>{label}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((r) => (
          <tr key={`${r.division}|${r.month}`} className="hover:bg-blue-50/40">
            <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-gray-900">{r.division.replace('EDD-', '')}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-gray-500">{monthLabel(r.month)}</td>
            {cols.map(([label, key]) => <td key={label} className={tdBase}>{nfmt(r[key] as number)}</td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className={`${tdStickyFoot} text-left`} colSpan={2}>Total</td>
          {cols.map(([label, key]) => <td key={label} className={`${tdStickyFoot} text-right`}>{nfmt(total(key))}</td>)}
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
    <table className="w-full min-w-[1300px] border-collapse text-sm">
      <thead>
        <tr>
          <th className={`${thStickyBase} text-left`}>Division</th>
          <th className={`${thStickyBase} text-left`}>Month</th>
          {cols.map(([label]) => <th key={label} className={`${thStickyBase} text-right`}>{label}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((r) => (
          <tr key={`${r.division}|${r.month}`} className="hover:bg-blue-50/40">
            <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-gray-900">{r.division.replace('EDD-', '')}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-gray-500">{monthLabel(r.month)}</td>
            {cols.map(([label, key]) => <td key={label} className={tdBase}>{nfmt(r[key] as number)}</td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className={`${tdStickyFoot} text-left`} colSpan={2}>Total</td>
          {cols.map(([label, key]) => <td key={label} className={`${tdStickyFoot} text-right`}>{nfmt(total(key))}</td>)}
        </tr>
      </tfoot>
    </table>
  );
}

export default React.memo(FieldReport);
