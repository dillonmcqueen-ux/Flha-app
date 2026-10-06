// server-lib/documentAccess.js
// Who may submit or view which document, beyond module gating.
//
// Two separate rules live here, and they are easy to confuse:
//
//   1. ASSIGNMENTS (document_assignments, docs/schema/document-assignments-
//      migration.sql). An Owner says "this audience may submit / view this
//      document". A row can only NARROW access, never widen it past
//      requireDocKey in server-lib/docKeyGate.js. No active rows for a
//      document and action = unchanged behaviour. Departments and divisions
//      are tags, not locks: they gate nothing until a row names them.
//
//   2. SUPERVISOR SCOPE (rule A). A supervisor who is not the Account Owner
//      sees only submissions from their own departments, divisions and
//      sites, plus their own. This is deliberate and is independent of
//      assignment rows. A supervisor with no tags set sees only their own
//      submissions, so tag your supervisors before relying on it.
//
// The Account Owner and the founder (admin) bypass both. Owner status is read
// from the roster row on every call, not from the session token, so demoting
// an Owner takes effect on their next request.
//
// WHY THE OFFLINE QUEUE SHAPES THIS FILE
// A 4xx (other than 401/408/425/429) tells src/offlineQueue.js to DROP a
// queued submission for good. A worker who filled a form in at 9am with no
// signal must not lose it because an Owner assigned the form to someone else
// at noon. Assignment rows therefore carry created_at and ended_at, and a
// submit is evaluated AS OF the moment it was filled in (`asOf`, from the
// client's queued time, clamped to GRACE_MS). A live submit has no queued
// time and is evaluated as of now. Each form's request builder sends the
// queued time on a replay (queuedAtFor in src/offlineQueue.js).
//
// DB FAILURE POSTURE
//   - missing document_assignments table or sites.division_id (migration not
//     applied yet): behave as before, no rows, nothing narrowed. Shipping
//     this file ahead of the SQL must not break submissions. The roster
//     columns it reads (is_owner, divisions, default_site_id) already exist
//     live; a database without them fails closed with 503.
//   - any other read error: fail CLOSED with 503, which the offline queue
//     keeps and retries (403 would drop it). Same reasoning as docKeyGate.

function isFounderSession(session) {
  return !!session && !session.userId && (session.role === 'admin' || session.founder === true);
}

export const SUBMIT = 'submit';
export const VIEW = 'view';
export const GRACE_MS = 48 * 60 * 60 * 1000;

// The document types whose handlers actually call requireAssignment. An
// assignment on any other key (time clock, certifications, equipment
// compliance, maintenance, equipment reports) would hide a menu card while
// the handler still answered, which is the cosmetic-only gating break #21
// was about. Custom forms (`custom_<id>`) and Portal documents
// (`portal_<id>`) are enforced too. The assignment screen must only offer
// keys that pass isAssignableKey.
export const ENFORCED_BUILTIN_KEYS = ['flha', 'inspection', 'toolbox', 'nearmiss', 'incident', 'daily', 'monthly', 'fuellog'];
export function isAssignableKey(key) {
  return ENFORCED_BUILTIN_KEYS.includes(key) || /^custom_\d+$/.test(String(key)) || /^portal_\d+$/.test(String(key));
}
// Portal documents are enforced on submit only: their supervisor reads are
// routed by department in api/portal.js and do not consult view rows (break
// #47 in docs/feature-interaction-map.md). A view row there would be accepted
// and do nothing, so it is not offered.
export function isAssignableAction(key, action) {
  if (!isAssignableKey(key)) return false;
  if (action !== SUBMIT && action !== VIEW) return false;
  return !(/^portal_\d+$/.test(String(key)) && action === VIEW);
}

const MISSING_RELATION_CODES = new Set(['42P01', '42703', 'PGRST205', 'PGRST204']);
function isMissingSchema(error) {
  return !!error && MISSING_RELATION_CODES.has(String(error.code || ''));
}

