import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { clearCache, getCachedData, setCachedData } from '@/app/lib/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The fetchAll export path walks the whole table (~20s for All Months);
// Vercel Hobby defaults to a 10s function timeout.
export const maxDuration = 60;

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

// Server-side search runs against the generated search_text column
// (all searchable columns concatenated, with a trigram index).

// Table header labels -> sortable DB columns for the paged path.
// 'Resolution Time' is computed client-side, so it sorts by closed_date.
const SORT_COLUMNS: Record<string, string> = {
  'Complaint Number': 'complaint_number',
  'Consumer Name': 'consumer_name',
  'Consumer Mobile': 'consumer_mobile',
  'Consumer Address': 'consumer_address',
  'Complaint Type': 'complaint_type',
  'Complaint Sub Type': 'complaint_sub_type',
  'Status': 'status',
  'Closed Status': 'closed_status',
  'Complaint Date and Time': 'complaint_date',
  'Closed Date': 'closed_date',
  'Resolution Time': 'closed_date',
  'Area Type': 'area_type',
  'Division': 'division',
  'Sub Division': 'sub_division',
  'Sub Station': 'sub_station',
  'Closed By': 'closed_by',
  'Closing Remarks': 'closing_remarks'
};

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
  return `complaints:v2:${params.toString() || 'default'}`;
}

function getFetchAllMaxRecords() {
  const value = process.env.COMPLAINTS_FETCH_ALL_MAX_RECORDS;
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractFilters(searchParams: URLSearchParams) {
  let fromDate = searchParams.get('fromDate') || '';
  let toDate = searchParams.get('toDate') || '';
  const todayOnly = searchParams.get('today') === '1';

  if (!fromDate && !toDate && todayOnly) {
    const todayRange = getTodayRangeInIST();
    fromDate = todayRange.from;
    toDate = todayRange.to;
  }

  return {
    search: (searchParams.get('search') || '').trim(),
    division: searchParams.get('division') || '',
    subDivision: searchParams.get('subDivision') || '',
    subStation: searchParams.get('subStation') || '',
    status: searchParams.get('status') || '',
    closedStatus: searchParams.get('closedStatus') || '',
    fromDate: toISTTimestamp(fromDate, 'start'),
    toDate: toISTTimestamp(toDate, 'end')
  };
}

function applyCommonFilters(query: any, searchParams: URLSearchParams) {
  const filters = extractFilters(searchParams);

  if (filters.division) query = query.eq('division', filters.division);
  if (filters.subDivision) query = query.eq('sub_division', filters.subDivision);
  if (filters.subStation) query = query.eq('sub_station', filters.subStation);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.closedStatus) query = query.eq('closed_status', filters.closedStatus);
  if (filters.fromDate) query = query.gte('complaint_date', filters.fromDate);
  if (filters.toDate) query = query.lte('complaint_date', filters.toDate);

  if (filters.search) {
    query = query.ilike('search_text', `%${filters.search.replace(/,/g, ' ')}%`);
  }

  return query;
}

function buildRpcFilterParams(searchParams: URLSearchParams) {
  const filters = extractFilters(searchParams);

  return {
    p_division: filters.division || null,
    p_sub_division: filters.subDivision || null,
    p_sub_station: filters.subStation || null,
    p_status: filters.status || null,
    p_closed_status: filters.closedStatus || null,
    p_from: filters.fromDate,
    p_to: filters.toDate,
    p_search: filters.search ? filters.search.replace(/,/g, ' ') : null
  };
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
      // Keyset pagination through the get_complaints_page RPC: 10k rows per
      // round trip as one jsonb value (vs the old 1000-row OFFSET batches that
      // re-scanned everything before each batch).
      const dataArray: any[] = [];
      const maxRecords = getFetchAllMaxRecords();
      const rpcFilters = buildRpcFilterParams(searchParams);
      const pageSize = 10000;
      let cursor: { p_after_date?: string; p_after_id?: number } = {};

      while (maxRecords === null || dataArray.length < maxRecords) {
        const limit = maxRecords === null
          ? pageSize
          : Math.min(pageSize, maxRecords - dataArray.length);

        const { data: page, error } = await supabase.rpc('get_complaints_page', {
          ...rpcFilters,
          ...cursor,
          p_limit: limit
        });

        if (error) {
          throw error;
        }

        const rows = page?.rows || [];
        dataArray.push(...rows);

        if (rows.length < limit || !page?.next_date) break;
        cursor = { p_after_date: page.next_date, p_after_id: page.next_id };
      }

      const lastScrapedAt = await getLastScrapedAt();

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

  const sortColumn = SORT_COLUMNS[searchParams.get('sortBy') || ''] || 'complaint_date';
  const sortAscending = searchParams.get('sortDir') === 'asc';

  let query = supabase
    .from('complaints')
    .select('raw_data', { count: 'exact' })
    .order(sortColumn, { ascending: sortAscending })
    .order('id', { ascending: false });

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
