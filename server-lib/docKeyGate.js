// server-lib/docKeyGate.js
// One answer to "does this company have this document type switched on?",
// and one place that turns a no into an HTTP response.
//
// Until break #21 (docs/feature-interaction-map.md) module gating was
// presentation only: the Dashboard hid a tab, the worker menu hid a card,
// the weekly PDF skipped a section — and every handler behind them answered
// anyone who asked. A company that dropped a module (or never bought one)
// kept full read/write access to it through a saved URL, a stale tab, or a
// client whose settings fetch failed, because src/Dashboard.jsx fails OPEN
// when that fetch fails. This is the server-side half.
//
// There were already TWO copies of isDocKeyActive — api/equipmentreports.js
// and api/cron-equipment-reports.js — which is the shape break #1 exists to
// warn about: they gate the same weekly report from two entry points and a
// drift between them produces a document the dashboard says should not
// exist. Both now call this, and nothing should add a third copy.
//
// Unlike server-lib/inspectionAttachments.js this file is NEVER imported by
// the browser bundle, so it may import and use a Supabase client. It takes
// the client as an argument rather than constructing one, matching
// server-lib/equipmentScope.js and server-lib/compliance.js — the handlers
// all already hold a service-role client, and creating a second here would
// mean this file needed the env vars just to be imported.

import { MODULES, MODULE_KEYS } from './pricing.js';

// document_key -> the module that sells it. Derived from pricing.js rather
// than restated, so a module added there is covered here without anyone
// remembering to come back. server-lib/pricing.js is the source of truth
// for this mapping and tests/unit/doc-key-module-invariant.test.js pins
// that every built-in key belongs to exactly one module.
const MODULE_BY_DOC_KEY = Object.fromEntries(
  MODULE_KEYS.flatMap(key => MODULES[key].docKeys.map(docKey => [docKey, key]))
);

/**
 * The customer-facing name of whatever sells this document key — "Fuel &
 * Consumables", not "fuellog". Falls back to the raw key for anything no
 * module sells (a custom form's `custom_<id>`, say), which is not something
 * this gate is used for today.
 */
export function moduleLabelForDocKey(documentKey) {
  const moduleKey = MODULE_BY_DOC_KEY[documentKey];
  return moduleKey ? MODULES[moduleKey].label : String(documentKey);
}

/**
 * The raw read: `{ active, unavailable }`.
 *
 * DENY-BY-DEFAULT, matching api/customforms.js: a missing row means nobody
 * decided to give this company the feature, and for a key that a module
 * sells that means it was not bought. The opposite direction is break #6 —
 * found live on 2026-09-18, where two of three companies were running
 * document types nobody had decided to give them.
 *
 * `unavailable` separates "the answer is no" from "there is no answer right
 * now". Both deny — a gate that opens when its own lookup fails is not a
 * gate, which is the one place this differs from the browser, which fails
 * OPEN (src/Dashboard.jsx:2742) — but they must not be reported alike. A
 * hard no is a 403 and, to an offline-queued submit, a 403 means DROP (see
 * isPermanentRejection in src/offlineQueue.js). Answering a transient
 * database blip with 403 would therefore delete a worker's queued shift
 * over a five-second outage, so requireDocKey answers that with a 503.
 */
export async function readDocKeySetting(supabase, companyId, documentKey) {
  if (!companyId || !documentKey) return { active: false, unavailable: false };
  const { data: rows, error } = await supabase
    .from('company_document_settings')
    .select('is_active')
    .eq('company_id', companyId)
    .eq('document_key', documentKey)
    .limit(1);
  if (error) return { active: false, unavailable: true };
  return { active: !!(rows && rows.length > 0 && rows[0].is_active), unavailable: false };
}

/**
 * Whether a company has a document type switched on. Denies on a read
 * error, same as it denies a missing row — callers here (the weekly report
 * builder and the cron) are producing a document nobody is waiting on, so
 * skipping a company this week is the cheap, correct failure.
 */
