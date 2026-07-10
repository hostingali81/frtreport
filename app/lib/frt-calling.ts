/**
 * FRT Calling App — data layer (Phase 1).
 *
 * Fetches the live complaints grid (FormId 13339) and complaint detail
 * (FormId 13340) over plain HTTP by replaying a captured session, and upserts
 * into Supabase (queue state -> live_complaints, descriptive/contact data ->
 * complaints; the API reads the joined live_complaints_full view). The browser
 * is only used to (re)capture the session when it expires. See PROJECT-PLAN.md.
 *
 * Request/response shapes were confirmed in Phase 0 (scripts/verify-calling-forms.ts):
 *   list   -> <Rowset><DATAID>..</DATAID><COMPLAINTS>..</COMPLAINTS>...</Rowset>
 *   detail -> one <RESULTS CHILDCONTROLID="X"> block per requested child control
 */

import {
    FrtApiAuthError,
    getSupabaseClient,
    refreshFrtSessions,
    type FrtCallingApiSession
} from './shared-scraper';

// --- endpoint / request templates ---
const BASE_URL = 'https://www.frtbarabanki.com';
const ENDPOINT = '/api/AppsavyServices/GetRelationalDataA';
const CALLING_SESSION_KEY = 'frt_calling_session';

// Account-wide envelope (all confirmed constants — PROJECT-PLAN.md Appendix A).
const REQUEST_ENVELOPE =
    '<?xml version="1.0"?><Request VERSION="2" LANGUAGE_ID="" LOCATION="">' +
    '<Company Company_Id="1" /><Project Project_Id="339" />' +
    '<User User_Id="CONTROL_ROOM_BARABANKI" /><IUVLogin IUVLogin_Id="9311912726" />' +
    '<ROLE ROLE_ID="1882" />';

// Grid (control 143649) is loaded by the 143630 event tile.
export const LIST_INPUTXML =
    `${REQUEST_ENVELOPE}<Event Control_Id="143630" />` +
    '<Child Control_Id="143649" Report="HTML" AC_ID="196143"></Child></Request>';

// Detail children (control -> field). 143608/MOBILENO + 143610/CONSUMER_NAME are
// the whole point; the form's own request omits them, so we request them here.
export const DETAIL_CHILDREN: Array<{ ctrl: string; ac: string; field: string; column: Exclude<keyof ContactRecord, 'dataid'> }> = [
    { ctrl: '143610', ac: '195998', field: 'CONSUMER_NAME', column: 'consumer_name' },
    { ctrl: '143608', ac: '195997', field: 'MOBILENO', column: 'mobile' },
    { ctrl: '143704', ac: '196047', field: 'ADDRESS', column: 'address' },
    { ctrl: '143705', ac: '196048', field: 'LANDMARK', column: 'landmark' },
    { ctrl: '143703', ac: '196049', field: 'REMARKS', column: 'remarks' },
    { ctrl: '143905', ac: '196663', field: 'SUBSTATION', column: 'substation' },
    { ctrl: '143601', ac: '196001', field: 'CREW_NAME', column: 'assigned_crew' },
    { ctrl: '143609', ac: '196000', field: 'MOBILE', column: 'crew_mobile' }
];

export function buildDetailInputxml(dataId: string | number): string {
    const value = String(dataId);
    const children = DETAIL_CHILDREN.map(c =>
        `<Child Control_Id="${c.ctrl}" Report="HTML" AC_ID="${c.ac}">` +
        `<Parent Control_Id="143655" Value="${value}" Data_Form_Id="" XValue="${value}" YValue="" ZValue=""/></Child>`
    ).join('');
    return `${REQUEST_ENVELOPE}<Event Control_Id="0" />${children}</Request>`;
}

