/**
 * Diagnostic-only helpers for the Phase 0 scripts. The request templates and
 * parsers now live in app/lib/frt-calling.ts (single source of truth, shared with
 * the app); this file re-exports them and adds a couple of test-only helpers
 * (raw fetch replay + PII redaction) that don't belong in the app.
 */

export {
    LIST_INPUTXML, DETAIL_CHILDREN, buildDetailInputxml,
    parseRowsets, parseResultsByChild
} from '../app/lib/frt-calling';

const BASE_URL = 'https://www.frtbarabanki.com';
const ENDPOINT = '/api/AppsavyServices/GetRelationalDataA';
export { BASE_URL, ENDPOINT };

export async function replayFrt(headers: Record<string, string>, cookieHeader: string, inputxml: string) {
    const body = JSON.stringify({ inputxml: Buffer.from(inputxml, 'utf8').toString('base64'), DocVersion: 1 });
    const res = await fetch(BASE_URL + ENDPOINT, {
        method: 'POST',
        headers: { ...headers, cookie: cookieHeader },
        body,
        redirect: 'manual'
    });
    const text = await res.text();
    return { status: res.status, hasResult: text.includes('<RESULT'), text };
}

const PII_FIELDS = /name|mobile|phone|address|landmark|consumer/i;
export function redactRow(row: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
        out[k] = PII_FIELDS.test(k) && v ? `<${v.length} chars>` : v;
    }
    return out;
}