/**
 * The queued time a submit may be judged by. Only an offline-queue replay
 * carries a clientSubmissionId, so a bare `queuedAt` on its own is ignored.
 * This is a speed bump, not a proof: anyone holding a token can add both
 * fields. What it bounds is the damage (GRACE_MS, a submit only, never a
 * read). The real fix would be a server-signed "opened at" stamp the client
 * echoes back; it is not built, so a handcrafted request can still reach back
 * GRACE_MS on a submit.
 */
export function queuedAsOf(body) {
  if (!body || typeof body.clientSubmissionId !== 'string' || !body.clientSubmissionId) return undefined;
  return body.queuedAt;
}

/** Turns a client-supplied queued time into a safe evaluation instant. */
export function clampAsOf(raw, now = Date.now()) {
  if (raw === undefined || raw === null || raw === '') return now;
  const t = typeof raw === 'number' ? raw : Date.parse(raw);
  if (!Number.isFinite(t)) return now;
  if (t > now) return now;
  if (t < now - GRACE_MS) return now - GRACE_MS;
  return t;
}

function toIdList(values) {
  return (Array.isArray(values) ? values : []).map(Number).filter((n) => Number.isFinite(n));
}

/**
 * The calling person as the access rules see them. Returns null for a
 * session that is not an individually-identified roster login and is not an
 * admin (verifySession refuses those; this is belt and braces).
 *
 * `error: true` means the lookup failed and the caller must fail closed.
 */
export async function loadActor(supabase, session) {
  if (!session) return { actor: null, error: false };
  // The founder: the admin session, and the master code opening a company
  // (`founder: true`, role supervisor, no userId). Neither is a roster row,
  // and both see and submit everything, same as the Owner.
  if (!session.userId && (session.role === 'admin' || session.founder === true)) {
    return { actor: { bypass: true, founder: true, rosterId: null, role: session.role, departments: [], divisionIds: [], siteIds: new Set() }, error: false };
  }
  if (!session.userId) return { actor: null, error: false };

  // hide_unassigned and is_lead arrived after the other columns. A database
  // that does not have one yet answers 42703, and the read is retried with
  // fewer columns so a missing column never takes every submit and list down
  // with it.
  const BASE_COLUMNS = 'id, role, is_owner, departments, divisions, default_site_id, company_id';
  let rows = null;
  let error = null;
  for (const extra of [', hide_unassigned, is_lead', ', hide_unassigned', '']) {
    ({ data: rows, error } = await supabase
      .from('roster')
      .select(`${BASE_COLUMNS}${extra}`)
      .eq('id', session.userId)
      .limit(1));
    if (!(error && isMissingSchema(error))) break;
  }
  if (error) return { actor: null, error: true };
  const r = rows && rows[0];
  if (!r || r.company_id !== session.companyId) return { actor: null, error: false };

  const divisionIds = toIdList(r.divisions);
  const siteIds = new Set();
  if (r.default_site_id != null) siteIds.add(Number(r.default_site_id));
  if (divisionIds.length > 0) {
    const { data: siteRows, error: siteErr } = await supabase
      .from('sites')
      .select('id')
      .eq('company_id', session.companyId)
      .in('division_id', divisionIds);
    if (siteErr && !isMissingSchema(siteErr)) return { actor: null, error: true };
    (siteRows || []).forEach((s) => siteIds.add(Number(s.id)));
  }

  return {
    actor: {
      bypass: r.is_owner === true && r.role === 'supervisor',
      founder: false,
      rosterId: Number(r.id),
      role: r.role,
      departments: Array.isArray(r.departments) ? r.departments : [],
      divisionIds,
      siteIds,
      // The Owner hid every document that is not assigned to this person.
      hideUnassigned: r.hide_unassigned === true,
      // A crew lead: a worker the Owner flagged. Read live, never from the
      // token. Only a worker row can be one.
      isLead: r.is_lead === true && r.role === 'worker',
    },
    error: false,
  };
}

