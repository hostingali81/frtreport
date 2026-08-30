import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Shared plumbing for the public, read-only JSON API served under /api/v1.
//
// The internal /api/complaints endpoint is shaped around what the report UI
// needs (label-cased keys, pre-formatted dates, an in-process export cache).
// Third parties need something different: stable snake_case columns, machine
// readable timestamps, forgiving filters and honest errors. That is what this
// module provides; the v1 routes are thin wrappers over it.
// ---------------------------------------------------------------------------

/** Columns the API is allowed to return. `content_hash` is internal, so it is
 *  deliberately absent. */
export const COMPLAINT_FIELDS = [
  'id',
  'complaint_number',
  'complaint_date',
  'closed_date',
  'status',
  'closed_status',
  'closed_by',
  'closing_remarks',
  'division',
  'sub_division',
  'sub_station',
  'feeder',
  'area_type',
  'complaint_type',
  'complaint_sub_type',
  'consumer_name',
  'consumer_mobile',
  'consumer_address',
  'landmark',
  'assigned_crew',
  'crew_mobile',
  'consumer_remarks',
  'dataid',
  'created_at',
  'updated_at'
] as const;

export type ComplaintField = (typeof COMPLAINT_FIELDS)[number];

const FIELD_SET = new Set<string>(COMPLAINT_FIELDS);

/** Timestamp columns get timezone treatment on the way out. */
const TIMESTAMP_FIELDS = new Set(['complaint_date', 'closed_date', 'created_at', 'updated_at']);

/** Columns that may be sorted on. Everything here is either indexed or has low
 *  enough cardinality that ordering stays cheap. */
export const SORTABLE_FIELDS = [
  'complaint_date',
  'closed_date',
  'created_at',
  'updated_at',
  'complaint_number',
  'division',
  'sub_division',
  'sub_station',
  'feeder',
  'status',
  'closed_status',
  'area_type',
  'id'
] as const;

const SORTABLE = new Set<string>(SORTABLE_FIELDS);

/** Columns a date range may be applied to, keyed by every spelling accepted. */
const DATE_FIELDS: Record<string, string> = {
  complaint: 'complaint_date',
  complaint_date: 'complaint_date',
  complaintdate: 'complaint_date',
  closed: 'closed_date',
  closed_date: 'closed_date',
  closeddate: 'closed_date',
  created: 'created_at',
  created_at: 'created_at',
  updated: 'updated_at',
  updated_at: 'updated_at'
};

/** Equality filters. Each entry lists every spelling accepted for the same
 *  column so callers can use camelCase, snake_case or the plain column name. */
export const EQUALITY_FILTERS: Array<{ column: string; aliases: string[] }> = [
  { column: 'division', aliases: ['division', 'divisions'] },
  { column: 'sub_division', aliases: ['subDivision', 'sub_division', 'subdivision', 'subDivisions'] },
  { column: 'sub_station', aliases: ['subStation', 'sub_station', 'substation', 'subStations', 'ss'] },
  { column: 'feeder', aliases: ['feeder', 'feeders'] },
  { column: 'area_type', aliases: ['areaType', 'area_type', 'areatype'] },
  { column: 'status', aliases: ['status', 'statuses'] },
  { column: 'closed_status', aliases: ['closedStatus', 'closed_status', 'closedstatus'] },
  { column: 'closed_by', aliases: ['closedBy', 'closed_by', 'closedby'] },
  { column: 'complaint_type', aliases: ['complaintType', 'complaint_type', 'complainttype'] },
  { column: 'complaint_sub_type', aliases: ['complaintSubType', 'complaint_sub_type', 'complaintsubtype'] },
  { column: 'complaint_number', aliases: ['complaintNumber', 'complaint_number', 'complaintNo', 'complaintno'] },
  { column: 'consumer_mobile', aliases: ['mobile', 'consumerMobile', 'consumer_mobile'] },
  { column: 'dataid', aliases: ['dataid', 'dataId'] }
];

/** Every query-string key /api/v1/complaints understands. Unknown keys are
 *  rejected rather than silently ignored, so a typo in a filter never looks
 *  like "no such complaints". */
