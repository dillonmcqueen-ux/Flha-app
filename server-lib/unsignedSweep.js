// server-lib/unsignedSweep.js
// What happens to a record saved "to sign afterwards" that nobody signs
// (docs/schema/unsigned-escalation-migration.sql). Run by
// api/cron-notification-digest.js every few minutes.
//
//   After 24 hours unsigned: the people who would normally be told about that
//   document hear, once, that it is still unsigned. One email per person per
//   document type per run ("3 Incident Reports are still unsigned"), no content,
//   no author, no site. Who is told follows the same rules as a new-record notice
//   (server-lib/notifyRouting.js), so it needs the document's Notify switch on.
//
//   After 10 days unsigned: the record is closed unsigned. It stays readable and is
//   marked closed, nobody can sign it any more, and because awaiting_signature
//   stays true it keeps being left out of everything that only counts signed
//   records (the Brain, corrective actions, readings).
//
// The heads-up is claimed before it is sent (a conditional update on
// unsigned_alerted_at), so two overlapping runs never alert the same record twice.
// If every send for a record fails the claim is handed back so the next run tries
// again. Never throws; returns counts.

import { routeNotification, cleanLabel, DOCUMENT_LABELS } from './notifyRouting.js';
import { isPermanentRejection } from './notifyDigest.js';
import { SIGN_LATER_OVERDUE_MS, UNSIGNED_CLOSE_MS, missingSignColumns } from './signLater.js';

export const ALERT_BATCH = 50;
// Rows looked at per table per run: more than ALERT_BATCH so rows that are skipped
// (a suspended company) cannot hold up everyone behind them.
export const ALERT_SCAN = 100;
// Stop starting sends after this long; the function limit is 60 seconds.
export const SEND_BUDGET_MS = 35 * 1000;

const SOURCES = [
  { table: 'flhas', documentKey: 'flha', siteColumn: true },
  { table: 'incidents', documentKey: 'incident', siteColumn: true },
  { table: 'inspections', documentKey: 'inspection', siteColumn: false },
  { table: 'near_misses', documentKey: 'nearmiss', siteColumn: true, anonymous: true },
];

const isoAgo = (ms, nowMs) => new Date(nowMs - ms).toISOString();

/** Closes every record that has been unsigned for 10 days. Returns the number closed. */
export async function closeStaleUnsigned(supabase, { nowMs = Date.now() } = {}) {
  let closed = 0;
  for (const src of SOURCES) {
    const { data, error } = await supabase
      .from(src.table)
      .update({ unsigned_closed_at: new Date(nowMs).toISOString() })
      .eq('awaiting_signature', true)
      .is('unsigned_closed_at', null)
      // Only a record the heads-up stage has already looked at: nothing is closed in silence.
      .not('unsigned_alerted_at', 'is', null)
      .lt('signature_requested_at', isoAgo(UNSIGNED_CLOSE_MS, nowMs))
      .select('id');
    if (error) {
      if (!missingSignColumns(error)) console.error(`unsigned close failed for ${src.table}:`, error.message);
      continue;
    }
    closed += (data || []).length;
  }
  return closed;
}

/**
 * Sends the 24 hour heads-up. `sendEmail` is injected. Returns
 * { alerted, emailed, failed } (records claimed, emails sent, emails that failed).
 */
