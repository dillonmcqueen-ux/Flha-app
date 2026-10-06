// server-lib/leadAccess.js
// The crew lead: a WORKER the Account Owner flagged (roster.is_lead), not a
// new role. A lead keeps the worker menu and every worker gate, so the ~35
// places that test role === 'worker' are untouched, and gains four things:
//
//   - sees their crew's submissions (read only)
//   - signs off an extreme-risk FLHA for their crew
//   - gives their crew TASKS (a due date and a menu entry; a lead can never
//     restrict a document, only the Owner can)
//   - fills in a Daily Report or Fuel Log for a crew member, who stays the
//     author while the lead is recorded as having entered it
//
// A lead is a worker for the seat cap and signs in exactly like one.
//
// "Crew" is the people who share a department or division with the lead, or
// whose default site is one of the lead's sites (the lead's own default site
// plus the sites of their divisions). It is the same reach a supervisor's
// scope has (documentAccess.js rule A), so a lead sees what a supervisor
// with the same tags would see, and no more.

import { loadActor } from './documentAccess.js';

/**
 * Resolves the caller as a crew lead, from the roster row (never the token).
 * Returns `{ actor }` or `{ denied: { status, error } }`.
 */
export async function requireLead(supabase, session) {
  if (!session || !session.userId) return { denied: { status: 403, error: 'Not allowed.' } };
  const { actor, error } = await loadActor(supabase, session);
  if (error) return { denied: { status: 503, error: "Couldn't check your access. Please try again." } };
  if (!actor || !actor.isLead) return { denied: { status: 403, error: 'Only a crew lead can do that.' } };
  return { actor };
}

/** Is this person on the lead's crew? Pure. */
export function inCrew(actor, person) {
  if (!person || Number(person.id) === actor.rosterId) return false;
  if ((person.departments || []).some((d) => actor.departments.includes(d))) return true;
  if ((person.divisions || []).map(Number).some((d) => actor.divisionIds.includes(d))) return true;
  return person.default_site_id != null && actor.siteIds.has(Number(person.default_site_id));
}

/**
 * The lead's active crew: [{ id, name, role, departments, divisions,
 * default_site_id }], company-scoped. A crew never includes an Owner or
 * another supervisor's authority: only workers and other leads can be on it,
 * so a lead cannot reach upward.
 */
export async function loadCrew(supabase, session, actor) {
  const { data, error } = await supabase
    .from('roster')
    .select('id, name, role, is_owner, departments, divisions, default_site_id')
    .eq('company_id', session.companyId)
    .eq('active', true)
    .eq('role', 'worker');
  if (error) return { error: true, crew: [] };
  return { crew: (data || []).filter((p) => inCrew(actor, p)) };
}

/**
 * "Filling in for": returns a derived session in which the crew member is the
 * author and `enteredBy` records the lead, or `{ denied }`. Every id is
 * resolved against the lead's own crew server-side; a request can name
 * anybody, only a crew member is accepted.
 *
 * Only used by the document types that capture no personal signature (Daily
 * Report, Fuel Log). A signature is a legal act by the person, so a lead can
 * never produce one for somebody else; the other documents stay the
 * person's own to submit.
 */
export async function resolveOnBehalf(supabase, session, onBehalfOfRosterId) {
  const lead = await requireLead(supabase, session);
  if (lead.denied) return { denied: lead.denied };
  const id = Number(onBehalfOfRosterId);
  if (!Number.isInteger(id)) return { denied: { status: 400, error: 'Pick who you are filling this in for.' } };
  const { crew, error } = await loadCrew(supabase, session, lead.actor);
  if (error) return { denied: { status: 503, error: "Couldn't check your crew. Please try again." } };
  const member = crew.find((p) => Number(p.id) === id);
  if (!member) return { denied: { status: 403, error: 'That person is not on your crew.' } };
  return {
    session: { ...session, userId: member.id, name: member.name, userName: member.name, isOwner: false, enteredBy: lead.actor.rosterId },
    member,
  };
}
