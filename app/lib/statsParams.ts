// Query-string -> RPC params for the /analytics aggregate endpoints
// (get_complaints_stats, get_remarks_stats). Both take the same filter set, so
// they must parse it identically or the tabs would disagree on the same filters.

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

export function buildRpcFilterParams(searchParams: URLSearchParams) {
  let fromDate = searchParams.get('fromDate') || '';
  let toDate = searchParams.get('toDate') || '';

  if (!fromDate && !toDate && searchParams.get('today') === '1') {
    const todayRange = getTodayRangeInIST();
    fromDate = todayRange.from;
    toDate = todayRange.to;
  }

  return {
    p_division: searchParams.get('division') || null,
    p_sub_division: searchParams.get('subDivision') || null,
    p_sub_station: searchParams.get('subStation') || null,
    p_status: searchParams.get('status') || null,
    p_closed_status: searchParams.get('closedStatus') || null,
    p_from: toISTTimestamp(fromDate, 'start'),
    p_to: toISTTimestamp(toDate, 'end')
  };
}
