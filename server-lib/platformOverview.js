// server-lib/platformOverview.js
// The founder dashboard's numbers (Admin Panel > Platform). Aggregates only:
// counts per day, per type, per plan, per module. It never returns a document,
// a worker name, a company's answers or anything a customer typed. Company
// NAMES appear only in the per-company activity list, which the founder
// already sees on the Admin console.
//
// Reachable only through api/admin.js, whose handler rejects every session
// that is not the global ADMIN_CODE login before any action runs. Nothing in
// this file checks a session on purpose: it takes a service-role client and
// reads across companies, so it must never be imported by a handler a
// customer login can reach (a test pins that).
//
// Split in two so the arithmetic can be tested without a database:
// buildPlatformOverview() is pure, loadPlatformOverview() only fetches.

import { MODULES, MODULE_KEYS } from './pricing.js';

const DAY = 24 * 60 * 60 * 1000;

// document_key that gates each measurable document type. A module counts as
// "used" when at least one company that has it switched on filed one of these
// in the window. Maintenance and Equipment Compliance have no filing of their
// own to count (they read other documents), so they are reported as not
// measurable rather than guessed at.
export const DOC_TYPES = [
  { type: 'flha', label: 'FLHA', docKey: 'flha' },
  { type: 'toolbox', label: 'Toolbox Talk', docKey: 'toolbox' },
  { type: 'incident', label: 'Incident', docKey: 'incident' },
  { type: 'nearmiss', label: 'Near Miss', docKey: 'nearmiss' },
  { type: 'daily', label: 'Daily Report', docKey: 'daily' },
  { type: 'inspection', label: 'Equipment Inspection', docKey: 'inspection' },
  { type: 'monthly', label: 'Monthly Site Inspection', docKey: 'monthly' },
  { type: 'fuellog', label: 'Fuel Log', docKey: 'fuellog' },
  { type: 'timeclock', label: 'Time Clock', docKey: 'timeclock' },
  { type: 'certifications', label: 'Certification', docKey: 'certifications' },
  { type: 'custom', label: 'Custom Document', docKey: null },
  { type: 'portal', label: 'Company Portal', docKey: null },
];

