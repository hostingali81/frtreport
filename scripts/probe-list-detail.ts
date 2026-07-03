/**
 * Phase 0 follow-up probe (no new login).
 *
 * Reuses the session already captured by verify-calling-forms.ts (read from the
 * latest scripts/.capture/verify-calling-forms.*.json dump) and replays, over
 * plain Node fetch:
 *   1. the REAL complaint grid list  (FormId 13339, Event 143630 -> Child 143649/AC 196143)
 *   2. a REAL, FULL complaint detail  (FormId 13340, incl. CONSUMER_NAME + MOBILENO)
 *
 * Only works while the captured session is still valid (FRT sessions expire after
 * a few hours). If it 401s, re-run verify-calling-forms.ts for a fresh session —
 * that script now also does this end-to-end confirmation in one go.
 *
 * READ-ONLY against FRT. Run: npx tsx scripts/probe-list-detail.ts [dump.json]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import {
    DETAIL_CHILDREN, LIST_INPUTXML, buildDetailInputxml,
    parseResultsByChild, parseRowsets, redactRow, replayFrt
} from './frt-calling-shared';

const CAPTURE_DIR = path.resolve(process.cwd(), 'scripts', '.capture');

type Captured = { phase: string; headers: Record<string, string>; inputxml: string | null };
type Dump = { capturedRequests: Captured[]; cookieHeader: string };

function latestDump(): string {
    const files = readdirSync(CAPTURE_DIR)
        .filter(f => /^verify-calling-forms\..*\.json$/.test(f) && !f.endsWith('.summary.json'))
        .sort();
    if (!files.length) throw new Error(`No verify-calling-forms dump in ${CAPTURE_DIR}. Run verify-calling-forms.ts first.`);
    return path.join(CAPTURE_DIR, files[files.length - 1]);
}

async function main() {
    const dumpPath = process.argv[2] ? path.resolve(process.argv[2]) : latestDump();
    if (!existsSync(dumpPath)) throw new Error(`Dump not found: ${dumpPath}`);
    const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as Dump;
    console.log(`[probe] Using session from ${path.basename(dumpPath)}`);

    const listCapture = dump.capturedRequests.find(c => c.phase.startsWith('list'));
    const detailCapture = dump.capturedRequests.find(c => c.phase.startsWith('detail'));
    if (!listCapture || !detailCapture) throw new Error('Dump missing list or detail capture.');

    console.log('[probe] Replaying real complaint grid list…');
    const listRes = await replayFrt(listCapture.headers, dump.cookieHeader, LIST_INPUTXML);
    const listRows = listRes.hasResult ? parseRowsets(listRes.text) : [];
    const listFields = listRows.length ? Object.keys(listRows[0]) : [];
    console.log(`[probe]   status=${listRes.status} rows=${listRows.length} fields=${listFields.join(', ') || '(none)'}`);
    if (listRes.status === 401) console.log('[probe]   session expired — re-run verify-calling-forms.ts.');

    const firstDataId = listRows.find(r => r.DATAID)?.DATAID || null;
    let detail: unknown = 'skipped';
    if (firstDataId) {
        console.log(`[probe] Replaying FULL detail for DATAID=${firstDataId}…`);
        const detailRes = await replayFrt(detailCapture.headers, dump.cookieHeader, buildDetailInputxml(firstDataId));
        const byChild = detailRes.hasResult ? parseResultsByChild(detailRes.text) : {};
        const labelOf = Object.fromEntries(DETAIL_CHILDREN.map(c => [c.ctrl, c.field]));
        const perChild = Object.entries(byChild).map(([control, rows]) => ({
            control, label: labelOf[control] || '(unmapped)', rowCount: rows.length,
            fieldTags: rows.length ? [...new Set(rows.flatMap(r => Object.keys(r)))] : [],
            sample: rows.slice(0, 2).map(redactRow)
        }));
        console.log(`[probe]   status=${detailRes.status}`);
        for (const c of perChild) console.log(`     ${c.control} ${c.label}: rows=${c.rowCount} tags=[${c.fieldTags.join(',')}]`);
        detail = { status: detailRes.status, dataIdUsed: firstDataId, perChild };
    }

    mkdirSync(CAPTURE_DIR, { recursive: true });
    const outPath = path.join(CAPTURE_DIR, `probe-list-detail.${new Date().toISOString().replace(/[:.]/g, '-')}.summary.json`);
    writeFileSync(outPath, JSON.stringify({
        savedAt: new Date().toISOString(),
        list: { status: listRes.status, rowCount: listRows.length, fields: listFields, sampleRows: listRows.slice(0, 3).map(redactRow) },
        detail
    }, null, 2), 'utf8');
    console.log(`\nShareable (paste to me): ${outPath}\n`);
}

main().catch(err => { console.error('\n[probe] FAILED:', err?.message || err); process.exit(1); });
