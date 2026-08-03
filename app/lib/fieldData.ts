// Field work, survey and DT-population data for EDC-Barabanki, Nov 2025 - Jul 2026.
//
// Sources:
//   public/Key-Point.xlsx
//     "DT and Line Survey"       -> inspection: what was found to be REQUIRED
//     "DT and Line Maintenance"  -> the work actually DONE off the back of that survey
//   public/DT-Count.xlsx
//     "DT Count"                 -> installed transformer population, folded up
//                                   from its substation rows to division level
//
// Held in-repo rather than in the DB for now - these are monthly manual returns,
// not a scraped feed. The numbers themselves live in fieldData.generated.ts and
// are produced by scripts/generate-field-data.ts straight from the spreadsheets,
// so updating a sheet is a one-command regenerate. Verify with
// scripts/crosscheck-field-data.ts, which re-reads the workbooks and diffs every
// cell against what the app is serving.

import {
  WORK_RAW, SURVEY_RAW, PERIOD_MATERIAL_REQ_RAW, DT_COUNT_RAW, CAPACITY_LABELS
} from './fieldData.generated';

export { CAPACITY_LABELS };

export const DIVISIONS = [
  'EDD-Barabanki',
  'EDD-Ramnagar',
  'EDD-Fatehpur',
  'EDD-Haidergarh',
  'EDD-Ramsanehighat'
] as const;

export type Division = (typeof DIVISIONS)[number];

export const CIRCLE = 'EDC-Barabanki';

export const MONTHS = [
  '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
  '2026-04', '2026-05', '2026-06', '2026-07'
] as const;

export type Month = (typeof MONTHS)[number];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-01' -> 'Jan 26' */
export const monthLabel = (m: string) => {
  const [y, mm] = m.split('-');
  return `${MONTH_NAMES[Number(mm) - 1]} ${y.slice(2)}`;
};