const KNOWN_PARAMS = new Set<string>([
  ...EQUALITY_FILTERS.flatMap((f) => f.aliases),
  'from', 'fromDate', 'from_date', 'startDate', 'start_date',
  'to', 'toDate', 'to_date', 'endDate', 'end_date',
  'date', 'day', 'month', 'year', 'today', 'yesterday', 'lastDays', 'last_days', 'days',
  'dateField', 'date_field', 'updatedSince', 'updated_since',
  'page', 'limit', 'perPage', 'per_page', 'offset',
  'sort', 'sortBy', 'sort_by', 'order', 'sortDir', 'sort_dir',
  'fields', 'format', 'tz', 'timezone', 'count', 'pretty', 'apiKey', 'api_key'
]);

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

export const MAX_LIMIT = 1000;
export const DEFAULT_LIMIT = 100;
/** Guard against a caller pasting thousands of values into one filter. */
const MAX_FILTER_VALUES = 50;

// ---------------------------------------------------------------------------
// Dates. Every date in this API is Indian Standard Time. IST has no DST, so a
// fixed +05:30 offset is exact and far cheaper than an Intl round trip per row.
// ---------------------------------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const IST_SUFFIX = '+05:30';

function istParts(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function pad(value: number, width = 2) {
  return String(value).padStart(width, '0');
}

function istDayStart(year: number, month: number, day: number) {
  return pad(year, 4) + '-' + pad(month) + '-' + pad(day) + 'T00:00:00' + IST_SUFFIX;
}

function istDayEnd(year: number, month: number, day: number) {
  return pad(year, 4) + '-' + pad(month) + '-' + pad(day) + 'T23:59:59.999' + IST_SUFFIX;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adds an IST offset to bare dates/times so Postgres never falls back to the
 *  server's own zone. Values that already carry an offset pass through. */
function toISTTimestamp(value: string, boundary: 'start' | 'end'): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) return trimmed;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed + (boundary === 'start' ? 'T00:00:00' : 'T23:59:59.999') + IST_SUFFIX;
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed.replace(' ', 'T') + ':00' + IST_SUFFIX;
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed.replace(' ', 'T') + IST_SUFFIX;
  }

  return null;
}

/** `2026-08`, `08-2026`, `August 2026` and `aug-2026` all mean the same month. */
function parseMonth(value: string): { year: number; month: number } | null {
  const trimmed = value.trim();

  let match = /^(\d{4})[-/](\d{1,2})$/.exec(trimmed);
  if (match) {
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : null;
  }

  match = /^(\d{1,2})[-/](\d{4})$/.exec(trimmed);
  if (match) {
    const month = Number(match[1]);
    return month >= 1 && month <= 12 ? { year: Number(match[2]), month } : null;
  }

  match = /^([A-Za-z]+)[\s-]+(\d{4})$/.exec(trimmed);
  if (match) {
    const name = match[1].toLowerCase();
    const index = MONTH_NAMES.findIndex((m) => m === name || m.slice(0, 3) === name);
    if (index >= 0) return { year: Number(match[2]), month: index + 1 };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Filter values
// ---------------------------------------------------------------------------

function titleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/** The scraped data is not case-consistent (area_type holds `Urban`, `urban`
 *  and `URBAN`). Matching each requested value against its common casings only
 *  ever adds candidates to the IN list, so it cannot hide a real row. */
function caseVariants(value: string) {
  return Array.from(new Set([value, value.toLowerCase(), value.toUpperCase(), titleCase(value)]));
}

function splitValues(raw: string) {
  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Authorization',
  'Access-Control-Max-Age': '86400'
};

export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function apiJson(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string>; pretty?: boolean }
) {
  const payload = init?.pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body);
  return new NextResponse(payload, {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...(init?.headers || {})
    }
  });
}

