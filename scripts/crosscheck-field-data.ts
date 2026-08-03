/**
 * Reads public/Key-Point.xlsx and public/DT-Count.xlsx directly and compares
 * EVERY cell against what app/lib/fieldData.ts actually serves.
 *
 * The data is generated (scripts/generate-field-data.ts), so this is the
 * regression guard: it proves the generator, the row/column mapping and the
 * aggregation helpers still agree with the spreadsheets after any sheet edit.
 *
 *   npx tsx scripts/crosscheck-field-data.ts
 */

import ExcelJS from 'exceljs';
import path from 'path';
import {
  DIVISIONS, MONTHS, WORK_ROWS, SURVEY_ROWS, PERIOD_MATERIAL_REQ, DT_COUNT,
  divisionDtTotal, type Division, type WorkRow, type SurveyRow
} from '../app/lib/fieldData';

const FILE = path.join(process.cwd(), 'public', 'Key-Point.xlsx');
const DT_FILE = path.join(process.cwd(), 'public', 'DT-Count.xlsx');

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

  console.log(`Cross-checking app/lib/fieldData.ts against ${path.relative(process.cwd(), FILE)} and ${path.relative(process.cwd(), DT_FILE)}\n`);

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

  // --- DT-Count.xlsx -------------------------------------------------------
  const dtWb = new ExcelJS.Workbook();
  await dtWb.xlsx.readFile(DT_FILE);
  const dtWs = dtWb.worksheets[0];
  if (!dtWs) throw new Error('DT-Count.xlsx: no worksheet');

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  let pending: number[][] = [];
  let sheetCircleTotal: number | null = null;
  const seen = new Set<Division>();

  for (let r = 2; r <= dtWs.rowCount; r++) {
    const row = dtWs.getRow(r);
    const name = String(row.getCell(1).value ?? '').trim();
    if (!name) continue;

    if (/circle total/i.test(name)) {
      sheetCircleTotal = cellNumber(row.getCell(11));
      break;
    }

    const totalMatch = /^EDD\s+(.+?)\s+Total$/i.exec(name);
    if (totalMatch) {
      const key = norm(`EDD-${totalMatch[1]}`);
      const division = DIVISIONS.find((d) => norm(d) === key);
      if (!division) {
        problems.push(`DT-Count R${r}: unknown division "${name}"`);
        pending = [];
        continue;
      }
      seen.add(division);
      diff(`DT-Count ${division} substation count`, pending.length, DT_COUNT[division].substations);
      for (let c = 0; c < 9; c++) {
        diff(`DT-Count ${division} capacity col ${c + 1}`, pending.reduce((a, s) => a + s[c], 0), DT_COUNT[division].byCapacity[c]);
      }
      pending = [];
      continue;
    }

    pending.push(Array.from({ length: 9 }, (_, c) => cellNumber(row.getCell(2 + c))));
  }

  DIVISIONS.filter((d) => !seen.has(d)).forEach((d) => problems.push(`DT-Count: no block found for ${d}`));

  if (sheetCircleTotal === null) {
    problems.push('DT-Count: circle total row not found');
  } else {
    diff('DT-Count circle total', sheetCircleTotal, DIVISIONS.reduce((a, d) => a + divisionDtTotal(d), 0));
  }

  if (problems.length) {
    console.error(`${problems.length} problem(s):\n`);
    problems.forEach((p) => console.error(`  ${p}`));
    console.error(`\n${compared} cells compared — FAILED.`);
    process.exit(1);
  }

  console.log(`${compared.toLocaleString('en-IN')} cells compared against Key-Point.xlsx and DT-Count.xlsx — every one matches.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
