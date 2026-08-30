import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';

export const metadata: Metadata = {
  title: 'Complaints API',
  description: 'REST API documentation for the FRT Barabanki supply complaints dataset.'
};

// ---------------------------------------------------------------------------
// Static documentation for the public API under /api/v1. Everything here is
// plain server-rendered markup: the page has no client bundle, and every
// example is a real link a reader can click to see live JSON.
// ---------------------------------------------------------------------------

type Row = { name: string; type: string; detail: string };

const FILTER_PARAMS: Row[] = [
  { name: 'division', type: 'string', detail: 'Electricity division, e.g. EDD-BARABANKI.' },
  { name: 'subDivision', type: 'string', detail: 'Sub-division. Also accepted as sub_division.' },
  { name: 'subStation', type: 'string', detail: 'Sub-station, e.g. 33/11 KV BADEL. Also accepted as sub_station or substation.' },
  { name: 'feeder', type: 'string', detail: 'Feeder name. Free text, so use /api/v1/filters to discover valid values.' },
  { name: 'areaType', type: 'string', detail: 'Urban, Rural, Industrial or Class1.' },
  { name: 'status', type: 'string', detail: 'Complaint Closed, Pending or Work In Progress.' },
  { name: 'closedStatus', type: 'string', detail: 'Closed Within, Closed Beyond or Work In progress.' },
  { name: 'closedBy', type: 'string', detail: 'Who closed it - a crew mobile number or a name such as CONTROL_ROOM_2.' },
  { name: 'complaintType', type: 'string', detail: 'Top-level category, currently only Supply Related.' },
  { name: 'complaintSubType', type: 'string', detail: 'e.g. No Supply, Major Power Failure, Distribution Transformer.' },
  { name: 'complaintNumber', type: 'string', detail: 'One or more complaint numbers.' },
  { name: 'mobile', type: 'string', detail: 'Consumer mobile number. Also accepted as consumerMobile.' },
  { name: 'dataid', type: 'integer', detail: 'The record id used by the upstream FRT system.' }
];

const DATE_PARAMS: Row[] = [
  { name: 'from', type: 'date', detail: 'Start of the range, inclusive. YYYY-MM-DD or a full ISO timestamp. Aliases: fromDate, startDate.' },
  { name: 'to', type: 'date', detail: 'End of the range, inclusive. Aliases: toDate, endDate.' },
  { name: 'date', type: 'date', detail: 'A single calendar day - shorthand for from and to on the same date.' },
  { name: 'month', type: 'string', detail: 'A whole month. Accepts 2026-08, 08-2026, August 2026 or aug-2026.' },
  { name: 'year', type: 'integer', detail: 'A whole calendar year, e.g. 2026.' },
  { name: 'today', type: 'boolean', detail: 'Set to 1 for today so far (IST).' },
  { name: 'yesterday', type: 'boolean', detail: 'Set to 1 for the whole of yesterday (IST).' },
  { name: 'lastDays', type: 'integer', detail: 'The last N days including today, 1-400. Alias: days.' },
  { name: 'dateField', type: 'string', detail: 'Which column the range applies to: complaint_date (default), closed_date, created_at or updated_at.' },
  { name: 'updatedSince', type: 'timestamp', detail: 'Only rows changed at or after this moment. Applied on top of any date range - this is how you sync incrementally.' }
];

const OUTPUT_PARAMS: Row[] = [
  { name: 'page', type: 'integer', detail: '1-based page number. Default 1.' },
  { name: 'limit', type: 'integer', detail: 'Rows per page. Default 100, maximum 1000.' },
  { name: 'offset', type: 'integer', detail: 'Row offset. Overrides page when both are sent.' },
  { name: 'sort', type: 'string', detail: 'Column to sort by. Default complaint_date.' },
  { name: 'order', type: 'string', detail: 'asc or desc. Default desc.' },
  { name: 'fields', type: 'string', detail: 'Comma-separated subset of columns, to cut the response size.' },
  { name: 'format', type: 'string', detail: 'json (default) or csv. CSV downloads as a file with a UTF-8 BOM so Excel opens it cleanly.' },
  { name: 'tz', type: 'string', detail: 'ist (default) returns +05:30 timestamps; utc returns Z timestamps.' },
  { name: 'count', type: 'string', detail: 'exact (default) includes the total row count. Pass none to skip it and respond faster.' },
  { name: 'pretty', type: 'boolean', detail: 'Set to 1 for indented JSON - handy when opening the URL in a browser.' }
];