/** Does one assignment row name this person? Pure. */
export function matchesAudience(row, actor) {
  switch (row.audience_type) {
    case 'everyone': return true;
    case 'role': return actor.role === row.audience_value;
    case 'department': return actor.departments.includes(row.audience_value);
    case 'division': return actor.divisionIds.includes(Number(row.audience_value));
    case 'site': return actor.siteIds.has(Number(row.audience_value));
    case 'individual': return actor.rosterId != null && String(actor.rosterId) === String(row.audience_value);
    default: return false;
  }
}

/** Rows that were in force at the given instant. Pure. */
export function activeRowsAsOf(rows, asOfMs) {
  return (rows || []).filter((r) => {
    const created = Date.parse(r.created_at);
    if (Number.isFinite(created) && created > asOfMs) return false;
    if (r.ended_at) {
      const ended = Date.parse(r.ended_at);
      if (Number.isFinite(ended) && ended <= asOfMs) return false;
    }
    return true;
  });
}

/**
 * The decision for one document and action. Pure.
 *   narrowed: some active row exists for this action
 *   allowed:  not narrowed, or at least one row names the actor
 */
export function evaluateAccess(rows, actor, action, asOfMs) {
  if (actor.bypass) return { narrowed: false, allowed: true };
  const active = activeRowsAsOf(rows, asOfMs).filter((r) => r.action === action);
  // Only a RESTRICTING row narrows. A task (restricts = false) puts the
  // document on someone's "assigned to you" list with a due date and takes
  // nothing away from anyone else. A row with no `restricts` field predates
  // the switch and restricts, as it always did.
  const restricting = active.filter(isRestricting);
  if (restricting.length > 0 && !restricting.some((r) => matchesAudience(r, actor))) {
    return { narrowed: true, allowed: false };
  }
  // "Hide everything not assigned to me": with no row naming this person the
  // document is off for them, even when nobody else has been narrowed. A task
  // from the Owner names them just as a restriction does, but a task from a
  // crew lead does not: the Owner's decision to limit what this person sees
  // is not the lead's to undo. The restriction check above has already run,
  // so no task can get past a restriction either.
  if (action === SUBMIT && actor.hideUnassigned) {
    return { narrowed: true, allowed: active.some((r) => r.by_lead !== true && matchesAudience(r, actor)) };
  }
  if (restricting.length === 0) return { narrowed: false, allowed: true };
  return { narrowed: true, allowed: true };
}

/** Does this row narrow access, or is it only a task? Pure. */
export function isRestricting(row) {
  return row.restricts !== false;
}

async function readAssignmentRows(supabase, companyId, documentKeys) {
  // by_lead arrived with the crew lead migration; a database without it
  // answers 42703 and the read is retried without it, so an unapplied
  // migration never switches every assignment off.
  let { data, error } = await supabase
    .from('document_assignments')
    .select('document_key, audience_type, audience_value, action, restricts, by_lead, due_at, created_at, ended_at')
    .eq('company_id', companyId)
    .in('document_key', documentKeys);
  if (error && isMissingSchema(error) && String(error.code) === '42703') {
    ({ data, error } = await supabase
      .from('document_assignments')
      .select('document_key, audience_type, audience_value, action, restricts, due_at, created_at, ended_at')
      .eq('company_id', companyId)
      .in('document_key', documentKeys));
  }
  if (error) {
    if (isMissingSchema(error)) return { rows: [], error: false };
    return { rows: [], error: true };
  }
  return { rows: data || [], error: false };
}

const NOT_ALLOWED = {
  [SUBMIT]: 'This document is not assigned to you.',
  [VIEW]: 'You do not have access to these records.',
};

/**
 * The guard handlers call, next to requireDocKey. Returns null when the
 * action may proceed or `{ status, error }` to return verbatim.
 *
 *   const denied = await requireAssignment(supabaseAdmin, session, 'flha', SUBMIT, { asOf: req.body.queuedAt });
 *   if (denied) return res.status(denied.status).json({ error: denied.error });
 *
 * 'view' is a supervisor-tier concept. A worker is never narrowed by a view
 * row, because a worker only ever reads their own submissions.
 */
