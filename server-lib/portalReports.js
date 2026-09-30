// server-lib/portalReports.js
// Emailing completed Company Portal documents to a department. Two callers:
//   - api/cron-portal-reports.js runs every active schedule that is due.
//   - api/portal.js's email_portal_record and send_report_schedule_now.
//
// What goes out is a plain-text email listing the records with short-lived
// signed links to their PDFs (7 days). PDFs are never attached: the files
// stay in the private flha-reports bucket and the link is the only way in.
// Addresses are sent one email each so recipients never see each other.

import { decryptField } from './fieldCrypto.js';
import { signRows } from './signedUrls.js';
import { sendEmail } from './email.js';
import { PORTAL_DEPARTMENT_LABELS, prettifyDepartmentKey } from './portalDepartments.js';

export const LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_LISTED = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export function departmentLabel(dep) {
  return PORTAL_DEPARTMENT_LABELS[dep] || prettifyDepartmentKey(dep);
}

// Decrypts a schedule's hand-added recipient list. A row that can't be read
// yields [] and is logged, so one bad row never stops the others.
export function readRecipients(schedule) {
  if (!schedule.recipients_encrypted) return [];
  try {
    const list = JSON.parse(decryptField(schedule.recipients_encrypted));
    return Array.isArray(list) ? list.filter((e) => typeof e === 'string' && e) : [];
  } catch (e) {
    console.error(`portal schedule ${schedule.id}: could not read recipients:`, e.message);
    return [];
  }
}

// Same calendar-day logic for both frequencies, in UTC: a schedule is due if
// it is active, has not already gone out today, and (weekly only) today is
// its weekday.
export function isDue(schedule, now = new Date()) {
  if (!schedule.active) return false;
  const today = now.toISOString().slice(0, 10);
  if (schedule.last_sent_at && new Date(schedule.last_sent_at).toISOString().slice(0, 10) === today) return false;
  if (schedule.frequency === 'weekly') return schedule.weekday === now.getUTCDay();
  return schedule.frequency === 'daily';
}

export function sinceFor(schedule, now = new Date()) {
  if (schedule.last_sent_at) return new Date(schedule.last_sent_at);
  return new Date(now.getTime() - (schedule.frequency === 'weekly' ? 7 : 1) * DAY_MS);
}

// Active supervisors in a company whose departments include any of `departments`.
export async function departmentSupervisorEmails(supabaseAdmin, companyId, departments) {
  const { data: rows } = await supabaseAdmin
    .from('roster')
    .select('email, departments')
    .eq('company_id', companyId)
    .eq('role', 'supervisor')
    .eq('active', true)
    .not('email', 'is', null);
  const out = [];
  for (const r of rows || []) {
    if (!(r.departments || []).some((d) => departments.includes(d))) continue;
    try {
      const email = decryptField(r.email);
      if (email) out.push(email);
    } catch (e) {
      console.error('portal report: could not read a supervisor email:', e.message);
    }
  }
  return out;
}

export function dedupeEmails(list) {
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const k = String(e).trim().toLowerCase();
    if (k && !seen.has(k)) { seen.add(k); out.push(String(e).trim()); }
  }
  return out;
}

// Records for a company's documents routed to `department`, created after
// `since`, newest first, each with a signed PDF link (or null).
export async function gatherRecords(supabaseAdmin, companyId, department, since) {
  const { data: docs } = await supabaseAdmin
    .from('portal_documents').select('id, title, departments').eq('company_id', companyId);
  const docMap = {};
  (docs || []).filter((d) => (d.departments || []).includes(department)).forEach((d) => { docMap[d.id] = d; });
  const ids = Object.keys(docMap).map(Number);
  if (ids.length === 0) return [];
  const { data: records } = await supabaseAdmin
    .from('portal_records')
    .select('id, document_id, submitted_by, created_at, pdf_url')
    .in('document_id', ids)
    .gt('created_at', since.toISOString())
    .order('created_at', { ascending: false });
  const signed = await signRows(supabaseAdmin, records || [], [{ key: 'pdf_url', bucket: 'flha-reports' }], LINK_TTL_SECONDS);
  return signed.map((r) => ({ ...r, document_title: docMap[r.document_id].title }));
}

