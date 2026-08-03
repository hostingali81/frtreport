/**
 * Independent cross-check: reads public/Key-Point.xlsx directly and compares
 * EVERY cell against app/lib/fieldData.ts.
 *
 * verify-field-data.ts asserts against totals that were also transcribed by
 * hand, so it cannot catch a cell + total mistyped together. This one reads the
 * spreadsheet itself, so it is the authoritative check.
 *
 *   npx tsx scripts/crosscheck-field-data.ts
 */

import ExcelJS from 'exceljs';
import path from 'path';
import {
  DIVISIONS, MONTHS, WORK_ROWS, SURVEY_ROWS, PERIOD_MATERIAL_REQ,
  type Division, type WorkRow, type SurveyRow
} from '../app/lib/fieldData';

const FILE = path.join(process.cwd(), 'public', 'Key-Point.xlsx');

// Each division occupies 9 month rows, then a Total row. First block starts at 4.
const blockStart = (i: number) => 4 + i * 10;

// Maintenance sheet: columns C..S in sheet order.
const WORK_COLS: (keyof WorkRow)[] = [
  'dtMaint', 'lug', 'bushing', 'silica', 'oil', 'earthing', 'dtLead', 'damageDt',
  'trim33', 'trim11', 'ins33', 'ins11', 'abc', 'weasel', 'stay', 'jumper', 'pole'
];

// Survey sheet: columns C..Q in sheet order. abcReq (N) and weaselReq (O) are
// merged period cells and are checked separately.
const SURVEY_COLS: (keyof SurveyRow | null)[] = [
  'dtSurvey', 'lugReq', 'bushingReq', 'silicaReq', 'earthingReq', 'dtLeadReq',
  'lineSurveyKm', 'treeTrimReq', 'trim11Req', 'ins33Req', 'ins11Req',
  null, null, // N = Req. LT ABC Cable, O = Req. Weasel Conductor (merged)
  'stayReq', 'poleReq'
];

/** Blank means zero in this return; formula cells carry their computed result. */
function cellNumber(cell: ExcelJS.Cell): number {
  const v = cell.value as unknown;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'result' in (v as Record<string, unknown>)) {
    const r = (v as { result: unknown }).result;
    return typeof r === 'number' ? r : 0;
  }
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  throw new Error(`unexpected cell value: ${JSON.stringify(v)}`);
}

/** The month column holds a real date; normalise to 'YYYY-MM'. */
function cellMonth(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v instanceof Date) {
    // Excel dates come back in UTC; use UTC parts so a negative TZ offset
    // cannot roll 2025-11-01 back into October.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  throw new Error(`month cell is not a date: ${JSON.stringify(v)}`);
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);

  const workWs = wb.getWorksheet('DT and Line Maintenance');
  const surveyWs = wb.getWorksheet('DT and Line Survey');
  if (!workWs || !surveyWs) throw new Error('expected sheets not found in Key-Point.xlsx');

  let compared = 0;
  const problems: string[] = [];
  const diff = (label: string, sheet: number, code: number) => {
    compared++;
    if (sheet !== code) problems.push(`${label}: sheet=${sheet}  code=${code}  (diff ${code - sheet})`);
  };

  console.log(`Cross-checking app/lib/fieldData.ts against ${path.relative(process.cwd(), FILE)}\n`);

  DIVISIONS.forEach((division: Division, di) => {
    const start = blockStart(di);

    MONTHS.forEach((month, mi) => {
      const rowNo = start + mi;

      // --- Maintenance sheet -------------------------------------------------
      const wRow = workWs.getRow(rowNo);
      const wSheetMonth = cellMonth(wRow.getCell(2));
      if (wSheetMonth !== month) {
        problems.push(`Maintenance row ${rowNo}: month is ${wSheetMonth}, expected ${month}`);
      }
      const wSheetDiv = String(wRow.getCell(1).value ?? '').trim();
      if (wSheetDiv && wSheetDiv !== division) {
        problems.push(`Maintenance row ${rowNo}: division is "${wSheetDiv}", expected "${division}"`);
      }
      const wCode = WORK_ROWS.find((r) => r.division === division && r.month === month);
      if (!wCode) {
        problems.push(`Maintenance: no code row for ${division} ${month}`);
      } else {
        WORK_COLS.forEach((key, ci) => {
          diff(`Maintenance ${division} ${month} ${String(key)}`, cellNumber(wRow.getCell(3 + ci)), wCode[key] as number);
        });
      }

      // --- Survey sheet ------------------------------------------------------
      const sRow = surveyWs.getRow(rowNo);
      const sSheetMonth = cellMonth(sRow.getCell(2));
      if (sSheetMonth !== month) {
        problems.push(`Survey row ${rowNo}: month is ${sSheetMonth}, expected ${month}`);
      }
      const sCode = SURVEY_ROWS.find((r) => r.division === division && r.month === month);
      if (!sCode) {
        problems.push(`Survey: no code row for ${division} ${month}`);
      } else {
        SURVEY_COLS.forEach((key, ci) => {
          if (!key) return; // merged period columns, checked below
          diff(`Survey ${division} ${month} ${String(key)}`, cellNumber(sRow.getCell(3 + ci)), sCode[key] as number);
        });
      }
    });

    // Merged LT ABC / Weasel requirement: one value spanning the division block.
    const merged = surveyWs.getRow(start);
    diff(`Survey ${division} abcReq (merged N${start}:N${start + 8})`, cellNumber(merged.getCell(14)), PERIOD_MATERIAL_REQ[division].abcReq);
    diff(`Survey ${division} weaselReq (merged O${start}:O${start + 8})`, cellNumber(merged.getCell(15)), PERIOD_MATERIAL_REQ[division].weaselReq);
  });

  if (problems.length) {
    console.error(`${problems.length} problem(s):\n`);
    problems.forEach((p) => console.error(`  ${p}`));
    console.error(`\n${compared} cells compared — FAILED.`);
    process.exit(1);
  }

  console.log(`${compared.toLocaleString('en-IN')} cells compared against the spreadsheet — every one matches.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
