// Field work + survey data for EDC-Barabanki, Nov 2025 - Jul 2026.
//
// Source: public/Key-Point.xlsx, two sheets:
//   "DT and Line Survey"       -> inspection: what was found to be REQUIRED
//   "DT and Line Maintenance"  -> the work actually DONE off the back of that survey
//
// Hard-coded on purpose for now (no DB round-trip) - the sheet is a monthly
// manual return, not a scraped feed. Numbers are transcribed verbatim from the
// sheet, including its formula results; scripts/verify-field-data.ts asserts
// every column total against the sheet's own Grand Total row, so a typo here
// fails loudly instead of quietly skewing a chart.

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

// Tuple column order mirrors the source sheet left-to-right, so a row here can
// be diffed against the spreadsheet by eye.
// [month, dtMaint, lug, bushing, silica, oil, earthing, dtLead, damageDt,
//  trim33, trim11, ins33, ins11, abc, weasel, stay, jumper, pole]
type WorkTuple = [string, ...number[]];

const WORK_RAW: Record<Division, WorkTuple[]> = {
  'EDD-Barabanki': [
    ['2025-11', 120, 65, 0, 0, 0, 0, 229, 0, 10, 10, 0, 0, 0, 0, 5, 78, 20],
    ['2025-12', 135, 180, 0, 0, 0, 21, 0, 9, 5, 11, 0, 45, 100, 200, 15, 43, 13],
    ['2026-01', 35, 419, 1, 0, 150, 3, 0, 12, 10, 13, 0, 0, 0, 0, 18, 80, 14],
    ['2026-02', 40, 312, 1, 0, 195, 0, 1420, 8, 8, 9, 0, 53, 0, 0, 22, 66, 12],
    ['2026-03', 110, 318, 3, 0, 200, 0, 909, 6, 21, 12, 3, 70, 0, 200, 8, 40, 15],
    ['2026-04', 142, 161, 2, 10, 350, 5, 415, 8, 13, 17, 0, 33, 350, 270, 13, 118, 8],
    ['2026-05', 60, 210, 1, 0, 400, 0, 0, 33, 9, 21, 0, 40, 720, 26, 0, 187, 43],
    ['2026-06', 86, 92, 1, 0, 200, 0, 0, 38, 8, 12, 0, 0, 0, 0, 0, 134, 26],
    ['2026-07', 39, 104, 2, 0, 0, 0, 0, 58, 10, 6, 0, 0, 0, 0, 0, 100, 12]
  ],
  'EDD-Ramnagar': [
    ['2025-11', 40, 14, 0, 0, 0, 25, 1159, 0, 10, 25, 10, 20, 995, 400, 2, 79, 31],
    ['2025-12', 20, 52, 0, 0, 0, 19, 829, 9, 6, 10, 6, 13, 150, 250, 2, 47, 19],
    ['2026-01', 22, 84, 0, 0, 0, 0, 12, 23, 18, 6, 2, 10, 730, 200, 0, 55, 13],
    ['2026-02', 24, 182, 0, 0, 0, 13, 190, 13, 16, 6, 3, 20, 615, 250, 1, 45, 11],
    ['2026-03', 104, 124, 0, 0, 1140, 3, 30, 15, 20, 41, 14, 16, 110, 200, 2, 104, 9],
    ['2026-04', 110, 160, 0, 0, 540, 0, 5, 31, 12, 20, 4, 12, 0, 180, 3, 90, 15],
    ['2026-05', 40, 44, 0, 0, 0, 0, 35, 107, 10, 11, 2, 10, 0, 170, 0, 70, 65],
    ['2026-06', 20, 90, 0, 0, 0, 0, 0, 110, 17, 27, 0, 20, 0, 150, 0, 80, 25],
    ['2026-07', 18, 46, 0, 0, 0, 0, 0, 145, 14, 12, 4, 6, 0, 0, 0, 68, 35]
  ],
  'EDD-Fatehpur': [
    ['2025-11', 48, 12, 0, 0, 0, 0, 0, 0, 15, 40, 0, 27, 1000, 100, 0, 35, 35],
    ['2025-12', 28, 38, 0, 0, 0, 0, 0, 9, 22, 32, 0, 0, 0, 0, 0, 55, 14],
    ['2026-01', 30, 40, 0, 0, 400, 0, 0, 18, 20, 55, 5, 0, 570, 0, 2, 30, 16],
    ['2026-02', 32, 79, 0, 25, 250, 0, 0, 16, 15, 45, 0, 0, 200, 0, 4, 50, 11],
    ['2026-03', 102, 38, 4, 0, 220, 10, 0, 26, 12, 10, 0, 1, 150, 0, 1, 45, 8],
    ['2026-04', 119, 28, 8, 0, 200, 0, 0, 16, 17, 25, 0, 16, 0, 450, 5, 85, 8],
    ['2026-05', 48, 68, 2, 0, 200, 30, 0, 76, 20, 45, 6, 3, 400, 450, 0, 135, 55],
    ['2026-06', 26, 15, 2, 0, 200, 0, 0, 96, 8, 22, 0, 0, 768, 0, 0, 65, 22],
    // Oil Top-up for Jul-26 is blank in the sheet (not a zero) - recorded as 0.
    ['2026-07', 28, 22, 0, 0, 0, 0, 0, 85, 13, 15, 0, 0, 0, 0, 1, 45, 18]
  ],
  'EDD-Haidergarh': [
    ['2025-11', 15, 140, 0, 0, 0, 0, 220, 0, 20, 35, 3, 0, 0, 0, 0, 80, 19],
    ['2025-12', 45, 90, 9, 0, 0, 30, 1274, 16, 17, 30, 27, 74, 290, 160, 5, 115, 9],
    ['2026-01', 35, 116, 14, 0, 600, 0, 0, 29, 20, 60, 2, 0, 530, 340, 2, 60, 10],
    ['2026-02', 43, 166, 5, 25, 200, 0, 334, 11, 25, 90, 18, 0, 0, 160, 2, 75, 8],
    ['2026-03', 55, 307, 8, 0, 800, 220, 522, 15, 14, 70, 10, 11, 0, 50, 7, 90, 9],
    ['2026-04', 60, 312, 10, 0, 550, 100, 630, 22, 10, 42, 41, 180, 150, 270, 1, 120, 30],
    ['2026-05', 82, 435, 15, 0, 350, 0, 504, 58, 12, 24, 6, 60, 80, 520, 5, 155, 83],
    ['2026-06', 87, 134, 7, 0, 200, 0, 0, 73, 15, 12, 0, 0, 280, 0, 0, 125, 25],
    ['2026-07', 110, 95, 2, 0, 0, 0, 0, 91, 10, 20, 0, 0, 0, 0, 0, 70, 17]
  ],
  'EDD-Ramsanehighat': [
    ['2025-11', 30, 160, 0, 0, 0, 87, 955, 0, 12, 20, 5, 61, 460, 400, 0, 80, 27],
    ['2025-12', 102, 211, 0, 0, 0, 5, 100, 16, 13, 55, 0, 2, 0, 0, 2, 95, 13],
    ['2026-01', 58, 347, 0, 25, 250, 0, 0, 11, 10, 105, 0, 0, 0, 0, 1, 105, 11],
    ['2026-02', 65, 412, 1, 0, 350, 16, 555, 15, 13, 92, 12, 34, 1000, 400, 1, 150, 13],
    ['2026-03', 70, 116, 3, 0, 200, 0, 0, 33, 26, 75, 0, 0, 0, 0, 0, 185, 9],
    ['2026-04', 52, 79, 2, 0, 0, 0, 200, 26, 10, 40, 12, 38, 50, 0, 0, 60, 21],
    ['2026-05', 48, 85, 1, 0, 0, 13, 210, 69, 17, 45, 16, 29, 0, 200, 2, 65, 52],
    ['2026-06', 20, 78, 0, 0, 0, 0, 0, 81, 7, 30, 0, 0, 0, 0, 1, 70, 21],
    ['2026-07', 30, 33, 0, 0, 0, 12, 150, 85, 15, 45, 0, 0, 40, 0, 1, 40, 22]
  ]
};