// Doc keys that gate a module but have no filing of their own to count, so
// DOC_TYPES cannot measure them. Listed on purpose: tests/unit/platform-
// overview.test.js requires DOC_TYPES plus this list to cover every key in
// pricing.js exactly (map break #41). Add a document key to a module and that
// test fails until the key is either measured above or named here.
export const UNMEASURED_DOC_KEYS = ['equipment_reports', 'maintenance', 'equipment_compliance'];

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export function buildPlatformOverview({ companies = [], docs = {}, roster = [], docSettings = [], onboarding = [], truncated = false } = {}, now = new Date()) {
  const t = now.getTime();
  const since = (days) => t - days * DAY;
  const liveCompanies = companies.filter((c) => !c.suspended);

  // ── activity ─────────────────────────────────────────────────────────
  const typeStats = DOC_TYPES.map(({ type, label }) => {
    const rows = docs[type] || [];
    let d7 = 0, d30 = 0;
    for (const r of rows) {
      const ts = new Date(r.created_at).getTime();
      if (ts >= since(7)) d7 += 1;
      if (ts >= since(30)) d30 += 1;
    }
    return { type, label, last7: d7, last30: d30, total: rows.length };
  });

  const days = [];
  const dayIdx = {};
  for (let i = 29; i >= 0; i--) {
    const key = dayKey(t - i * DAY);
    dayIdx[key] = days.length;
    days.push({ date: key, total: 0 });
  }
  const activeCompany7 = new Set();
  const activeCompany30 = new Set();
  const lastDocAt = {};
  for (const { type } of DOC_TYPES) {
    for (const r of docs[type] || []) {
      const ts = new Date(r.created_at).getTime();
      // A document whose parent form was deleted has no company left to
      // credit, but it still happened, so it counts toward the daily total.
      if (r.company_id != null) {
        if (!lastDocAt[r.company_id] || ts > lastDocAt[r.company_id]) lastDocAt[r.company_id] = ts;
        if (ts >= since(7)) activeCompany7.add(r.company_id);
        if (ts >= since(30)) activeCompany30.add(r.company_id);
      }
      if (ts >= since(30)) {
        const i = dayIdx[dayKey(ts)];
        if (i !== undefined) days[i].total += 1;
      }
    }
  }

  const activeWorkers = (windowDays) => roster.filter((r) => r.active && r.last_login_at && new Date(r.last_login_at).getTime() >= since(windowDays)).length;

  const months = [];
  const monthIdx = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    monthIdx[key] = months.length;
    months.push({ key, label: d.toLocaleDateString('en-CA', { month: 'short', year: '2-digit' }), signups: 0, requests: 0 });
  }
  for (const c of companies) {
    if (!c.created_at) continue;
    const d = new Date(c.created_at);
    const i = monthIdx[`${d.getFullYear()}-${d.getMonth()}`];
    if (i !== undefined) months[i].signups += 1;
  }
  for (const o of onboarding) {
    if (!o.created_at) continue;
    const d = new Date(o.created_at);
    const i = monthIdx[`${d.getFullYear()}-${d.getMonth()}`];
    if (i !== undefined) months[i].requests += 1;
  }
  const funnel = {};
  for (const o of onboarding) funnel[o.status || 'unknown'] = (funnel[o.status || 'unknown'] || 0) + 1;

  // ── plans and modules ────────────────────────────────────────────────
  const byTier = {};
  for (const c of liveCompanies) byTier[c.plan_tier || 'unset'] = (byTier[c.plan_tier || 'unset'] || 0) + 1;
  const bySubscription = {};
  for (const c of companies) bySubscription[c.stripe_subscription_status || 'none'] = (bySubscription[c.stripe_subscription_status || 'none'] || 0) + 1;

  // A company "has" a module when any of its keys is switched on. Explicit
  // rows only: since the pricing rework every provisioned company has a row
  // per key, so an absent row means not bought.
  const enabledKeys = new Map();
  for (const s of docSettings) {
    if (!s.is_active) continue;
    if (!enabledKeys.has(s.company_id)) enabledKeys.set(s.company_id, new Set());
    enabledKeys.get(s.company_id).add(s.document_key);
  }
  const liveIds = new Set(liveCompanies.map((c) => c.id));
  const typeByDocKey = {};
  for (const { type, docKey } of DOC_TYPES) if (docKey) typeByDocKey[docKey] = type;

  const filedIn30 = (companyId, docKeys) => docKeys.some((k) => {
    const type = typeByDocKey[k];
    if (!type) return false;
    return (docs[type] || []).some((r) => r.company_id === companyId && new Date(r.created_at).getTime() >= since(30));
  });

  const modules = MODULE_KEYS.map((key) => {
    const m = MODULES[key];
    const measurable = m.docKeys.some((k) => typeByDocKey[k]);
    let bought = 0, used = 0;
    for (const id of liveIds) {
      const keys = enabledKeys.get(id);
      if (!keys || !m.docKeys.some((k) => keys.has(k))) continue;
      bought += 1;
      if (measurable && filedIn30(id, m.docKeys)) used += 1;
    }
    return { key, label: m.label, bought, used: measurable ? used : null, adoptionPct: measurable && bought > 0 ? Math.round((used / bought) * 100) : null };
  }).sort((a, b) => b.bought - a.bought);

  // ── per company (names are the founder's own client list) ────────────
  const perCompany = liveCompanies.map((c) => {
    const last = lastDocAt[c.id] || null;
    return {
      id: c.id,
      name: c.name,
      tier: c.plan_tier || null,
      subscription: c.stripe_subscription_status || null,
      docs30: DOC_TYPES.reduce((n, { type }) => n + (docs[type] || []).filter((r) => r.company_id === c.id && new Date(r.created_at).getTime() >= since(30)).length, 0),
      lastDocAt: last ? new Date(last).toISOString() : null,
      daysSinceLastDoc: last ? Math.floor((t - last) / DAY) : null,
    };
  }).sort((a, b) => b.docs30 - a.docs30);

  return {
    generatedAt: now.toISOString(),
    truncated,
    totals: {
      companies: companies.length,
      live: liveCompanies.length,
      suspended: companies.length - liveCompanies.length,
      activeCompanies7: activeCompany7.size,
      activeCompanies30: activeCompany30.size,
      activeWorkers7: activeWorkers(7),
      activeWorkers30: activeWorkers(30),
      rosterActive: roster.filter((r) => r.active).length,
    },
    documents: { byType: typeStats.sort((a, b) => b.last30 - a.last30), perDay: days },
    signups: { months, funnel },
    plans: { byTier, bySubscription },
    modules,
    perCompany,
  };
}

