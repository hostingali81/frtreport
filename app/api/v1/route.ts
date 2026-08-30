import { createClient } from '@supabase/supabase-js';
import { apiJson, corsPreflight } from '@/app/lib/publicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

export async function OPTIONS() {
  return corsPreflight();
}

/** Service discovery: what exists, where the docs are, and how fresh the data
 *  is. Intentionally cheap - no row counts, no aggregation. */
export async function GET(request: Request) {
  const base = new URL(request.url).origin;

  let lastScrapedAt: string | null = null;
  if (supabase) {
    const { data } = await supabase
      .from('scrape_metadata')
      .select('last_scrape_at')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastScrapedAt = data?.last_scrape_at ?? null;
  }

  return apiJson(
    {
      success: true,
      name: 'FRT Barabanki Complaints API',
      version: '1.0.0',
      description: 'Read-only access to electricity supply complaints for the Barabanki circle.',
      documentation: base + '/api-docs',
      openapi: base + '/api/v1/openapi',
      timezone: 'Asia/Kolkata',
      authentication: process.env.PUBLIC_API_KEY
        ? 'Required. Send the key as an X-Api-Key header or an apiKey query parameter.'
        : 'None. All endpoints are open.',
      lastScrapedAt,
      endpoints: [
        {
          method: 'GET',
          path: '/api/v1/complaints',
          summary: 'List complaint rows with filters, sorting, paging and CSV export.',
          example: base + '/api/v1/complaints?month=2026-08&division=EDD-BARABANKI&limit=5&pretty=1'
        },
        {
          method: 'GET',
          path: '/api/v1/complaints/{complaintNumber}',
          summary: 'Fetch a single complaint by complaint number (or by numeric dataid).',
          example: base + '/api/v1/complaints/MV05072637096?pretty=1'
        },
        {
          method: 'GET',
          path: '/api/v1/filters',
          summary: 'Allowed values for every filter: divisions, sub-stations, months and more.',
          example: base + '/api/v1/filters?pretty=1'
        }
      ]
    },
    { pretty: true, headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } }
  );
}
