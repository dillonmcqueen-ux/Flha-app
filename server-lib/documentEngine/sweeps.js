// server-lib/documentEngine/sweeps.js
// The time-based follow-ups for unified-engine records, run by
// api/cron-notification-digest.js next to the sweeps for the built-in
// documents (server-lib/unsignedSweep.js). Same rules:
//
//   - A record saved "to sign afterwards" that is still unsigned after 24 hours
//     gets one heads-up to the people who would be told about that document.
//     After 10 days it is closed unsigned (readable, never signable).
//   - A record still waiting on a reviewer after 48 hours escalates once to
//     the Account Owner, so a reviewer who is away does not strand it.
//
// Each stage is claimed with a conditional update BEFORE anything is sent, so
// two overlapping runs never alert the same record twice, and handed back if
// nobody could be told so the next run retries. Nothing here throws; every
// function returns counts. A database that has not had
// docs/schema/document-engine-wp3-migration.sql applied has none of the
// columns these read, so a missing-column error is a quiet skip, not a fault.

import { routeNotification, cleanLabel } from '../notifyRouting.js';
import { isPermanentRejection } from '../notifyDigest.js';
import { withDecryptedEmail } from '../fieldCrypto.js';
import { SIGN_LATER_OVERDUE_MS, UNSIGNED_CLOSE_MS } from '../signLater.js';
import { notifyPlan } from './rules.js';
import { engineKey, engineSetting } from './notify.js';
import { runFollowUpsAgain } from './service.js';

export const STALE_REVIEW_MS = 48 * 60 * 60 * 1000;
export const ALERT_BATCH = 50;
export const ALERT_SCAN = 100;
export const SEND_BUDGET_MS = 35 * 1000;

const SINGLE_ADDRESS = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
const iso = (ms) => new Date(ms).toISOString();
const missingColumn = (error) => !!error && ['42703', 'PGRST204', '42P01', 'PGRST205'].includes(String(error.code || ''));

/** Closes every engine record that has been unsigned for 10 days. Returns the number closed. */
export async function closeStaleUnsignedEngine(db, { nowMs = Date.now() } = {}) {
  const { data, error } = await db
    .from('document_records')
    .update({ unsigned_closed_at: iso(nowMs) })
    .eq('awaiting_signature', true)
    .is('unsigned_closed_at', null)
    // Only a record the heads-up stage has already looked at: nothing is closed in silence.
    .not('unsigned_alerted_at', 'is', null)
    .lt('signature_requested_at', iso(nowMs - UNSIGNED_CLOSE_MS))
    .select('id');
  if (error) {
    if (!missingColumn(error)) console.error('engine unsigned close failed:', error.message);
    return 0;
  }
  return (data || []).length;
}

async function loadPlans(db, versionIds) {
  const plans = new Map();
  if (versionIds.length === 0) return plans;
  const { data } = await db.from('document_rules').select('version_id, rule_type, sort_order, config').in('version_id', versionIds);
  const byVersion = new Map();
  (data || []).forEach((r) => {
    if (!byVersion.has(r.version_id)) byVersion.set(r.version_id, []);
    byVersion.get(r.version_id).push(r);
  });
  versionIds.forEach((v) => plans.set(Number(v), notifyPlan(byVersion.get(v) || [])));
  return plans;
}

/**
 * The 24 hour "still unsigned" heads-up. One email per person per document,
 * with a count and nothing else. Returns { alerted, emailed, failed }.
 */
