// server-lib/platformBusiness.js
// The business half of the founder dashboard (Admin Panel > Platform):
// estimated MRR, seat usage against plan caps, time to first document, churn
// signals and a per-company health score.
//
// These are ESTIMATES built from data FORA holds, not from Stripe. MRR is
// each live company's list price (server-lib/pricing.js: platform base plus
// every module it has switched on, before the 3% card surcharge). The result
// is labelled as an estimate everywhere it is shown. It does not include
// Company Portal engagements, Custom Builds or Gatehouse, which are priced
// outside pricing.js.
//
// Pure and DB-free: server-lib/platformOverview.js loads the rows and calls
// buildBusinessMetrics(). Like that file, it must only ever be reached from
// api/admin.js's founder-only handler (a test pins the import chain).
//
// Health is a rule-based score with its reasons attached, deliberately not a
// black box. A founder acting on "Acme is at risk" needs to see why.

import { BASE, MODULES, MODULE_KEYS, TIERS } from './pricing.js';
import { effectiveSeatCap } from './onboardingHelpers.js';

const DAY = 24 * 60 * 60 * 1000;

// Stripe subscription statuses. Anything billed and current, versus anything
// that means money is late or gone. A company with no status was not bought
// through Checkout (the founder created it by hand, or it is a test).
export const BILLED_STATUSES = new Set(['active', 'trialing']);
export const PAYMENT_RISK_STATUSES = new Set(['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'canceled']);

// A company younger than this is too new to score fairly.
export const NEW_COMPANY_DAYS = 14;
export const NEAR_CAP_PCT = 80;

export function boughtModuleKeys(enabledDocKeys) {
  if (!enabledDocKeys) return [];
  return MODULE_KEYS.filter((k) => MODULES[k].docKeys.some((dk) => enabledDocKeys.has(dk)));
}

export function estimateMonthly(tier, moduleKeys) {
  if (!TIERS.includes(tier)) return null;
  return moduleKeys.reduce((sum, k) => sum + MODULES[k].price[tier], BASE[tier]);
}

function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function bandFor(score) {
  if (score >= 70) return 'healthy';
  if (score >= 40) return 'watch';
  return 'at_risk';
}

// typeByDocKey maps a document_key to the key its filings are stored under in
// `docs`, so "used" can be judged the same way the module adoption table does.
export function buildBusinessMetrics({ companies = [], docs = {}, roster = [], docSettings = [] } = {}, { typeByDocKey = {} } = {}, now = new Date()) {
  const t = now.getTime();
  const live = companies.filter((c) => !c.suspended);

  const enabled = new Map();
  for (const s of docSettings) {
    if (!s.is_active) continue;
    if (!enabled.has(s.company_id)) enabled.set(s.company_id, new Set());
    enabled.get(s.company_id).add(s.document_key);
  }

  // One pass over every filing: last and first document per company, and the
  // filings in the last 30 days per type per company (for module "used").
  const firstDoc = {}, lastDoc = {}, filedRecent = {};
  for (const [type, rows] of Object.entries(docs)) {
    for (const r of rows) {
      if (r.company_id == null) continue;
      const ts = new Date(r.created_at).getTime();
      if (!firstDoc[r.company_id] || ts < firstDoc[r.company_id]) firstDoc[r.company_id] = ts;
      if (!lastDoc[r.company_id] || ts > lastDoc[r.company_id]) lastDoc[r.company_id] = ts;
      if (ts >= t - 30 * DAY) {
        if (!filedRecent[r.company_id]) filedRecent[r.company_id] = new Set();
        filedRecent[r.company_id].add(type);
      }
    }
  }

  const rosterBy = {};
  for (const r of roster) {
    if (!r.active) continue;
    if (!rosterBy[r.company_id]) rosterBy[r.company_id] = { active: 0, logins7: 0, logins14: 0 };
    rosterBy[r.company_id].active += 1;
    const login = r.last_login_at ? new Date(r.last_login_at).getTime() : null;
    if (login && login >= t - 7 * DAY) rosterBy[r.company_id].logins7 += 1;
    if (login && login >= t - 14 * DAY) rosterBy[r.company_id].logins14 += 1;
  }

  const perCompany = live.map((c) => {
    const modules = boughtModuleKeys(enabled.get(c.id));
    const monthly = estimateMonthly(c.plan_tier, modules);
    const status = c.stripe_subscription_status || null;
    const billed = status ? BILLED_STATUSES.has(status) : false;
    const paymentRisk = status ? PAYMENT_RISK_STATUSES.has(status) : false;

    const seatsUsed = (rosterBy[c.id] || {}).active || 0;
    const cap = effectiveSeatCap(c.plan_tier);
    const seatPct = cap ? Math.round((seatsUsed / cap) * 100) : null;

    const ageDays = c.created_at ? Math.floor((t - new Date(c.created_at).getTime()) / DAY) : null;
    const daysSinceLastDoc = lastDoc[c.id] ? Math.floor((t - lastDoc[c.id]) / DAY) : null;
    const daysToFirstDoc = firstDoc[c.id] && c.created_at ? Math.max(0, Math.floor((firstDoc[c.id] - new Date(c.created_at).getTime()) / DAY)) : null;

    // Module adoption for this company: measurable modules it has, and how
    // many of those filed anything in 30 days. Modules with no filing of
    // their own are left out of both sides rather than counted against it.
    let measurable = 0, used = 0;
    for (const mk of modules) {
      const types = MODULES[mk].docKeys.map((dk) => typeByDocKey[dk]).filter(Boolean);
      if (types.length === 0) continue;
      measurable += 1;
      if (types.some((ty) => (filedRecent[c.id] || new Set()).has(ty))) used += 1;
    }

    const reasons = [];
    let score = null, band = 'new';
    const isNew = ageDays !== null && ageDays < NEW_COMPANY_DAYS;
    if (!isNew) {
      let recency = 0;
      if (daysSinceLastDoc === null) reasons.push('Has never filed a document');
      else if (daysSinceLastDoc <= 7) recency = 40;
      else if (daysSinceLastDoc <= 14) { recency = 30; reasons.push(`No document in ${daysSinceLastDoc} days`); }
      else if (daysSinceLastDoc <= 30) { recency = 15; reasons.push(`No document in ${daysSinceLastDoc} days`); }
      else reasons.push(`No document in ${daysSinceLastDoc} days`);

      const r = rosterBy[c.id];
      let logins = 0;
      if (!r || r.active === 0) reasons.push('No active workers on the roster');
      else {
        logins = Math.round((r.logins7 / r.active) * 30);
        if (r.logins7 === 0) reasons.push('No worker has logged in this week');
      }

      let adoption = 10; // neutral when nothing about it is measurable
      if (measurable > 0) {
        adoption = Math.round((used / measurable) * 20);
        if (used < measurable) reasons.push(`Using ${used} of ${measurable} paid modules`);
      }

      let payment = 5;
      if (billed) payment = 10;
      else if (paymentRisk) { payment = 0; reasons.push(`Subscription ${status}`); }

      score = recency + logins + adoption + payment;
      band = bandFor(score);
    }

    return {
      id: c.id, name: c.name, tier: c.plan_tier || null, subscription: status,
      modules: modules.length, monthly, billed, paymentRisk,
      seatsUsed, seatCap: cap, seatPct,
      nearCap: seatPct !== null && seatPct >= NEAR_CAP_PCT, atCap: seatPct !== null && seatPct >= 100,
      ageDays, daysSinceLastDoc, daysToFirstDoc,
      score, band, reasons,
    };
  });

  const priced = perCompany.filter((c) => c.monthly !== null);
  const sum = (rows) => rows.reduce((n, c) => n + c.monthly, 0);
  const byTier = {};
  for (const c of priced) byTier[c.tier] = (byTier[c.tier] || 0) + c.monthly;

  const ttfd = perCompany.map((c) => c.daysToFirstDoc).filter((n) => n !== null);

  return {
    mrr: {
      estimated: sum(priced),
      billed: sum(priced.filter((c) => c.billed)),
      notBilled: sum(priced.filter((c) => !c.billed && !c.paymentRisk)),
      atRisk: sum(priced.filter((c) => c.paymentRisk)),
      byTier,
      unpriced: perCompany.length - priced.length,
      note: 'List price estimate: platform base plus switched-on modules, before the 3% card surcharge. Excludes Company Portal engagements, Custom Builds and Gatehouse.',
    },
    seats: {
      nearCap: perCompany.filter((c) => c.nearCap).map((c) => ({ id: c.id, name: c.name, used: c.seatsUsed, cap: c.seatCap, pct: c.seatPct })),
    },
    timeToFirstDocument: {
      medianDays: median(ttfd),
      filed: ttfd.length,
      neverFiled: perCompany.filter((c) => c.daysToFirstDoc === null).length,
    },
    health: {
      healthy: perCompany.filter((c) => c.band === 'healthy').length,
      watch: perCompany.filter((c) => c.band === 'watch').length,
      atRisk: perCompany.filter((c) => c.band === 'at_risk').length,
      new: perCompany.filter((c) => c.band === 'new').length,
    },
    perCompany,
  };
}