export async function requireAssignment(supabase, session, documentKey, action, { asOf } = {}) {
  if (!session) return { status: 401, error: 'Not logged in. Please log in again.' };
  if (isFounderSession(session)) return null;
  const { actor, error: actorErr } = await loadActor(supabase, session);
  if (actorErr) return { status: 503, error: "Couldn't check your access. Please try again." };
  if (!actor) return { status: 401, error: 'Not logged in. Please log in again.' };
  // Reading is a supervisor-tier idea: an ordinary worker only ever reads
  // their own submissions and is never narrowed by a view row. A crew lead
  // reads their crew's, so a lead is held to the view rows.
  if (action === VIEW && actor.role === 'worker' && !actor.isLead) return null;
  if (actor.bypass) return null;
  const { rows, error } = await readAssignmentRows(supabase, session.companyId, [documentKey]);
  if (error) return { status: 503, error: "Couldn't check your access. Please try again." };
  const verdict = evaluateAccess(rows, actor, action, action === SUBMIT ? clampAsOf(asOf) : Date.now());
  if (verdict.allowed) return null;
  return { status: 403, error: NOT_ALLOWED[action] };
}

/**
 * For the worker menu. Given the document keys a company has switched on,
 * returns which of them this person may submit and the assignments naming
 * them (with due dates), so the menu can show "assigned to you" first.
 *
 *   { allowedKeys: Set, assigned: [{ documentKey, dueAt }], error }
 *
 * On a read error `allowedKeys` is null and the caller must show everything
 * (the menu is presentation; every submit handler enforces for real).
 */
export async function menuAccessFor(supabase, session, documentKeys) {
  const { actor, error: actorErr } = await loadActor(supabase, session);
  if (actorErr || !actor) return { allowedKeys: null, assigned: [], error: true };
  if (actor.bypass) {
    return { allowedKeys: new Set(documentKeys), assigned: [], error: false };
  }
  const assignable = documentKeys.filter(isAssignableKey);
  const allowedKeys = new Set(documentKeys.filter((k) => !isAssignableKey(k)));
  if (assignable.length === 0) return { allowedKeys, assigned: [], error: false };
  const { rows, error } = await readAssignmentRows(supabase, session.companyId, assignable);
  if (error) return { allowedKeys: null, assigned: [], error: true };
  const now = Date.now();
  const assigned = [];
  for (const key of assignable) {
    const forKey = rows.filter((r) => r.document_key === key);
    if (evaluateAccess(forKey, actor, SUBMIT, now).allowed) allowedKeys.add(key);
    const mine = activeRowsAsOf(forKey, now).filter((r) => r.action === SUBMIT && matchesAudience(r, actor));
    if (mine.length > 0) {
      const dues = mine.map((r) => (r.due_at ? Date.parse(r.due_at) : null)).filter((t) => t !== null);
      const sinceMs = Math.min(...mine.map((r) => Date.parse(r.created_at)).filter((t) => Number.isFinite(t)));
      assigned.push({
        documentKey: key,
        dueAt: dues.length ? new Date(Math.min(...dues)).toISOString() : null,
        since: Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : null,
      });
    }
  }
  return { allowedKeys, assigned, error: false };
}

// ── Supervisor scope (rule A) ─────────────────────────────────────────────

/** Does this record fall inside the supervisor's own scope? Pure. */
export function recordInScope(record, actor, authorTags, { siteKey = 'site_id', authorKey = 'submitted_by_roster_id' } = {}) {
  const authorId = record[authorKey];
  if (authorId != null && actor.rosterId != null && Number(authorId) === actor.rosterId) return true;
  const siteId = record[siteKey];
  if (siteId != null && actor.siteIds.has(Number(siteId))) return true;
  if (authorId != null) {
    const tags = authorTags.get(Number(authorId));
    if (tags) {
      if ((tags.departments || []).some((d) => actor.departments.includes(d))) return true;
      if (toIdList(tags.divisions).some((d) => actor.divisionIds.includes(d))) return true;
    }
  }
  return false;
}

