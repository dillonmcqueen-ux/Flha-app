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
