import {
  apiJson,
  corsPreflight,
  COMPLAINT_FIELDS,
  DEFAULT_LIMIT,
  EQUALITY_FILTERS,
  MAX_LIMIT,
  SORTABLE_FIELDS
} from '@/app/lib/publicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMESTAMP_FIELDS = new Set(['complaint_date', 'closed_date', 'created_at', 'updated_at']);
const INTEGER_FIELDS = new Set(['id', 'dataid']);

/** The row schema is generated from the same field list the routes project, so
 *  the spec cannot drift away from what the API actually returns. */
function complaintSchema() {
  const properties: Record<string, unknown> = {};
  for (const field of COMPLAINT_FIELDS) {
    if (INTEGER_FIELDS.has(field)) {
      properties[field] = { type: 'integer', nullable: true };
    } else if (TIMESTAMP_FIELDS.has(field)) {
      properties[field] = { type: 'string', format: 'date-time', nullable: true, example: '2026-08-05T14:20:00+05:30' };
    } else {
      properties[field] = { type: 'string', nullable: true };
    }
  }
  return { type: 'object', properties };
}

function filterParameters() {
  return EQUALITY_FILTERS.map(({ column, aliases }) => ({
    name: aliases[0],
    in: 'query',
    required: false,
    description:
      'Filter on `' + column + '`. Case-insensitive, exact match. Comma-separate values to match any of them. ' +
      'Also accepted as: ' + aliases.slice(1).map((a) => '`' + a + '`').join(', ') + '.',
    schema: { type: 'string' }
  }));
}

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  const base = new URL(request.url).origin;

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'FRT Barabanki Complaints API',
      version: '1.0.0',
      description:
        'Read-only JSON access to electricity supply complaints for the Barabanki circle. ' +
        'All dates are Indian Standard Time (UTC+05:30) unless `tz=utc` is passed.',
      contact: { name: 'API documentation', url: base + '/api-docs' }
    },
    servers: [{ url: base }],
    paths: {
      '/api/v1': {
        get: {
          summary: 'Service index',
          description: 'Lists the available endpoints and reports when the dataset was last refreshed.',
          responses: { '200': { description: 'Service metadata' } }
        }
      },
      '/api/v1/complaints': {
        get: {
          summary: 'List complaints',
          description:
            'Returns raw complaint rows. Combine any number of filters; they are ANDed together, ' +
            'while comma-separated values inside one filter are ORed.',
          parameters: [
            ...filterParameters(),
            {
              name: 'from',
              in: 'query',
              description: 'Start of the date range (inclusive). `YYYY-MM-DD` or a full ISO 8601 timestamp. Aliases: `fromDate`, `startDate`.',
              schema: { type: 'string', example: '2026-08-01' }
            },
            {
              name: 'to',
              in: 'query',
              description: 'End of the date range (inclusive). Aliases: `toDate`, `endDate`.',
              schema: { type: 'string', example: '2026-08-31' }
            },
            { name: 'date', in: 'query', description: 'A single calendar day.', schema: { type: 'string', example: '2026-08-15' } },
            { name: 'month', in: 'query', description: 'A whole month: `2026-08`, `08-2026` or `August 2026`.', schema: { type: 'string', example: '2026-08' } },
            { name: 'year', in: 'query', description: 'A whole calendar year.', schema: { type: 'integer', example: 2026 } },
            { name: 'today', in: 'query', description: 'Set to `1` for today (IST).', schema: { type: 'boolean' } },
            { name: 'yesterday', in: 'query', description: 'Set to `1` for yesterday (IST).', schema: { type: 'boolean' } },
            { name: 'lastDays', in: 'query', description: 'The last N days including today (1-400). Alias: `days`.', schema: { type: 'integer', example: 7 } },
            {
              name: 'dateField',
              in: 'query',
              description: 'Which column the date range applies to.',
              schema: { type: 'string', enum: ['complaint_date', 'closed_date', 'created_at', 'updated_at'], default: 'complaint_date' }
            },
            {
              name: 'updatedSince',
              in: 'query',
              description: 'Only rows whose `updated_at` is at or after this timestamp. Applied on top of any date range - use it to sync incrementally.',
              schema: { type: 'string', example: '2026-08-29T00:00:00+05:30' }
            },
            { name: 'page', in: 'query', description: '1-based page number.', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', description: 'Rows per page.', schema: { type: 'integer', default: DEFAULT_LIMIT, maximum: MAX_LIMIT } },
            { name: 'offset', in: 'query', description: 'Row offset. Overrides `page` when both are sent.', schema: { type: 'integer' } },
            { name: 'sort', in: 'query', description: 'Column to sort by.', schema: { type: 'string', enum: [...SORTABLE_FIELDS], default: 'complaint_date' } },
            { name: 'order', in: 'query', description: 'Sort direction.', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
            { name: 'fields', in: 'query', description: 'Comma-separated subset of columns to return.', schema: { type: 'string', example: 'complaint_number,status,complaint_date' } },
            { name: 'format', in: 'query', description: 'Response format.', schema: { type: 'string', enum: ['json', 'csv'], default: 'json' } },
            { name: 'tz', in: 'query', description: 'Timezone for returned timestamps.', schema: { type: 'string', enum: ['ist', 'utc'], default: 'ist' } },
            { name: 'count', in: 'query', description: 'Set to `none` to skip the exact total and shave latency off large queries.', schema: { type: 'string', enum: ['exact', 'none'], default: 'exact' } },
            { name: 'pretty', in: 'query', description: 'Set to `1` for indented JSON.', schema: { type: 'boolean' } }
          ],
          responses: {
            '200': {
              description: 'A page of complaints',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      meta: { $ref: '#/components/schemas/Meta' },
                      data: { type: 'array', items: { $ref: '#/components/schemas/Complaint' } }
                    }
                  }
                },
                'text/csv': { schema: { type: 'string' } }
              }
            },
            '400': { description: 'A parameter was missing, unknown or malformed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '401': { description: 'API key required or invalid', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      },
      '/api/v1/complaints/{complaintNumber}': {
        get: {
          summary: 'Fetch one complaint',
          description: 'Looks up a complaint by its complaint number. An all-digit value is treated as the upstream `dataid`.',
          parameters: [
            { name: 'complaintNumber', in: 'path', required: true, schema: { type: 'string', example: 'MV05072637096' } },
            { name: 'fields', in: 'query', schema: { type: 'string' } },
            { name: 'tz', in: 'query', schema: { type: 'string', enum: ['ist', 'utc'], default: 'ist' } },
            { name: 'pretty', in: 'query', schema: { type: 'boolean' } }
          ],
          responses: {
            '200': {
              description: 'The complaint',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/Complaint' } } }
                }
              }
            },
            '404': { description: 'No such complaint', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
          }
        }
      },
      '/api/v1/filters': {
        get: {
          summary: 'Allowed filter values',
          description: 'Divisions, sub-divisions, sub-stations, statuses, months and the feeders seen in the requested scope.',
          parameters: [
            { name: 'division', in: 'query', description: 'Narrow the sampled feeder list to one division.', schema: { type: 'string' } },
            { name: 'subStation', in: 'query', description: 'Narrow the sampled feeder list to one sub-station.', schema: { type: 'string' } },
            { name: 'pretty', in: 'query', schema: { type: 'boolean' } }
          ],
          responses: { '200': { description: 'Filter vocabularies' } }
        }
      }
    },
    components: {
      securitySchemes: {
        ApiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
        ApiKeyQuery: { type: 'apiKey', in: 'query', name: 'apiKey' }
      },
      schemas: {
        Complaint: complaintSchema(),
        Meta: {
          type: 'object',
          properties: {
            total: { type: 'integer', nullable: true, description: 'Total matching rows, or null when count=none.' },
            totalPages: { type: 'integer', nullable: true },
            count: { type: 'integer', description: 'Rows in this response.' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            hasMore: { type: 'boolean' },
            nextPage: { type: 'string', nullable: true, description: 'Ready-made URL for the next page.' },
            sort: { type: 'string' },
            order: { type: 'string' },
            timezone: { type: 'string' },
            filters: { type: 'object', description: 'Echo of the filters the server actually applied.' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'invalid_parameter' },
                message: { type: 'string' },
                param: { type: 'string', nullable: true },
                hint: { type: 'string', nullable: true }
              }
            }
          }
        }
      }
    }
  };

  return apiJson(spec, {
    pretty: true,
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
  });
}
