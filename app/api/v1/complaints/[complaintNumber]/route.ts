import { createClient } from '@supabase/supabase-js';
import {
  apiError,
  apiJson,
  checkApiKey,
  corsPreflight,
  parseQuery,
  QueryError,
  shapeRow
} from '@/app/lib/publicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ complaintNumber: string }> }
) {
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

  const { complaintNumber } = await params;
  const identifier = decodeURIComponent(complaintNumber).trim();

  if (!identifier) {
    return apiError(400, 'invalid_parameter', 'A complaint number is required.', { param: 'complaintNumber' });
  }

  // Complaint numbers look like MV05072637096. An all-digit path segment is
  // treated as the upstream dataid instead, since that is the other identifier
  // callers see in the source system.
  let builder = supabase.from('complaints').select(query.fields.join(','));
  builder = /^\d+$/.test(identifier)
    ? builder.eq('dataid', Number(identifier))
    : builder.in('complaint_number', [identifier, identifier.toUpperCase(), identifier.toLowerCase()]);

  const { data, error } = await builder.limit(1).maybeSingle();

  if (error) {
    return apiError(500, 'query_failed', error.message);
  }

  if (!data) {
    return apiError(404, 'not_found', 'No complaint matches "' + identifier + '".');
  }

  return apiJson(
    { success: true, data: shapeRow(data as Record<string, any>, query.fields, query.tz) },
    {
      pretty: query.pretty,
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
    }
  );
}
