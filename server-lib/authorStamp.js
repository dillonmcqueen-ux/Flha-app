// server-lib/authorStamp.js
// Deciding which roster member authored a submitted document.
//
// Break #3 in docs/feature-interaction-map.md: every document identified its
// author by a free-text name, while roster login exists precisely so a
// person is a real record.
//
// The id is already in the session, so this is stamped SERVER-SIDE on
// insert and must never appear in a SUBMITTABLE_FIELDS allowlist. That is
// the opposite of break #2's site_id, which the client legitimately supplies
// from a dropdown: an author a caller can choose is not attribution, it is a
// suggestion. Keeping it out of the allowlists means there is no request
// shape that can set it at all.
//
// It also means a queued offline submission is attributed at DRAIN time to
// whoever is actually logged in, rather than to whatever the payload
// happened to carry when it was written.

/**
 * Returns the roster id to record as the author, or null.
 *
 * Null is the normal, expected outcome in two cases, neither of them a bug:
 *   - a company still on a shared login has no roster row to point at
 *     (2 of the 3 companies today), so its records stay text-only;
 *   - an anonymous near miss must never carry one.
 *
 * `isAnonymous` is not decoration. src/NearMiss.jsx promises the worker in
 * so many words that the report is anonymous and takes no signature.
 * Recording who filed it would silently break that promise — the worker
 * believes they are unidentifiable while the database knows exactly who they
 * are. The database enforces this too
 * (near_misses_anonymous_has_no_author); this is the half that keeps a
 * caller from ever trying.
 */
export function authorRosterId(session, { isAnonymous = false } = {}) {
  if (isAnonymous === true) return null;
  return (session && session.userId) || null;
}

/**
 * Overwrites the free-text name columns on a record about to be inserted
 * with the signed-in person's name, so the name on a document always
 * matches the roster member who submitted it.
 *
 * The client shows the name read-only for a roster login, but nothing
 * stopped a request from carrying a different one. Like the roster id
 * above, the name is stamped server-side. A session with no individual
 * identity (founder/admin) has no name to stamp, so the submitted text is
 * left alone: that is the one case where the form still asks for a name.
 *
 * `isAnonymous` skips the stamp entirely (anonymous near miss).
 */
export function sessionDisplayName(session) {
  return String((session && (session.name || session.userName)) || '').trim();
}

export function stampAuthorName(session, record, fields, { isAnonymous = false } = {}) {
  if (isAnonymous === true || !record) return record;
  const name = sessionDisplayName(session);
  if (!name) return record;
  for (const f of fields) record[f] = name;
  return record;
}
