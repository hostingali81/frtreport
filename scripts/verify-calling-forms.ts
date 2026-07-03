/**
 * Phase 0 verification for the FRT Calling App (see PROJECT-PLAN.md §10).
 *
 * Logs in ONCE via the existing browser session (reuses createFrtScraperSession
 * so we don't re-implement the encrypted login), captures the per-form session
 * headers for FormId 13339 (live complaints grid) and 13340 (complaint detail),
 * then — over plain Node fetch, no browser — confirms end-to-end that:
 *   - the real complaint grid list returns rows (Event 143630 -> Child 143649)
 *   - a full complaint detail returns CONSUMER_NAME + MOBILENO (the callable number)
 *
 * Answers §10 open questions: Q1 formid per-form/stable, Q2 fetch replay works,
 * Q7 how many rows the grid returns.
 *
 * READ-ONLY against FRT. Nothing is written to Supabase.
 * Run:   npx tsx scripts/verify-calling-forms.ts
 * Output (both under scripts/.capture/, gitignored):
 *   verify-calling-forms.<ts>.json          full dump (real tokens + PII — keep local)
 *   verify-calling-forms.<ts>.summary.json  redacted, safe to paste to me
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import { createFrtScraperSession, type FrtPageLike } from '../app/lib/shared-scraper';
import {
    BASE_URL, DETAIL_CHILDREN, ENDPOINT, LIST_INPUTXML,
    buildDetailInputxml, parseResultsByChild, parseRowsets, redactRow, replayFrt
} from './frt-calling-shared';

const FORM_LIST = 13339;
const FORM_DETAIL = 13340;
const CAPTURE_DIR = path.resolve(process.cwd(), 'scripts', '.capture');
const SHARED_HEADER_KEYS = ['token', 'roleid', 'sourcetype', 'appsavylogin'] as const;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- .env.local loader (tsx does not read Next.js env files automatically) ---
function loadEnvLocal() {
    const file = path.resolve(process.cwd(), '.env.local');
    if (!existsSync(file)) return;
    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}

// --- captured request bookkeeping (we only need each form's session headers) ---
type Captured = { phase: string; headers: Record<string, string>; bodyRaw: string; inputxml: string | null; formidHeader: string | null };
const captured: Captured[] = [];
let currentPhase = 'init';

function extractHeaders(raw: Record<string, string>) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
        const lk = k.toLowerCase();
        if (lk.startsWith(':') || lk === 'cookie' || lk === 'content-length' || lk === 'host') continue;
        headers[lk] = v;
    }
    return headers;
}

function registerCapture(page: FrtPageLike) {
    page.on('request', (req: { url: () => string; method: () => string; headers: () => Record<string, string>; postData: () => string | undefined }) => {
        try {
            if (!req.url().includes(ENDPOINT) || req.method() !== 'POST') return;
            const bodyRaw = req.postData() || '';
            let inputxml: string | null = null;
            try {
                const parsed = JSON.parse(bodyRaw) as { inputxml?: string };
                inputxml = Buffer.from(String(parsed.inputxml || ''), 'base64').toString('utf8');
            } catch { inputxml = null; }
            const headers = extractHeaders(req.headers());
            captured.push({ phase: currentPhase, headers, bodyRaw, inputxml, formidHeader: headers.formid ?? null });
            console.log(`  [capture:${currentPhase}] GetRelationalDataA  formid=${(headers.formid || '').slice(0, 8)}…`);
        } catch { /* never let capture break navigation */ }
    });
}

async function waitForCapture(phase: string, timeoutMs: number) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (captured.some(c => c.phase === phase)) return true;
        await sleep(250);
    }
    return false;
}