// --- XML parsing ---
function decodeEntities(v: string): string {
    return v
        .replace(/&#(\d+);/g, (_, c: string) => String.fromCharCode(Number(c)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, c: string) => String.fromCharCode(parseInt(c, 16)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

export function parseRowsets(xml: string): Array<Record<string, string>> {
    const blocks = xml.match(/<Rowset\b[^>]*>[\s\S]*?<\/Rowset>/gi) || [];
    return blocks.map(block => {
        const inner = block.replace(/^<Rowset\b[^>]*>/i, '').replace(/<\/Rowset>\s*$/i, '');
        const row: Record<string, string> = {};
        const fieldRe = /<([A-Za-z_][\w]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
        let m: RegExpExecArray | null;
        while ((m = fieldRe.exec(inner)) !== null) {
            row[m[1]] = decodeEntities(m[2]).replace(/\s+/g, ' ').trim();
        }
        return row;
    });
}

export function parseResultsByChild(xml: string): Record<string, Array<Record<string, string>>> {
    const out: Record<string, Array<Record<string, string>>> = {};
    for (const part of xml.split(/<RESULTS\b/i).slice(1)) {
        const childMatch = part.match(/CHILDCONTROLID="([^"]*)"/i);
        out[childMatch ? childMatch[1] : 'unknown'] = parseRowsets(part);
    }
    return out;
}

// FRT list dates come as M/D/YYYY h:mm:ss AM/PM (IST). Store as timestamptz IST.
export function parseFrtDateTime(value: string | undefined | null): string | null {
    if (!value) return null;
    const m = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i);
    if (!m) return null;
    const [, mm, dd, yyyy, hh, min, ss, ap] = m;
    let hours = Number(hh);
    if (/pm/i.test(ap) && hours < 12) hours += 12;
    if (/am/i.test(ap) && hours === 12) hours = 0;
    const p = (n: number | string) => String(n).padStart(2, '0');
    return `${yyyy}-${p(mm)}-${p(dd)}T${p(hours)}:${p(min)}:${p(ss || '00')}+05:30`;
}

// --- record shapes (mirror the Supabase columns) ---
export type ComplaintRecord = {
    dataid: number;
    complaint_number: string | null;
    fault_id: number | null;
    complaint_type: string | null;
    complaint_sub_type: string | null;
    district: string | null;
    area: string | null;
    area_type: string | null;
    feeder: string | null;
    action_status: string | null;
    complaint_date: string | null;
};

export type ContactRecord = {
    dataid: number;
    consumer_name: string | null;
    mobile: string | null;
    address: string | null;
    landmark: string | null;
    remarks: string | null;
    substation: string | null;
    assigned_crew: string | null;
    crew_mobile: string | null;
};

function nz(v: string | undefined): string | null {
    const t = (v ?? '').trim();
    return t.length ? t : null;
}

export function mapListRow(row: Record<string, string>): ComplaintRecord | null {
    const dataid = Number(row.DATAID);
    if (!Number.isFinite(dataid) || dataid <= 0) return null;
    const faultId = Number(row.FAULT_ID);
    return {
        dataid,
        complaint_number: nz(row.COMPLAINTS),
        fault_id: Number.isFinite(faultId) ? faultId : null,
        complaint_type: nz(row.COMPLAINT_TYPE),
        complaint_sub_type: nz(row.COMPLAINT_SUB_TYPE),
        district: nz(row.DISTRICT),
        area: nz(row.AREA),
        area_type: nz(row.AREA_TYPE),
        feeder: nz(row.FEEDER),
        action_status: nz(row.ACTION),
        complaint_date: parseFrtDateTime(row.COMPLAINT_DATE)
    };
}

export function mapDetail(dataid: number, byChild: Record<string, Array<Record<string, string>>>): ContactRecord {
    const record: ContactRecord = {
        dataid,
        consumer_name: null, mobile: null, address: null, landmark: null,
        remarks: null, substation: null, assigned_crew: null, crew_mobile: null
    };
    for (const c of DETAIL_CHILDREN) {
        const value = byChild[c.ctrl]?.[0]?.[c.field];
        record[c.column] = nz(value);
    }
    return record;
}

// --- HTTP replay ---
async function fetchGetRelationalData(headers: Record<string, string>, cookieHeader: string, inputxml: string) {
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

// --- cached session (reuses the existing `reports` table, like the report app) ---
async function loadCachedCallingSession(): Promise<FrtCallingApiSession | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase.from('reports').select('payload').eq('key', CALLING_SESSION_KEY).maybeSingle();
        if (error || !data?.payload) return null;
        const s = data.payload as FrtCallingApiSession;
        if (!s.listHeaders || !s.detailHeaders || !s.cookieHeader) return null;
        return s;
    } catch {
        return null;
    }
}

// Note: the cached calling session is WRITTEN by refreshFrtSessions() in
// shared-scraper.ts (one login refreshes both the report and calling sessions);
// this module only loads it for replay.

export type FrtCallingClient = {
    fetchList: () => Promise<ComplaintRecord[]>;
    fetchContact: (dataId: number) => Promise<ContactRecord>;
};

// Fast client: replays the cached session; on auth rejection re-captures once via
// browser login (de-duplicated so concurrent callers share one capture).
export async function createFrtCallingClient(username: string, password: string): Promise<FrtCallingClient> {
    let session = await loadCachedCallingSession();
    let capturePromise: Promise<FrtCallingApiSession> | null = null;

    const captureFresh = () => {
        if (!capturePromise) {
            capturePromise = (async () => {
                // Refresh BOTH sessions from one login so this recapture doesn't
                // invalidate the report session (see refreshFrtSessions).
                const { calling } = await refreshFrtSessions(username, password);
                session = calling;
                return calling;
            })().finally(() => { capturePromise = null; });
        }
        return capturePromise;
    };

    const replay = async (which: 'list' | 'detail', inputxml: string): Promise<string> => {
        if (!session) await captureFresh();
        let attempt = 0;
        while (true) {
            attempt += 1;
            const headers = which === 'list' ? session!.listHeaders : session!.detailHeaders;
            const res = await fetchGetRelationalData(headers, session!.cookieHeader, inputxml);
            if (res.status === 200 && res.hasResult) return res.text;

            const authReject = [301, 302, 303, 307, 308, 401, 403].includes(res.status) || !res.hasResult;
            if (authReject) {
                if (attempt >= 3) throw new FrtApiAuthError(`FRT calling session rejected (HTTP ${res.status})`);
                await captureFresh();
                continue;
            }
            throw new Error(`FRT calling API failed (HTTP ${res.status})`);
        }
    };

    return {
        fetchList: async () => {
            const rows = parseRowsets(await replay('list', LIST_INPUTXML));
            return rows.map(mapListRow).filter((r): r is ComplaintRecord => r !== null);
        },
        fetchContact: async (dataId: number) => {
            const byChild = parseResultsByChild(await replay('detail', buildDetailInputxml(dataId)));
            return mapDetail(dataId, byChild);
        }
    };
}

