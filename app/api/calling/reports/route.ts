import { NextResponse } from 'next/server';

import { getSession } from '../../../lib/session';
import { getSupabaseClient } from '../../../lib/shared-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

// Attributes of the complaint a call belongs to, embedded via the call_logs ->
// complaints relationship (dataid). Lets us filter/segment calls by complaint
// geography, feeder, area, type and status without a second query.
type ComplaintAttrs = {
  division: string | null; sub_division: string | null; feeder: string | null;
  area_type: string | null; complaint_type: string | null; status: string | null;
  complaint_date: string | null;
};

type Log = {
  id: number; dataid: number | null; complaint_number: string | null; call_time: string;
  call_status: string | null; problem_category: string | null; notes: string | null;
  operator: string | null; operator_id: string | null;
  duration_seconds: number | null; connected: boolean | null; is_incoming?: boolean | null;
  complaints: ComplaintAttrs | null;
};

// Old rows have connected=null; fall back to the recorded status.
function isConnected(l: Log): boolean {
  return l.connected ?? (l.call_status === 'Connected');
}

function tally(logs: Log[], key: 'call_status' | 'problem_category'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of logs) {
    const k = l[key] || 'Unspecified';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// A filter param is a comma-separated allow-list; empty/absent means "no filter".
function parseList(v: string | null): string[] {
  return v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
}
// Sorted, de-duplicated non-empty values for a dropdown.
function distinctSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== ''))).sort((a, b) => a.localeCompare(b));
}