// Lightweight DOM note (grid is a JS control, not an HTML table — recorded for reference).
type DomNote = { url: string; title: string; onLoginPage: boolean; tableIds: string[]; ctrlIds: string[] };
function snapshotDom(page: FrtPageLike) {
    return page.evaluate<DomNote>(function () {
        return {
            url: location.href,
            title: document.title || '',
            onLoginPage: !!document.querySelector('#txtPassword, #btnlogin'),
            tableIds: Array.from(document.querySelectorAll('table')).map(t => t.id).filter(Boolean).slice(0, 20),
            ctrlIds: Array.from(document.querySelectorAll('[id]')).map(el => el.id).filter(id => /^ctrl\d+/.test(id)).slice(0, 40)
        };
    });
}

async function loadCached13345Session(): Promise<{ headers?: Record<string, string> } | null> {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE;
    if (!url || !key) return null;
    try {
        const supabase = createClient(url, key);
        const { data } = await supabase.from('reports').select('payload').eq('key', 'frt_api_session').maybeSingle();
        return (data?.payload as { headers?: Record<string, string> }) || null;
    } catch { return null; }
}

function redactHeaders(h: Record<string, string>) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) out[k] = `<${(v || '').length} chars>`;
    return out;
}

async function main() {
    loadEnvLocal();
    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';

    const username = process.env.FRT_USERNAME;
    const password = process.env.FRT_PASSWORD;
    if (!username || !password) {
        console.error('Missing FRT_USERNAME / FRT_PASSWORD (checked .env.local and process env).');
        process.exit(1);
    }

    console.log('[verify] Logging in via browser (reuses the proven login flow)…');
    const session = await createFrtScraperSession(username, password);
    if (!session.getPage) { await session.close(); throw new Error('Session did not expose getPage(); shared-scraper change missing.'); }
    const page = session.getPage();

    const cached13345 = await loadCached13345Session();

    try {
        registerCapture(page);

        // Navigate to each form to capture its per-form session headers (formid).
        console.log(`[verify] Navigating to FormId ${FORM_LIST} (grid) to capture its session headers…`);
        currentPhase = 'list-nav';
        await page.goto(`${BASE_URL}/UI/Form?FormId=${FORM_LIST}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await waitForCapture('list-nav', 12000);
        await sleep(1000);
        const listDom = await snapshotDom(page).catch(() => null);

        console.log(`[verify] Navigating to FormId ${FORM_DETAIL} (detail) to capture its session headers…`);
        currentPhase = 'detail-nav';
        await page.goto(`${BASE_URL}/UI/Form?FormId=${FORM_DETAIL}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await waitForCapture('detail-nav', 10000);

        const cookies = await page.cookies();
        const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        const listReq = captured.find(c => c.phase.startsWith('list'));
        const detailReq = captured.find(c => c.phase.startsWith('detail'));

        // ---- Core architecture test: replay the REAL grid list over plain fetch ----
        let listRows: Array<Record<string, string>> = [];
        let listStatus = 0;
        if (listReq) {
            console.log('[verify] Replaying REAL complaint grid list over plain Node fetch (no browser)…');
            const res = await replayFrt(listReq.headers, cookieHeader, LIST_INPUTXML);
            listStatus = res.status;
            listRows = res.hasResult ? parseRowsets(res.text) : [];
            console.log(`[verify]   status=${res.status} rows=${listRows.length} fields=[${(listRows[0] ? Object.keys(listRows[0]) : []).join(',')}]`);
        } else {
            console.log('[verify] No list session captured — cannot replay.');
        }

        // ---- Full detail incl. CONSUMER_NAME + MOBILENO for the first complaint ----
        const firstDataId = listRows.find(r => r.DATAID)?.DATAID || null;
        let detailStatus = 0;
        let detailPerChild: Array<{ control: string; label: string; rowCount: number; fieldTags: string[]; sample: Array<Record<string, string>> }> = [];
        let mobileFound = false;
        if (detailReq && firstDataId) {
            console.log(`[verify] Replaying FULL detail for DATAID=${firstDataId} (confirming the phone number)…`);
            const res = await replayFrt(detailReq.headers, cookieHeader, buildDetailInputxml(firstDataId));
            detailStatus = res.status;
            const byChild = res.hasResult ? parseResultsByChild(res.text) : {};
            const labelOf = Object.fromEntries(DETAIL_CHILDREN.map(c => [c.ctrl, c.field]));
            detailPerChild = Object.entries(byChild).map(([control, rows]) => ({
                control, label: labelOf[control] || '(unmapped)', rowCount: rows.length,
                fieldTags: rows.length ? [...new Set(rows.flatMap(r => Object.keys(r)))] : [],
                sample: rows.slice(0, 2).map(redactRow)
            }));
            const mobileChild = detailPerChild.find(c => c.label === 'MOBILENO');
            mobileFound = !!mobileChild && mobileChild.rowCount > 0 && mobileChild.sample.some(r => Object.values(r).some(Boolean));
            console.log(`[verify]   status=${res.status}  MOBILENO retrieved: ${mobileFound}`);
            for (const c of detailPerChild) console.log(`     ${c.control} ${c.label}: rows=${c.rowCount} tags=[${c.fieldTags.join(',')}]`);
        }

        // ---- formid comparison (Q1) ----
        const formidComparison = {
            list_13339: listReq?.formidHeader ?? null,
            detail_13340: detailReq?.formidHeader ?? null,
            cached_13345: cached13345?.headers?.formid ?? null,
            list_vs_detail_same: !!listReq?.formidHeader && listReq.formidHeader === detailReq?.formidHeader
        };
        const sharedHeaderMatch: Record<string, boolean | 'no-cache' | 'no-capture'> = {};
        for (const k of SHARED_HEADER_KEYS) {
            if (!listReq) sharedHeaderMatch[k] = 'no-capture';
            else if (!cached13345?.headers) sharedHeaderMatch[k] = 'no-cache';
            else sharedHeaderMatch[k] = listReq.headers[k] === cached13345.headers[k];
        }

        // ---- write outputs ----
        mkdirSync(CAPTURE_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fullPath = path.join(CAPTURE_DIR, `verify-calling-forms.${stamp}.json`);
        const summaryPath = path.join(CAPTURE_DIR, `verify-calling-forms.${stamp}.summary.json`);

        writeFileSync(fullPath, JSON.stringify({
            savedAt: new Date().toISOString(),
            capturedRequests: captured, cookieHeader, listDom,
            listRows, firstDataId, detailPerChild, formidComparison, sharedHeaderMatch
        }, null, 2), 'utf8');

        const summary = {
            savedAt: new Date().toISOString(),
            answers: {
                Q1_formid_per_form: formidComparison,
                Q2_shared_headers_match_13345: sharedHeaderMatch,
                Q2_fetch_replay_list_status: listStatus,
                Q2_fetch_replay_detail_status: detailStatus,
                Q7_grid_row_count: listRows.length,
                MOBILENO_retrievable: mobileFound
            },
            list_13339: {
                formidHeaderLength: listReq ? (listReq.headers.formid || '').length : null,
                headerKeys: listReq ? Object.keys(listReq.headers) : null,
                inputxmlUsed: LIST_INPUTXML,
                fields: listRows[0] ? Object.keys(listRows[0]) : [],
                sampleRows: listRows.slice(0, 3).map(redactRow)
            },
            detail_13340: {
                formidHeaderLength: detailReq ? (detailReq.headers.formid || '').length : null,
                dataIdUsed: firstDataId,
                perChild: detailPerChild
            },
            list_dom: listDom,
            cookieNames: cookies.map(c => c.name)
        };
        writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

        console.log('\n================ VERIFY SUMMARY ================');
        console.log(`formid per-form: ${JSON.stringify(formidComparison)}`);
        console.log(`list replay: HTTP ${listStatus}, rows=${listRows.length}`);
        console.log(`detail replay: HTTP ${detailStatus}, MOBILENO retrievable: ${mobileFound}`);
        console.log(`\nFull dump  (keep local): ${fullPath}`);
        console.log(`Shareable  (paste to me): ${summaryPath}`);
        console.log('================================================\n');
    } finally {
        await session.close();
    }
}

main().catch(err => { console.error('\n[verify] FAILED:', err?.message || err); process.exit(1); });
