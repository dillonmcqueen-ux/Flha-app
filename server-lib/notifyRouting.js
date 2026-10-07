// server-lib/notifyRouting.js
// Who hears about a newly submitted document, and the email that tells them.
//
// The audience is exactly the people who could open the record, never a
// separate list that can drift from it:
//
//   - a supervisor (not the Owner) whose departments, divisions or sites
//     place the record: documentAccess.js recordInScope, the same rule that
//     decides what their Dashboard shows
//   - a crew lead, when the record's author is on their crew: leadAccess.js
//     inCrew. A lead's reach is the crew's own records, so an anonymous record
//     (no author) never reaches a lead
//   - anyone the Owner named for this document ("always notify")
//   - the Account Owner, ONLY when nobody else would be told, so a record that
//     matches nobody's tags still reaches a person
//
// "Could open" includes the Owner's per-document VIEW assignments: someone a
// document's view rows leave out is not told it exists, even when their tags
// place the record. The same check runs on the Owner's "always notify" extras,
// so naming a person cannot widen who learns about a document past who may read
// it.
//
// CALLER CONTRACT (PR 2 onwards):
//   - companyId comes from the verified session, never from the request
//   - submitted_by_roster_id is null for an anonymous record, explicitly
//   - siteName is a label looked up server-side from the validated site; it is
//     still stripped of control characters and links here as a second guard
//   - the result of routeNotification holds decrypted addresses. It is for the
//     server only: a response to a browser (the Owner's preview) must carry
//     names or masked addresses, never `email`
//   - a site is placed by an anonymous record's site alone, so an alert at a
//     one-person site can still point at its author. That is inherent to
//     notifying by site and is the Owner's choice to switch on
//
// The author is never told about their own submission. An anonymous near miss
// has no author, so it is placed by its site alone and no email mentions a
// person.
//
// OFF BY DEFAULT: a document with no document_notifications row, or one with
// enabled = false, notifies nobody. A database without the table behaves the
// same way, so shipping this ahead of the SQL changes nothing.
//
// COOLDOWN: document_notification_state remembers when each person was last
// told about each document. Inside the window a notice is held back and
// counted, and the next email says how many came in since. A state table that
// cannot be read or written means NOTHING is sent: the cooldown is what keeps
// a flood off the shared sender, so it is never skipped.
//
// The email names the document and the site and nothing else: no report
// content, no author, so incident detail never sits in an inbox. One email per
// person, so recipients never see each other's addresses. A failed send is
// logged and never thrown: the record is already saved.

import { recordInScope, evaluateAccess, VIEW } from './documentAccess.js';
import { inCrew } from './leadAccess.js';
import { withDecryptedEmail } from './fieldCrypto.js';

const MISSING_SCHEMA = new Set(['42P01', '42703', 'PGRST205', 'PGRST204']);
const isMissingSchema = (error) => !!error && MISSING_SCHEMA.has(String(error.code || ''));

// A runaway audience (a mis-tagged company) must not turn one submit into a
// burst of emails.
export const MAX_RECIPIENTS = 25;

// One email per person per document per window. A worker looping submits, or a
// busy site, then costs each recipient one email and a count, not one per
// submit, and the shared sender's quota is protected for every company.
export const COOLDOWN_MS = 10 * 60 * 1000;

export const DOCUMENT_LABELS = {
  flha: 'FLHA',
  inspection: 'Equipment Inspection',
  toolbox: 'Toolbox Talk',
  nearmiss: 'Near Miss Report',
  incident: 'Incident Report',
  daily: 'Daily Report',
  monthly: 'Monthly Inspection',
  fuellog: 'Fuel Log',
};

const SINGLE_ADDRESS = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

