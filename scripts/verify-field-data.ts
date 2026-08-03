/**
 * Verifies app/lib/fieldData.ts against public/Key-Point.xlsx.
 *
 * The field data is transcribed by hand from the sheet, so every division total
 * and every circle grand total below is copied from the sheet's own Total /
 * Grand Total rows. Per-division AND grand totals are both asserted so a pair of
 * typos that cancel out still fails.
 *
 *   npx tsx scripts/verify-field-data.ts
 */

import {
  DIVISIONS, MONTHS, WORK_ROWS, SURVEY_ROWS, PERIOD_MATERIAL_REQ,
  type Division, type WorkRow, type SurveyRow
} from '../app/lib/fieldData';

// [dtMaint, lug, bushing, silica, oil, earthing, dtLead, damageDt,
//  trim33, trim11, ins33, ins11, abc, weasel, stay, jumper, pole]
const WORK_KEYS: (keyof WorkRow)[] = [
  'dtMaint', 'lug', 'bushing', 'silica', 'oil', 'earthing', 'dtLead', 'damageDt',
  'trim33', 'trim11', 'ins33', 'ins11', 'abc', 'weasel', 'stay', 'jumper', 'pole'
];

const WORK_DIVISION_TOTALS: Record<Division, number[]> = {
  'EDD-Barabanki':     [767, 1861, 11, 10, 1495, 29, 2973, 172, 94, 111, 3, 241, 1170, 696, 81, 846, 163],
  'EDD-Ramnagar':      [398, 796, 0, 0, 1680, 60, 2260, 453, 123, 158, 45, 127, 2600, 1800, 10, 638, 223],
  'EDD-Fatehpur':      [461, 340, 16, 25, 1470, 40, 0, 342, 142, 289, 11, 47, 3088, 1000, 13, 545, 187],
  'EDD-Haidergarh':    [532, 1795, 70, 25, 2700, 350, 3484, 315, 143, 383, 107, 325, 1330, 1500, 22, 890, 210],
  'EDD-Ramsanehighat': [475, 1521, 7, 25, 800, 133, 2170, 336, 123, 507, 45, 164, 1550, 1000, 8, 850, 189]
};

const WORK_GRAND_TOTAL = [2633, 6313, 104, 85, 8145, 612, 10887, 1618, 625, 1448, 211, 904, 9738, 5996, 134, 3769, 972];

// [dtSurvey, lugReq, bushingReq, silicaReq, earthingReq, dtLeadReq,
//  lineSurveyKm, treeTrimReq, trim11Req, ins33Req, ins11Req, stayReq, poleReq]
const SURVEY_KEYS: (keyof SurveyRow)[] = [
  'dtSurvey', 'lugReq', 'bushingReq', 'silicaReq', 'earthingReq', 'dtLeadReq',
  'lineSurveyKm', 'treeTrimReq', 'trim11Req', 'ins33Req', 'ins11Req', 'stayReq', 'poleReq'
];

const SURVEY_DIVISION_TOTALS: Record<Division, number[]> = {
  'EDD-Barabanki':     [905, 1861, 60, 1380, 675, 6250, 1450, 522, 735, 39, 241, 81, 163],
  'EDD-Ramnagar':      [398, 796, 37, 0, 60, 2260, 1290, 642, 316, 45, 127, 10, 223],
  'EDD-Fatehpur':      [461, 340, 21, 25, 40, 0, 1180, 406, 615, 11, 47, 13, 187],
  'EDD-Haidergarh':    [574, 1795, 74, 25, 350, 3484, 1475, 450, 780, 107, 325, 22, 210],
  'EDD-Ramsanehighat': [475, 1521, 34, 25, 133, 2170, 1610, 740, 885, 45, 164, 8, 189]
};

const SURVEY_GRAND_TOTAL = [2813, 6313, 226, 1455, 1258, 14164, 7005, 2760, 3331, 247, 904, 134, 972];

// Merged period cells in the survey sheet (N/O columns), and their grand totals.
const ABC_WEASEL_GRAND_TOTAL = { abcReq: 12000, weaselReq: 10000 };

let failures = 0;
const check = (label: string, actual: number, expected: number) => {
  if (actual !== expected) {
    console.error(`  FAIL  ${label}: got ${actual}, sheet says ${expected} (diff ${actual - expected})`);
    failures++;
  }
};

console.log(`Verifying field data — ${DIVISIONS.length} divisions × ${MONTHS.length} months\n`);

// Shape: every division must have exactly one row per month in both sheets.
for (const d of DIVISIONS) {
  for (const [name, rows] of [['work', WORK_ROWS], ['survey', SURVEY_ROWS]] as const) {
    const mine = rows.filter((r) => r.division === d);
    if (mine.length !== MONTHS.length) {
      console.error(`  FAIL  ${d} ${name}: ${mine.length} rows, expected ${MONTHS.length}`);
      failures++;
    }
    const missing = MONTHS.filter((m) => !mine.some((r) => r.month === m));
    if (missing.length) {
      console.error(`  FAIL  ${d} ${name}: missing months ${missing.join(', ')}`);
      failures++;
    }
  }
}

console.log('Maintenance sheet — division totals');
for (const d of DIVISIONS) {
  const rows = WORK_ROWS.filter((r) => r.division === d);
  WORK_KEYS.forEach((key, i) => {
    const sum = rows.reduce((a, r) => a + (r[key] as number), 0);
    check(`${d} / ${key}`, sum, WORK_DIVISION_TOTALS[d][i]);
  });
}

console.log('Maintenance sheet — circle grand total');
WORK_KEYS.forEach((key, i) => {
  const sum = WORK_ROWS.reduce((a, r) => a + (r[key] as number), 0);
  check(`Grand Total / ${key}`, sum, WORK_GRAND_TOTAL[i]);
});

console.log('Survey sheet — division totals');
for (const d of DIVISIONS) {
  const rows = SURVEY_ROWS.filter((r) => r.division === d);
  SURVEY_KEYS.forEach((key, i) => {
    const sum = rows.reduce((a, r) => a + (r[key] as number), 0);
    check(`${d} / ${key}`, sum, SURVEY_DIVISION_TOTALS[d][i]);
  });
}

console.log('Survey sheet — circle grand total');
SURVEY_KEYS.forEach((key, i) => {
  const sum = SURVEY_ROWS.reduce((a, r) => a + (r[key] as number), 0);
  check(`Grand Total / ${key}`, sum, SURVEY_GRAND_TOTAL[i]);
});

console.log('Survey sheet — merged period requirements (LT ABC / Weasel)');
check(
  'Grand Total / abcReq',
  DIVISIONS.reduce((a, d) => a + PERIOD_MATERIAL_REQ[d].abcReq, 0),
  ABC_WEASEL_GRAND_TOTAL.abcReq
);
check(
  'Grand Total / weaselReq',
  DIVISIONS.reduce((a, d) => a + PERIOD_MATERIAL_REQ[d].weaselReq, 0),
  ABC_WEASEL_GRAND_TOTAL.weaselReq
);

if (failures > 0) {
  console.error(`\n${failures} mismatch(es) — app/lib/fieldData.ts does not match Key-Point.xlsx.`);
  process.exit(1);
}

const cells = DIVISIONS.length * MONTHS.length * (WORK_KEYS.length + SURVEY_KEYS.length);
console.log(`\nAll totals match. ${cells.toLocaleString('en-IN')} transcribed cells verified.`);
