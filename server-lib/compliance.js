// server-lib/compliance.js
// One definition of the equipment-compliance vocabulary — what the document
// types are called, and how close an expiry date is — shared by everything
// that asks: the Dashboard's Equipment > Compliance tab, the Dashboard's
// overview banner, `compliance_summary` in api/companydata.js, and the
// compliance section of the weekly equipment report
// (api/equipmentreports.js -> server-lib/reportPdfs.js).
//
// It lives here rather than in src/ because api/ code cannot import from the
// frontend bundle, and it is deliberately dependency-free (no supabase, no
// node builtins, no React) so the browser bundle importing it costs nothing.
// The functions below are a verbatim move of the ones that were defined at
// module level in src/Dashboard.jsx when the Compliance tab was built — a
// second copy on the server would be two 30-day windows that can silently
// drift apart, which is the class of break docs/feature-interaction-map.md
// exists to catch. api/certifications.js keeps its own classifyExpiry for
// WORKER certifications: different table, different vocabulary
// ('expiring_soon' / 'valid' is what its callers already read), and merging
// the two is a change to the certification surface, not to break #14.

// How close an expiry date is, in the only three buckets a supervisor acts
// on. 30 days is the window because that is roughly the notice needed to
// book a CVIP and still have the machine working in the meantime.
export const EXPIRY_WARNING_DAYS = 30;

// The document types the compliance editor offers. The server stores
// whatever it is sent (api/companydata.js's complianceDocType only trims and
// lowercases it) — this list is the shortlist, not the constraint, because
// what expires on a machine varies by industry. It lives here so the weekly
// report names a document the same way the screen that created it does:
// "cvip" on a printed page a supervisor hands to an auditor is not the same
// as "CVIP / safety inspection".
export const COMPLIANCE_DOC_TYPES = [
  { key: 'cvip', label: 'CVIP / safety inspection' },
  { key: 'registration', label: 'Registration' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'certification', label: 'Certification' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'other', label: 'Other' },
];

// A free-text doc_type that isn't on the shortlist reads back as itself.
export function complianceDocLabel(key) {
  return (COMPLIANCE_DOC_TYPES.find(t => t.key === key) || {}).label || key;
}

// Whole days from `asOf` until `dateStr`, negative once the date has passed.
// Returns null when either side is unparseable, so a caller can tell "no
// answer" from "zero days".
//
// Both sides are parsed as LOCAL midnight, so the subtraction is a whole
// number of days regardless of timezone (Math.round absorbs the DST hour).
// `asOf` accepts a 'YYYY-MM-DD' string — which is what the weekly report
// passes, since a stored report is a snapshot classified against the week it
// covers, not against whenever someone opens the PDF — or a Date, which
// defaults to now.
//
// Known, deliberate edge: on the server "now" is UTC, so between 6pm
// Mountain and midnight the server's idea of today is already tomorrow, and
// a date expiring today classifies as `expired` one evening early. It errs
// toward warning sooner, and the Compliance tab (which classifies in the
// browser's own timezone) is the screen that states the actual date.
export function expiryDayDelta(dateStr, asOf = new Date()) {
  if (!dateStr) return null;
  const due = new Date(`${dateStr}T00:00:00`);
  const from = typeof asOf === 'string' ? new Date(`${asOf}T00:00:00`) : new Date(asOf);
  if (typeof asOf !== 'string') from.setHours(0, 0, 0, 0);
  if (Number.isNaN(due.getTime()) || Number.isNaN(from.getTime())) return null;
  return Math.round((due - from) / 86400000);
}

// "expired" | "due_soon" | "ok". A missing or unparseable date reads as "ok"
// rather than "expired": the compliance table requires a real date on write
// (api/companydata.js), so the only way to get here without one is a row
// that predates that check, and flagging those as expired would bury the
// real ones in noise.
export function expiryStatus(dateStr, asOf = new Date()) {
  const days = expiryDayDelta(dateStr, asOf);
  if (days == null) return 'ok';
  if (days < 0) return 'expired';
  if (days <= EXPIRY_WARNING_DAYS) return 'due_soon';
  return 'ok';
}

// The same fact in the words a supervisor reads on the row.
export function expiryText(dateStr, asOf = new Date()) {
  const days = expiryDayDelta(dateStr, asOf);
  if (days == null) return 'No expiry date';
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Expires today';
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}
