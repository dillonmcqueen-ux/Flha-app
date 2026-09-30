// server-lib/ownerAccess.js
// Who may edit a company's roster, roles, departments, divisions and setup.
//
// The Account Owner is a supervisor-role roster row with is_owner = true
// (docs/schema/owner-profile-migration.sql). The founder (the `admin`
// session that carries no userId) has exactly the same power over a
// customer's setup; the difference is that the founder can also act across
// companies and is the only one who can reset an Owner's authenticator.
// Neither is a "company admin": customers only ever have a worker,
// supervisor or Owner login, and the Admin Panel stays founder-only.

export function isFounder(session) {
  return !!session && session.role === 'admin' && !session.userId;
}

export function isOwner(session) {
  return !!session && !!session.userId && session.isOwner === true && session.role === 'supervisor';
}

// Owner or founder: the gate for roster roles, departments, divisions and
// the company's setup lists. Supervisors keep the day-to-day worker
// contact edits (email, phone, employee id) but not these.
export function canManageCompany(session) {
  return isFounder(session) || isOwner(session);
}
