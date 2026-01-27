import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCachedData, setCachedData, clearCache } from '@/app/lib/cache';

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
  const forceRefresh = searchParams.get('refresh') === '1';
  
  if (fetchAll) {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = getCachedData();
      if (cached) {
        console.log('✅ Serving from cache');
        return NextResponse.json({
          success: true,
          data: cached.data,
          total: cached.data.length,
          fetched: cached.data.length,
          lastScrapedAt: cached.lastScrapedAt,
          fromCache: true
        }, {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
          }
        });
      }
    } else {
      clearCache();
    }
    try {
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      const maxRecords = 50000;
      
      while (from < maxRecords) {
        const { data, error } = await supabase
          .from('complaints')
          .select('raw_data')
          .order('complaint_date', { ascending: false })
          .range(from, from + batchSize - 1);
        
        if (error) {
          console.error('Batch error:', error);
          break;
        }
        
        if (!data || data.length === 0) break;
        
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

      const lastScrapedAt = metadata?.last_scrape_at 
        ? new Date(metadata.last_scrape_at).toLocaleString('en-IN', { 
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })
        : null;

      // Store in cache
      const dataArray = allData.map(row => row.raw_data);
      setCachedData(dataArray, lastScrapedAt);
      console.log('💾 Data cached for 10 minutes');

      return NextResponse.json({
        success: true,
        data: dataArray,
        total: count || 0,
        fetched: allData.length,
        lastScrapedAt,
        fromCache: false
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
        }
      });
    } catch (err: any) {
      console.error('FetchAll error:', err);
      return NextResponse.json({ 
        success: false, 
        error: err.message || 'Failed to fetch data' 
      }, { status: 500 });
    }
  }
  
  const page = parseInt(searchParams.get('page') || '1');
  const pageLimit = parseInt(searchParams.get('limit') || '100');
  
  const search = searchParams.get('search') || '';
  const division = searchParams.get('division') || '';
  const subDivision = searchParams.get('subDivision') || '';
  const subStation = searchParams.get('subStation') || '';
  const status = searchParams.get('status') || '';
  const closedStatus = searchParams.get('closedStatus') || '';
  const fromDate = searchParams.get('fromDate') || '';
  const toDate = searchParams.get('toDate') || '';

  let query = supabase.from('complaints').select('raw_data', { count: 'exact' });

  if (division) query = query.eq('division', division);
  if (subDivision) query = query.eq('sub_division', subDivision);
  if (subStation) query = query.eq('sub_station', subStation);
  if (status) query = query.eq('status', status);
  if (closedStatus) query = query.eq('closed_status', closedStatus);
  
  if (fromDate) query = query.gte('complaint_date', new Date(fromDate).toISOString());
  if (toDate) query = query.lte('complaint_date', new Date(toDate).toISOString());
  if (search) query = query.or(`complaint_number.ilike.%${search}%,division.ilike.%${search}%,sub_division.ilike.%${search}%,sub_station.ilike.%${search}%`);

  query = query.order('complaint_date', { ascending: false });

  const offset = (page - 1) * pageLimit;
  query = query.range(offset, offset + pageLimit - 1);

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

  const lastScrapedAt = metadata?.last_scrape_at 
    ? new Date(metadata.last_scrape_at).toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    : null;

  return NextResponse.json({
    success: true,
    data: (data || []).map(row => row.raw_data),
    total: count || 0,
    page,
    limit: pageLimit,
    totalPages: Math.ceil((count || 0) / pageLimit),
    lastScrapedAt
  });
}
