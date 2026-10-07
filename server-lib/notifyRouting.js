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
// The author is never told about their own submission. An anonymous near miss
// has no author, so it is placed by its site alone and no email mentions a
// person.
//
// OFF BY DEFAULT: a document with no document_notifications row, or one with
// enabled = false, notifies nobody. A database without the table behaves the
// same way, so shipping this ahead of the SQL changes nothing.
//
// The email names the document and the site and nothing else: no report
// content, no author, so incident detail never sits in an inbox. One email per
// person, so recipients never see each other's addresses. A failed send is
// logged and never thrown: the record is already saved.

import { recordInScope } from './documentAccess.js';
import { inCrew } from './leadAccess.js';
import { withDecryptedEmail } from './fieldCrypto.js';

const MISSING_SCHEMA = new Set(['42P01', '42703', 'PGRST205', 'PGRST204']);
const isMissingSchema = (error) => !!error && MISSING_SCHEMA.has(String(error.code || ''));

// A runaway audience (a mis-tagged company) must not turn one submit into a
// burst of emails.
export const MAX_RECIPIENTS = 25;

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
 *
 * Returns { recipients: [{ id, email }], missingEmail: [id], reason }.
 * `reason` is 'ok', or 'none' when nobody could be told.
 */
export function pickRecipients({ record, roster, author = null, divisionSites = new Map(), extraRosterIds = [] }) {
  const authorId = record.submitted_by_roster_id != null ? Number(record.submitted_by_roster_id) : null;
  const authorTags = new Map();
  if (author && authorId != null) authorTags.set(authorId, { departments: author.departments || [], divisions: author.divisions || [] });

  const chosen = new Map();
  const add = (person) => { if (person && Number(person.id) !== authorId) chosen.set(Number(person.id), person); };

  for (const person of roster) {
    if (person.is_owner === true && person.role === 'supervisor') continue; // fallback only
    const actor = actorFor(person, divisionSites);
    if (person.role === 'supervisor') {
      if (recordInScope(record, actor, authorTags)) add(person);
    } else if (person.role === 'worker' && person.is_lead === true && author && authorId != null) {
      if (inCrew(actor, { id: authorId, departments: author.departments, divisions: author.divisions, default_site_id: author.default_site_id })) add(person);
    }
  }

  const byId = new Map(roster.map((p) => [Number(p.id), p]));
  for (const id of toIdList(extraRosterIds)) add(byId.get(id));

  if (chosen.size === 0) {
    roster.filter((p) => p.is_owner === true && p.role === 'supervisor').forEach(add);
  }

  const missingEmail = [];
  const recipients = [];
  for (const person of chosen.values()) {
    const email = typeof person.email === 'string' ? person.email.trim() : '';
    if (!email) { missingEmail.push(Number(person.id)); continue; }
    recipients.push({ id: Number(person.id), email });
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

  const picked = pickRecipients({ record, roster, author, divisionSites, extraRosterIds: setting.extraRosterIds });
  return { enabled: true, ...picked };
}

/**
 * Tells the audience about a new record. Never throws. Returns
 * { sent, failed, reason } so a caller or a test can see what happened.
 *
 * `siteName` is the label shown in the email; it falls back to "your company"
 * rather than printing nothing.
 */
export async function notifyOnSubmit(supabase, { sendEmail, companyId, documentKey, record, siteName }) {
  try {
    const routed = await routeNotification(supabase, { companyId, documentKey, record });
    if (!routed.enabled || routed.recipients.length === 0) return { sent: 0, failed: 0, reason: routed.reason };
    const label = DOCUMENT_LABELS[documentKey] || 'Custom document';
    const where = typeof siteName === 'string' && siteName.trim() ? ` at ${siteName.trim().slice(0, 80)}` : '';
    let sent = 0;
    let failed = 0;
    for (const r of routed.recipients) {
      try {
        await sendEmail({
          to: r.email,
          subject: `New ${label}${where}`,
          text: `A new ${label} was submitted${where}.\n\nLog in to FORA to view it.`,
        });
        sent += 1;
      } catch (e) {
        failed += 1;
        console.error('routed notification email failed:', e && e.message);
      }
    }
    return { sent, failed, reason: 'ok' };
  } catch (e) {
    console.error('notifyOnSubmit failed:', e && e.message);
    return { sent: 0, failed: 0, reason: 'error' };
  }
}