export async function alertOverdueUnsignedEngine(db, { sendEmail, nowMs = Date.now() } = {}) {
  const out = { alerted: 0, emailed: 0, failed: 0 };
  try {
    const { data: rows, error } = await db
      .from('document_records')
      .select('id, company_id, definition_id, version_id, site_id, submitted_by_roster_id')
      .eq('awaiting_signature', true)
      .is('unsigned_closed_at', null)
      .is('unsigned_alerted_at', null)
      .lt('signature_requested_at', iso(nowMs - SIGN_LATER_OVERDUE_MS))
      .order('signature_requested_at', { ascending: true })
      .limit(ALERT_SCAN);
    if (error) {
      if (!missingColumn(error)) console.error('engine unsigned alert lookup failed:', error.message);
      return out;
    }
    if (!rows || rows.length === 0) return out;

    const companyIds = [...new Set(rows.map((r) => r.company_id))];
    const defIds = [...new Set(rows.map((r) => r.definition_id))];
    const [cos, settings, defs, plans] = await Promise.all([
      db.from('companies').select('id, suspended').in('id', companyIds),
      db.from('company_documents').select('company_id, definition_id, is_enabled, owner_muted').in('company_id', companyIds).in('definition_id', defIds),
      db.from('document_definitions').select('id, title').in('id', defIds),
      loadPlans(db, [...new Set(rows.map((r) => Number(r.version_id)))]),
    ]);
    if (cos.error || settings.error || defs.error) { console.error('engine unsigned alert lookups failed'); return out; }
    const suspended = new Set((cos.data || []).filter((c) => c.suspended === true).map((c) => Number(c.id)));
    const setting = new Map((settings.data || []).map((s) => [`${s.company_id}:${s.definition_id}`, s]));
    const title = new Map((defs.data || []).map((d) => [Number(d.id), cleanLabel(d.title) || 'document']));

    const routeCache = new Map();
    const perPerson = new Map();
    const claimed = [];
    let routedCount = 0;
    for (const row of rows) {
      if (routedCount >= ALERT_BATCH) break;
      const claimTo = (value) => db.from('document_records').update({ unsigned_alerted_at: value }).eq('id', row.id).eq('company_id', row.company_id);
      if (suspended.has(Number(row.company_id))) {
        await claimTo(iso(nowMs)).is('unsigned_alerted_at', null);
        continue;
      }
      const { data: won, error: claimErr } = await claimTo(iso(nowMs)).eq('awaiting_signature', true).is('unsigned_closed_at', null).is('unsigned_alerted_at', null).select('id');
      if (claimErr || !won || won.length === 0) continue;
      out.alerted += 1;
      routedCount += 1;

      const s = setting.get(`${row.company_id}:${row.definition_id}`);
      const plan = plans.get(Number(row.version_id)) || notifyPlan([]);
      const cfg = engineSetting({ plan, ownerMuted: !s || s.owner_muted === true || s.is_enabled !== true });
      const key = `${row.company_id}:${row.definition_id}:${row.site_id}:${row.submitted_by_roster_id}`;
      if (!routeCache.has(key)) {
        routeCache.set(key, await routeNotification(db, {
          companyId: row.company_id,
          documentKey: engineKey(row.definition_id),
          record: { site_id: row.site_id ?? null, submitted_by_roster_id: row.submitted_by_roster_id ?? null },
          settingOverride: cfg,
        }));
      }
      const routed = routeCache.get(key);
      if (routed.reason === 'error') {
        await claimTo(null);
        out.alerted -= 1;
        continue;
      }
      if (!routed.enabled || routed.recipients.length === 0) continue;
      claimed.push({ row, recipients: routed.recipients });
      for (const r of routed.recipients) {
        const pk = `${row.company_id}:${r.id}`;
        if (!perPerson.has(pk)) perPerson.set(pk, { email: r.email, counts: new Map() });
        const c = perPerson.get(pk).counts;
        c.set(Number(row.definition_id), (c.get(Number(row.definition_id)) || 0) + 1);
      }
    }

    const sentTo = new Set();
    const sendStart = Date.now();
    for (const [pk, person] of perPerson) {
      for (const [definitionId, n] of person.counts) {
        if (Date.now() - sendStart > SEND_BUDGET_MS) break;
        const label = title.get(Number(definitionId)) || 'document';
        const plural = `${label}${n === 1 ? '' : 's'}`;
        try {
          await sendEmail({
            to: person.email,
            subject: `${n} ${plural} still unsigned`,
            text: `${n} ${plural} ${n === 1 ? 'has' : 'have'} been waiting more than 24 hours for the worker's signature.\n\nUntil it is signed it is not counted, and it closes unsigned after 10 days. Log in to FORA to see which.`,
          });
          out.emailed += 1;
          sentTo.add(`${pk}:${definitionId}`);
        } catch (e) {
          out.failed += 1;
          console.error('engine unsigned heads-up email failed:', e && e.message);
          if (isPermanentRejection(e)) sentTo.add(`${pk}:${definitionId}`);
        }
      }
    }
    for (const entry of claimed) {
      const told = entry.recipients.some((r) => sentTo.has(`${entry.row.company_id}:${r.id}:${entry.row.definition_id}`));
      if (!told) {
        await db.from('document_records').update({ unsigned_alerted_at: null }).eq('id', entry.row.id).eq('company_id', entry.row.company_id);
        out.alerted -= 1;
      }
    }
  } catch (e) {
    console.error('alertOverdueUnsignedEngine failed:', e && e.message);
  }
  return out;
}

/**
 * Records waiting on a reviewer for more than 48 hours escalate once to the
 * company's Account Owner, one email per Owner per company with a count. A
 * document the Owner muted is left alone. Returns { escalated, emailed, failed }.
 */