// A label that is safe to put in a subject line and the first line of an email
// from FORA's own sender: one line, no control characters, no links.
export function cleanLabel(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

const toIdList = (values) => (Array.isArray(values) ? values : []).map(Number).filter((n) => Number.isFinite(n));

function actorFor(person, divisionSites) {
  const divisionIds = toIdList(person.divisions);
  const siteIds = new Set();
  if (person.default_site_id != null) siteIds.add(Number(person.default_site_id));
  divisionIds.forEach((d) => (divisionSites.get(d) || []).forEach((s) => siteIds.add(Number(s))));
  return {
    rosterId: Number(person.id),
    role: person.role,
    departments: Array.isArray(person.departments) ? person.departments : [],
    divisionIds,
    siteIds,
  };
}

/**
 * The people to tell about one record. Pure.
 *
 *   record         { site_id, submitted_by_roster_id } (author null = anonymous)
 *   roster         the company's ACTIVE people, each { id, role, is_owner,
 *                  is_lead, departments, divisions, default_site_id, email }
 *                  with `email` already decrypted
 *   author         the author's { id, departments, divisions, default_site_id },
 *                  or null. Passed separately because the author may no longer
 *                  be active.
 *   divisionSites  Map(divisionId -> [siteId]) for the company
 *   extraRosterIds the Owner's "always notify" ids for this document
 *   viewRows       the document's active 'view' assignment rows (may be empty)
 *   nowMs          the instant the view rows are judged at
 *
 * Returns { recipients: [{ id, email }], missingEmail: [id], reason }.
 * `reason` is 'ok', or 'none' when nobody could be told.
 */
export function pickRecipients({ record, roster, author = null, divisionSites = new Map(), extraRosterIds = [], viewRows = [], nowMs = Date.now() }) {
  const authorId = record.submitted_by_roster_id != null ? Number(record.submitted_by_roster_id) : null;
  const authorTags = new Map();
  if (author && authorId != null) authorTags.set(authorId, { departments: author.departments || [], divisions: author.divisions || [] });

  // Extras first, so the cap below drops the broad audience before it drops
  // someone the Owner asked for by name.
  const chosen = new Map();
  const mayView = (person) => evaluateAccess(viewRows, actorFor(person, divisionSites), VIEW, nowMs).allowed;
  const add = (person) => {
    if (person && Number(person.id) !== authorId && mayView(person)) chosen.set(Number(person.id), person);
  };
  const byId = new Map(roster.map((p) => [Number(p.id), p]));
  for (const id of toIdList(extraRosterIds)) add(byId.get(id));

  for (const person of roster) {
    if (person.is_owner === true && person.role === 'supervisor') continue; // fallback only
    const actor = actorFor(person, divisionSites);
    if (person.role === 'supervisor') {
      if (recordInScope(record, actor, authorTags)) add(person);
    } else if (person.role === 'worker' && person.is_lead === true && author && authorId != null) {
      if (inCrew(actor, { id: authorId, departments: author.departments, divisions: author.divisions, default_site_id: author.default_site_id })) add(person);
    }
  }

  if (chosen.size === 0) {
    // The Owner sees everything, so no view row can leave them out.
    roster.filter((p) => p.is_owner === true && p.role === 'supervisor' && Number(p.id) !== authorId)
      .forEach((p) => chosen.set(Number(p.id), p));
  }

  const missingEmail = [];
  const recipients = [];
  for (const person of chosen.values()) {
    const email = typeof person.email === 'string' ? person.email.trim() : '';
    // One plain address only: a stored value like "a@x.com, b@y.com" must not
    // reach Resend as a list.
    if (!SINGLE_ADDRESS.test(email)) { missingEmail.push(Number(person.id)); continue; }
    recipients.push({ id: Number(person.id), email });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    console.error(`notification audience capped: ${recipients.length - MAX_RECIPIENTS} of ${recipients.length} not told`);
  }
  return { recipients: recipients.slice(0, MAX_RECIPIENTS), missingEmail, reason: recipients.length > 0 ? 'ok' : 'none' };
}

/** The Owner's setting for one document, or off. */
export async function loadNotifySetting(supabase, companyId, documentKey) {
  const { data, error } = await supabase
    .from('document_notifications')
    .select('enabled, extra_roster_ids')
    .eq('company_id', companyId)
    .eq('document_key', documentKey)
    .limit(1);
  if (error) {
    if (isMissingSchema(error)) return { enabled: false, extraRosterIds: [], error: false };
    return { enabled: false, extraRosterIds: [], error: true };
  }
  const row = data && data[0];
  if (!row || row.enabled !== true) return { enabled: false, extraRosterIds: [], error: false };
  return { enabled: true, extraRosterIds: toIdList(row.extra_roster_ids), error: false };
}

async function loadRoster(supabase, companyId) {
  let rows = null;
  let error = null;
  for (const cols of [
    'id, role, is_owner, is_lead, departments, divisions, default_site_id, email',
    'id, role, is_owner, departments, divisions, default_site_id, email',
  ]) {
    ({ data: rows, error } = await supabase.from('roster').select(cols).eq('company_id', companyId).eq('active', true));
    if (!(error && isMissingSchema(error))) break;
  }
  if (error) return { roster: [], error: true };
  return { roster: withDecryptedEmail(rows || []), error: false };
}

async function loadViewRows(supabase, companyId, documentKey) {
  const { data, error } = await supabase
    .from('document_assignments')
    .select('audience_type, audience_value, action, restricts, created_at, ended_at')
    .eq('company_id', companyId)
    .eq('document_key', documentKey)
    .eq('action', VIEW);
  if (error) return isMissingSchema(error) ? { rows: [], error: false } : { rows: [], error: true };
  return { rows: data || [], error: false };
}

// A site id that is not this company's is treated as no site at all. The
// submit handler validates it too; this keeps a forged id from steering routing.
async function ownSiteId(supabase, companyId, siteId) {
  if (siteId == null) return { siteId: null, error: false };
  const { data, error } = await supabase.from('sites').select('id').eq('company_id', companyId).eq('id', siteId).limit(1);
  if (error) return isMissingSchema(error) ? { siteId: null, error: false } : { siteId: null, error: true };
  return { siteId: data && data[0] ? Number(data[0].id) : null, error: false };
}

async function loadDivisionSites(supabase, companyId, divisionIds) {
  const map = new Map();
  if (divisionIds.length === 0) return { map, error: false };
  const { data, error } = await supabase.from('sites').select('id, division_id').eq('company_id', companyId).in('division_id', divisionIds);
  if (error) return isMissingSchema(error) ? { map, error: false } : { map, error: true };
  (data || []).forEach((s) => {
    const d = Number(s.division_id);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(Number(s.id));
  });
  return { map, error: false };
}

/**
 * Works out who to tell about a record, without sending anything. Used by
 * notifyOnSubmit, and by the Owner's "who would be notified" preview.
 * `enabled: false` means the document is off, not an error.
 */
export async function routeNotification(supabase, { companyId, documentKey, record }) {
  const setting = await loadNotifySetting(supabase, companyId, documentKey);
  if (setting.error) return { enabled: false, recipients: [], missingEmail: [], reason: 'error' };
  if (!setting.enabled) return { enabled: false, recipients: [], missingEmail: [], reason: 'off' };

  const { roster, error } = await loadRoster(supabase, companyId);
  if (error) return { enabled: true, recipients: [], missingEmail: [], reason: 'error' };

  const authorId = record.submitted_by_roster_id != null ? Number(record.submitted_by_roster_id) : null;
  let author = null;
  if (authorId != null) {
    author = roster.find((p) => Number(p.id) === authorId) || null;
    if (!author) {
      const { data } = await supabase.from('roster').select('id, departments, divisions, default_site_id').eq('company_id', companyId).eq('id', authorId).limit(1);
      author = (data && data[0]) || null;
    }
  }

  const divisionIds = [...new Set(roster.flatMap((p) => toIdList(p.divisions)))];
  const { map: divisionSites, error: sitesErr } = await loadDivisionSites(supabase, companyId, divisionIds);
  if (sitesErr) return { enabled: true, recipients: [], missingEmail: [], reason: 'error' };

  const view = await loadViewRows(supabase, companyId, documentKey);
  if (view.error) return { enabled: true, recipients: [], missingEmail: [], reason: 'error' };
  const site = await ownSiteId(supabase, companyId, record.site_id);
  if (site.error) return { enabled: true, recipients: [], missingEmail: [], reason: 'error' };

  const picked = pickRecipients({ record: { ...record, site_id: site.siteId }, roster, author, divisionSites, extraRosterIds: setting.extraRosterIds, viewRows: view.rows });
  return { enabled: true, ...picked };
}

/**
 * Splits the audience into who is emailed now and who is inside their cooldown.
 * Pure. `state` maps roster id -> { last_sent_at, suppressed_count }.
 */
export function applyCooldown(recipients, state, nowMs) {
  const send = [];
  const hold = [];
  for (const r of recipients) {
    const s = state.get(Number(r.id));
    const last = s ? Date.parse(s.last_sent_at) : NaN;
    if (Number.isFinite(last) && nowMs - last < COOLDOWN_MS) hold.push({ ...r, suppressed: Number(s.suppressed_count) || 0 });
    else send.push({ ...r, suppressed: s ? Number(s.suppressed_count) || 0 : 0 });
  }
  return { send, hold };
}

async function loadState(supabase, companyId, documentKey, rosterIds) {
  const { data, error } = await supabase
    .from('document_notification_state')
    .select('roster_id, last_sent_at, suppressed_count')
    .eq('company_id', companyId)
    .eq('document_key', documentKey)
    .in('roster_id', rosterIds);
  if (error) return { state: new Map(), error: true };
  return { state: new Map((data || []).map((r) => [Number(r.roster_id), r])), error: false };
}

async function saveState(supabase, companyId, documentKey, rosterId, lastSentAt, suppressedCount) {
  const { error } = await supabase
    .from('document_notification_state')
    .upsert({ company_id: companyId, document_key: documentKey, roster_id: rosterId, last_sent_at: lastSentAt, suppressed_count: suppressedCount }, { onConflict: 'company_id,document_key,roster_id' });
  if (error) console.error('notification state write failed:', error.message);
}

/**
 * Tells the audience about a new record. Never throws. Returns
 * { sent, failed, held, reason } so a caller or a test can see what happened.
 *
 * `siteName` is the label shown in the email; it falls back to "your company"
 * rather than printing nothing.
 */
export async function notifyOnSubmit(supabase, { sendEmail, companyId, documentKey, record, siteName, documentLabel }) {
  try {
    const routed = await routeNotification(supabase, { companyId, documentKey, record });
    if (!routed.enabled || routed.recipients.length === 0) return { sent: 0, failed: 0, held: 0, reason: routed.reason };
    const now = Date.now();
    const st = await loadState(supabase, companyId, documentKey, routed.recipients.map((r) => r.id));
    if (st.error) return { sent: 0, failed: 0, held: 0, reason: 'error' };
    const { send, hold } = applyCooldown(routed.recipients, st.state, now);
    for (const h of hold) {
      const prev = st.state.get(h.id);
      await saveState(supabase, companyId, documentKey, h.id, prev.last_sent_at, h.suppressed + 1);
    }
    // A custom form passes its own title; a built-in uses its fixed label.
    const label = DOCUMENT_LABELS[documentKey] || cleanLabel(documentLabel) || 'Custom document';
    const cleanSite = cleanLabel(siteName);
    const where = cleanSite ? ` at ${cleanSite}` : '';
    let sent = 0;
    let failed = 0;
    for (const r of send) {
      try {
        const more = r.suppressed > 0 ? `\n\n${r.suppressed} more ${label}${r.suppressed === 1 ? ' was' : 's were'} submitted since your last notice.` : '';
        await sendEmail({
          to: r.email,
          subject: `New ${label}${where}`,
          text: `A new ${label} was submitted${where}.${more}\n\nLog in to FORA to view it.`,
        });
        await saveState(supabase, companyId, documentKey, r.id, new Date(now).toISOString(), 0);
        sent += 1;
      } catch (e) {
        failed += 1;
        console.error('routed notification email failed:', e && e.message);
      }
    }
    return { sent, failed, held: hold.length, reason: 'ok' };
  } catch (e) {
    console.error('notifyOnSubmit failed:', e && e.message);
    return { sent: 0, failed: 0, held: 0, reason: 'error' };
  }
}
