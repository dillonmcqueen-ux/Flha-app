// server-lib/sentDocumentsSweep.js
// Send & Sign: one reminder email to a person whose sent document is past due
// and still open (docs/schema/sent-documents-reminders-migration.sql). Run
// hourly by api/cron-notification-digest.js.
//
// One reminder per document, ever. The reminder is claimed before it is sent
// (a conditional update on reminded_at), so two overlapping runs never remind
// twice, and handed back when the send fails so the next run tries again. A
// person with several overdue documents gets one email listing how many.
// Nothing is sent for a company that is suspended or no longer has the Send &
// Sign module. Never throws; returns counts.

import { withDecryptedEmail } from './fieldCrypto.js';
import { isValidEmail } from './onboardingHelpers.js';

export const REMINDER_SCAN = 100;
// Stop starting sends after this long; the digest cron has a 60 second limit and
// runs four other sweeps before this one.
export const REMINDER_BUDGET_MS = 15 * 1000;
let warnedMissingColumn = false;
const isMissingColumn = (error) => !!error && (error.code === '42703' || /reminded_at/.test(error.message || ''));

/** The reminder email for one person. Pure. */
export function buildReminderEmail({ name, count, companyName, origin }) {
  const plural = count === 1 ? 'document is' : 'documents are';
  return {
    subject: `${count} ${count === 1 ? 'document is' : 'documents are'} past due`,
    text: [
      `Hi ${name || 'there'},`,
      '',
      `${count} ${plural} waiting on you${companyName ? ` at ${companyName}` : ''} and past the due date.`,
      '',
      `Sign in to FORA and look under "Sent to you": ${origin || 'https://portal.forafieldsolutions.com'}`,
      '',
      'FORA Field Solutions',
    ].join('\n'),
  };
}

// Claims a set of documents. Only rows still open and unreminded are won, so
// two overlapping runs never claim the same one. Returns the ids won.
async function claim(supabase, companyId, ids, nowIso) {
  const { data, error } = await supabase
    .from('sent_documents')
    .update({ reminded_at: nowIso })
    .in('id', ids).eq('company_id', companyId)
    .in('status', ['sent', 'opened']).is('reminded_at', null)
    .select('id');
  if (error || !data) return [];
  return data.map((r) => r.id);
}

export async function remindOverdueSentDocuments(supabase, { sendEmail, origin, nowMs = Date.now(), budgetMs = REMINDER_BUDGET_MS } = {}) {
  const out = { reminded: 0, emailed: 0, failed: 0 };
  const startedAt = Date.now();
  try {
    const nowIso = new Date(nowMs).toISOString();
    const { data: rows, error } = await supabase
      .from('sent_documents')
      .select('id, company_id, roster_id')
      .in('status', ['sent', 'opened'])
      .is('reminded_at', null)
      .not('due_at', 'is', null)
      .lt('due_at', nowIso)
      .order('due_at', { ascending: true })
      .limit(REMINDER_SCAN);
    if (error) {
      if (isMissingColumn(error)) {
        // Logged once per server instance, not every hour: the migration
        // simply has not been applied yet.
        if (!warnedMissingColumn) console.warn('sent document reminders skipped: sent_documents.reminded_at does not exist yet (docs/schema/sent-documents-reminders-migration.sql)');
        warnedMissingColumn = true;
      } else {
        console.error('sent document reminder lookup failed:', error.message);
      }
      return out;
    }
    if (!rows || rows.length === 0) return out;

    const companyIds = [...new Set(rows.map((r) => r.company_id))];
    const [{ data: companies, error: coErr }, { data: settings, error: setErr }] = await Promise.all([
      supabase.from('companies').select('id, name, suspended').in('id', companyIds),
      supabase.from('company_document_settings').select('company_id, is_active').eq('document_key', 'sent_documents').in('company_id', companyIds),
    ]);
    if (coErr || setErr) { console.error('sent document reminder company lookup failed'); return out; }
    const companyById = new Map((companies || []).map((c) => [Number(c.id), c]));
    const active = new Set((settings || []).filter((s) => s.is_active === true).map((s) => Number(s.company_id)));

    // Documents of a suspended or unlicensed company are claimed without an
    // email, so they leave the queue instead of being fetched again every hour
    // and crowding out everyone else.
    const skipped = new Map();
    const byPerson = new Map();
    for (const row of rows) {
      const company = companyById.get(Number(row.company_id));
      if (!company || company.suspended === true || !active.has(Number(row.company_id))) {
        if (!skipped.has(row.company_id)) skipped.set(row.company_id, []);
        skipped.get(row.company_id).push(row.id);
        continue;
      }
      const key = `${row.company_id}:${row.roster_id}`;
      if (!byPerson.has(key)) byPerson.set(key, { companyId: row.company_id, rosterId: row.roster_id, ids: [] });
      byPerson.get(key).ids.push(row.id);
    }
    for (const [companyId, ids] of skipped) await claim(supabase, companyId, ids, nowIso);

    // One person at a time: claim, then send, and stop starting new people when
    // the time budget is spent. What is left is simply picked up next hour.
    for (const person of byPerson.values()) {
      if (Date.now() - startedAt > budgetMs) break;
      const won = await claim(supabase, person.companyId, person.ids, nowIso);
      if (won.length === 0) continue;
      out.reminded += won.length;

      const { data: people } = await supabase.from('roster').select('id, name, email, active')
        .eq('id', person.rosterId).eq('company_id', person.companyId).limit(1);
      const member = people && people[0] ? withDecryptedEmail(people[0]) : null;
      // Nobody to write to: the claim stands, there is nothing to retry.
      if (!member || member.active === false || !isValidEmail(member.email)) continue;
      const company = companyById.get(Number(person.companyId));
      const mail = buildReminderEmail({ name: member.name, count: won.length, companyName: company && company.name, origin });
      try {
        await sendEmail({ to: member.email, subject: mail.subject, text: mail.text });
        out.emailed += 1;
      } catch (e) {
        out.failed += 1;
        console.error('sent document reminder email failed:', e.message);
        // Hand the claim back so the next run tries again.
        const { error: backError } = await supabase.from('sent_documents').update({ reminded_at: null })
          .in('id', won).eq('company_id', person.companyId);
        if (backError) console.error('sent document reminder hand-back failed:', backError.message);
        else out.reminded -= won.length;
      }
    }
  } catch (e) {
    console.error('sent document reminders failed:', e.message);
  }
  return out;
}