export async function alertOverdueUnsigned(supabase, { sendEmail, nowMs = Date.now() } = {}) {
  const out = { alerted: 0, emailed: 0, failed: 0 };
  try {
    // person -> documentKey -> count; and per record who it went to, for the retry rule
    const perPerson = new Map();
    const claimed = [];
    // Many records from one author at one site share an audience: work it out once.
    const routeCache = new Map();
    const routeOnce = async (args) => {
      const k = `${args.companyId}:${args.documentKey}:${args.record.site_id}:${args.record.submitted_by_roster_id}`;
      if (!routeCache.has(k)) routeCache.set(k, await routeNotification(supabase, args));
      return routeCache.get(k);
    };

    for (const src of SOURCES) {
      const cols = ['id', 'company_id', 'submitted_by_roster_id']
        .concat(src.siteColumn ? ['site_id'] : [])
        .concat(src.anonymous ? ['is_anonymous'] : []);
      const { data: rows, error } = await supabase
        .from(src.table)
        .select(cols.join(', '))
        .eq('awaiting_signature', true)
        .is('unsigned_closed_at', null)
        .is('unsigned_alerted_at', null)
        .lt('signature_requested_at', isoAgo(SIGN_LATER_OVERDUE_MS, nowMs))
        .order('signature_requested_at', { ascending: true })
        .limit(ALERT_SCAN);
      if (error) {
        if (!missingSignColumns(error)) console.error(`unsigned alert lookup failed for ${src.table}:`, error.message);
        continue;
      }
      if (!rows || rows.length === 0) continue;

      const companyIds = [...new Set(rows.map((r) => r.company_id))];
      const { data: cos, error: coErr } = await supabase.from('companies').select('id, suspended').in('id', companyIds);
      if (coErr) { console.error('unsigned alert company lookup failed'); continue; }
      const suspended = new Set((cos || []).filter((c) => c.suspended === true).map((c) => Number(c.id)));

      let routedCount = 0;
      for (const row of rows) {
        if (routedCount >= ALERT_BATCH) break;
        if (suspended.has(Number(row.company_id))) {
          // Nobody is told for a suspended company; leave the queue so it cannot hold up others.
          await supabase.from(src.table).update({ unsigned_alerted_at: new Date(nowMs).toISOString() })
            .eq('id', row.id).eq('company_id', row.company_id).is('unsigned_alerted_at', null);
          continue;
        }
        // Claim first: only one run can win this record.
        const { data: won, error: claimErr } = await supabase
          .from(src.table)
          .update({ unsigned_alerted_at: new Date(nowMs).toISOString() })
          .eq('id', row.id)
          .eq('company_id', row.company_id)
          .eq('awaiting_signature', true)
          .is('unsigned_closed_at', null)
          .is('unsigned_alerted_at', null)
          .select('id');
        if (claimErr || !won || won.length === 0) continue;
        out.alerted += 1;
        routedCount += 1;

        // An anonymous near miss is placed by its site alone, never by who filed it.
        const authorId = src.anonymous && row.is_anonymous === true ? null : (row.submitted_by_roster_id ?? null);
        const routed = await routeOnce({
          companyId: row.company_id,
          documentKey: src.documentKey,
          record: { site_id: src.siteColumn ? (row.site_id ?? null) : null, submitted_by_roster_id: authorId },
        });
        if (routed.reason === 'error') {
          // We could not work out who to tell: hand the claim back to retry.
          await supabase.from(src.table).update({ unsigned_alerted_at: null }).eq('id', row.id).eq('company_id', row.company_id);
          out.alerted -= 1;
          continue;
        }
        if (!routed.enabled || routed.recipients.length === 0) continue;
        const entry = { src, row, recipients: routed.recipients, delivered: false };
        claimed.push(entry);
        for (const r of routed.recipients) {
          const key = `${row.company_id}:${r.id}`;
          if (!perPerson.has(key)) perPerson.set(key, { email: r.email, counts: new Map() });
          const p = perPerson.get(key);
          p.counts.set(src.documentKey, (p.counts.get(src.documentKey) || 0) + 1);
        }
      }
    }

    // One email per person per document type.
    const sentTo = new Set();
    const sendStart = Date.now();
    for (const [key, person] of perPerson) {
      for (const [documentKey, n] of person.counts) {
        // Out of time: whoever has not been told is handed back below and tried next run.
        if (Date.now() - sendStart > SEND_BUDGET_MS) break;
        const label = cleanLabel(DOCUMENT_LABELS[documentKey]) || 'document';
        const plural = `${label}${n === 1 ? '' : 's'}`;
        try {
          await sendEmail({
            to: person.email,
            subject: `${n} ${plural} still unsigned`,
            text: `${n} ${plural} ${n === 1 ? 'has' : 'have'} been waiting more than 24 hours for the worker's signature.\n\nUntil it is signed it is not counted, and it closes unsigned after 10 days. Log in to FORA to see which.`,
          });
          out.emailed += 1;
          sentTo.add(`${key}:${documentKey}`);
        } catch (e) {
          out.failed += 1;
          console.error('unsigned heads-up email failed:', e && e.message);
          // A permanent rejection (a bad address) will not succeed on a retry: treat it as
          // handled so one bad address cannot keep a record at the head of the queue.
          if (isPermanentRejection(e)) sentTo.add(`${key}:${documentKey}`);
        }
      }
    }

    // A record nobody could be told about goes back in the queue to retry.
    for (const entry of claimed) {
      const told = entry.recipients.some((r) => sentTo.has(`${entry.row.company_id}:${r.id}:${entry.src.documentKey}`));
      if (!told) {
        await supabase.from(entry.src.table).update({ unsigned_alerted_at: null }).eq('id', entry.row.id).eq('company_id', entry.row.company_id);
        out.alerted -= 1;
      }
    }
  } catch (e) {
    console.error('alertOverdueUnsigned failed:', e && e.message);
  }
  return out;
}
