// server-lib/documentEngine/notify.js
// Email for unified-engine documents (WP3). It reuses the rules every other
// document already follows (server-lib/notifyRouting.js): the audience is
// exactly the people who could open the record, nobody is told about their
// own document, each person has a burst limit per document per window, a held
// notice is reported by the digest, and an email names the document and the
// site and nothing else.
//
// What differs for the engine:
//   - the builder switches notifications on (a notify rule or a reviewer
//     step) and the company Owner can mute a document
//     (company_documents.owner_muted). The Owner's per-document
//     document_notifications switch is not used, so the setting is handed to
//     notifyRouting as `settingOverride`.
//   - every notice for one document shares one key, engine_<definitionId>,
//     which is what claim_notification_slot and the digest count against.
//
// `deps.sendEmail` is injected. With none, nothing is sent (the mail key is
// not configured), exactly like server-lib/notifyAudience.js. Nothing here
// throws: the record is already saved.

import { notifyOnSubmit, claimSlot, refundSlot, cleanLabel } from '../notifyRouting.js';
import { withDecryptedEmail } from '../fieldCrypto.js';

const SINGLE_ADDRESS = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
const MAX_PEOPLE = 25;

const DEPARTMENT_LABEL = { hr: 'HR', payroll: 'Payroll', safety: 'Safety', maintenance: 'Maintenance', operations_manager: 'Operations Manager' };

export const engineKey = (definitionId) => `engine_${Number(definitionId)}`;

/** The setting handed to notifyRouting for one document. */
export function engineSetting({ plan, ownerMuted, extraRosterIds = [] }) {
  return {
    enabled: plan.announce === true && ownerMuted !== true,
    extraRosterIds: [...new Set([...(plan.extraRosterIds || []), ...extraRosterIds])],
  };
}

async function companySuspended(db, companyId) {
  const { data } = await db.from('companies').select('suspended').eq('id', companyId).limit(1);
  return !!(data && data[0] && data[0].suspended);
}

/** Active supervisors whose departments include any of these (ids only). */
export async function supervisorIdsInDepartments(db, companyId, departments) {
  const wanted = (departments || []).filter(Boolean);
  if (wanted.length === 0) return [];
  const { data, error } = await db.from('roster').select('id, role, departments, is_owner').eq('company_id', companyId).eq('active', true).eq('role', 'supervisor');
  if (error) return [];
  return (data || []).filter((p) => (p.departments || []).some((d) => wanted.includes(d))).map((p) => Number(p.id));
}

/**
 * Tells the audience about a record that now needs them: a new submit, or the
 * next step of a review chain. `skipRosterId` is the reviewer who just acted.
 */
export async function notifyRecord(db, deps, { companyId, definition, record, plan, ownerMuted, skipRosterId = null }) {
  try {
    if (!deps || !deps.sendEmail) return { sent: 0, reason: 'no_mail' };
    if (await companySuspended(db, companyId)) return { sent: 0, reason: 'suspended' };
    let siteName = null;
    if (record.site_id != null) {
      const { data } = await db.from('sites').select('name').eq('id', record.site_id).eq('company_id', companyId).limit(1);
      siteName = data && data[0] ? data[0].name : null;
    }
    const deptIds = await supervisorIdsInDepartments(db, companyId, plan.departments);
    const setting = engineSetting({ plan, ownerMuted, extraRosterIds: deptIds });
    const out = await notifyOnSubmit(db, {
      sendEmail: deps.sendEmail,
      companyId,
      documentKey: engineKey(definition.id),
      record: { site_id: record.site_id ?? null, submitted_by_roster_id: record.submitted_by_roster_id ?? null, skip_roster_id: skipRosterId },
      siteName,
      documentLabel: definition.title,
      settingOverride: setting,
    });
    return out;
  } catch (e) {
    console.error('engine notification failed:', e && e.message);
    return { sent: 0, reason: 'error' };
  }
}

/**
 * One email each to named people, through the same claim and refund as every
 * other notice. Returns how many were sent.
 */
export async function notifyPeople(db, deps, { companyId, documentKey, rosterIds, subject, text }) {
  let sent = 0;
  try {
    if (!deps || !deps.sendEmail) return 0;
    if (await companySuspended(db, companyId)) return 0;
    const ids = [...new Set((rosterIds || []).map(Number).filter(Number.isInteger))].slice(0, MAX_PEOPLE);
    if (ids.length === 0) return 0;
    const { data, error } = await db.from('roster').select('id, email, active').eq('company_id', companyId).in('id', ids);
    if (error) return 0;
    const people = withDecryptedEmail((data || []).filter((p) => p.active !== false));
    for (const person of people) {
      const email = typeof person.email === 'string' ? person.email.trim() : '';
      if (!SINGLE_ADDRESS.test(email)) continue;
      const claim = await claimSlot(db, companyId, documentKey, Number(person.id));
      if (claim.error || !claim.allowed) continue;
      try {
        await deps.sendEmail({ to: email, subject, text });
        sent += 1;
      } catch (e) {
        console.error('engine notice email failed:', e && e.message);
        await refundSlot(db, companyId, documentKey, Number(person.id), { slots: 1, held: claim.suppressed });
      }
    }
  } catch (e) {
    console.error('engine notifyPeople failed:', e && e.message);
  }
  return sent;
}

/** Tells the author their document was sent back. Never says why: the reason is in the app. */
export async function notifyReturned(db, deps, { companyId, definition, record, ownerMuted }) {
  if (ownerMuted === true || record.submitted_by_roster_id == null) return 0;
  const label = cleanLabel(definition.title) || 'document';
  return notifyPeople(db, deps, {
    companyId,
    documentKey: engineKey(definition.id),
    rosterIds: [record.submitted_by_roster_id],
    subject: `${label} sent back`,
    text: `A ${label} you filed was sent back for changes.\n\nLog in to FORA to fix it.`,
  });
}

/**
 * Tells the target departments' supervisors that an answer was routed to
 * them. With nobody in a department, the Account Owner is told instead.
 * Names the document and the department, never the question or the answer.
 */
export async function notifyEscalations(db, deps, { companyId, definition, matches, ownerMuted }) {
  if (ownerMuted === true || !matches || matches.length === 0) return 0;
  const label = cleanLabel(definition.title) || 'document';
  let sent = 0;
  const departments = [...new Set(matches.map((m) => m.department))];
  for (const dept of departments) {
    let ids = await supervisorIdsInDepartments(db, companyId, [dept]);
    if (ids.length === 0) {
      const { data } = await db.from('roster').select('id, is_owner, role').eq('company_id', companyId).eq('active', true).eq('role', 'supervisor');
      ids = (data || []).filter((p) => p.is_owner === true).map((p) => Number(p.id));
    }
    const dl = DEPARTMENT_LABEL[dept] || cleanLabel(dept) || 'your department';
    sent += await notifyPeople(db, deps, {
      companyId,
      documentKey: engineKey(definition.id),
      rosterIds: ids,
      subject: `${label}: routed to ${dl}`,
      text: `An answer on a ${label} was routed to ${dl}.\n\nLog in to FORA to view it.`,
    });
  }
  return sent;
}
