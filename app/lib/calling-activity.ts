// Call activity for a date range, counted by WHEN THE CALL WAS MADE.
//
// The Calling Report's complaint metrics (total / called / connected, faults,
// feeders…) come from get_calling_stats, which ranges on `complaint_date` —
// the universe there is "complaints that arrived in this window". Its `attempts`
// number therefore counts every call ever logged against those complaints, which
// is NOT the same thing as "calls made in this window": a complaint that arrives
// at 11pm and is called at 1am counts in yesterday's attempts, and a call made
// today on yesterday's complaint counts in yesterday too.
//
// The Android app's Reports screen (/api/calling/reports) ranges on `call_time`,
// so its "Total calls" never matched the dashboard. Operators compare those two
// numbers, so the dashboard now shows this call_time-based block for everything
// that is about calls, and keeps the complaint_date block for everything that is
// about complaints.
//
// call_logs is small (~14k rows since the app launched 03/07/2026) and the
// projection is five narrow columns, so paging it here is far cheaper than
// another aggregation over the 124k-row `complaints` join — see the free-tier IO
// budget note in calling-stats-cache.ts.

import type { SupabaseClient } from '@supabase/supabase-js';

const BATCH = 1000; // PostgREST caps every query at 1000 rows — page past it.

type ActivityRow = {
  call_status: string | null;
  connected: boolean | null;
  duration_seconds: number | null;
  is_incoming: boolean | null;
};

export type CallActivity = {
  calls: number;
  callsConnected: number;
  talkSeconds: number;
  incoming: number;
  incomingConnected: number;
  outgoing: number;
  outgoingConnected: number;
  byCallStatus: { k: string; n: number }[];
};

// Old rows have connected=null; fall back to the recorded status (same rule as
// /api/calling/reports and get_calling_stats).
const isConnected = (r: ActivityRow) => r.connected ?? r.call_status === 'Connected';

export async function fetchCallActivity(
  supabase: SupabaseClient,
  opts: { from: string; to: string; allTime?: boolean }
): Promise<CallActivity> {
  const rows: ActivityRow[] = [];
  for (let offset = 0; ; offset += BATCH) {
    let query = supabase
      .from('call_logs')
      .select('call_status, connected, duration_seconds, is_incoming')
      .order('id', { ascending: false }) // stable, so offset paging can't skip/dupe rows
      .range(offset, offset + BATCH - 1);
    if (!opts.allTime) {
      query = query
        .gte('call_time', `${opts.from}T00:00:00+05:30`)
        .lte('call_time', `${opts.to}T23:59:59+05:30`);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data as unknown as ActivityRow[]) || [];
    rows.push(...page);
    if (page.length < BATCH) break;
  }

  const statusCounts = new Map<string, number>();
  const activity: CallActivity = {
    calls: rows.length,
    callsConnected: 0,
    talkSeconds: 0,
    incoming: 0,
    incomingConnected: 0,
    outgoing: 0,
    outgoingConnected: 0,
    byCallStatus: []
  };
  for (const r of rows) {
    const conn = isConnected(r);
    if (conn) activity.callsConnected += 1;
    activity.talkSeconds += r.duration_seconds ?? 0;
    if (r.is_incoming === true) {
      activity.incoming += 1;
      if (conn) activity.incomingConnected += 1;
    } else {
      activity.outgoing += 1;
      if (conn) activity.outgoingConnected += 1;
    }
    const k = r.call_status?.trim() || 'Unspecified';
    statusCounts.set(k, (statusCounts.get(k) ?? 0) + 1);
  }
  activity.byCallStatus = [...statusCounts.entries()]
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));

  return activity;
}
