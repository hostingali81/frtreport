import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { clearCache, getCachedData, setCachedData } from '@/app/lib/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

const SEARCH_COLUMNS = [
  'complaint_number',
  'division',
  'sub_division',
  'sub_station',
  'consumer_name',
  'consumer_mobile',
  'consumer_address',
  'complaint_type',
  'complaint_sub_type',
  'status',
  'closed_status',
  'closed_by',
  'closing_remarks',
  'area_type'
];

function getISTDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const partMap = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    year: partMap.year,
    month: partMap.month,
    day: partMap.day
  };
}

function getTodayRangeInIST() {
  const { year, month, day } = getISTDateParts(new Date());
  return {
    from: `${year}-${month}-${day}T00:00:00+05:30`,
    to: `${year}-${month}-${day}T23:59:59+05:30`
  };
}

function toISTTimestamp(value: string, boundary: 'start' | 'end') {
  if (!value) return null;

  if (/[zZ]$/.test(value) || /[+-]\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const time = boundary === 'start' ? '00:00:00' : '23:59:59';
    return `${value}T${time}+05:30`;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return `${value}:00+05:30`;
  }

  return value;
}

function buildCacheKey(searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams);
  params.delete('refresh');
  return `complaints:${params.toString() || 'default'}`;
}

function applyCommonFilters(query: any, searchParams: URLSearchParams) {
  const search = searchParams.get('search') || '';
  const division = searchParams.get('division') || '';
  const subDivision = searchParams.get('subDivision') || '';
  const subStation = searchParams.get('subStation') || '';
  const status = searchParams.get('status') || '';
  const closedStatus = searchParams.get('closedStatus') || '';
  let fromDate = searchParams.get('fromDate') || '';
  let toDate = searchParams.get('toDate') || '';
  const todayOnly = searchParams.get('today') === '1';

  if (!fromDate && !toDate && todayOnly) {
    const todayRange = getTodayRangeInIST();
    fromDate = todayRange.from;
    toDate = todayRange.to;
  }

  if (division) query = query.eq('division', division);
  if (subDivision) query = query.eq('sub_division', subDivision);
  if (subStation) query = query.eq('sub_station', subStation);
  if (status) query = query.eq('status', status);
  if (closedStatus) query = query.eq('closed_status', closedStatus);

  const normalizedFromDate = toISTTimestamp(fromDate, 'start');
  const normalizedToDate = toISTTimestamp(toDate, 'end');

  if (normalizedFromDate) query = query.gte('complaint_date', normalizedFromDate);
  if (normalizedToDate) query = query.lte('complaint_date', normalizedToDate);

  if (search) {
    const safeSearch = search.replace(/,/g, ' ');
    const searchQuery = SEARCH_COLUMNS.map((column) => `${column}.ilike.%${safeSearch}%`).join(',');
    query = query.or(searchQuery);
  }

  return query;
}

async function getLastScrapedAt() {
  const { data: metadata } = await supabase!
    .from('scrape_metadata')
    .select('last_scrape_at')
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return metadata?.last_scrape_at
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
}

export async function GET(request: Request) {
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const fetchAll = searchParams.get('fetchAll') === 'true';
  const forceRefresh = searchParams.get('refresh') === '1';
  const cacheKey = buildCacheKey(searchParams);

  if (fetchAll) {
    if (!forceRefresh) {
      const cached = getCachedData(cacheKey);
      if (cached) {
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
      clearCache(cacheKey);
    }

    try {
      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      const maxRecords = 50000;

      while (from < maxRecords) {
        let batchQuery = supabase
          .from('complaints')
          .select('raw_data')
          .order('complaint_date', { ascending: false });

        batchQuery = applyCommonFilters(batchQuery, searchParams);
        batchQuery = batchQuery.range(from, from + batchSize - 1);

        const { data, error } = await batchQuery;

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) break;

        allData = allData.concat(data);

        if (data.length < batchSize) break;
        from += batchSize;
      }

      const lastScrapedAt = await getLastScrapedAt();
      const dataArray = allData.map((row) => row.raw_data);

      setCachedData(cacheKey, dataArray, lastScrapedAt);

      return NextResponse.json({
        success: true,
        data: dataArray,
        total: dataArray.length,
        fetched: dataArray.length,
        lastScrapedAt,
        fromCache: false
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
        }
      });
    } catch (err: any) {
      return NextResponse.json({
        success: false,
        error: err.message || 'Failed to fetch data'
      }, { status: 500 });
    }
  }

  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageLimit = parseInt(searchParams.get('limit') || '100', 10);
  const offset = (page - 1) * pageLimit;

  let query = supabase
    .from('complaints')
    .select('raw_data', { count: 'exact' })
    .order('complaint_date', { ascending: false });

  query = applyCommonFilters(query, searchParams);
  query = query.range(offset, offset + pageLimit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const lastScrapedAt = await getLastScrapedAt();

  return NextResponse.json({
    success: true,
    data: (data || []).map((row) => row.raw_data),
    total: count || 0,
    page,
    limit: pageLimit,
    totalPages: Math.ceil((count || 0) / pageLimit),
    lastScrapedAt
  });
}
