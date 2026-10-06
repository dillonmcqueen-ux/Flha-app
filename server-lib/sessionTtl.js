// server-lib/sessionTtl.js
// How long a signed login session stays valid. Every api/*.js file that
// verifies a session calls sessionExpired() instead of carrying its own copy
// of the constant, so the two lifetimes below can never drift between files.
//
//   - Workers keep 7 days. Workers are on
//     phones in the field and a login mid-shift is the thing to avoid.
//   - Supervisors (which includes the Account Owner) and founder sessions get 12 hours: long enough
//     that one PIN plus authenticator covers a working day, short enough that a
//     stolen unlocked laptop does not stay logged in for a week. The browser
//     now keeps their session across closing the window (src/Login.jsx), so
//     this expiry is what bounds it.
//
// Lives outside api/ on purpose, same reason as server-lib/uploadUrls.js.

export const WORKER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SUPERVISOR_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function sessionTtlMs(payload) {
  if (!payload) return WORKER_SESSION_TTL_MS;
  // Founder sessions reach every company, so they get the short window too.
  if (payload.role === 'admin' || payload.founder === true) return SUPERVISOR_SESSION_TTL_MS;
  return payload.role === 'supervisor' && payload.userId ? SUPERVISOR_SESSION_TTL_MS : WORKER_SESSION_TTL_MS;
}

export function sessionExpired(payload, now = Date.now()) {
  if (!payload || !payload.issuedAt) return true;
  return now - payload.issuedAt > sessionTtlMs(payload);
}