const FIELDS: Row[] = [
  { name: 'id', type: 'integer', detail: 'Internal row id. Stable, but not the number the consumer sees.' },
  { name: 'complaint_number', type: 'string', detail: 'The complaint number printed on the ticket, e.g. MV05072637096.' },
  { name: 'complaint_date', type: 'timestamp', detail: 'When the complaint was registered.' },
  { name: 'closed_date', type: 'timestamp', detail: 'When it was closed. null while still open.' },
  { name: 'status', type: 'string', detail: 'Complaint Closed, Pending or Work In Progress.' },
  { name: 'closed_status', type: 'string', detail: 'Whether the closure met the response-time target: Closed Within or Closed Beyond.' },
  { name: 'closed_by', type: 'string', detail: 'Crew mobile number or control-room identifier that closed it.' },
  { name: 'closing_remarks', type: 'string', detail: 'Free-text remark recorded at closure.' },
  { name: 'division', type: 'string', detail: 'Electricity distribution division.' },
  { name: 'sub_division', type: 'string', detail: 'Sub-division under the division.' },
  { name: 'sub_station', type: 'string', detail: '33/11 KV sub-station the supply comes from.' },
  { name: 'feeder', type: 'string', detail: '11 KV feeder. The same feeder name can exist under two sub-stations.' },
  { name: 'area_type', type: 'string', detail: 'Urban, Rural, Industrial or Class1.' },
  { name: 'complaint_type', type: 'string', detail: 'Top-level category.' },
  { name: 'complaint_sub_type', type: 'string', detail: 'Specific fault category.' },
  { name: 'consumer_name', type: 'string', detail: 'Name of the complainant.' },
  { name: 'consumer_mobile', type: 'string', detail: 'Contact number of the complainant.' },
  { name: 'consumer_address', type: 'string', detail: 'Address as recorded upstream.' },
  { name: 'landmark', type: 'string', detail: 'Landmark, when the consumer supplied one.' },
  { name: 'assigned_crew', type: 'string', detail: 'Field crew assigned to the complaint.' },
  { name: 'crew_mobile', type: 'string', detail: 'Mobile number of the assigned crew.' },
  { name: 'consumer_remarks', type: 'string', detail: 'Remark captured from the consumer during follow-up calling.' },
  { name: 'dataid', type: 'integer', detail: 'Record id in the upstream FRT system.' },
  { name: 'created_at', type: 'timestamp', detail: 'When this row first entered the database.' },
  { name: 'updated_at', type: 'timestamp', detail: 'When this row was last refreshed. Use it with updatedSince to sync.' }
];

const ERRORS = [
  { code: '400 invalid_parameter', detail: 'An unknown parameter, an unparseable date, a limit below 1, a field or sort column that does not exist. The response names the offending parameter and usually suggests the fix.' },
  { code: '401 unauthorized', detail: 'Only possible when this deployment has an API key configured and the request did not carry a valid one.' },
  { code: '404 not_found', detail: 'The single-complaint endpoint found no row for that complaint number or dataid.' },
  { code: '500 query_failed', detail: 'The database rejected or could not finish the query. Retry; if it persists the query is probably too broad.' },
  { code: '503 database_unavailable', detail: 'The deployment is missing its database credentials.' }
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-slate-200 pt-10">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

function ParamTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Parameter</th>
            <th className="px-4 py-2.5 font-semibold">Type</th>
            <th className="px-4 py-2.5 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.name} className="align-top">
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[13px] font-medium text-sky-800">{row.name}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{row.type}</td>
              <td className="px-4 py-2.5 text-slate-700">{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-4 text-[13px] leading-relaxed text-slate-100">
      <code>{children}</code>
    </pre>
  );
}

