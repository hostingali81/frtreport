// Fault-category canonicalisation, shared by every surface that groups calls by
// the operator-recorded fault (Calling Report charts, the called-complaints
// drill-down, and the API that feeds it).
//
// Before the app shipped a fixed fault dropdown, operators typed the category
// free-hand, so the history holds spelling/format variants of the same fault.
// These get folded into one canonical label so a fault isn't split across
// near-duplicate rows. Kept deliberately conservative — only unambiguous
// same-fault variants, never a semantic guess. Keys are lower-cased +
// space-collapsed; see canonicalFault.
export const FAULT_ALIASES: Record<string, string> = {
  'voltage flactuation': 'Voltage Fluctuation',
  '11kv line fault': '11 KV Line Fault',
  'bill related issue': 'Billing Issue',
  'meter related issue': 'Meter Issue',
  't/f fault': 'Transformer (DT) Fault',
  transformer: 'Transformer (DT) Fault',
  'individiual cable fault': 'Service Cable Fault (Individual)'
};

export const canonicalFault = (raw: string): string => {
  const clean = raw.trim().replace(/\s+/g, ' ');
  return FAULT_ALIASES[clean.toLowerCase()] ?? clean;
};

// The calling app prefixes every note with an audit segment it writes itself
// ("Call 1:23", "Rang 0:27 · not picked", "📞 Incoming call", "⚠ No call from
// app"). Duration and direction are already stored in their own columns, so for
// display we strip the prefix down to what the operator actually typed.
export function operatorRemark(notes: string | null | undefined): string {
  if (!notes) return '';
  return notes
    .split(' · ')
    .slice(1)
    .filter((part) => part !== 'not picked' && part !== 'missed')
    .join(' · ')
    .trim();
}

// A log the operator filled in at the desk instead of dialling from the app —
// worth surfacing in a review, since no device call backs it up.
export const isDeskFilled = (notes: string | null | undefined): boolean => !!notes && notes.startsWith('⚠ No call from app');
