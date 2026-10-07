// server-lib/notifyDigest.js
// The held-notice digest. Past the burst limit (server-lib/notifyRouting.js) a
// notice is only counted; this is what tells the person. Run by
// api/cron-notification-digest.js every few minutes.
//
// One run: claim_held_notices hands back every (company, document, person) whose
// window has ended and that still holds notices, resetting each count to zero in
// the same transaction (FOR UPDATE SKIP LOCKED, so overlapping runs never take
// the same row). Each row becomes ONE email: "N more <document>s were submitted
// since your last notice." No report content, no author, no site.
//
// A claimed row is dropped, not retried, when the person can no longer be told:
// the document's Notify switch is off now, the person is inactive or has no
// usable address, or their company is suspended. A send that fails is refunded
// so the next run tries again. Never throws; returns counts.

import { DOCUMENT_LABELS, COOLDOWN_SECONDS, refundSlot } from './notifyRouting.js';
import { withDecryptedEmail } from './fieldCrypto.js';

const SINGLE_ADDRESS = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
export const DIGEST_BATCH = 200;
const SEND_CONCURRENCY = 5;

export async function runDigest(supabase, { sendEmail, windowSeconds = COOLDOWN_SECONDS, limit = DIGEST_BATCH } = {}) {
  const out = { claimed: 0, sent: 0, dropped: 0, failed: 0, error: false };
  try {
    const { data: claimed, error } = await supabase.rpc('claim_held_notices', { p_window_seconds: windowSeconds, p_limit: limit });
    if (error) {
      console.error('claim_held_notices failed:', error.code, error.message);
      return { ...out, error: true };
    }
    const rows = Array.isArray(claimed) ? claimed : [];
    out.claimed = rows.length;
    if (rows.length === 0) return out;

    const companyIds = [...new Set(rows.map((r) => Number(r.company_id)))];
    const rosterIds = [...new Set(rows.map((r) => Number(r.roster_id)))];

    const [settings, people, companies] = await Promise.all([
      supabase.from('document_notifications').select('company_id, document_key, enabled').in('company_id', companyIds),
      supabase.from('roster').select('id, company_id, active, email').in('id', rosterIds),
      supabase.from('companies').select('id, suspended').in('id', companyIds),
    ]);
    // If we cannot judge who may still be told, hand every row back rather than lose the counts.
    if (settings.error || people.error || companies.error) {
      console.error('notification digest lookups failed');
      for (const r of rows) await refundSlot(supabase, Number(r.company_id), r.document_key, Number(r.roster_id), { held: Number(r.held) });
      return { ...out, error: true };
    }

    const on = new Set((settings.data || []).filter((s) => s.enabled === true).map((s) => `${s.company_id}:${s.document_key}`));
    const suspended = new Set((companies.data || []).filter((c) => c.suspended === true).map((c) => Number(c.id)));
    const person = new Map(withDecryptedEmail(people.data || []).map((p) => [`${p.company_id}:${p.id}`, p]));

    const tell = async (row) => {
      const company = Number(row.company_id);
      const roster = Number(row.roster_id);
      const held = Number(row.held) || 0;
      const who = person.get(`${company}:${roster}`);
      const email = who && typeof who.email === 'string' ? who.email.trim() : '';
      if (held <= 0 || !on.has(`${company}:${row.document_key}`) || suspended.has(company) || !who || who.active !== true || !SINGLE_ADDRESS.test(email)) {
        out.dropped += 1;
        return;
      }
      const label = DOCUMENT_LABELS[row.document_key] || 'Custom document';
      const n = held >= 999 ? '999+' : String(held);
      try {
        await sendEmail({
          to: email,
          subject: `${label}: ${n} new`,
          text: `${n} more ${label}${held === 1 ? ' was' : 's were'} submitted since your last notice.\n\nLog in to FORA to view ${held === 1 ? 'it' : 'them'}.`,
        });
        out.sent += 1;
      } catch (e) {
        out.failed += 1;
        console.error('notification digest email failed:', e && e.message);
        await refundSlot(supabase, company, row.document_key, roster, { held });
      }
    };
    for (let i = 0; i < rows.length; i += SEND_CONCURRENCY) {
      await Promise.all(rows.slice(i, i + SEND_CONCURRENCY).map(tell));
    }
    return out;
  } catch (e) {
    console.error('runDigest failed:', e && e.message);
    return { ...out, error: true };
  }
}