export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return apiJson(
    { success: false, error: { code, message, ...(extra || {}) } },
    { status, pretty: true, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** The API is open unless PUBLIC_API_KEY is set in the environment. When it is,
 *  callers must send it as an `X-Api-Key` header or an `apiKey` query param. */
export function checkApiKey(request: Request, searchParams: URLSearchParams) {
  const expected = process.env.PUBLIC_API_KEY;
  if (!expected) return null;

  const supplied =
    request.headers.get('x-api-key') ||
    searchParams.get('apiKey') ||
    searchParams.get('api_key') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

  if (supplied && supplied === expected) return null;

  return apiError(
    401,
    'unauthorized',
    'A valid API key is required. Send it as an X-Api-Key header or an apiKey query parameter.'
  );
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

export type ParsedQuery = {
  filters: Array<{ column: string; values: string[] }>;
  dateField: string;
  from: string | null;
  to: string | null;
  updatedSince: string | null;
  limit: number;
  offset: number;
  page: number;
  usedOffset: boolean;
  sort: string;
  ascending: boolean;
  fields: string[];
  format: 'json' | 'csv';
  tz: 'ist' | 'utc';
  wantCount: boolean;
  pretty: boolean;
  applied: Record<string, unknown>;
};

export class QueryError extends Error {
  constructor(public param: string, message: string, public hint?: string) {
    super(message);
    this.name = 'QueryError';
  }
}

function firstOf(searchParams: URLSearchParams, keys: string[]) {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value !== null && value.trim() !== '') return value.trim();
  }
  return null;
}

function isTruthy(value: string | null) {
  return value !== null && ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
}

function parseIntParam(searchParams: URLSearchParams, keys: string[], param: string) {
  const raw = firstOf(searchParams, keys);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new QueryError(param, '"' + raw + '" is not a whole number.');
  }
  return parsed;
}