function recordLine(r) {
  const when = new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return `- ${r.document_title}, submitted by ${r.submitted_by}, ${when}${r.pdf_url ? `\n  PDF: ${r.pdf_url}` : '\n  (no PDF was saved for this one)'}`;
}

export function digestText({ companyName, scheduleName, department, records }) {
  const listed = records.slice(0, MAX_LISTED).map(recordLine).join('\n');
  const more = records.length > MAX_LISTED ? `\n...and ${records.length - MAX_LISTED} more. Log in to FORA to see them all.` : '';
  return `${companyName}: ${records.length} completed document${records.length === 1 ? '' : 's'} for ${departmentLabel(department)}${scheduleName ? ` (${scheduleName})` : ''}.\n\n${listed}${more}\n\nThe PDF links work for 7 days. After that, log in to FORA to download them again.`;
}

async function sendEach(addresses, subject, text) {
  let sent = 0;
  for (const to of addresses) {
    try { await sendEmail({ to, subject, text }); sent++; } catch (e) { console.error('portal report email failed:', e.message); }
  }
  return sent;
}

// Runs one schedule. `now` is injectable for tests. With nothing new it sends
// nothing but still marks the schedule as handled for today.
export async function runSchedule(supabaseAdmin, schedule, now = new Date()) {
  // sendEmail() silently does nothing without a Resend key, which would look
  // like success. Refuse to run instead, and leave the schedule untouched.
  if (!process.env.RESEND_API_KEY) return { recordCount: 0, recipientCount: 0, sent: 0, marked: false, reason: 'email_not_configured' };
  const { data: coRows } = await supabaseAdmin.from('companies').select('name').eq('id', schedule.company_id).limit(1);
  const companyName = (coRows && coRows[0] && coRows[0].name) || 'Your company';
  const records = await gatherRecords(supabaseAdmin, schedule.company_id, schedule.department, sinceFor(schedule, now));

  let recipientCount = 0;
  let sent = 0;
  if (records.length > 0) {
    const extra = readRecipients(schedule);
    const supers = schedule.include_department_supervisors
      ? await departmentSupervisorEmails(supabaseAdmin, schedule.company_id, [schedule.department])
      : [];
    const addresses = dedupeEmails([...supers, ...extra]);
    recipientCount = addresses.length;
    const subject = `${companyName}: ${records.length} new ${departmentLabel(schedule.department)} document${records.length === 1 ? '' : 's'}`;
    sent = await sendEach(addresses, subject, digestText({ companyName, scheduleName: schedule.name, department: schedule.department, records }));
    // Nobody to send to, or every send failed: leave last_sent_at alone so
    // the next run tries the same records again instead of dropping them.
    // (Marking it handled here once meant a department with no supervisor
    // email on file lost its documents for good.)
    if (sent === 0) return { recordCount: records.length, recipientCount, sent, marked: false };
  }
  await supabaseAdmin.from('portal_report_schedules').update({ last_sent_at: now.toISOString() }).eq('id', schedule.id);
  return { recordCount: records.length, recipientCount, sent, marked: true };
}

// One record, to a department's supervisors. Used by the "Email to
// department" button. Returns how many addresses it went to.
export async function emailRecordToDepartment(supabaseAdmin, { companyId, record, documentTitle, department }) {
  const { data: coRows } = await supabaseAdmin.from('companies').select('name').eq('id', companyId).limit(1);
  const companyName = (coRows && coRows[0] && coRows[0].name) || 'Your company';
  const [signed] = await signRows(supabaseAdmin, [record], [{ key: 'pdf_url', bucket: 'flha-reports' }], LINK_TTL_SECONDS);
  const addresses = dedupeEmails(await departmentSupervisorEmails(supabaseAdmin, companyId, [department]));
  if (addresses.length === 0) return { recipientCount: 0, sent: 0 };
  const text = digestText({ companyName, scheduleName: '', department, records: [{ ...signed, document_title: documentTitle }] });
  const sent = await sendEach(addresses, `${companyName}: ${documentTitle}`, text);
  return { recipientCount: addresses.length, sent };
}