// --- Supabase persistence ---
export type SyncResult = { fetched: number; upserted: number; markedResolved: number };

export async function syncLiveComplaints(rows: ComplaintRecord[]): Promise<SyncResult> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured');

    const now = new Date().toISOString();
    // The grid occasionally repeats a DATAID; duplicate conflict keys inside one
    // upsert batch make Postgres reject the whole statement ("ON CONFLICT DO
    // UPDATE command cannot affect row a second time"), so keep the last
    // occurrence of each.
    const byDataid = new Map<number, ComplaintRecord>();
    for (const r of rows) byDataid.set(r.dataid, r);

    // Descriptive data lives only in the main complaints table; the API joins it
    // back via the live_complaints_full view. The RPC coalesces per column so a
    // transiently blank grid cell never NULLs out scraper-written data.
    const meta = Array.from(byDataid.values())
        .filter(r => r.complaint_number)
        .map(r => ({
            complaint_number: r.complaint_number,
            dataid: r.dataid,
            complaint_type: r.complaint_type,
            complaint_sub_type: r.complaint_sub_type,
            sub_station: r.area,
            area_type: r.area_type,
            feeder: r.feeder,
            complaint_date: r.complaint_date
        }));
    if (meta.length) {
        const { error } = await supabase.rpc('upsert_live_complaint_meta', { rows: meta });
        if (error) throw new Error(`complaints meta upsert failed: ${error.message}`);
    }

    // live_complaints keeps only queue state (+ district, which complaints
    // doesn't have a column for).
    const payload = Array.from(byDataid.values()).map(r => ({
        dataid: r.dataid,
        complaint_number: r.complaint_number,
        fault_id: r.fault_id,
        district: r.district,
        action_status: r.action_status,
        last_synced_at: now,
        still_in_feed: true
    }));

    if (payload.length) {
        for (let i = 0; i < payload.length; i += 500) {
            const batch = payload.slice(i, i + 500);
            const { error } = await supabase
                .from('live_complaints')
                .upsert(batch, { onConflict: 'dataid', ignoreDuplicates: false });
            if (error) throw new Error(`live_complaints upsert failed: ${error.message}`);
        }
    }

    // Anything previously in the feed but absent now has left the live grid.
    let markedResolved = 0;
    const currentIds = Array.from(byDataid.keys());
    if (currentIds.length) {
        const { data, error } = await supabase
            .from('live_complaints')
            .update({ still_in_feed: false, last_synced_at: now })
            .eq('still_in_feed', true)
            .not('dataid', 'in', `(${currentIds.join(',')})`)
            .select('dataid');
        if (error) throw new Error(`live_complaints resolve-sweep failed: ${error.message}`);
        markedResolved = data?.length ?? 0;
    }

    return { fetched: rows.length, upserted: payload.length, markedResolved };
}

export async function saveContact(contact: ContactRecord): Promise<ContactRecord> {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured');
    
    // Get the complaint_number associated with this dataid
    const { data: lc, error: lcError } = await supabase
        .from('live_complaints')
        .select('complaint_number')
        .eq('dataid', contact.dataid)
        .maybeSingle();

    if (!lc || lcError) {
        throw new Error(`Cannot save contact: no live_complaint found for dataid ${contact.dataid}`);
    }

    // Upsert only the contact fields into the main complaints table; the
    // descriptive/status columns are owned by the sync RPC and report scraper.
    const { error } = await supabase
        .from('complaints')
        .upsert({
            complaint_number: lc.complaint_number,
            dataid: contact.dataid,
            consumer_name: contact.consumer_name,
            consumer_mobile: contact.mobile,
            consumer_address: contact.address,
            landmark: contact.landmark,
            assigned_crew: contact.assigned_crew,
            crew_mobile: contact.crew_mobile,
            sub_station: contact.substation,
            consumer_remarks: contact.remarks
        }, { onConflict: 'complaint_number' });

    if (error) throw new Error(`complaints upsert failed: ${error.message}`);
    return contact;
}

export async function getCachedContact(dataId: number): Promise<ContactRecord | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('complaints')
        .select('dataid, consumer_name, consumer_mobile, consumer_address, landmark, consumer_remarks, sub_station, assigned_crew, crew_mobile')
        .eq('dataid', dataId)
        .maybeSingle();
        
    if (error || !data) return null;
    
    return {
        dataid: data.dataid,
        consumer_name: data.consumer_name,
        mobile: data.consumer_mobile,
        address: data.consumer_address,
        landmark: data.landmark,
        remarks: data.consumer_remarks,
        substation: data.sub_station,
        assigned_crew: data.assigned_crew,
        crew_mobile: data.crew_mobile,
    };
}