export function parseQuery(searchParams: URLSearchParams): ParsedQuery {
  for (const key of searchParams.keys()) {
    if (!KNOWN_PARAMS.has(key)) {
      throw new QueryError(key, 'Unknown parameter "' + key + '".', 'See /api-docs for the full parameter list.');
    }
  }

  const applied: Record<string, unknown> = {};

  // --- equality filters -----------------------------------------------------
  const filters: Array<{ column: string; values: string[] }> = [];
  for (const { column, aliases } of EQUALITY_FILTERS) {
    const raw = firstOf(searchParams, aliases);
    if (raw === null) continue;

    const requested = splitValues(raw);
    if (!requested.length) continue;
    if (requested.length > MAX_FILTER_VALUES) {
      throw new QueryError(column, 'At most ' + MAX_FILTER_VALUES + ' comma-separated values are allowed per filter.');
    }

    applied[column] = requested;
    filters.push({ column, values: requested.flatMap(caseVariants) });
  }

  // --- date range -----------------------------------------------------------
  const dateFieldRaw = firstOf(searchParams, ['dateField', 'date_field']);
  const dateField = dateFieldRaw ? DATE_FIELDS[dateFieldRaw.toLowerCase()] : 'complaint_date';
  if (!dateField) {
    throw new QueryError(
      'dateField',
      '"' + dateFieldRaw + '" is not a filterable date column.',
      'Use one of: complaint_date, closed_date, created_at, updated_at.'
    );
  }

  let from: string | null = null;
  let to: string | null = null;

  const rawFrom = firstOf(searchParams, ['from', 'fromDate', 'from_date', 'startDate', 'start_date']);
  const rawTo = firstOf(searchParams, ['to', 'toDate', 'to_date', 'endDate', 'end_date']);
  const rawDate = firstOf(searchParams, ['date', 'day']);
  const rawMonth = firstOf(searchParams, ['month']);
  const rawYear = firstOf(searchParams, ['year']);
  const lastDays = parseIntParam(searchParams, ['lastDays', 'last_days', 'days'], 'lastDays');

  // Precedence, most specific first. Documented in /api-docs so a request that
  // sets two of these never behaves surprisingly.
  if (rawFrom || rawTo) {
    if (rawFrom) {
      from = toISTTimestamp(rawFrom, 'start');
      if (!from) {
        throw new QueryError('from', '"' + rawFrom + '" is not a recognised date.', 'Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.');
      }
    }
    if (rawTo) {
      to = toISTTimestamp(rawTo, 'end');
      if (!to) {
        throw new QueryError('to', '"' + rawTo + '" is not a recognised date.', 'Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.');
      }
    }
    applied.from = from;
    applied.to = to;
  } else if (rawDate) {
    from = toISTTimestamp(rawDate, 'start');
    to = toISTTimestamp(rawDate, 'end');
    if (!from || !to) {
      throw new QueryError('date', '"' + rawDate + '" is not a recognised date.', 'Use YYYY-MM-DD.');
    }
    applied.date = rawDate;
  } else if (rawMonth) {
    const parsed = parseMonth(rawMonth);
    if (!parsed) {
      throw new QueryError(
        'month',
        '"' + rawMonth + '" is not a recognised month.',
        'Use YYYY-MM (2026-08) or a month name (August 2026).'
      );
    }
    from = istDayStart(parsed.year, parsed.month, 1);
    to = istDayEnd(parsed.year, parsed.month, daysInMonth(parsed.year, parsed.month));
    applied.month = pad(parsed.year, 4) + '-' + pad(parsed.month);
  } else if (rawYear) {
    const year = Number.parseInt(rawYear, 10);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      throw new QueryError('year', '"' + rawYear + '" is not a recognised year.');
    }
    from = istDayStart(year, 1, 1);
    to = istDayEnd(year, 12, 31);
    applied.year = year;
  } else if (isTruthy(searchParams.get('today'))) {
    const now = istParts(new Date());
    from = istDayStart(now.year, now.month, now.day);
    to = istDayEnd(now.year, now.month, now.day);
    applied.today = true;
  } else if (isTruthy(searchParams.get('yesterday'))) {
    const y = istParts(new Date(Date.now() - 24 * 60 * 60 * 1000));
    from = istDayStart(y.year, y.month, y.day);
    to = istDayEnd(y.year, y.month, y.day);
    applied.yesterday = true;
  } else if (lastDays !== null) {
    if (lastDays < 1 || lastDays > 400) {
      throw new QueryError('lastDays', 'lastDays must be between 1 and 400.');
    }
    const now = istParts(new Date());
    const start = istParts(new Date(Date.now() - (lastDays - 1) * 24 * 60 * 60 * 1000));
    from = istDayStart(start.year, start.month, start.day);
    to = istDayEnd(now.year, now.month, now.day);
    applied.lastDays = lastDays;
  }

  if (from || to) applied.dateField = dateField;

  const rawUpdatedSince = firstOf(searchParams, ['updatedSince', 'updated_since']);
  let updatedSince: string | null = null;
  if (rawUpdatedSince) {
    updatedSince = toISTTimestamp(rawUpdatedSince, 'start');
    if (!updatedSince) {
      throw new QueryError(
        'updatedSince',
        '"' + rawUpdatedSince + '" is not a recognised timestamp.',
        'Use YYYY-MM-DD or a full ISO 8601 timestamp.'
      );
    }
    applied.updatedSince = updatedSince;
  }

  // --- paging ---------------------------------------------------------------
  const rawLimit = parseIntParam(searchParams, ['limit', 'perPage', 'per_page'], 'limit');
  if (rawLimit !== null && rawLimit < 1) {
    throw new QueryError('limit', 'limit must be at least 1.');
  }
  const limit = Math.min(rawLimit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const rawOffset = parseIntParam(searchParams, ['offset'], 'offset');
  if (rawOffset !== null && rawOffset < 0) {
    throw new QueryError('offset', 'offset cannot be negative.');
  }

  const rawPage = parseIntParam(searchParams, ['page'], 'page');
  if (rawPage !== null && rawPage < 1) {
    throw new QueryError('page', 'page starts at 1.');
  }

  // An explicit offset wins; page is then derived so meta stays self-consistent.
  const usedOffset = rawOffset !== null;
  const page = usedOffset ? Math.floor(rawOffset / limit) + 1 : (rawPage ?? 1);
  const offset = usedOffset ? rawOffset : (page - 1) * limit;

  // --- sorting --------------------------------------------------------------
  const sort = (firstOf(searchParams, ['sort', 'sortBy', 'sort_by']) || 'complaint_date').trim();
  if (!SORTABLE.has(sort)) {
    throw new QueryError('sort', '"' + sort + '" cannot be sorted on.', 'Sortable columns: ' + SORTABLE_FIELDS.join(', ') + '.');
  }

  const rawOrder = (firstOf(searchParams, ['order', 'sortDir', 'sort_dir']) || 'desc').toLowerCase();
  if (!['asc', 'desc'].includes(rawOrder)) {
    throw new QueryError('order', '"' + rawOrder + '" is not a sort direction.', 'Use asc or desc.');
  }

  // --- projection and output ------------------------------------------------
  let fields: string[] = [...COMPLAINT_FIELDS];
  const rawFields = firstOf(searchParams, ['fields']);
  if (rawFields) {
    const requested = splitValues(rawFields);
    const unknown = requested.filter((f) => !FIELD_SET.has(f));
    if (unknown.length) {
      throw new QueryError(
        'fields',
        'Unknown field(s): ' + unknown.join(', ') + '.',
        'Available fields: ' + COMPLAINT_FIELDS.join(', ') + '.'
      );
    }
    if (requested.length) fields = requested;
    applied.fields = fields;
  }

  const rawFormat = (firstOf(searchParams, ['format']) || 'json').toLowerCase();
  if (!['json', 'csv'].includes(rawFormat)) {
    throw new QueryError('format', '"' + rawFormat + '" is not a supported format.', 'Use json or csv.');
  }

  const rawTz = (firstOf(searchParams, ['tz', 'timezone']) || 'ist').toLowerCase();
  if (!['ist', 'utc'].includes(rawTz)) {
    throw new QueryError('tz', '"' + rawTz + '" is not a supported timezone.', 'Use ist (default) or utc.');
  }

  const rawCount = (firstOf(searchParams, ['count']) || 'exact').toLowerCase();
  if (!['exact', 'none'].includes(rawCount)) {
    throw new QueryError('count', '"' + rawCount + '" is not a supported count mode.', 'Use exact (default) or none.');
  }

  return {
    filters,
    dateField,
    from,
    to,
    updatedSince,
    limit,
    offset,
    page,
    usedOffset,
    sort,
    ascending: rawOrder === 'asc',
    fields,
    format: rawFormat as 'json' | 'csv',
    tz: rawTz as 'ist' | 'utc',
    wantCount: rawCount === 'exact',
    pretty: isTruthy(searchParams.get('pretty')),
    applied
  };
}