/** '2026-01' -> 'January 2026' */
export const monthLabelLong = (m: string) => {
  const [y, mm] = m.split('-');
  const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${full[Number(mm) - 1]} ${y}`;
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface WorkRow {
  division: Division;
  month: string;
  dtMaint: number;      // DT Maintenance (Nos.)
  lug: number;          // Lug Changed (Nos.)
  bushing: number;      // Bushing Changed (Nos.)
  silica: number;       // Silica Gel Replaced (Kg)
  oil: number;          // Oil Top-up (Ltr)
  earthing: number;     // Earthing (Body/Neutral)
  dtLead: number;       // DT Lead Replacement (Mtr)
  damageDt: number;     // Damage DT Replacement
  trim33: number;       // 33KV Tree Trimming (KM)
  trim11: number;       // 11KV Tree Trimming (KM)
  ins33: number;        // 33KV Insulator Changed (Disc+Pin) (Nos.)
  ins11: number;        // 11KV Insulator Changed (Disc+Pin) (Nos.)
  abc: number;          // LT ABC Cable Replaced (Mtr.)
  weasel: number;       // Weasel Conductor Replaced/Tightened (Mtr.)
  stay: number;         // Stay Set Repaired/Replaced (Nos.)
  jumper: number;       // Jumper Repaired (Nos.)
  pole: number;         // Damage/Mid Span/Tilted Pole Replacement
}

export interface SurveyRow {
  division: Division;
  month: string;
  dtSurvey: number;      // DT Survey (Nos.)
  lugReq: number;        // Lug Required (Nos.)
  bushingReq: number;    // Bushing Required (Nos.)
  silicaReq: number;     // Silica Gel Required (Kg)
  earthingReq: number;   // Earthing Required
  dtLeadReq: number;     // DT Lead Required (Mtr)
  lineSurveyKm: number;  // Line Survey Done 33kv and 11kv (KM)
  treeTrimReq: number;   // Req. Tree Trimming (KM) 33kv + 11kv - combined
  trim11Req: number;     // Req. 11KV Tree Trimming (KM) - see DATA_NOTES
  ins33Req: number;      // Replace Req. 33KV Insulator (Disc+Pin) (Nos.)
  ins11Req: number;      // Replace Req. 11KV Insulator (Disc+Pin) (Nos.)
  stayReq: number;       // Req. Stay Set (Nos.)
  poleReq: number;       // Req. Damage/Mid Span/Tilted Pole Replacement
}

// The monthly rows and the DT population are generated straight from the two
// spreadsheets - see scripts/generate-field-data.ts. Nothing here is typed by
// hand, so a sheet update is a one-command sync rather than a transcription job.
export const PERIOD_MATERIAL_REQ = PERIOD_MATERIAL_REQ_RAW as Record<Division, { abcReq: number; weaselReq: number }>;

export const WORK_ROWS: WorkRow[] = DIVISIONS.flatMap((division) =>
  WORK_RAW[division].map(([month, ...v]) => ({
    division,
    month,
    dtMaint: v[0], lug: v[1], bushing: v[2], silica: v[3], oil: v[4],
    earthing: v[5], dtLead: v[6], damageDt: v[7], trim33: v[8], trim11: v[9],
    ins33: v[10], ins11: v[11], abc: v[12], weasel: v[13], stay: v[14],
    jumper: v[15], pole: v[16]
  }))
);

export const SURVEY_ROWS: SurveyRow[] = DIVISIONS.flatMap((division) =>
  SURVEY_RAW[division].map(([month, ...v]) => ({
    division,
    month,
    dtSurvey: v[0], lugReq: v[1], bushingReq: v[2], silicaReq: v[3],
    earthingReq: v[4], dtLeadReq: v[5], lineSurveyKm: v[6], treeTrimReq: v[7],
    trim11Req: v[8], ins33Req: v[9], ins11Req: v[10], stayReq: v[11], poleReq: v[12]
  }))
);

// ---------------------------------------------------------------------------
// Installed DT population (DT-Count.xlsx)
// ---------------------------------------------------------------------------

// `substations` is the number of source rows the division block was folded up
// from. It is deliberately not surfaced anywhere in the UI - the report is
// division-wise only - but scripts/crosscheck-field-data.ts asserts it, so a row
// added to or removed from DT-Count.xlsx fails loudly instead of silently
// shifting a division total.
export const DT_COUNT = DT_COUNT_RAW as Record<Division, { substations: number; byCapacity: number[] }>;

/**
 * Capacity is an ordered scale (10 -> 630 KVA), and nine buckets is more colour
 * classes than any chart can carry. Rolled into three ordered bands for the
 * visual; the full nine-column split stays in the table.
 */
export const CAPACITY_BANDS: { id: string; label: string; range: string; columns: number[] }[] = [
  { id: 'small', label: 'Small', range: '10 – 25 KVA', columns: [0, 1, 2] },
  { id: 'medium', label: 'Medium', range: '63 – 100 KVA', columns: [3, 4] },
  { id: 'large', label: 'Large', range: '160 – 630 KVA', columns: [5, 6, 7, 8] }
];

export const divisionDtTotal = (d: Division) =>
  DT_COUNT[d].byCapacity.reduce((a, b) => a + b, 0);

export interface DtPopulation {
  division: Division;
  byCapacity: number[];
  bands: number[];
  total: number;
}

export function dtPopulation(slice: Slice): DtPopulation[] {
  return slice.divisions.map((division) => {
    const byCapacity = DT_COUNT[division].byCapacity;
    return {
      division,
      byCapacity,
      bands: CAPACITY_BANDS.map((b) => b.columns.reduce((a, c) => a + byCapacity[c], 0)),
      total: byCapacity.reduce((a, b) => a + b, 0)
    };
  });
}

/**
 * DT work carried out per 100 installed transformers.
 *
 * The DT count is a point-in-time population with no month dimension, so this is
 * a job rate, NOT a share of distinct transformers covered - a DT attended twice
 * counts twice. Labelled that way everywhere it is shown.
 */
export interface DtCoverage {
  division: Division;
  population: number;
  surveyed: number;
  maintained: number;
  surveyedPer100: number;
  maintainedPer100: number;
}

export function dtCoverage(slice: Slice): DtCoverage[] {
  return slice.divisions.map((division) => {
    const one: Slice = { divisions: [division], months: slice.months };
    const population = divisionDtTotal(division);
    const surveyed = surveyRowsIn(one).reduce((a, r) => a + r.dtSurvey, 0);
    const maintained = workRowsIn(one).reduce((a, r) => a + r.dtMaint, 0);
    return {
      division,
      population,
      surveyed,
      maintained,
      surveyedPer100: population > 0 ? (surveyed / population) * 100 : 0,
      maintainedPer100: population > 0 ? (maintained / population) * 100 : 0
    };
  });
}

// ---------------------------------------------------------------------------
// Metric catalogue
// ---------------------------------------------------------------------------

export type MetricGroup = 'DT' | 'Line';

/** An activity the survey raised a requirement for and the field crews then worked on. */
export interface PairedMetric {
  id: string;
  label: string;
  short: string;
  unit: string;
  group: MetricGroup;
  reqLabel: string;
  doneLabel: string;
  /** Monthly requirement. Absent when the sheet only carries a period-level target. */
  req?: (s: SurveyRow) => number;
  /** Period-level requirement (LT ABC / Weasel) - fixed for the whole 9 months. */
  periodReq?: (d: Division) => number;
  done: (w: WorkRow) => number;
  /** Requirement does not scale with a month filter - flagged in the UI. */
  periodScoped?: boolean;
  note?: string;
}

export const PAIRED_METRICS: PairedMetric[] = [
  {
    id: 'dt', label: 'DT Inspected → Maintained', short: 'DT Maintenance', unit: 'Nos.', group: 'DT',
    reqLabel: 'Surveyed', doneLabel: 'Maintained',
    req: (s) => s.dtSurvey, done: (w) => w.dtMaint
  },
  {
    id: 'lug', label: 'Lug', short: 'Lug', unit: 'Nos.', group: 'DT',
    reqLabel: 'Required', doneLabel: 'Changed',
    req: (s) => s.lugReq, done: (w) => w.lug
  },
  {
    id: 'bushing', label: 'Bushing', short: 'Bushing', unit: 'Nos.', group: 'DT',
    reqLabel: 'Required', doneLabel: 'Changed',
    req: (s) => s.bushingReq, done: (w) => w.bushing
  },
  {
    id: 'silica', label: 'Silica Gel', short: 'Silica Gel', unit: 'Kg', group: 'DT',
    reqLabel: 'Required', doneLabel: 'Replaced',
    req: (s) => s.silicaReq, done: (w) => w.silica
  },
  {
    id: 'earthing', label: 'Earthing (Body / Neutral)', short: 'Earthing', unit: 'Nos.', group: 'DT',
    reqLabel: 'Required', doneLabel: 'Done',
    req: (s) => s.earthingReq, done: (w) => w.earthing
  },
  {
    id: 'dtLead', label: 'DT Lead', short: 'DT Lead', unit: 'Mtr', group: 'DT',
    reqLabel: 'Required', doneLabel: 'Replaced',
    req: (s) => s.dtLeadReq, done: (w) => w.dtLead
  },
  {
    id: 'tree', label: 'Tree Trimming (33KV + 11KV)', short: 'Tree Trimming', unit: 'KM', group: 'Line',
    reqLabel: 'Required', doneLabel: 'Trimmed',
    req: (s) => s.treeTrimReq, done: (w) => w.trim33 + w.trim11,
    note: 'Requirement is the combined 33KV + 11KV figure from the survey sheet.'
  },
  {
    id: 'ins33', label: '33KV Insulator (Disc + Pin)', short: '33KV Insulator', unit: 'Nos.', group: 'Line',
    reqLabel: 'Required', doneLabel: 'Changed',
    req: (s) => s.ins33Req, done: (w) => w.ins33
  },
  {
    id: 'ins11', label: '11KV Insulator (Disc + Pin)', short: '11KV Insulator', unit: 'Nos.', group: 'Line',
    reqLabel: 'Required', doneLabel: 'Changed',
    req: (s) => s.ins11Req, done: (w) => w.ins11
  },
  {
    id: 'abc', label: 'LT ABC Cable', short: 'LT ABC Cable', unit: 'Mtr', group: 'Line',
    reqLabel: 'Required', doneLabel: 'Replaced',
    periodReq: (d) => PERIOD_MATERIAL_REQ[d].abcReq, done: (w) => w.abc,
    periodScoped: true,
    note: 'Survey sheet carries one requirement for the whole period, not per month.'
  },
  {
    id: 'weasel', label: 'Weasel Conductor', short: 'Weasel Conductor', unit: 'Mtr', group: 'Line',
    reqLabel: 'Required', doneLabel: 'Replaced / Tightened',
    periodReq: (d) => PERIOD_MATERIAL_REQ[d].weaselReq, done: (w) => w.weasel,
    periodScoped: true,
    note: 'Survey sheet carries one requirement for the whole period, not per month.'
  },
  {
    id: 'stay', label: 'Stay Set', short: 'Stay Set', unit: 'Nos.', group: 'Line',
    reqLabel: 'Required', doneLabel: 'Repaired / Replaced',
    req: (s) => s.stayReq, done: (w) => w.stay
  },
  {
    id: 'pole', label: 'Damaged / Mid-span / Tilted Pole', short: 'Pole Replacement', unit: 'Nos.', group: 'Line',
    reqLabel: 'Required', doneLabel: 'Replaced',
    req: (s) => s.poleReq, done: (w) => w.pole
  }
];

/** Work with no matching "required" column in the survey sheet. */
export interface StandaloneMetric {
  id: string;
  label: string;
  unit: string;
  group: MetricGroup;
  source: 'work' | 'survey';
  value: (r: WorkRow & SurveyRow) => number;
}

export const WORK_ONLY_METRICS: StandaloneMetric[] = [
  { id: 'oil', label: 'Oil Top-up', unit: 'Ltr', group: 'DT', source: 'work', value: (r) => r.oil },
  { id: 'damageDt', label: 'Damaged DT Replaced', unit: 'Nos.', group: 'DT', source: 'work', value: (r) => r.damageDt },
  { id: 'jumper', label: 'Jumper Repaired', unit: 'Nos.', group: 'Line', source: 'work', value: (r) => r.jumper }
];

export const SURVEY_ONLY_METRICS: StandaloneMetric[] = [
  { id: 'lineSurvey', label: 'Line Surveyed (33KV & 11KV)', unit: 'KM', group: 'Line', source: 'survey', value: (r) => r.lineSurveyKm }
];

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface Slice {
  divisions: Division[];
  months: string[];
}

export const FULL_SLICE: Slice = { divisions: [...DIVISIONS], months: [...MONTHS] };

const inSlice = (r: { division: Division; month: string }, s: Slice) =>
  s.divisions.includes(r.division) && s.months.includes(r.month);

export const workRowsIn = (s: Slice) => WORK_ROWS.filter((r) => inSlice(r, s));
export const surveyRowsIn = (s: Slice) => SURVEY_ROWS.filter((r) => inSlice(r, s));

export interface MetricTotal {
  metric: PairedMetric;
  req: number;
  done: number;
  /** done/req as a percentage, capped for the bar geometry but not for the label. */
  pct: number;
  gap: number;
}

/**
 * Requirement vs work done for one activity over a slice.
 *
 * Period-scoped materials (LT ABC, Weasel) always report the full-period
 * requirement for the selected divisions - the sheet has no monthly split to
 * pro-rate, so shrinking the month filter would otherwise invent one.
 */
export function metricTotal(metric: PairedMetric, slice: Slice): MetricTotal {
  const done = workRowsIn(slice).reduce((sum, r) => sum + metric.done(r), 0);
  const req = metric.periodReq
    ? slice.divisions.reduce((sum, d) => sum + metric.periodReq!(d), 0)
    : surveyRowsIn(slice).reduce((sum, r) => sum + (metric.req?.(r) ?? 0), 0);
  return { metric, req, done, pct: req > 0 ? (done / req) * 100 : 0, gap: Math.max(0, req - done) };
}

export const metricTotals = (slice: Slice) => PAIRED_METRICS.map((m) => metricTotal(m, slice));

/** Unweighted mean completion across the tracked activities - see the UI caption. */
export function averageCompletion(slice: Slice): number {
  const totals = metricTotals(slice).filter((t) => t.req > 0);
  if (totals.length === 0) return 0;
  return totals.reduce((sum, t) => sum + Math.min(100, t.pct), 0) / totals.length;
}

export interface HeadlineTotals {
  dtSurveyed: number;
  dtMaintained: number;
  lineSurveyedKm: number;
  treeTrimmedKm: number;
  damagedDtReplaced: number;
  jumperRepaired: number;
  oilTopUp: number;
  dtLeadReplaced: number;
}

export function headlineTotals(slice: Slice): HeadlineTotals {
  const w = workRowsIn(slice);
  const s = surveyRowsIn(slice);
  const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    dtSurveyed: sum(s, (r) => r.dtSurvey),
    dtMaintained: sum(w, (r) => r.dtMaint),
    lineSurveyedKm: sum(s, (r) => r.lineSurveyKm),
    treeTrimmedKm: sum(w, (r) => r.trim33 + r.trim11),
    damagedDtReplaced: sum(w, (r) => r.damageDt),
    jumperRepaired: sum(w, (r) => r.jumper),
    oilTopUp: sum(w, (r) => r.oil),
    dtLeadReplaced: sum(w, (r) => r.dtLead)
  };
}

/** Per-month requirement vs done for one activity. */
export function monthlySeries(metric: PairedMetric, slice: Slice) {
  return slice.months.map((month) => {
    const one: Slice = { divisions: slice.divisions, months: [month] };
    const done = workRowsIn(one).reduce((sum, r) => sum + metric.done(r), 0);
    const req = metric.periodReq
      ? null
      : surveyRowsIn(one).reduce((sum, r) => sum + (metric.req?.(r) ?? 0), 0);
    return { month, req, done };
  });
}

/** Per-division requirement vs done for one activity. */
export function divisionSeries(metric: PairedMetric, slice: Slice) {
  return slice.divisions.map((division) => {
    const one: Slice = { divisions: [division], months: slice.months };
    const t = metricTotal(metric, one);
    return { division, req: t.req, done: t.done, pct: t.pct };
  });
}

/** Completion % for every division × activity - the scorecard grid. */
export function divisionScorecard(slice: Slice) {
  return slice.divisions.map((division) => {
    const one: Slice = { divisions: [division], months: slice.months };
    const cells = PAIRED_METRICS.map((m) => {
      const t = metricTotal(m, one);
      return { id: m.id, req: t.req, done: t.done, pct: t.pct };
    });
    const rated = cells.filter((c) => c.req > 0);
    return {
      division,
      cells,
      average: rated.length ? rated.reduce((s, c) => s + Math.min(100, c.pct), 0) / rated.length : 0
    };
  });
}

/** Per-month totals for a work-only / survey-only activity. */
export function standaloneMonthly(metric: StandaloneMetric, slice: Slice) {
  const rows = metric.source === 'work' ? workRowsIn(slice) : surveyRowsIn(slice);
  return slice.months.map((month) => ({
    month,
    value: (rows as (WorkRow & SurveyRow)[])
      .filter((r) => r.month === month)
      .reduce((sum, r) => sum + metric.value(r), 0)
  }));
}

// ---------------------------------------------------------------------------
// Caveats surfaced in the UI - an officer reading these charts should see the
// same footnotes the sheet implies but never states.
// ---------------------------------------------------------------------------

const nf = (n: number) => n.toLocaleString('en-IN');

/** Divisions where the standalone 11KV column exceeds the combined requirement. */
const trim11OverCombined = DIVISIONS.filter((d) => {
  const rows = SURVEY_ROWS.filter((r) => r.division === d);
  return rows.reduce((a, r) => a + r.trim11Req, 0) > rows.reduce((a, r) => a + r.treeTrimReq, 0);
}).length;

/** Activities where every division and month recorded done === required. */
const fullyClosed = PAIRED_METRICS.filter((m) => {
  if (!m.req) return false;
  return SURVEY_ROWS.every((s) => {
    const w = WORK_ROWS.find((x) => x.division === s.division && x.month === s.month);
    return w ? m.req!(s) === m.done(w) : false;
  });
}).map((m) => m.short);

// Figures are derived, never typed in, so a spreadsheet update cannot leave a
// stale number sitting in a footnote.
export const DATA_NOTES: { title: string; body: string }[] = [
  {
    title: 'Tree trimming requirement is a combined figure',
    body:
      `The survey sheet records one tree-trimming requirement covering both 33KV and 11KV lines (${nf(SURVEY_ROWS.reduce((a, r) => a + r.treeTrimReq, 0))} KM for the circle), so it is compared against 33KV + 11KV trimming done together. The sheet also carries a separate "Req. 11KV Tree Trimming" column (${nf(SURVEY_ROWS.reduce((a, r) => a + r.trim11Req, 0))} KM); it exceeds the combined figure in ${trim11OverCombined} of the ${DIVISIONS.length} divisions, so it is shown in the survey table only and is not used in any completion percentage.`
  },
  {
    title: 'LT ABC Cable and Weasel Conductor requirements are period totals',
    body:
      'In the survey sheet these two requirements are single merged cells covering all nine months of each division, not monthly entries. They are therefore always reported for the full period of the selected divisions and do not change with the month filter.'
  },
  {
    title: 'DT count is a population snapshot, not a monthly figure',
    body:
      `DT-Count.xlsx lists ${nf(DIVISIONS.reduce((a, d) => a + divisionDtTotal(d), 0))} installed transformers across the ${DIVISIONS.length} divisions, with no month dimension. Work is therefore expressed as jobs per 100 installed DTs rather than as a share of transformers covered — a DT attended in two different months counts twice, so the rate can exceed the number of distinct DTs touched.`
  },
  ...(fullyClosed.length
    ? [{
      title: 'Activities recorded at full completion',
      body:
        `${fullyClosed.join(', ')} show the same figure under "required" and "done" in every division and month, i.e. everything the survey raised was attended to within the same month.`
    }]
    : []),
  {
    title: 'One blank cell',
    body: 'Oil Top-up for EDD-Fatehpur, July 2026 is blank in the source sheet and is counted as zero.'
  }
];
