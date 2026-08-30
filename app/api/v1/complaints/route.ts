import { createClient } from '@supabase/supabase-js';
import {
  apiError,
  apiJson,
  applyQuery,
  checkApiKey,
  corsPreflight,
  csvResponse,
  nextPageUrl,
  parseQuery,
  QueryError,
  shapeRow,
  toCsv
} from '@/app/lib/publicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// An unfiltered exact count over ~185k rows can take a few seconds when the
// database cache is cold; Vercel's default function timeout is 10s.
export const maxDuration = 60;

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  if (!supabase) {
    return apiError(503, 'database_unavailable', 'The database is not configured on this deployment.');
  }

  const { searchParams } = new URL(request.url);

  const unauthorized = checkApiKey(request, searchParams);
  if (unauthorized) return unauthorized;

  let query;
  try {
    query = parseQuery(searchParams);
  } catch (err) {
    if (err instanceof QueryError) {
      return apiError(400, 'invalid_parameter', err.message, { param: err.param, hint: err.hint });
    }
    throw err;
  }

  // The count is requested in the same round trip as the rows (PostgREST's
  // Prefer: count header), so `count=exact` costs latency but not a second call.
  let builder = supabase
    .from('complaints')
    .select(query.fields.join(','), query.wantCount ? { count: 'exact' } : undefined)
    .order(query.sort, { ascending: query.ascending, nullsFirst: false })
    // Tie-break so a row never appears on two pages when timestamps collide.
    .order('id', { ascending: false });

  builder = applyQuery(builder, query);
  builder = builder.range(query.offset, query.offset + query.limit - 1);

  const { data, error, count } = await builder;

  if (error) {
    return apiError(500, 'query_failed', error.message);
  }

  const rows = (data || []).map((row: any) => shapeRow(row, query.fields, query.tz));

  if (query.format === 'csv') {
    return csvResponse(toCsv(rows, query.fields), 'complaints.csv');
  }

  const total = query.wantCount ? (count ?? 0) : null;
  const totalPages = total === null ? null : Math.max(1, Math.ceil(total / query.limit));
  const hasMore = total === null ? rows.length === query.limit : query.offset + rows.length < total;

  return apiJson(
    {
      success: true,
      meta: {
        total,
        totalPages,
        count: rows.length,
        page: query.page,
        limit: query.limit,
        offset: query.offset,
        hasMore,
        nextPage: nextPageUrl(request, query, hasMore),
        sort: query.sort,
        order: query.ascending ? 'asc' : 'desc',
        timezone: query.tz === 'utc' ? 'UTC' : 'Asia/Kolkata',
        filters: query.applied,
        docs: new URL('/api-docs', request.url).toString()
      },
      data: rows
    },
    {
      pretty: query.pretty,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        ...(total === null ? {} : { 'X-Total-Count': String(total) })
      }
    }
  );
}
