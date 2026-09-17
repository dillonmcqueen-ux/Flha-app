// src/certificationStatus.js
// Break #8 in docs/feature-interaction-map.md — certification expiry
// didn't gate, inform, or reach anything. `worker_certifications` was
// referenced by api/certifications.js and by no other file in the codebase.
//
// What this deliberately does NOT do is block a submission. The break was
// written as "a worker whose ticket expired yesterday can still submit an
// FLHA for the task that ticket covers", but two things make gating the
// wrong fix:
//
//   1. `cert_type` is free text (Dashboard.jsx's placeholder is literally
//      "Type (e.g. Fall Protection)"), and nothing anywhere maps a ticket
//      to the tasks or hazards it covers. "The task that ticket covers" is
//      not computable without inventing a taxonomy.
//   2. Refusing the submission would stop a worker filing safety paperwork
//      on a jobsite because an administrative record lapsed. That is worse
//      than the gap it closes.
//
// So the connection runs the other way: a document carries its author
// (submitted_by_roster_id, break #3), and a supervisor reviewing it sees
// what that person's tickets looked like ON THE DAY THEY FILED IT.

const EXPIRING_SOON_DAYS = 30;

// As-of, not "now", and that is the whole point. A ticket that lapsed last
// week was perfectly valid when the worker filed an FLHA three months ago,
// and flagging that old document today would be telling the supervisor
// something false about a record they are reviewing.
export function classifyExpiryAsOf(expiryDate, asOf, soonDays = EXPIRING_SOON_DAYS) {
  if (!expiryDate || !asOf) return null;
  const expiry = new Date(expiryDate);
  const at = new Date(asOf);
  if (isNaN(expiry.getTime()) || isNaN(at.getTime())) return null;
  if (expiry < at) return "expired";
  if (expiry <= new Date(at.getTime() + soonDays * 24 * 60 * 60 * 1000)) return "expiring_soon";
  return "valid";
}

// Returns what a reviewer should know about one document's author, or null
// when there is nothing worth saying.
//
// Null is returned for an unattributed document rather than a zero-state
// badge: documents submitted before break #3 landed carry no roster id, and
// anonymous near misses never carry one by design. "No expired tickets" and
// "we don't know who filed this" are different answers, and showing the
// first when the second is true is how a reviewer gets false assurance.
export function authorCertificationFlags(certifications, rosterId, submittedAt) {
  if (rosterId === null || rosterId === undefined || rosterId === "") return null;
  if (!submittedAt) return null;

  const mine = (certifications || []).filter(c => c && String(c.roster_id) === String(rosterId));
  if (mine.length === 0) return null;

  const expired = [];
  const expiringSoon = [];
  mine.forEach(c => {
    const state = classifyExpiryAsOf(c.expiry_date, submittedAt);
    const label = (c.cert_type || c.cert_name || "Ticket").trim();
    if (state === "expired") expired.push(label);
    else if (state === "expiring_soon") expiringSoon.push(label);
  });

  if (expired.length === 0 && expiringSoon.length === 0) return null;
  return { expired, expiringSoon };
}

// One short line for a document row. Kept here rather than in the component
// so the wording is testable and cannot drift between the places that show
// it.
export function authorCertificationLabel(flags) {
  if (!flags) return null;
  const parts = [];
  if (flags.expired.length) parts.push(`${flags.expired.length} expired ticket${flags.expired.length === 1 ? "" : "s"}`);
  if (flags.expiringSoon.length) parts.push(`${flags.expiringSoon.length} expiring soon`);
  // "when filed" is load-bearing: without it a supervisor reads this as the
  // worker's status today and goes looking for a problem that may not exist.
  return `${parts.join(", ")} when filed`;
}