// [month, dtSurvey, lugReq, bushingReq, silicaReq, earthingReq, dtLeadReq,
//  lineSurveyKm, treeTrimReq, trim11Req, ins33Req, ins11Req, stayReq, poleReq]
type SurveyTuple = [string, ...number[]];

const SURVEY_RAW: Record<Division, SurveyTuple[]> = {
  'EDD-Barabanki': [
    ['2025-11', 180, 65, 8, 120, 80, 1000, 90, 32, 55, 3, 0, 5, 20],
    ['2025-12', 185, 180, 10, 140, 100, 1000, 110, 70, 20, 4, 45, 15, 13],
    ['2026-01', 150, 419, 10, 120, 70, 1000, 240, 50, 50, 2, 0, 18, 14],
    ['2026-02', 80, 312, 10, 150, 75, 750, 150, 70, 70, 2, 53, 22, 12],
    ['2026-03', 70, 318, 7, 200, 80, 500, 350, 100, 80, 8, 70, 8, 15],
    ['2026-04', 55, 161, 5, 150, 80, 500, 220, 75, 110, 5, 33, 13, 8],
    ['2026-05', 60, 210, 4, 140, 60, 500, 80, 40, 110, 5, 40, 0, 43],
    ['2026-06', 86, 92, 4, 160, 60, 500, 90, 40, 120, 5, 0, 0, 26],
    ['2026-07', 39, 104, 2, 200, 70, 500, 120, 45, 120, 5, 0, 0, 12]
  ],
  'EDD-Ramnagar': [
    ['2025-11', 40, 14, 4, 0, 25, 1159, 200, 80, 50, 10, 20, 2, 31],
    ['2025-12', 20, 52, 6, 0, 19, 829, 160, 78, 20, 6, 13, 2, 19],
    ['2026-01', 22, 84, 7, 0, 0, 12, 140, 40, 11, 2, 10, 0, 13],
    ['2026-02', 24, 182, 3, 0, 13, 190, 150, 84, 12, 3, 20, 1, 11],
    ['2026-03', 104, 124, 1, 0, 3, 30, 150, 75, 82, 14, 16, 2, 9],
    ['2026-04', 110, 160, 1, 0, 0, 5, 80, 45, 40, 4, 12, 3, 15],
    ['2026-05', 40, 44, 5, 0, 0, 35, 120, 90, 22, 2, 10, 0, 65],
    ['2026-06', 20, 90, 8, 0, 0, 0, 140, 75, 55, 0, 20, 0, 25],
    ['2026-07', 18, 46, 2, 0, 0, 0, 150, 75, 24, 4, 6, 0, 35]
  ],
  'EDD-Fatehpur': [
    ['2025-11', 48, 12, 2, 0, 0, 0, 90, 30, 80, 0, 27, 0, 35],
    ['2025-12', 28, 38, 1, 0, 0, 0, 150, 70, 65, 0, 0, 0, 14],
    ['2026-01', 30, 40, 1, 0, 0, 0, 200, 80, 115, 5, 0, 2, 16],
    ['2026-02', 32, 79, 1, 25, 0, 0, 150, 60, 120, 0, 0, 4, 11],
    ['2026-03', 102, 38, 4, 0, 10, 0, 120, 50, 20, 0, 1, 1, 8],
    ['2026-04', 119, 28, 8, 0, 0, 0, 140, 35, 50, 0, 16, 5, 8],
    ['2026-05', 48, 68, 2, 0, 30, 0, 180, 40, 90, 6, 3, 0, 55],
    ['2026-06', 26, 15, 2, 0, 0, 0, 40, 15, 45, 0, 0, 0, 22],
    ['2026-07', 28, 22, 0, 0, 0, 0, 110, 26, 30, 0, 0, 1, 18]
  ],
  'EDD-Haidergarh': [
    ['2025-11', 30, 140, 4, 0, 0, 220, 135, 40, 70, 3, 0, 0, 19],
    ['2025-12', 45, 90, 9, 0, 30, 1274, 200, 70, 60, 27, 74, 5, 9],
    ['2026-01', 62, 116, 14, 0, 0, 0, 190, 40, 135, 2, 0, 2, 10],
    ['2026-02', 43, 166, 5, 25, 0, 334, 180, 55, 180, 18, 0, 2, 8],
    ['2026-03', 55, 307, 8, 0, 220, 522, 180, 55, 140, 10, 11, 7, 9],
    ['2026-04', 60, 312, 10, 0, 100, 630, 160, 80, 85, 41, 180, 1, 30],
    ['2026-05', 82, 435, 15, 0, 0, 504, 150, 50, 45, 6, 60, 5, 83],
    ['2026-06', 87, 134, 7, 0, 0, 0, 140, 30, 25, 0, 0, 0, 25],
    ['2026-07', 110, 95, 2, 0, 0, 0, 140, 30, 40, 0, 0, 0, 17]
  ],
  'EDD-Ramsanehighat': [
    ['2025-11', 30, 160, 2, 0, 87, 955, 240, 90, 40, 5, 61, 0, 27],
    ['2025-12', 102, 211, 8, 0, 5, 100, 320, 110, 110, 0, 2, 2, 13],
    ['2026-01', 58, 347, 8, 25, 0, 0, 160, 60, 210, 0, 0, 1, 11],
    ['2026-02', 65, 412, 7, 0, 16, 555, 100, 85, 185, 12, 34, 1, 13],
    ['2026-03', 70, 116, 4, 0, 0, 0, 130, 90, 180, 0, 0, 0, 9],
    ['2026-04', 52, 79, 2, 0, 0, 200, 140, 70, 40, 12, 38, 0, 21],
    ['2026-05', 48, 85, 1, 0, 13, 210, 180, 70, 45, 16, 29, 2, 52],
    ['2026-06', 20, 78, 1, 0, 0, 0, 160, 75, 30, 0, 0, 1, 21],
    ['2026-07', 30, 33, 1, 0, 12, 150, 180, 90, 45, 0, 0, 1, 22]
  ]
};

