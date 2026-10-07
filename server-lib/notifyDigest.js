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
// so the next run tries again, EXCEPT a permanent rejection (a 4xx other than
// 408 and 429 from the mail provider), which is dropped so one bad address cannot
// be retried forever and starve healthy rows. A stored address that cannot be
// decrypted (a broken or missing key) is handed back, not dropped: that is a
// fault to fix, not a person who cannot be told. Never throws; returns counts.

import { DOCUMENT_LABELS, COOLDOWN_SECONDS, refundSlot } from './notifyRouting.js';
import { withDecryptedEmail } from './fieldCrypto.js';

const SINGLE_ADDRESS = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
// Small on purpose: the claim zeroes the counts before anything is sent, so a
// run that is cut off mid-way loses at most this many rows' counts.
export const DIGEST_BATCH = 50;
const SEND_CONCURRENCY = 5;

// sendEmail throws "Resend API error: <status> ..." for a rejected send. A 4xx
// other than request-timeout (408) and rate-limit (429) will not succeed on a
// retry, so it is dropped rather than refunded.
export function isPermanentRejection(error) {
  const m = /Resend API error: (\d{3})/.exec(String(error && error.message));
  if (!m) return false;
  const status = Number(m[1]);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

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
      supabase.from('document_notifications').select('company_id, document_key, enabled')
        .in('company_id', companyIds).in('document_key', [...new Set(rows.map((r) => r.document_key))]).limit(5000),
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
    // hadEmail is read BEFORE decrypting: an address that is stored but decrypts
    // to nothing is a key problem, which must not be mistaken for "no address".
    const hadEmail = new Map((people.data || []).map((p) => [`${p.company_id}:${p.id}`, !!p.email]));
    const person = new Map(withDecryptedEmail(people.data || []).map((p) => [`${p.company_id}:${p.id}`, p]));

    const tell = async (row) => {
      const company = Number(row.company_id);
      const roster = Number(row.roster_id);
      const held = Number(row.held) || 0;
      const who = person.get(`${company}:${roster}`);
      const email = who && typeof who.email === 'string' ? who.email.trim() : '';
      if (who && who.active === true && !email && hadEmail.get(`${company}:${roster}`)) {
        // Stored but unreadable: hand the count back and say so, never drop it.
        out.failed += 1;
        console.error('notification digest: a stored address could not be decrypted');
        await refundSlot(supabase, company, row.document_key, roster, { held });
        return;
      }
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
        console.error('notification digest email failed:', e && e.message);
        if (isPermanentRejection(e)) { out.dropped += 1; return; }
        out.failed += 1;
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