function Try({ base, path, label }: { base: string; path: string; label?: string }) {
  return (
    <a
      href={path}
      target="_blank"
      rel="noreferrer"
      className="group block rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[13px] text-slate-800 hover:border-sky-400 hover:bg-sky-50"
    >
      {label ? <span className="mb-1 block font-sans text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span> : null}
      <span className="break-all">
        <span className="text-slate-400">{base}</span>
        <span className="group-hover:text-sky-800">{path}</span>
      </span>
    </a>
  );
}

const NAV = [
  ['quick-start', 'Quick start'],
  ['endpoints', 'Endpoints'],
  ['filters', 'Filter parameters'],
  ['dates', 'Date parameters'],
  ['output', 'Output & paging'],
  ['response', 'Response shape'],
  ['fields', 'Field reference'],
  ['recipes', 'Recipes'],
  ['paging-code', 'Fetching everything'],
  ['errors', 'Errors'],
  ['notes', 'Limits & notes']
];

export default async function ApiDocsPage() {
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') || headerList.get('host') || 'frtreport.vercel.app';
  const proto = headerList.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const base = proto + '://' + host;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">FRT Barabanki</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900">Complaints REST API</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-600">
            Read-only JSON access to every electricity supply complaint in the Barabanki circle. Filter by division,
            sub-division, sub-station, feeder, status, date range or month, and get raw rows back - no scraping, no
            login, no HTML parsing.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700 ring-1 ring-emerald-200">
              No authentication required
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
              All times IST (UTC+05:30)
            </span>
            <a href="/api/v1/openapi" target="_blank" rel="noreferrer" className="rounded-full bg-sky-50 px-3 py-1 font-medium text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100">
              OpenAPI 3.1 spec
            </a>
            <a href="/api/v1" target="_blank" rel="noreferrer" className="rounded-full bg-sky-50 px-3 py-1 font-medium text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100">
              Service index
            </a>
          </div>
          <div className="mt-6 inline-flex flex-wrap items-baseline gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Base URL</span>
            <span className="font-mono text-sm text-slate-900">{base}/api/v1</span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-6 py-12">
        <nav className="sticky top-8 hidden h-fit w-52 shrink-0 lg:block">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">On this page</p>
          <ul className="space-y-1.5 text-sm">
            {NAV.map(([id, label]) => (
              <li key={id}>
                <a href={'#' + id} className="text-slate-600 hover:text-sky-700">{label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 space-y-12">
          <section id="quick-start" className="scroll-mt-20">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Quick start</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-slate-700">
              Open this in a browser or hit it with curl. It returns the five most recent complaints, indented for
              reading:
            </p>
            <div className="mt-4">
              <Try base={base} path="/api/v1/complaints?limit=5&pretty=1" />
            </div>
            <p className="mt-6 text-[15px] leading-relaxed text-slate-700">And the same thing from a terminal:</p>
            <div className="mt-3">
              <Code>{'curl "' + base + '/api/v1/complaints?limit=5"'}</Code>
            </div>
            <p className="mt-6 text-[15px] leading-relaxed text-slate-700">
              Everything else is that URL plus filters. Filters combine with AND; comma-separated values inside one
              filter combine with OR.
            </p>
          </section>

          <Section id="endpoints" title="Endpoints">
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="font-mono text-sm text-slate-900">
                  <span className="mr-2 rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">GET</span>
                  /api/v1/complaints
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  The main endpoint. Returns a page of raw complaint rows plus a <span className="font-mono">meta</span> block
                  describing the result set.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="font-mono text-sm text-slate-900">
                  <span className="mr-2 rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">GET</span>
                  /api/v1/complaints/{'{complaintNumber}'}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  One complaint by its number. An all-digit path segment is treated as the upstream{' '}
                  <span className="font-mono">dataid</span> instead.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="font-mono text-sm text-slate-900">
                  <span className="mr-2 rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">GET</span>
                  /api/v1/filters
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Every value you are allowed to filter on: divisions, sub-divisions, sub-stations, statuses, months,
                  and the feeders seen in a scope. Call this first if you are building a dropdown.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="font-mono text-sm text-slate-900">
                  <span className="mr-2 rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">GET</span>
                  /api/v1 &nbsp;·&nbsp; /api/v1/openapi
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Service index (endpoint list and data freshness) and the machine-readable OpenAPI 3.1 document you can
                  import into Postman, Insomnia or a code generator.
                </p>
              </div>
            </div>
          </Section>

          <Section id="filters" title="Filter parameters">
            <p>
              All of these are optional and can be combined. Matching is exact but case-insensitive, so{' '}
              <span className="font-mono text-sm">areaType=urban</span> and{' '}
              <span className="font-mono text-sm">areaType=URBAN</span> behave identically. There is no partial or fuzzy
              matching - fetch valid values from <a className="text-sky-700 underline" href="/api/v1/filters?pretty=1" target="_blank" rel="noreferrer">/api/v1/filters</a>.
            </p>
            <ParamTable rows={FILTER_PARAMS} />
            <p>
              Pass several values to one filter by separating them with commas, up to 50 per filter:
            </p>
            <Try base={base} path="/api/v1/complaints?status=Pending,Work%20In%20Progress&limit=5&pretty=1" />
          </Section>

          <Section id="dates" title="Date parameters">
            <p>
              Dates are interpreted in Indian Standard Time. A bare{' '}
              <span className="font-mono text-sm">YYYY-MM-DD</span> in <span className="font-mono text-sm">from</span> starts
              at 00:00:00 IST, and in <span className="font-mono text-sm">to</span> it ends at 23:59:59.999 IST, so both
              ends of a range are inclusive.
            </p>
            <ParamTable rows={DATE_PARAMS} />
            <div className="rounded-lg border-l-4 border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong className="font-semibold">Only one range applies.</strong> If you send more than one, the most
              specific wins, in this order: <span className="font-mono">from/to</span> →{' '}
              <span className="font-mono">date</span> → <span className="font-mono">month</span> →{' '}
              <span className="font-mono">year</span> → <span className="font-mono">today</span> →{' '}
              <span className="font-mono">yesterday</span> → <span className="font-mono">lastDays</span>. The{' '}
              <span className="font-mono">meta.filters</span> block in every response tells you what the server actually
              applied. <span className="font-mono">updatedSince</span> is the exception - it always applies, on top of
              whichever range you chose.
            </div>
          </Section>

          <Section id="output" title="Output & paging">
            <ParamTable rows={OUTPUT_PARAMS} />
            <p>
              The hard ceiling on <span className="font-mono text-sm">limit</span> is 1000 rows per request. To pull more
              than that, walk the pages - see <a className="text-sky-700 underline" href="#paging-code">fetching everything</a>.
            </p>
          </Section>

          <Section id="response" title="Response shape">
            <p>
              Successful list responses always look like this. <span className="font-mono text-sm">meta.nextPage</span> is
              a ready-made URL, so a client can follow it without rebuilding the query string:
            </p>
            <Code>{`{
  "success": true,
  "meta": {
    "total": 4175,
    "totalPages": 42,
    "count": 100,
    "page": 1,
    "limit": 100,
    "offset": 0,
    "hasMore": true,
    "nextPage": "` + base + `/api/v1/complaints?month=2026-08&page=2",
    "sort": "complaint_date",
    "order": "desc",
    "timezone": "Asia/Kolkata",
    "filters": { "month": "2026-08", "dateField": "complaint_date" },
    "docs": "` + base + `/api-docs"
  },
  "data": [
    {
      "id": 4134408,
      "complaint_number": "MV05072637096",
      "complaint_date": "2026-07-05T22:11:00+05:30",
      "closed_date": "2026-07-05T23:59:00+05:30",
      "status": "Complaint Closed",
      "closed_status": "Closed Within",
      "closed_by": "CONTROL_ROOM_2",
      "closing_remarks": "Work in Progress",
      "division": "EDD-RAMSNEHI GHAT",
      "sub_division": "EDSD-RAMSANEHI GHAT",
      "sub_station": "33/11 KV DULAADEPUR",
      "feeder": "Katwa Sadak",
      "area_type": "Rural",
      "complaint_type": "Supply Related",
      "complaint_sub_type": "No Supply",
      "consumer_name": "ANIL KUMAR",
      "consumer_mobile": "7080787123",
      "consumer_address": "poore kot chhndwal BARABANKI UP-225405 IND",
      "landmark": null,
      "assigned_crew": null,
      "crew_mobile": null,
      "consumer_remarks": null,
      "dataid": 59491956,
      "created_at": "2026-07-05T22:37:59+05:30",
      "updated_at": "2026-07-09T08:35:41+05:30"
    }
  ]
}`}</Code>
            <p>
              Errors use one consistent envelope, and name the parameter at fault:
            </p>
            <Code>{`{
  "success": false,
  "error": {
    "code": "invalid_parameter",
    "message": "\\"2026-13\\" is not a recognised month.",
    "param": "month",
    "hint": "Use YYYY-MM (2026-08) or a month name (August 2026)."
  }
}`}</Code>
          </Section>

          <Section id="fields" title="Field reference">
            <p>
              Every column returned by default. Restrict them with{' '}
              <span className="font-mono text-sm">fields=</span> when you only need a few - it makes large pulls
              dramatically smaller.
            </p>
            <ParamTable rows={FIELDS} />
            <div className="rounded-lg border-l-4 border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Rows scraped in the last few minutes can arrive with{' '}
              <span className="font-mono">division</span>, <span className="font-mono">status</span> and the consumer
              fields still <span className="font-mono">null</span>; a later pass fills them in. Filter on{' '}
              <span className="font-mono">updated_at</span> if you need only settled rows.
            </div>
          </Section>

          <Section id="recipes" title="Recipes">
            <p>Each of these is a live link. Click one to see the response.</p>
            <div className="space-y-3">
              <Try base={base} label="Today's complaints" path="/api/v1/complaints?today=1&limit=20&pretty=1" />
              <Try base={base} label="One month, one division" path="/api/v1/complaints?month=2026-08&division=EDD-BARABANKI&limit=20&pretty=1" />
              <Try base={base} label="One sub-station over a date range" path="/api/v1/complaints?subStation=33/11%20KV%20BADEL&from=2026-08-01&to=2026-08-15&pretty=1" />
              <Try base={base} label="Still-pending complaints, oldest first" path="/api/v1/complaints?status=Pending&sort=complaint_date&order=asc&limit=50&pretty=1" />
              <Try base={base} label="Complaints closed beyond the target time" path="/api/v1/complaints?closedStatus=Closed%20Beyond&month=2026-08&limit=20&pretty=1" />
              <Try base={base} label="Rural no-supply faults last 7 days" path="/api/v1/complaints?areaType=Rural&complaintSubType=No%20Supply&lastDays=7&limit=20&pretty=1" />
              <Try base={base} label="Closed during a window (by closing time, not registration time)" path="/api/v1/complaints?dateField=closed_date&from=2026-08-01&to=2026-08-07&limit=20&pretty=1" />
              <Try base={base} label="Only four columns, for a lightweight feed" path="/api/v1/complaints?month=2026-08&fields=complaint_number,sub_station,status,complaint_date&limit=50&pretty=1" />
              <Try base={base} label="Everything changed since a timestamp (incremental sync)" path="/api/v1/complaints?updatedSince=2026-08-29&sort=updated_at&order=asc&limit=100&pretty=1" />
              <Try base={base} label="Just the count, no rows" path="/api/v1/complaints?month=2026-08&limit=1&fields=id&pretty=1" />
              <Try base={base} label="CSV download" path="/api/v1/complaints?month=2026-08&division=EDD-BARABANKI&format=csv&limit=1000" />
              <Try base={base} label="One complaint by number" path="/api/v1/complaints/MV05072637096?pretty=1" />
              <Try base={base} label="Feeders under one sub-station" path="/api/v1/filters?subStation=33/11%20KV%20BADEL&pretty=1" />
            </div>
          </Section>

          <Section id="paging-code" title="Fetching everything">
            <p>
              With <span className="font-mono text-sm">limit=1000</span> and{' '}
              <span className="font-mono text-sm">count=none</span>, a month of complaints is a handful of requests. Keep
              going until a page comes back with fewer rows than you asked for.
            </p>
            <p className="pt-2 font-medium text-slate-900">JavaScript</p>
            <Code>{`const BASE = "` + base + `/api/v1/complaints";

async function fetchAll(filters) {
  const rows = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams(filters);
    params.set("limit", "1000");
    params.set("count", "none");
    params.set("page", String(page));

    const res = await fetch(BASE + "?" + params);
    if (!res.ok) throw new Error("HTTP " + res.status);

    const body = await res.json();
    rows.push(...body.data);

    if (body.data.length < 1000) break;
    page += 1;
  }

  return rows;
}

const august = await fetchAll({ month: "2026-08", division: "EDD-BARABANKI" });
console.log(august.length + " complaints");`}</Code>
            <p className="pt-2 font-medium text-slate-900">Python</p>
            <Code>{`import requests

BASE = "` + base + `/api/v1/complaints"

def fetch_all(**filters):
    rows, page = [], 1
    while True:
        params = {**filters, "limit": 1000, "count": "none", "page": page}
        body = requests.get(BASE, params=params, timeout=60).json()
        rows.extend(body["data"])
        if len(body["data"]) < 1000:
            return rows
        page += 1

august = fetch_all(month="2026-08", division="EDD-BARABANKI")
print(len(august), "complaints")`}</Code>
            <p className="pt-2 font-medium text-slate-900">Straight into a spreadsheet</p>
            <Code>{`curl -o august.csv \\
  "` + base + `/api/v1/complaints?month=2026-08&format=csv&limit=1000"`}</Code>
          </Section>

          <Section id="errors" title="Errors">
            <p>
              Every failure returns the same envelope with an HTTP status that matches. Unknown query parameters are a
              deliberate 400 rather than a silent no-op, so a typo like{' '}
              <span className="font-mono text-sm">divison=</span> never looks like an empty result set.
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Status &amp; code</th>
                    <th className="px-4 py-2.5 font-semibold">When it happens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ERRORS.map((row) => (
                    <tr key={row.code} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[13px] text-sky-800">{row.code}</td>
                      <td className="px-4 py-2.5 text-slate-700">{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="notes" title="Limits & notes">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="font-semibold text-slate-900">Page size</strong> is capped at 1000 rows. Anything
                larger is silently reduced to 1000 rather than rejected.
              </li>
              <li>
                <strong className="font-semibold text-slate-900">Caching.</strong> List responses carry{' '}
                <span className="font-mono text-sm">s-maxage=60</span>, so identical requests within a minute may be
                served from the edge cache. Filter options are cached for 15 minutes.
              </li>
              <li>
                <strong className="font-semibold text-slate-900">Freshness.</strong> The dataset is refreshed from the
                upstream FRT system every few minutes; a complaint&apos;s status can keep changing for a day or two after
                it is registered. <a className="text-sky-700 underline" href="/api/v1" target="_blank" rel="noreferrer">/api/v1</a>{' '}
                reports the last successful refresh.
              </li>
              <li>
                <strong className="font-semibold text-slate-900">Cost of a query.</strong> Filtering by date is what
                keeps requests fast. An unfiltered request with{' '}
                <span className="font-mono text-sm">count=exact</span> has to count roughly 185,000 rows - pass{' '}
                <span className="font-mono text-sm">count=none</span> when you do not need the total.
              </li>
              <li>
                <strong className="font-semibold text-slate-900">CORS</strong> is open, so browser applications can call
                the API directly.
              </li>
              <li>
                <strong className="font-semibold text-slate-900">Personal data.</strong> Rows include consumer names,
                addresses and mobile numbers. Handle them accordingly, and do not republish them in bulk.
              </li>
              <li>
                <strong className="font-semibold text-slate-900">Writes.</strong> There are none. Every endpoint is{' '}
                <span className="font-mono text-sm">GET</span> only.
              </li>
            </ul>
          </Section>
        </main>
      </div>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-500">
          FRT Barabanki Complaints API · v1 ·{' '}
          <a className="text-sky-700 underline" href="/api/v1/openapi" target="_blank" rel="noreferrer">OpenAPI spec</a>{' '}
          ·{' '}
          <Link className="text-sky-700 underline" href="/">Report dashboard</Link>
        </div>
      </footer>
    </div>
  );
}