async function readAuthorTags(supabase, companyId, records, authorKey) {
  const ids = [...new Set(records.map((r) => r[authorKey]).filter((v) => v != null).map(Number))];
  const tags = new Map();
  if (ids.length === 0) return { tags, error: false };
  const { data, error } = await supabase
    .from('roster')
    .select('id, departments, divisions')
    .eq('company_id', companyId)
    .in('id', ids);
  if (error) return { tags, error: true };
  (data || []).forEach((r) => tags.set(Number(r.id), r));
  return { tags, error: false };
}

/**
 * Filters a list of records down to what this session may see.
 *   - admin / founder / Account Owner: everything
 *   - worker: never reaches here (list handlers are supervisor-tier)
 *   - supervisor: rule A
 *
 * Returns `{ records }` or `{ denied: { status, error } }`.
 */
export async function scopeRecords(supabase, session, records, opts = {}) {
  if (!session) return { denied: { status: 401, error: 'Not logged in. Please log in again.' } };
  if (isFounderSession(session)) return { records };
  const { actor, error: actorErr } = await loadActor(supabase, session);
  if (actorErr) return { denied: { status: 503, error: "Couldn't check your access. Please try again." } };
  if (!actor) return { denied: { status: 401, error: 'Not logged in. Please log in again.' } };
  if (actor.bypass) return { records };
  const authorKey = opts.authorKey || 'submitted_by_roster_id';
  const { tags, error } = await readAuthorTags(supabase, session.companyId, records, authorKey);
  if (error) return { denied: { status: 503, error: "Couldn't check your access. Please try again." } };
  return { records: records.filter((r) => recordInScope(r, actor, tags, opts)) };
}

/** One record, for detail / edit / delete / review handlers. */
export async function requireRecordScope(supabase, session, record, opts = {}) {
  if (!record) return null;
  const out = await scopeRecords(supabase, session, [record], opts);
  if (out.denied) return out.denied;
  if (out.records.length === 0) return { status: 403, error: 'Not allowed.' };
  return null;
}

/**
 * Edit / delete / review / sign handlers: the caller may touch these records
 * only if they could have listed them. Checks the document's view rows and
 * then rule A for every record. Returns null or `{ status, error }`.
 */
export async function requireRecordsAccess(supabase, session, documentKey, records, opts = {}) {
  const viewDenied = await requireAssignment(supabase, session, documentKey, VIEW);
  if (viewDenied) return viewDenied;
  const list = (records || []).filter(Boolean);
  if (list.length === 0) return null;
  const out = await scopeRecords(supabase, session, list, opts);
  if (out.denied) return out.denied;
  if (out.records.length !== list.length) return { status: 403, error: 'Not allowed.' };
  return null;
}

/**
 * List handlers: view rows, then rule A. Returns `{ records }` or
 * `{ denied: { status, error } }`.
 */
export async function listVisibleRecords(supabase, session, documentKey, records, opts = {}) {
  const viewDenied = await requireAssignment(supabase, session, documentKey, VIEW);
  if (viewDenied) return { denied: viewDenied };
  return scopeRecords(supabase, session, records, opts);
}

/**
 * List handlers whose rows span several documents (custom forms: one key per
 * form). `keyOf(record)` names each record's document key. Applies each
 * document's view rows, then rule A.
 */
