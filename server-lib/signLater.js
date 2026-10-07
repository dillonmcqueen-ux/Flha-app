// server-lib/signLater.js
// "Worker signs afterwards": a record can be saved before its author has
// signed it. Used by FLHA first, then Incident, Equipment Inspection and Near
// Miss, which is why nothing in here knows about one table.
//
// While a record is unsigned it carries `awaiting_signature = true`. It shows
// to supervisors as "Awaiting <name>'s signature" and cannot be approved. Only
// the person it is stamped to (`submitted_by_roster_id`, from the session at
// submit time) can sign it; nobody signs for somebody else. After 24 hours
// unsigned, a crew lead sees a note on their crew screen.
//
// Fail closed: a database without the columns refuses a sign-later save
// rather than quietly storing an unsigned record that nothing blocks.

export const SIGN_LATER_OVERDUE_MS = 24 * 60 * 60 * 1000;
// An unsigned record is closed (kept, never counted, no longer signable) after this long.
export const UNSIGNED_CLOSE_MS = 10 * 24 * 60 * 60 * 1000;

// Tables that can carry the flag. A table name from a request is never used;
// callers pass one of these constants.
export const SIGN_LATER_TABLES = ['flhas', 'incidents', 'inspections', 'near_misses'];

const MAX_SIGNATURE_CHARS = 400000;

/** The signature a worker draws: a PNG data URL of sane size, or null. */
export function cleanSignature(value) {
  if (typeof value !== 'string') return null;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) return null;
  if (value.length > MAX_SIGNATURE_CHARS) return null;
  return value;
}

export function missingSignColumns(error) {
  if (!error) return false;
  // Only a real missing-column error counts. A message that merely names one of
  // the columns must not unlock a retry without the unsigned filter.
  const code = String(error.code || '');
  return code === '42703' || code === 'PGRST204';
}

/** Fields stamped on a record saved to be signed later. */
export function unsignedFields(nowIso) {
  return { awaiting_signature: true, signature_requested_at: nowIso, worker_signed_at: null };
}

/**
 * Reads the sign state of one record: { found, awaiting, requestedAt,
 * authorId, companyId } or { error }. A table without the columns has nothing
 * awaiting a signature.
 */
export async function loadSignState(supabase, table, id, companyId) {
  if (!SIGN_LATER_TABLES.includes(table)) return { error: true };
  const wide = await supabase
    .from(table)
    .select('id, company_id, submitted_by_roster_id, awaiting_signature, signature_requested_at, unsigned_closed_at')
    .eq('id', id)
    .eq('company_id', companyId)
    .limit(1);
  let rows = wide.data;
  if (wide.error) {
    if (!missingSignColumns(wide.error)) return { error: true };
    // Keep awaiting_signature even when only the newer unsigned_closed_at column is
    // missing: dropping it would make every unsigned record look signed.
    const mid = await supabase
      .from(table)
      .select('id, company_id, submitted_by_roster_id, awaiting_signature, signature_requested_at')
      .eq('id', id)
      .eq('company_id', companyId)
      .limit(1);
    if (!mid.error) rows = mid.data;
  }
  if (wide.error && rows === wide.data) {
    const narrow = await supabase
      .from(table)
      .select('id, company_id, submitted_by_roster_id')
      .eq('id', id)
      .eq('company_id', companyId)
      .limit(1);
    if (narrow.error) return { error: true };
    rows = narrow.data;
  }
  const row = rows && rows[0];
  if (!row) return { found: false };
  return {
    found: true,
    awaiting: row.awaiting_signature === true,
    closed: !!row.unsigned_closed_at,
    requestedAt: row.signature_requested_at || null,
    authorId: row.submitted_by_roster_id == null ? null : Number(row.submitted_by_roster_id),
    companyId: row.company_id,
  };
}

/**
 * Applies the one rule that lets a person sign their own awaiting record.
 * `update` is the extra columns to write (the signature and PDF receipt, named
 * by the document type). Returns { ok } or { denied: { status, error } }.
 */
export async function completeSignature(supabase, { table, id, session, update, nowIso }) {
  if (!session || !session.userId) return { denied: { status: 403, error: 'Sign in with your own name to sign.' } };
  const state = await loadSignState(supabase, table, id, session.companyId);
  if (state.error) return { denied: { status: 503, error: "Couldn't check that record. Please try again." } };
  if (!state.found || state.authorId == null || state.authorId !== Number(session.userId)) {
    return { denied: { status: 403, error: 'That is not yours to sign.' } };
  }
  if (state.closed) return { denied: { status: 409, error: 'This record was closed unsigned after 10 days and can no longer be signed. Ask your supervisor.' } };
  if (!state.awaiting) return { denied: { status: 409, error: 'That record is already signed.' } };
  const { data, error } = await supabase
    .from(table)
    .update({ ...update, awaiting_signature: false, worker_signed_at: nowIso })
    .eq('id', id)
    .eq('company_id', session.companyId)
    .eq('submitted_by_roster_id', Number(session.userId))
    .eq('awaiting_signature', true)
    .is('unsigned_closed_at', null)
    .select('id');
  if (error) return { denied: { status: 500, error: 'Could not save your signature. Try again.' } };
  // A second, simultaneous signature matches nothing: report it, don't claim a write.
  if (!data || data.length === 0) return { denied: { status: 409, error: 'That record is already signed.' } };
  return { ok: true };
}

/** True when an unsigned record has waited longer than a day. */
export function signatureOverdue(requestedAt, nowMs = Date.now()) {
  if (!requestedAt) return false;
  const t = new Date(requestedAt).getTime();
  return Number.isFinite(t) && nowMs - t > SIGN_LATER_OVERDUE_MS;
}

/**
 * Runs a read that must not count a record still awaiting its author's
 * signature (readings that feed maintenance and fuel, for example).
 * `buildQuery` returns a fresh query each call. A database without the
 * sign-later columns has no unsigned records, so the read is retried without
 * the filter.
 */
export async function readSignedOnly(buildQuery) {
  const filtered = await buildQuery().eq('awaiting_signature', false);
  if (filtered.error && missingSignColumns(filtered.error)) return await buildQuery();
  return filtered;
}