export async function escalateStalePending(db, { sendEmail, nowMs = Date.now() } = {}) {
  const out = { escalated: 0, emailed: 0, failed: 0 };
  try {
    const { data: rows, error } = await db
      .from('document_records')
      .select('id, company_id, definition_id')
      .eq('status', 'pending_approval')
      .eq('awaiting_signature', false)
      .is('review_alerted_at', null)
      .lt('submitted_at', iso(nowMs - STALE_REVIEW_MS))
      .order('submitted_at', { ascending: true })
      .limit(ALERT_SCAN);
    if (error) {
      if (!missingColumn(error)) console.error('engine stale review lookup failed:', error.message);
      return out;
    }
    if (!rows || rows.length === 0) return out;

    const companyIds = [...new Set(rows.map((r) => r.company_id))];
    const defIds = [...new Set(rows.map((r) => r.definition_id))];
    const [cos, settings] = await Promise.all([
      db.from('companies').select('id, suspended').in('id', companyIds),
      db.from('company_documents').select('company_id, definition_id, owner_muted').in('company_id', companyIds).in('definition_id', defIds),
    ]);
    if (cos.error || settings.error) { console.error('engine stale review lookups failed'); return out; }
    const suspended = new Set((cos.data || []).filter((c) => c.suspended === true).map((c) => Number(c.id)));
    const muted = new Set((settings.data || []).filter((s) => s.owner_muted === true).map((s) => `${s.company_id}:${s.definition_id}`));

    const perCompany = new Map();
    let n = 0;
    for (const row of rows) {
      if (n >= ALERT_BATCH) break;
      const stamp = (value) => db.from('document_records').update({ review_alerted_at: value }).eq('id', row.id).eq('company_id', row.company_id);
      if (suspended.has(Number(row.company_id)) || muted.has(`${row.company_id}:${row.definition_id}`)) {
        await stamp(iso(nowMs)).is('review_alerted_at', null);
        continue;
      }
      const { data: won, error: claimErr } = await stamp(iso(nowMs)).eq('status', 'pending_approval').is('review_alerted_at', null).select('id');
      if (claimErr || !won || won.length === 0) continue;
      n += 1;
      out.escalated += 1;
      perCompany.set(Number(row.company_id), [...(perCompany.get(Number(row.company_id)) || []), row]);
    }

    const sendStart = Date.now();
    for (const [companyId, list] of perCompany) {
      const { data: owners, error: ownErr } = await db.from('roster').select('id, email, active, is_owner, role').eq('company_id', companyId).eq('active', true).eq('role', 'supervisor');
      const people = ownErr ? [] : withDecryptedEmail((owners || []).filter((p) => p.is_owner === true));
      let told = false;
      for (const owner of people) {
        if (Date.now() - sendStart > SEND_BUDGET_MS) break;
        const email = typeof owner.email === 'string' ? owner.email.trim() : '';
        if (!SINGLE_ADDRESS.test(email)) continue;
        const count = list.length;
        try {
          await sendEmail({
            to: email,
            subject: `${count} document${count === 1 ? '' : 's'} waiting for review`,
            text: `${count} document${count === 1 ? ' has' : 's have'} been waiting more than 48 hours for a reviewer.\n\nLog in to FORA to see which, or to nudge whoever is away.`,
          });
          out.emailed += 1;
          told = true;
        } catch (e) {
          out.failed += 1;
          console.error('engine stale review email failed:', e && e.message);
          if (isPermanentRejection(e)) told = true;
        }
      }
      if (!told) {
        // Nobody could be told: hand the stamp back so a later run, after an Owner
        // address is fixed, tries again.
        for (const row of list) await db.from('document_records').update({ review_alerted_at: null }).eq('id', row.id).eq('company_id', companyId);
        out.escalated -= list.length;
      }
    }
  } catch (e) {
    console.error('escalateStalePending failed:', e && e.message);
  }
  return out;
}

export const RETRY_BATCH = 25;
export const RETRY_AFTER_MS = 5 * 60 * 1000;

/**
 * Runs the follow-ups again for records whose first run failed part way
 * (escalations, notifications, Brain). Steps already done are not repeated.
 * A record is tried at most five times, then left alone. Returns { retried, stillFailing }.
 */
export async function retryFailedFollowUps(db, { sendEmail = null, nowMs = Date.now() } = {}) {
  const out = { retried: 0, stillFailing: 0 };
  try {
    const { data, error } = await db.from('document_records').select('*')
      .eq('meta->>followups_failed', 'true')
      .eq('awaiting_signature', false)
      .lt('created_at', iso(nowMs - RETRY_AFTER_MS))
      .order('created_at', { ascending: true })
      .limit(RETRY_BATCH);
    if (error) {
      if (!missingColumn(error)) console.error('engine follow-up retry read failed:', error.message);
      return out;
    }
    for (const record of data || []) {
      try {
        const res = await runFollowUpsAgain(db, { sendEmail }, record);
        out.retried += 1;
        if (res.failed) out.stillFailing += 1;
      } catch (e) {
        out.stillFailing += 1;
        console.error('engine follow-up retry failed:', e && e.message);
      }
    }
  } catch (e) {
    console.error('retryFailedFollowUps failed:', e && e.message);
  }
  return out;
}
