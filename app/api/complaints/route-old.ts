import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

export async function GET(request: Request) {
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '1000');
  const search = searchParams.get('search') || '';
  const division = searchParams.get('division') || '';
  const subDivision = searchParams.get('subDivision') || '';
  const subStation = searchParams.get('subStation') || '';
  const status = searchParams.get('status') || '';
  const closedStatus = searchParams.get('closedStatus') || '';
  const fromDate = searchParams.get('fromDate') || '';
  const toDate = searchParams.get('toDate') || '';
  const sortBy = searchParams.get('sortBy') || 'complaint_date';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const offset = (page - 1) * limit;

  let query = supabase
    .from('complaints')
    .select('raw_data', { count: 'exact' });

  if (search) {
    query = query.or(`complaint_number.ilike.%${search}%,division.ilike.%${search}%,sub_division.ilike.%${search}%,sub_station.ilike.%${search}%`);
  }
  if (division) query = query.eq('division', division);
  if (subDivision) query = query.eq('sub_division', subDivision);
  if (subStation) query = query.eq('sub_station', subStation);
  if (status) query = query.eq('status', status);
  if (closedStatus) query = query.eq('closed_status', closedStatus);
  if (fromDate) query = query.gte('complaint_date', fromDate);
  if (toDate) query = query.lte('complaint_date', toDate);

  query = query.order(sortBy, { ascending: sortOrder === 'asc' });
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: data?.map(row => row.raw_data) || [],
    pagination: {
      page,
      limit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit)
    }
  });
}
