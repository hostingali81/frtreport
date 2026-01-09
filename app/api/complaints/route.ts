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
  const fetchAll = searchParams.get('fetchAll') === 'true';
  
  if (fetchAll) {
    // Fetch ALL records in batches
    let allData: any[] = [];
    let from = 0;
    const batchSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from('complaints')
        .select('raw_data')
        .order('complaint_date', { ascending: false })
        .range(from, from + batchSize - 1);
      
      if (error || !data || data.length === 0) break;
      
      allData = allData.concat(data);
      
      if (data.length < batchSize) break;
      from += batchSize;
    }
    
    const { count } = await supabase
      .from('complaints')
      .select('id', { count: 'exact', head: true });
    
    const { data: metadata } = await supabase
      .from('scrape_metadata')
      .select('last_scrape_at')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      data: allData.map(row => row.raw_data),
      total: count || 0,
      lastScrapedAt: metadata?.last_scrape_at || null
    });
  }
  
  // Pagination params
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '100');
  
  // Filter params
  const search = searchParams.get('search') || '';
  const division = searchParams.get('division') || '';
  const subDivision = searchParams.get('subDivision') || '';
  const subStation = searchParams.get('subStation') || '';
  const status = searchParams.get('status') || '';
  const closedStatus = searchParams.get('closedStatus') || '';
  const fromDate = searchParams.get('fromDate') || '';
  const toDate = searchParams.get('toDate') || '';

  // Build query
  let query = supabase.from('complaints').select('raw_data', { count: 'exact' });

  // Apply filters
  if (division) query = query.eq('division', division);
  if (subDivision) query = query.eq('sub_division', subDivision);
  if (subStation) query = query.eq('sub_station', subStation);
  if (status) query = query.eq('status', status);
  if (closedStatus) query = query.eq('closed_status', closedStatus);
  
  if (fromDate) query = query.gte('complaint_date', new Date(fromDate).toISOString());
  if (toDate) query = query.lte('complaint_date', new Date(toDate).toISOString());
  if (search) query = query.or(`complaint_number.ilike.%${search}%,division.ilike.%${search}%,sub_division.ilike.%${search}%,sub_station.ilike.%${search}%`);

  query = query.order('complaint_date', { ascending: false });

  const offset = (page - 1) * limit;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: metadata } = await supabase
    .from('scrape_metadata')
    .select('last_scrape_at')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    data: (data || []).map(row => row.raw_data),
    total: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
    lastScrapedAt: metadata?.last_scrape_at || null
  });
}
