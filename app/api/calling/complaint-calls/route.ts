import { NextResponse } from 'next/server';

import { canonicalFault, isDeskFilled, operatorRemark } from '../../../lib/faults';
import { getSupabaseClient } from '../../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The drill-down behind the Calling Report's aggregates: one row per complaint
// that has at least one logged call, with its full call history attached.
// /api/calling/analytics answers "how many"; this answers "which ones, and what
// was said". Range filters on complaint_date so the numbers reconcile with the
// rest of the tab (get_calling_stats filters the same way).
//
// call_logs is small (~13k rows since the calling app launched 03/07/2026), so
// grouping here instead of in a new RPC keeps the free-tier DB out of another
// full-table aggregation. Responses are cached for a minute like the sibling
// analytics route.

const CACHE_TTL = 60 * 1000;
const cache = new Map<string, { timestamp: number; payload: unknown }>();
const BATCH = 1000; // PostgREST caps every query at 1000 rows — page past it.

function istDateOnly(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function subtractDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type ComplaintAttrs = {
  division: string | null; sub_division: string | null; sub_station: string | null;
  feeder: string | null; area_type: string | null; complaint_type: string | null;
  complaint_sub_type: string | null; status: string | null; closed_status: string | null;
  complaint_date: string | null; closed_date: string | null; closing_remarks: string | null;
  consumer_name: string | null; consumer_mobile: string | null; consumer_address: string | null;
};

type LogRow = {
  id: number;
  complaint_number: string | null;
  call_time: string;
  call_status: string | null;
  problem_category: string | null;
  notes: string | null;
  operator: string | null;
  duration_seconds: number | null;
  connected: boolean | null;
  is_incoming: boolean | null;
  complaints: ComplaintAttrs | null;
};

// One logged call, trimmed for the wire.
type Call = {
  time: string;
  status: string | null;
  connected: boolean;
  seconds: number;
  fault: string | null;
  remark: string;
  operator: string | null;
  incoming: boolean;
  deskFilled: boolean;
};

const SELECT_COLS =
  'id, complaint_number, call_time, call_status, problem_category, notes, operator, duration_seconds, connected, is_incoming, ' +
  'complaints!inner(division, sub_division, sub_station, feeder, area_type, complaint_type, complaint_sub_type, status, closed_status, complaint_date, closed_date, closing_remarks, consumer_name, consumer_mobile, consumer_address)';

// Old rows have connected=null; fall back to the recorded status.
const isConnected = (l: LogRow): boolean => l.connected ?? l.call_status === 'Connected';

const distinctSorted = (values: (string | null | undefined)[]): string[] =>
  Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== ''))).sort((a, b) => a.localeCompare(b));

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const { searchParams } = new URL(request.url);
    const allTime = searchParams.get('all') === '1';
    const todayIst = istDateOnly(new Date());
    let from = searchParams.get('from') || subtractDays(todayIst, 6);
    let to = searchParams.get('to') || todayIst;
    if (!DATE_ONLY.test(from)) from = subtractDays(todayIst, 6);
    if (!DATE_ONLY.test(to)) to = todayIst;

    const cacheKey = allTime ? 'all' : `${from}|${to}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return NextResponse.json(cached.payload);

    const logs: LogRow[] = [];
    for (let offset = 0; ; offset += BATCH) {
      let query = supabase
        .from('call_logs')
        .select(SELECT_COLS)
        .order('id', { ascending: false }) // stable, so offset paging can't skip/dupe rows
        .range(offset, offset + BATCH - 1);
      if (!allTime) {
        query = query
          .gte('complaints.complaint_date', `${from}T00:00:00+05:30`)
          .lte('complaints.complaint_date', `${to}T23:59:59+05:30`);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const page = (data as unknown as LogRow[]) || [];
      logs.push(...page);
      if (page.length < BATCH) break;
    }

    // Group into one row per complaint.
    const byComplaint = new Map<string, {
      complaintNumber: string;
      complaintDate: string | null;
      closedDate: string | null;
      division: string | null;
      subDivision: string | null;
      substation: string | null;
      feeder: string | null;
      areaType: string | null;
      complaintType: string | null;
      complaintSubType: string | null;
      status: string | null;
      closedStatus: string | null;
      closingRemarks: string | null;
      consumerName: string | null;
      consumerMobile: string | null;
      consumerAddress: string | null;
      calls: Call[];
    }>();

    for (const l of logs) {
      const c = l.complaints;
      if (!c || !l.complaint_number) continue;
      let entry = byComplaint.get(l.complaint_number);
      if (!entry) {
        entry = {
          complaintNumber: l.complaint_number,
          complaintDate: c.complaint_date,
          closedDate: c.closed_date,
          division: c.division,
          subDivision: c.sub_division,
          substation: c.sub_station,
          feeder: c.feeder,
          areaType: c.area_type,
          complaintType: c.complaint_type,
          complaintSubType: c.complaint_sub_type,
          status: c.status,
          closedStatus: c.closed_status,
          closingRemarks: c.closing_remarks,
          consumerName: c.consumer_name,
          consumerMobile: c.consumer_mobile,
          consumerAddress: c.consumer_address,
          calls: []
        };
        byComplaint.set(l.complaint_number, entry);
      }
      entry.calls.push({
        time: l.call_time,
        status: l.call_status,
        connected: isConnected(l),
        seconds: l.duration_seconds ?? 0,
        fault: l.problem_category ? canonicalFault(l.problem_category) : null,
        remark: operatorRemark(l.notes),
        operator: l.operator,
        incoming: l.is_incoming === true,
        deskFilled: isDeskFilled(l.notes)
      });
    }

    const rows = [...byComplaint.values()].map(e => {
      const calls = e.calls.sort((a, b) => a.time.localeCompare(b.time)); // oldest first, reads as a timeline
      const connectedCalls = calls.filter(c => c.connected);
      // The remark a reviewer cares about is the last one an operator actually
      // typed on a call that got through.
      const lastSpoken = [...connectedCalls].reverse().find(c => c.remark);
      return {
        ...e,
        calls,
        totalCalls: calls.length,
        connectedCalls: connectedCalls.length,
        incomingCalls: calls.filter(c => c.incoming).length,
        outgoingCalls: calls.filter(c => !c.incoming).length,
        talkSeconds: calls.reduce((a, c) => a + c.seconds, 0),
        firstCall: calls[0]?.time ?? null,
        lastCall: calls[calls.length - 1]?.time ?? null,
        lastRemark: lastSpoken?.remark ?? '',
        faults: distinctSorted(calls.map(c => c.fault)),
        operators: distinctSorted(calls.map(c => c.operator)),
        callStatuses: distinctSorted(calls.map(c => c.status)),
        everConnected: connectedCalls.length > 0
      };
    }).sort((a, b) => (b.complaintDate ?? '').localeCompare(a.complaintDate ?? ''));

    const payload = {
      success: true,
      range: allTime ? null : { from, to },
      generatedAt: new Date().toISOString(),
      totals: {
        complaints: rows.length,
        connectedComplaints: rows.filter(r => r.everConnected).length,
        calls: logs.length,
        connectedCalls: rows.reduce((a, r) => a + r.connectedCalls, 0),
        incomingCalls: rows.reduce((a, r) => a + r.incomingCalls, 0),
        talkSeconds: rows.reduce((a, r) => a + r.talkSeconds, 0)
      },
      // Dropdown values come from the whole range (before any client-side
      // filtering) so a user always sees every value present in the range.
      availableFilters: {
        divisions: distinctSorted(rows.map(r => r.division)),
        subDivisions: distinctSorted(rows.map(r => r.subDivision)),
        substations: distinctSorted(rows.map(r => r.substation)),
        feeders: distinctSorted(rows.map(r => r.feeder)),
        complaintTypes: distinctSorted(rows.map(r => r.complaintType)),
        complaintSubTypes: distinctSorted(rows.map(r => r.complaintSubType)),
        closedStatuses: distinctSorted(rows.map(r => r.closedStatus)),
        faults: distinctSorted(rows.flatMap(r => r.faults)),
        operators: distinctSorted(rows.flatMap(r => r.operators)),
        callStatuses: distinctSorted(rows.flatMap(r => r.callStatuses))
      },
      rows
    };

    cache.set(cacheKey, { timestamp: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