export async function isDocKeyActive(supabase, companyId, documentKey) {
  const { active } = await readDocKeySetting(supabase, companyId, documentKey);
  return active;
}

/**
 * The guard handlers call. Returns `null` when the action may proceed, or
 * `{ status, error }` to be returned verbatim as the response.
 *
 * Usage, once per gated action, right after the existing role check:
 *
 *     const denied = await requireDocKey(supabaseAdmin, session, 'fuellog');
 *     if (denied) return res.status(denied.status).json({ error: denied.error });
 *
 * ADMIN IS EXEMPT, on purpose. `session.role === 'admin'` is not a customer
 * role — there is no customer admin login (see
 * .claude/agents/admin-access-copy-guard.md); it is the founder, gated by a
 * single global ADMIN_CODE, and the Admin Panel reads across every company
 * at once (api/flhas.js's `count` is literally per-company totals for the
 * onboarding console). Gating the founder would break the console that
 * decides what a company is sold, to enforce a boundary the founder is on
 * the other side of. The paid boundary this closes is the customer's own
 * supervisor and worker sessions, which is exactly who break #21 names.
 *
 * The company is always the session's own. Only an admin can act on another
 * company (resolveCompanyId), and an admin never reaches the check.
 */
export async function requireDocKey(supabase, session, documentKey) {
  if (!session) return { status: 401, error: 'Not logged in. Please log in again.' };
  if (session.role === 'admin') return null;
  // A non-admin session carrying no company is an auth problem, not a
  // billing one, and the difference is now expensive: 403 tells the offline
  // queue to DROP the submission for good (src/offlineQueue.js's
  // isPermanentRejection), so answering a broken session with "your plan
  // doesn't include this" would destroy a worker's queued shift instead of
  // sending them to log in again. Not reachable today -- every worker and
  // supervisor token carries companyId and verifySession re-checks it
  // against the roster row -- so this is a guard against the shape, not a
  // fix for a live path.
  if (!session.companyId) return { status: 401, error: 'Not logged in. Please log in again.' };
  const { active, unavailable } = await readDocKeySetting(supabase, session.companyId, documentKey);
  if (active) return null;
  // Still denied, but retryable, and it has to SAY so: 503 keeps an
  // offline-queued submission queued, where 403 would drop it for good.
  if (unavailable) {
    return { status: 503, error: "Couldn't check which modules your company has. Please try again." };
  }
  return {
    status: 403,
    error: `Your company's plan doesn't include ${moduleLabelForDocKey(documentKey)}. Contact FORA to add it.`,
  };
}

/**
 * The guard for a company's OWN custom document (`custom_<formId>`), break #25.
 *
 * ALLOW-BY-DEFAULT, the deliberate opposite of requireDocKey above. A custom
 * form is something this company's admin built for itself, so a missing row
 * means "made it, never switched it off", not "never bought it"
 * (api/customforms.js get_worker_documents, pinned by
 * tests/unit/doc-setting-defaults.test.js). requireDocKey cannot be reused
 * here: it would switch off every custom form that has no row.
 *
 * Only an explicit `is_active: false` refuses, with 403, which tells an
 * offline-queued submission to drop and show the worker why. A FAILED
 * lookup refuses with 503 so the queue keeps the entry, same reasoning as
 * requireDocKey. Admin is exempt for the same reason too.
 */
export async function requireCustomDocKey(supabase, session, formId) {
  if (!session) return { status: 401, error: 'Not logged in. Please log in again.' };
  if (session.role === 'admin') return null;
  if (!session.companyId) return { status: 401, error: 'Not logged in. Please log in again.' };
  const { data: rows, error } = await supabase
    .from('company_document_settings')
    .select('is_active')
    .eq('company_id', session.companyId)
    .eq('document_key', `custom_${formId}`)
    .limit(1);
  if (error) return { status: 503, error: "Couldn't check whether this document is available. Please try again." };
  if (rows && rows.length > 0 && rows[0].is_active === false) {
    return { status: 403, error: 'This document has been switched off for your company.' };
  }
  return null;
}
