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

type Log = {
  id: number; dataid: number | null; complaint_number: string | null; call_time: string;
  call_status: string | null; problem_category: string | null; notes: string | null;
  operator: string | null; operator_id: string | null;
};

function tally(logs: Log[], key: 'call_status' | 'problem_category'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of logs) {
    const k = l[key] || 'Unspecified';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
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

    let query = supabase
      .from('call_logs')
      .select('id, dataid, complaint_number, call_time, call_status, problem_category, notes, operator, operator_id')
      .gte('call_time', `${from}T00:00:00+05:30`)
      .lte('call_time', `${to}T23:59:59+05:30`)
      .order('call_time', { ascending: false })
      .limit(5000);

    // Operators only ever see their own calls.
    if (session.role === 'operator') query = query.eq('operator_id', session.id);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const logs = (data as Log[]) || [];

    // Per-operator breakdown (for admin/super this is everyone; for an operator
    // it is just themselves).
    const byOperator = new Map<string, { operator_id: string | null; operator: string; total: number; connected: number; last_call_time: string | null }>();
    for (const l of logs) {
      const opKey = String(l.operator_id ?? l.operator ?? 'unknown');
      const entry = byOperator.get(opKey) || { operator_id: l.operator_id, operator: l.operator || 'Unknown', total: 0, connected: 0, last_call_time: null };
      entry.total += 1;
      if (l.call_status === 'Connected') entry.connected += 1;
      if (!entry.last_call_time || l.call_time > entry.last_call_time) entry.last_call_time = l.call_time;
      byOperator.set(opKey, entry);
    }

    return NextResponse.json({
      success: true,
      role: session.role,
      range: { from, to },
      totals: { total: logs.length, byStatus: tally(logs, 'call_status'), byCategory: tally(logs, 'problem_category') },
      operators: Array.from(byOperator.values()).sort((a, b) => b.total - a.total),
      recent: logs.slice(0, 100)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
