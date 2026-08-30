import { createClient } from '@supabase/supabase-js';
import { apiError, apiJson, checkApiKey, corsPreflight, COMPLAINT_FIELDS, SORTABLE_FIELDS } from '@/app/lib/publicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
  : null;

// area_type, complaint_type and complaint_sub_type carry no index, so asking the
// database for their distinct values costs a full sequential scan (measured at
// 11-80s each). They are also tiny, closed vocabularies, so the observed values
// are listed here instead. Filtering on them is case-insensitive, which is why
// the mixed-case duplicates the scraper produces are folded into one entry.
const OBSERVED_AREA_TYPES = ['Urban', 'Rural', 'Industrial', 'Class1'];
const OBSERVED_COMPLAINT_TYPES = ['Supply Related'];
const OBSERVED_COMPLAINT_SUB_TYPES = [
  'No Supply',
  'Voltage Fluctuations Due To Local Problem',
  'Low High Voltage Information',
  'Major Power Failure',
  'Distribution Transformer',
  'Overhead Line Cable Breakdowns',
  'Underground Cable Breakdowns',
  'Period of Scheduled Outage'
];

/** Feeder names are free text with a long tail, so they are sampled from the
 *  most recent complaints in the requested scope rather than scanned in full. */
const FEEDER_SAMPLE_SIZE = 1000;

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { timestamp: number; payload: unknown }>();

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

  const division = (searchParams.get('division') || '').trim();
  const subStation = (searchParams.get('subStation') || searchParams.get('sub_station') || '').trim();
  const pretty = ['1', 'true', 'yes'].includes((searchParams.get('pretty') || '').toLowerCase());

  const cacheKey = division + '|' + subStation;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return apiJson(cached.payload, {
      pretty,
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' }
    });
  }

  try {
    // get_filter_options computes the distinct sets in the database. Selecting
    // whole columns through PostgREST silently caps at 1000 rows, which would
    // build these lists from an incomplete sample.
    const optionsPromise = supabase.rpc('get_filter_options');

    let feederQuery = supabase
      .from('complaints')
      .select('feeder')
      .not('feeder', 'is', null)
      .order('complaint_date', { ascending: false })
      .limit(FEEDER_SAMPLE_SIZE);

    if (division) feederQuery = feederQuery.eq('division', division);
    if (subStation) feederQuery = feederQuery.eq('sub_station', subStation);

    const [{ data: options, error: optionsError }, { data: feederRows, error: feederError }] =
      await Promise.all([optionsPromise, feederQuery]);

    if (optionsError) throw optionsError;
    if (feederError) throw feederError;

    const feeders = Array.from(
      new Set((feederRows || []).map((row: any) => row.feeder).filter(Boolean))
    ).sort((a, b) => String(a).localeCompare(String(b)));

    const payload = {
      success: true,
      scope: {
        division: division || null,
        subStation: subStation || null
      },
      options: {
        divisions: options?.divisions || [],
        subDivisions: options?.subDivisions || [],
        subStations: options?.subStations || [],
        statuses: options?.statuses || [],
        closedStatuses: options?.closedStatuses || [],
        months: options?.months || [],
        areaTypes: OBSERVED_AREA_TYPES,
        complaintTypes: OBSERVED_COMPLAINT_TYPES,
        complaintSubTypes: OBSERVED_COMPLAINT_SUB_TYPES,
        feeders
      },
      notes: {
        months: 'Pass a month straight to /api/v1/complaints as month=2026-08 or month=August 2026.',
        feeders:
          'Feeder names are free text. This list is sampled from the ' +
          FEEDER_SAMPLE_SIZE +
          ' most recent complaints in the requested scope - narrow it with ?division= or ?subStation= to get that scope\'s feeders.',
        areaTypes: 'Values in the source data are inconsistently cased. Filtering is case-insensitive, so areaType=urban and areaType=URBAN behave identically.',
        matching: 'All filter values must match exactly (case aside). There is no partial or fuzzy matching.'
      },
      fields: COMPLAINT_FIELDS,
      sortable: SORTABLE_FIELDS,
      docs: new URL('/api-docs', request.url).toString()
    };

    cache.set(cacheKey, { timestamp: Date.now(), payload });

    return apiJson(payload, {
      pretty,
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' }
    });
  } catch (err: any) {
    return apiError(500, 'query_failed', err?.message || 'Failed to load filter options.');
  }
}