// Pages through a table a slice at a time, because PostgREST returns about a
// thousand rows per request no matter what limit is asked for. Stops at
// `cap` rows and says so, rather than quietly reporting a partial number as
// the whole.
async function fetchAll(query, cap) {
  const pageSize = 1000;
  const out = [];
  for (let from = 0; from < cap; from += pageSize) {
    const { data, error } = await query().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < pageSize) return { rows: out, truncated: false };
  }
  return { rows: out, truncated: true };
}

const DOC_SOURCES = [
  { type: 'flha', table: 'flhas' },
  { type: 'toolbox', table: 'toolbox_talks' },
  { type: 'incident', table: 'incidents' },
  { type: 'nearmiss', table: 'near_misses' },
  { type: 'daily', table: 'daily_reports' },
  { type: 'inspection', table: 'inspections' },
  { type: 'fuellog', table: 'fuel_logs' },
  { type: 'timeclock', table: 'time_clock_entries' },
  { type: 'certifications', table: 'worker_certifications' },
];

// Tables with no company_id of their own: their records hang off a form or
// document, and that parent carries the company.
const VIA_PARENT = [
  { type: 'monthly', table: 'inspection_records', fk: 'form_id', parent: 'inspection_forms' },
  { type: 'custom', table: 'custom_form_records', fk: 'form_id', parent: 'custom_forms' },
  { type: 'portal', table: 'portal_records', fk: 'document_id', parent: 'portal_documents' },
];

export async function loadPlatformOverview(supabaseAdmin, now = new Date(), { rowCap = 20000 } = {}) {
  let truncated = false;
  const keep = (r) => { if (r.truncated) truncated = true; return r.rows; };

  const companies = keep(await fetchAll(() => supabaseAdmin.from('companies')
    .select('id, name, created_at, plan_tier, suspended, stripe_subscription_status').order('id'), rowCap));
  const roster = keep(await fetchAll(() => supabaseAdmin.from('roster')
    .select('company_id, active, last_login_at').order('id'), rowCap));
  const docSettings = keep(await fetchAll(() => supabaseAdmin.from('company_document_settings')
    .select('company_id, document_key, is_active').order('company_id'), rowCap));
  const onboarding = keep(await fetchAll(() => supabaseAdmin.from('onboarding_requests')
    .select('status, created_at').order('created_at'), rowCap));

  const docs = {};
  for (const { type, table } of DOC_SOURCES) {
    docs[type] = keep(await fetchAll(() => supabaseAdmin.from(table).select('company_id, created_at').order('created_at', { ascending: false }), rowCap));
  }
  for (const { type, table, fk, parent } of VIA_PARENT) {
    const parents = keep(await fetchAll(() => supabaseAdmin.from(parent).select('id, company_id').order('id'), rowCap));
    const companyOf = new Map(parents.map((p) => [p.id, p.company_id]));
    const rows = keep(await fetchAll(() => supabaseAdmin.from(table).select(`${fk}, created_at`).order('created_at', { ascending: false }), rowCap));
    docs[type] = rows.map((r) => ({ company_id: companyOf.get(r[fk]) ?? null, created_at: r.created_at }));
  }

  return buildPlatformOverview({ companies, docs, roster, docSettings, onboarding, truncated }, now);
}
