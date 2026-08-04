/**
 * Regenerates app/lib/fieldData.generated.ts from the two source spreadsheets.
 *
 *   npx tsx scripts/generate-field-data.ts
 *
 * Run this whenever public/Key-Point.xlsx or public/DT-Count.xlsx is updated -
 * the numbers are no longer transcribed by hand, so a sheet edit is a one-command
 * sync. Verify afterwards with scripts/crosscheck-field-data.ts.
 */

import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const KEY_POINT = path.join(ROOT, 'public', 'Key-Point.xlsx');
const DT_COUNT = path.join(ROOT, 'public', 'DT-Count.xlsx');
const OUT = path.join(ROOT, 'app', 'lib', 'fieldData.generated.ts');

const DIVISIONS = [
  'EDD-Barabanki', 'EDD-Ramnagar', 'EDD-Fatehpur', 'EDD-Haidergarh', 'EDD-Ramsanehighat'
] as const;

const MONTHS = [
  '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
  '2026-04', '2026-05', '2026-06', '2026-07'
];

/** Each division occupies 9 month rows then a Total row; first block starts at 4. */
const blockStart = (i: number) => 4 + i * 10;

/** Blank means zero in these returns; formula cells carry their computed result. */
function num(cell: ExcelJS.Cell): number {
  const v = cell.value as unknown;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'result' in (v as Record<string, unknown>)) {
    const r = (v as { result: unknown }).result;
    return typeof r === 'number' ? r : 0;
  }
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  throw new Error(`unexpected numeric cell: ${JSON.stringify(v)}`);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(KEY_POINT);
  const workWs = wb.getWorksheet('DT and Line Maintenance');
  const surveyWs = wb.getWorksheet('DT and Line Survey');
  if (!workWs || !surveyWs) throw new Error('Key-Point.xlsx: expected sheets not found');

  // --- Key-Point: monthly rows ---------------------------------------------
  const work: Record<string, number[][]> = {};
  const survey: Record<string, number[][]> = {};
  const periodReq: Record<string, { abcReq: number; weaselReq: number }> = {};

  // Truly empty cells (as opposed to an entered zero). Recorded so the UI can
  // footnote them accurately instead of carrying a hand-written note that goes
  // stale the next time the sheet is edited.
  const blanks: { sheet: string; division: string; month: string; column: string }[] = [];
  const label = (ws: ExcelJS.Worksheet, col: number) =>
    String(ws.getRow(3).getCell(col).value ?? '').replace(/\s+/g, ' ').trim();
  const noteBlank = (ws: ExcelJS.Worksheet, sheet: string, division: string, month: string, row: ExcelJS.Row, col: number) => {
    const v = row.getCell(col).value;
    if (v === null || v === undefined || v === '') {
      blanks.push({ sheet, division, month, column: label(ws, col) });
    }
  };

  DIVISIONS.forEach((division, di) => {
    const start = blockStart(di);
    work[division] = [];
    survey[division] = [];

    MONTHS.forEach((month, mi) => {
      const r = start + mi;

      const wRow = workWs.getRow(r);
      const wMonth = wRow.getCell(2).value;
      if (!(wMonth instanceof Date)) throw new Error(`Maintenance R${r}: month cell is not a date`);
      const wKey = `${wMonth.getUTCFullYear()}-${String(wMonth.getUTCMonth() + 1).padStart(2, '0')}`;
      if (wKey !== month) throw new Error(`Maintenance R${r}: month ${wKey}, expected ${month}`);
      // Columns C..S
      for (let c = 3; c <= 19; c++) noteBlank(workWs, 'Maintenance', division, month, wRow, c);
      work[division].push(Array.from({ length: 17 }, (_, c) => num(wRow.getCell(3 + c))));

      const sRow = surveyWs.getRow(r);
      const sMonth = sRow.getCell(2).value;
      if (!(sMonth instanceof Date)) throw new Error(`Survey R${r}: month cell is not a date`);
      const sKey = `${sMonth.getUTCFullYear()}-${String(sMonth.getUTCMonth() + 1).padStart(2, '0')}`;
      if (sKey !== month) throw new Error(`Survey R${r}: month ${sKey}, expected ${month}`);
      // Columns C..M then P..Q - N and O are the merged period requirements and
      // are only populated on the first row of each block, so they are skipped.
      for (const c of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17]) {
        noteBlank(surveyWs, 'Survey', division, month, sRow, c);
      }
      const sVals = [
        ...Array.from({ length: 11 }, (_, c) => num(sRow.getCell(3 + c))),
        num(sRow.getCell(16)),
        num(sRow.getCell(17))
      ];
      survey[division].push(sVals);
    });

    const merged = surveyWs.getRow(start);
    periodReq[division] = { abcReq: num(merged.getCell(14)), weaselReq: num(merged.getCell(15)) };
  });

  // --- DT-Count: substation rows folded up to divisions ---------------------
  const dtWb = new ExcelJS.Workbook();
  await dtWb.xlsx.readFile(DT_COUNT);
  const dtWs = dtWb.worksheets[0];
  if (!dtWs) throw new Error('DT-Count.xlsx: no worksheet');

  const capacityLabels: string[] = [];
  dtWs.getRow(1).eachCell({ includeEmpty: false }, (cell, c) => {
    if (c >= 2 && c <= 10) capacityLabels.push(String(cell.value ?? '').trim());
  });
  if (capacityLabels.length !== 9) throw new Error(`DT-Count: expected 9 capacity columns, got ${capacityLabels.length}`);

  const dtCount: Record<string, { substations: number; byCapacity: number[] }> = {};
  let pending: number[][] = [];

  for (let r = 2; r <= dtWs.rowCount; r++) {
    const row = dtWs.getRow(r);
    const name = String(row.getCell(1).value ?? '').trim();
    if (!name) continue;

    const totalMatch = /^EDD\s+(.+?)\s+Total$/i.exec(name);
    if (totalMatch) {
      const key = norm(`EDD-${totalMatch[1]}`);
      const division = DIVISIONS.find((d) => norm(d) === key);
      if (!division) throw new Error(`DT-Count R${r}: unknown division "${name}"`);

      // Sum the substation rows rather than the total row: several totals are
      // shared formulas that exceljs cannot resolve to a value.
      const byCapacity = Array.from({ length: 9 }, (_, c) => pending.reduce((a, s) => a + s[c], 0));

      // Where the sheet's own total does resolve, it must agree.
      for (let c = 0; c < 9; c++) {
        const sheetTotal = row.getCell(2 + c);
        const raw = sheetTotal.value as unknown;
        const resolvable = typeof raw === 'number'
          || (typeof raw === 'object' && raw !== null && 'result' in (raw as Record<string, unknown>) && typeof (raw as { result: unknown }).result === 'number');
        if (resolvable && num(sheetTotal) !== byCapacity[c]) {
          throw new Error(`DT-Count ${division} ${capacityLabels[c]}: substations sum to ${byCapacity[c]}, total row says ${num(sheetTotal)}`);
        }
      }

      dtCount[division] = { substations: pending.length, byCapacity };
      pending = [];
      continue;
    }

    if (/circle total/i.test(name)) break;
    pending.push(Array.from({ length: 9 }, (_, c) => num(row.getCell(2 + c))));
  }

  const missing = DIVISIONS.filter((d) => !dtCount[d]);
  if (missing.length) throw new Error(`DT-Count: no block found for ${missing.join(', ')}`);

  // --- Emit ----------------------------------------------------------------
  const tuples = (rows: number[][]) =>
    rows.map((v, i) => `    ['${MONTHS[i]}', ${v.join(', ')}]`).join(',\n');

  const src = `// GENERATED FILE - DO NOT EDIT BY HAND.
// Regenerate with: npx tsx scripts/generate-field-data.ts
// Sources: public/Key-Point.xlsx, public/DT-Count.xlsx
// Generated: ${new Date().toISOString().slice(0, 10)}

export type WorkTuple = [string, ...number[]];
export type SurveyTuple = [string, ...number[]];

// [month, dtMaint, lug, bushing, silica, oil, earthing, dtLead, damageDt,
//  trim33, trim11, ins33, ins11, abc, weasel, stay, jumper, pole]
export const WORK_RAW: Record<string, WorkTuple[]> = {
${DIVISIONS.map((d) => `  '${d}': [\n${tuples(work[d])}\n  ]`).join(',\n')}
};

// [month, dtSurvey, lugReq, bushingReq, silicaReq, earthingReq, dtLeadReq,
//  lineSurveyKm, treeTrimReq, trim11Req, ins33Req, ins11Req, stayReq, poleReq]
export const SURVEY_RAW: Record<string, SurveyTuple[]> = {
${DIVISIONS.map((d) => `  '${d}': [\n${tuples(survey[d])}\n  ]`).join(',\n')}
};

// LT ABC Cable / Weasel Conductor requirements are single merged cells spanning
// all nine months of a division - period targets, not monthly figures.
export const PERIOD_MATERIAL_REQ_RAW: Record<string, { abcReq: number; weaselReq: number }> = {
${DIVISIONS.map((d) => `  '${d}': { abcReq: ${periodReq[d].abcReq}, weaselReq: ${periodReq[d].weaselReq} }`).join(',\n')}
};

/** Cells left empty in the source sheets (an entered zero is not a blank). */
export const BLANK_CELLS: { sheet: string; division: string; month: string; column: string }[] = [
${blanks.map((b) => `  { sheet: '${b.sheet}', division: '${b.division}', month: '${b.month}', column: ${JSON.stringify(b.column)} }`).join(',\n')}
];

/** Transformer capacity buckets, smallest to largest (an ordered scale). */
export const CAPACITY_LABELS = [${capacityLabels.map((l) => `'${l}'`).join(', ')}] as const;

/** Installed DT population per division, split by capacity. */
export const DT_COUNT_RAW: Record<string, { substations: number; byCapacity: number[] }> = {
${DIVISIONS.map((d) => `  '${d}': { substations: ${dtCount[d].substations}, byCapacity: [${dtCount[d].byCapacity.join(', ')}] }`).join(',\n')}
};
`;

  fs.writeFileSync(OUT, src, 'utf8');

  const grand = DIVISIONS.reduce((a, d) => a + dtCount[d].byCapacity.reduce((x, y) => x + y, 0), 0);
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
  console.log(`  Key-Point : ${DIVISIONS.length} divisions × ${MONTHS.length} months`);
  console.log(`  Blanks    : ${blanks.length} empty cell(s) in Key-Point.xlsx`);
  blanks.forEach((b) => console.log(`    ${b.sheet} · ${b.division} · ${b.month} · ${b.column}`));
  console.log(`  DT-Count  : ${DIVISIONS.reduce((a, d) => a + dtCount[d].substations, 0)} substations, ${grand.toLocaleString('en-IN')} DTs`);
  DIVISIONS.forEach((d) => {
    const t = dtCount[d].byCapacity.reduce((x, y) => x + y, 0);
    console.log(`    ${d.padEnd(20)} ${String(dtCount[d].substations).padStart(3)} substations  ${String(t).padStart(6)} DTs`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