export async function listVisibleRecordsMulti(supabase, session, records, keyOf, opts = {}) {
  if (isFounderSession(session)) return { records };
  const { actor, error: actorErr } = await loadActor(supabase, session);
  if (actorErr) return { denied: { status: 503, error: "Couldn't check your access. Please try again." } };
  if (!actor) return { denied: { status: 401, error: 'Not logged in. Please log in again.' } };
  if (actor.bypass) return { records };
  const keys = [...new Set(records.map(keyOf))];
  let kept = records;
  if (keys.length > 0) {
    const { rows, error } = await readAssignmentRows(supabase, session.companyId, keys);
    if (error) return { denied: { status: 503, error: "Couldn't check your access. Please try again." } };
    const now = Date.now();
    const allowedByKey = new Map(keys.map((k) => [k, evaluateAccess(rows.filter((r) => r.document_key === k), actor, VIEW, now).allowed]));
    kept = records.filter((r) => allowedByKey.get(keyOf(r)));
  }
  return scopeRecords(supabase, session, kept, opts);
}

/**
 * One person's hide-unassigned flag, tolerant of the column not existing yet
 * (returns false). For profile screens; enforcement reads it in loadActor.
 */
export async function readHideUnassigned(supabase, companyId, rosterId) {
  const { data, error } = await supabase
    .from('roster').select('hide_unassigned').eq('id', rosterId).eq('company_id', companyId).limit(1);
  if (error || !data || !data[0]) return false;
  return data[0].hide_unassigned === true;
}

// Where each document's submissions live and how they join to the author.
// Monthly, custom and Portal rows have no company_id of their own; they are
// reached through their form or document, which is already this company's.
const COMPLETION_SOURCES = {
  flha: { table: 'flhas' },
  inspection: { table: 'inspections' },
  toolbox: { table: 'toolbox_talks' },
  nearmiss: { table: 'near_misses' },
  incident: { table: 'incidents' },
  daily: { table: 'daily_reports' },
  fuellog: { table: 'fuel_logs' },
  monthly: { table: 'inspection_records' },
};

/**
 * Adds `completedAt` to each assignment: this person's latest submission of
 * that document made at or after the assignment began, or null. Derived from
 * the author stamp on the record, never stored. A document whose records
 * carry no author (an anonymous near miss) can never show as done. Best
 * effort: any read error leaves completedAt null.
 */
export async function withCompletion(supabase, session, assigned) {
  if (!session || !session.userId || assigned.length === 0) return assigned;
  return Promise.all(assigned.map(async (a) => {
    try {
      let q;
      const custom = /^custom_(\d+)$/.exec(a.documentKey);
      const portal = /^portal_(\d+)$/.exec(a.documentKey);
      if (custom) q = supabase.from('custom_form_records').select('created_at').eq('form_id', Number(custom[1]));
      else if (portal) q = supabase.from('portal_records').select('created_at').eq('document_id', Number(portal[1]));
      else if (COMPLETION_SOURCES[a.documentKey]) {
        q = supabase.from(COMPLETION_SOURCES[a.documentKey].table).select('created_at');
        if (a.documentKey !== 'monthly') q = q.eq('company_id', session.companyId);
      } else return { ...a, completedAt: null };
      if (a.since) q = q.gte('created_at', a.since);
      const { data, error } = await q.eq('submitted_by_roster_id', session.userId).order('created_at', { ascending: false }).limit(1);
      return { ...a, completedAt: !error && data && data[0] ? data[0].created_at : null };
    } catch (e) {
      return { ...a, completedAt: null };
    }
  }));
}

/**
 * One person's Owner-set flags, tolerant of either column not existing yet
 * (each reads false). For profile screens; enforcement reads them in
 * loadActor.
 */
export async function readRosterFlags(supabase, companyId, rosterId) {
  for (const cols of ['hide_unassigned, is_lead', 'hide_unassigned', 'is_lead']) {
    const { data, error } = await supabase
      .from('roster').select(cols).eq('id', rosterId).eq('company_id', companyId).limit(1);
    if (error) { if (isMissingSchema(error)) continue; return { hideUnassigned: false, isLead: false }; }
    const r = (data && data[0]) || {};
    return { hideUnassigned: r.hide_unassigned === true, isLead: r.is_lead === true };
  }
  return { hideUnassigned: false, isLead: false };
}