// Talk-time buckets (seconds). Only connected calls have meaningful duration.
function inDurationBucket(seconds: number | null, bucket: string): boolean {
  const s = seconds ?? 0;
  if (bucket === 'lt30') return s < 30;
  if (bucket === '30to120') return s >= 30 && s <= 120;
  if (bucket === 'gt120') return s > 120;
  return true; // unknown bucket -> no restriction
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

    const { searchParams } = new URL(request.url);
    const todayIst = istDateOnly(new Date());
    const from = searchParams.get('from') || subtractDays(todayIst, 6);
    const to = searchParams.get('to') || todayIst;

    // ---- filters (Group A: call-level, Group B: complaint-level) ----
    const fStatus = parseList(searchParams.get('status'));               // call_status
    const fCategory = parseList(searchParams.get('category'));           // problem_category
    const fOperator = parseList(searchParams.get('operator'));           // operator_id (managers only)
    const fDirection = searchParams.get('direction');                    // 'incoming' | 'outgoing'
    const fDuration = searchParams.get('duration') || '';                // 'lt30' | '30to120' | 'gt120'
    const fDivision = parseList(searchParams.get('division'));
    const fSubDivision = parseList(searchParams.get('subDivision'));
    const fFeeder = parseList(searchParams.get('feeder'));
    const fAreaType = parseList(searchParams.get('areaType'));
    const fComplaintType = parseList(searchParams.get('complaintType'));
    const fComplaintStatus = parseList(searchParams.get('complaintStatus')); // complaints.status

    // call_logs in a range can exceed PostgREST's server-side max-rows cap
    // (1000). A single .limit() is silently clipped to that cap, which would make
    // every total below (count, byStatus, per-operator, talk time…) top out at
    // 1000. Page through the whole range in 1000-row batches. Each call also
    // embeds its complaint's attributes so we can segment by them below.
    const SELECT_COLS = 'id, dataid, complaint_number, call_time, call_status, problem_category, notes, operator, operator_id, duration_seconds, connected, is_incoming, complaints(division, sub_division, feeder, area_type, complaint_type, status, complaint_date)';
    const BATCH = 1000;
    const allLogs: Log[] = [];
    for (let offset = 0; ; offset += BATCH) {
      let query = supabase
        .from('call_logs')
        .select(SELECT_COLS)
        .gte('call_time', `${from}T00:00:00+05:30`)
        .lte('call_time', `${to}T23:59:59+05:30`)
        .order('call_time', { ascending: false })
        .order('id', { ascending: false }) // stable tiebreak so offset paging can't skip/dupe rows
        .range(offset, offset + BATCH - 1);

      // Operators only ever see their own calls.
      if (session.role === 'operator') query = query.eq('operator_id', session.id);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const page = ((data as unknown) as Log[]) || [];
      allLogs.push(...page);
      if (page.length < BATCH) break;
    }

    // Filter dropdowns are built from the WHOLE range (before filtering) so a
    // user always sees every value present in the range, not just what survived
    // the current filters.
    const availableFilters = {
      callStatuses: distinctSorted(allLogs.map(l => l.call_status)),
      categories: distinctSorted(allLogs.map(l => l.problem_category)),
      operators: Array.from(
        allLogs.reduce((m, l) => {
          const id = l.operator_id ?? '';
          if (id && !m.has(id)) m.set(id, l.operator || 'Unknown');
          return m;
        }, new Map<string, string>()),
      ).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      divisions: distinctSorted(allLogs.map(l => l.complaints?.division)),
      subDivisions: distinctSorted(allLogs.map(l => l.complaints?.sub_division)),
      feeders: distinctSorted(allLogs.map(l => l.complaints?.feeder)),
      areaTypes: distinctSorted(allLogs.map(l => l.complaints?.area_type)),
      complaintTypes: distinctSorted(allLogs.map(l => l.complaints?.complaint_type)),
      complaintStatuses: distinctSorted(allLogs.map(l => l.complaints?.status)),
    };

    // Apply the requested filters. Each dimension is AND-ed; within a dimension
    // the allow-list is OR-ed.
    const logs = allLogs.filter(l => {
      if (fStatus.length && !fStatus.includes(l.call_status ?? '')) return false;
      if (fCategory.length && !fCategory.includes(l.problem_category ?? '')) return false;
      if (fOperator.length && !fOperator.includes(String(l.operator_id ?? ''))) return false;
      if (fDirection === 'incoming' && l.is_incoming !== true) return false;
      if (fDirection === 'outgoing' && l.is_incoming === true) return false;
      if (fDuration && !inDurationBucket(l.duration_seconds, fDuration)) return false;
      const c = l.complaints;
      if (fDivision.length && !(c && fDivision.includes(c.division ?? ''))) return false;
      if (fSubDivision.length && !(c && fSubDivision.includes(c.sub_division ?? ''))) return false;
      if (fFeeder.length && !(c && fFeeder.includes(c.feeder ?? ''))) return false;
      if (fAreaType.length && !(c && fAreaType.includes(c.area_type ?? ''))) return false;
      if (fComplaintType.length && !(c && fComplaintType.includes(c.complaint_type ?? ''))) return false;
      if (fComplaintStatus.length && !(c && fComplaintStatus.includes(c.status ?? ''))) return false;
      return true;
    });

    // Per-operator breakdown (for admin/super this is everyone; for an operator
    // it is just themselves).
    const byOperator = new Map<string, { operator_id: string | null; operator: string; total: number; connected: number; talk_seconds: number; last_call_time: string | null }>();
    for (const l of logs) {
      const opKey = String(l.operator_id ?? l.operator ?? 'unknown');
      const entry = byOperator.get(opKey) || { operator_id: l.operator_id, operator: l.operator || 'Unknown', total: 0, connected: 0, talk_seconds: 0, last_call_time: null };
      entry.total += 1;
      if (isConnected(l)) entry.connected += 1;
      entry.talk_seconds += l.duration_seconds ?? 0;
      if (!entry.last_call_time || l.call_time > entry.last_call_time) entry.last_call_time = l.call_time;
      byOperator.set(opKey, entry);
    }

    const connectedTotal = logs.filter(isConnected).length;
    const talkSeconds = logs.reduce((a, l) => a + (l.duration_seconds ?? 0), 0);

    // Direction split — incoming (consumer called us) vs outgoing (we dialed).
    const incomingLogs = logs.filter(l => l.is_incoming === true);
    const outgoingLogs = logs.filter(l => l.is_incoming !== true);

    // Average time from complaint arrival to its FIRST call (responsiveness vs
    // the SLA clock). complaint_date comes from the embedded complaint.
    let avgFirstCallMinutes: number | null = null;
    const firstCallByDataid = new Map<number, string>();
    const complaintDateByDataid = new Map<number, string>();
    for (const l of logs) {
      if (l.dataid == null) continue;
      const prev = firstCallByDataid.get(l.dataid);
      if (!prev || l.call_time < prev) firstCallByDataid.set(l.dataid, l.call_time);
      if (l.complaints?.complaint_date) complaintDateByDataid.set(l.dataid, l.complaints.complaint_date);
    }
    if (firstCallByDataid.size) {
      const deltas: number[] = [];
      for (const [dataid, first] of firstCallByDataid) {
        const cDate = complaintDateByDataid.get(dataid);
        if (!cDate) continue;
        const mins = (new Date(first).getTime() - new Date(cDate).getTime()) / 60000;
        if (mins >= 0 && mins < 24 * 60) deltas.push(mins);
      }
      if (deltas.length) avgFirstCallMinutes = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
    }

    return NextResponse.json({
      success: true,
      role: session.role,
      range: { from, to },
      availableFilters,
      totals: {
        total: logs.length,
        connected: connectedTotal,
        connectRate: logs.length ? Math.round((connectedTotal / logs.length) * 100) : null,
        talkSeconds,
        avgTalkSeconds: connectedTotal ? Math.round(talkSeconds / connectedTotal) : null,
        avgFirstCallMinutes,
        outgoing: outgoingLogs.length,
        outgoingConnected: outgoingLogs.filter(isConnected).length,
        incoming: incomingLogs.length,
        incomingConnected: incomingLogs.filter(isConnected).length,
        byStatus: tally(logs, 'call_status'),
        byCategory: tally(logs, 'problem_category')
      },
      operators: Array.from(byOperator.values()).sort((a, b) => b.total - a.total),
      recent: logs.slice(0, 100)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
