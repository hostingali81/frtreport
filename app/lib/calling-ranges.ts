// The Calling Report's date presets, in one place.
//
// Both sides of the cache must agree on the exact from/to a preset means: the
// dashboard requests a range, and /api/calling/analytics only finds the
// precomputed row if that range matches a preset byte-for-byte. Keeping the
// ranges here (instead of mirroring them in the component and the warmer) is
// what stops the two from drifting apart. Pure date maths — no server imports —
// so the client bundle can use it too.

export type PresetId = 'today' | 'yesterday' | 'month' | 'lastMonth';

export const CALLING_PRESETS: { id: PresetId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'month', label: 'Current Month' },
  { id: 'lastMonth', label: 'Last Month' }
];

// "Today" is the operators' today: complaint dates are IST, so the day must be
// resolved in IST whatever the server's or viewer's timezone is.
export function istDateOnly(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const m = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

export function subtractDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return fmt(dt);
}

// Resolve a preset against a given IST "today". Current Month stops at today
// rather than running to the month's end — future dates hold no complaints and
// would only fragment the preset cache.
export function presetRange(id: PresetId, today: string = istDateOnly()): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  switch (id) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y1 = subtractDays(today, 1);
      return { from: y1, to: y1 };
    }
    case 'month':
      return { from: fmt(new Date(Date.UTC(y, m - 1, 1))), to: today };
    case 'lastMonth':
      // Day 0 of a month is the last day of the one before it.
      return { from: fmt(new Date(Date.UTC(y, m - 2, 1))), to: fmt(new Date(Date.UTC(y, m - 1, 0))) };
  }
}

export type PresetRange = { key: PresetId; from: string; to: string };

export function presetRanges(now: Date = new Date()): PresetRange[] {
  const today = istDateOnly(now);
  return CALLING_PRESETS.map((p) => ({ key: p.id, ...presetRange(p.id, today) }));
}

// Map an incoming request range back to a preset key, or null for a custom
// range (which has no precomputed row and runs the RPC live).
export function matchPresetKey(opts: { allTime?: boolean; from: string; to: string }, now: Date = new Date()): PresetId | null {
  if (opts.allTime) return null;
  return presetRanges(now).find((p) => p.from === opts.from && p.to === opts.to)?.key ?? null;
}