/** Applies the parsed filters to a PostgREST query builder. */
export function applyQuery(builder: any, query: ParsedQuery) {
  let q = builder;

  for (const filter of query.filters) {
    q = filter.values.length === 1
      ? q.eq(filter.column, filter.values[0])
      : q.in(filter.column, filter.values);
  }

  if (query.from) q = q.gte(query.dateField, query.from);
  if (query.to) q = q.lte(query.dateField, query.to);
  if (query.updatedSince) q = q.gte('updated_at', query.updatedSince);

  return q;
}

// ---------------------------------------------------------------------------
// Row shaping
// ---------------------------------------------------------------------------

function formatTimestamp(value: string | null, tz: 'ist' | 'utc') {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  // Complaint timestamps are minute-granular upstream, so the milliseconds
  // toISOString always emits are noise.
  const iso = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (tz === 'utc') return iso;
  // IST is a fixed +05:30 offset year round, so shifting and relabelling is exact.
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, IST_SUFFIX);
}

export function shapeRow(row: Record<string, any>, fields: string[], tz: 'ist' | 'utc') {
  const out: Record<string, any> = {};
  for (const field of fields) {
    const value = row[field];
    out[field] = TIMESTAMP_FIELDS.has(field) ? formatTimestamp(value ?? null, tz) : (value ?? null);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function toCsv(rows: Array<Record<string, any>>, fields: string[]) {
  const lines = [fields.join(',')];
  for (const row of rows) {
    lines.push(fields.map((field) => csvCell(row[field])).join(','));
  }
  return lines.join('\n');
}

export function csvResponse(csv: string, filename: string) {
  // The BOM keeps Excel from mangling non-ASCII consumer names.
  return new NextResponse('﻿' + csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      ...CORS_HEADERS
    }
  });
}

/** Builds the meta.nextPage link. A caller that paged by offset keeps paging by
 *  offset: an unaligned offset does not map onto a page boundary, so switching
 *  to ?page= would hand back rows the caller has already seen. */
export function nextPageUrl(request: Request, query: ParsedQuery, hasMore: boolean) {
  if (!hasMore) return null;

  const url = new URL(request.url);
  if (query.usedOffset) {
    url.searchParams.set('offset', String(query.offset + query.limit));
  } else {
    url.searchParams.delete('offset');
    url.searchParams.set('page', String(query.page + 1));
  }
  return url.toString();
}