// LT ABC Cable and Weasel Conductor requirements are entered in the survey sheet
// as ONE merged cell spanning all nine months of a division - a period-level
// target, not a monthly figure. Kept out of the monthly rows so nothing can sum
// them nine times over.
export const PERIOD_MATERIAL_REQ: Record<Division, { abcReq: number; weaselReq: number }> = {
  'EDD-Barabanki': { abcReq: 2500, weaselReq: 2000 },
  'EDD-Ramnagar': { abcReq: 3000, weaselReq: 2000 },
  'EDD-Fatehpur': { abcReq: 2500, weaselReq: 2000 },
  'EDD-Haidergarh': { abcReq: 2000, weaselReq: 2000 },
  'EDD-Ramsanehighat': { abcReq: 2000, weaselReq: 2000 }
};

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

export const DATA_NOTES: { title: string; body: string }[] = [
  {
    title: 'Tree trimming requirement is a combined figure',
    body:
      'The survey sheet records one tree-trimming requirement covering both 33KV and 11KV lines (2,760 KM for the circle), so it is compared against 33KV + 11KV trimming done together. The sheet also carries a separate "Req. 11KV Tree Trimming" column (3,331 KM); it exceeds the combined figure in four of the five divisions, so it is shown in the survey table only and is not used in any completion percentage.'
  },
  {
    title: 'LT ABC Cable and Weasel Conductor requirements are period totals',
    body:
      'In the survey sheet these two requirements are single merged cells covering all nine months of each division, not monthly entries. They are therefore always reported for the full period of the selected divisions and do not change with the month filter.'
  },
  {
    title: 'Activities recorded at full completion',
    body:
      'Lug, 11KV Insulator, Stay Set and Pole Replacement show the same figure under "required" and "done" in every division and month, i.e. everything the survey raised was attended to within the same month.'
  },
  {
    title: 'One blank cell',
    body: 'Oil Top-up for EDD-Fatehpur, July 2026 is blank in the source sheet and is counted as zero.'
  }
];
