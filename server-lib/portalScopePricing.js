// server-lib/portalScopePricing.js
// Company Portal scoping pricing, per the Boardroom decision recorded in
// the "FORA Company Portal — Build Spec" doc (2026-09-28):
// https://claude.ai/artifact/ViUH94b8ZmPcdoszTHQtwt
//
// Separate from server-lib/pricing.js's MODULES table on purpose. That
// table prices a company's ongoing module *subscription* at checkout time.
// This prices a one-off Portal *build engagement* — a setup fee scoped to
// how many of the client's own documents get digitized, quoted by Ted's
// pipeline before any Stripe object exists. The two meet only at the
// monthly figure: once a Portal engagement is built and paid for, the
// resulting monthly add-on would be entered into MODULES the same way any
// other module is, when Portal ships as a real subscribable module.
//
// Amounts are whole dollars in this module (matches pricing.js's
// convention); callers that talk to Stripe convert to cents themselves,
// same as server-lib/pricing.js's withSurcharge does.

// Mirrors pricing.js's TIER_LABELS split (basic: up to 10 users, advanced:
// 11–50) so a Portal quote doesn't invent a different definition of
// company size than the rest of the product uses.
export function tierFor(employeeCount) {
  const n = Number(employeeCount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n <= 10 ? 'basic' : 'advanced';
}

// Positioned between Equipment Compliance ($20/$45) and Time Clock
// ($50/$110) in server-lib/pricing.js's MODULES table — Portal documents
// are cheap to run (no AI cross-referencing) but there are more of them
// and routing/assignment runs continuously.
export const PORTAL_MONTHLY_FEE = { basic: 45, advanced: 100 };

// DEPRECATED for new quotes (2026-10-08): superseded by quotePortalBuild()
// below, which prices each document by build hours and charges onboarding
// separately. Kept so existing tests and the printed field scope sheet's
// reference box keep matching until those are regenerated.
//
// Banded by document count, not per-document — replaces (does not stack
// with) pricing.js's SETUP fee when Portal is a customer's first module.
// The 16+ band has no number: that's scoped as a real conversation, same
// rule as the Custom Builds guide's Tier 4 ("never quote off a one-line
// email").
export const SETUP_FEE_BANDS = [
  { max: 5, band: '1-5', fee: 900 },
  { max: 10, band: '6-10', fee: 1800 },
  { max: 15, band: '11-15', fee: 2800 },
];

export function setupFeeFor(documentCount) {
  const n = Number(documentCount);
  if (!Number.isFinite(n) || n <= 0) return { band: null, fee: null };
  const banded = SETUP_FEE_BANDS.find(b => n <= b.max);
  if (banded) return { band: banded.band, fee: banded.fee };
  return { band: '16+', fee: null };
}

// Full quote from the two rough inputs Ted gathers during intake. Returns
// null fee fields (never a guessed number) when the document count lands
// in the 16+ band or the employee count is missing — callers are expected
// to treat a null fee as "needs a real scoping conversation before
// quoting," not to fall back to some default.
export function quotePortalScope({ employeeCount, documentCount }) {
  const tier = tierFor(employeeCount);
  const { band, fee: setupFee } = setupFeeFor(documentCount);
  const monthlyFee = tier ? PORTAL_MONTHLY_FEE[tier] : null;
  return {
    tier,
    docBand: band,
    setupFee,
    monthlyFee,
    needsRealScopingCall: band === '16+' || !tier,
  };
}

// ---------------------------------------------------------------------------
// Per-document build pricing (Dillon, 2026-10-08). Replaces the document-count
// bands above for new quotes. Reference table and the 20 worked examples:
// docs/marketing/portal-document-pricing-floor.md
//
// Setup fee = onboarding (roster, equipment, sites, linking) + the sum of
// each document's build price. Monthly fee is unchanged.

export const HOURLY_RATE = 150;
export const DOCUMENT_MIN_PRICE = 150; // Tier 0 Custom Form floor
export const ONBOARDING_FEE = 300; // ~2 hours at HOURLY_RATE, per Dillon
export const RUSH_MULTIPLIER = 1.25; // under 48 hours

// Estimated build hours x HOURLY_RATE, rounded to the nearest $50, never
// below DOCUMENT_MIN_PRICE. Returns null for unusable hours.
export function documentPriceFor(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return null;
  return Math.max(DOCUMENT_MIN_PRICE, Math.round((h * HOURLY_RATE) / 50) * 50);
}

// documents: [{ name, hours, addOn?, workflow? }]
//   hours    estimated build hours, scored against the reference table
//   addOn    flat dollars for modifiers (exact paper layout match, extra
//            escalation routes, retyping from a scan)
//   workflow true for assign/due-date/close-out builds. Never priced here:
//            those are Custom Builds Tier 2+ and need a real scoping call.
// Returns null prices (never a guess) for anything it can't price, and sets
// needsRealScopingCall.
export function quotePortalBuild({ employeeCount, documents, rush = false }) {
  const tier = tierFor(employeeCount);
  const docs = Array.isArray(documents) ? documents : [];
  const priced = docs.map(d => {
    const addOn = Number(d.addOn) > 0 ? Number(d.addOn) : 0;
    const base = d.workflow ? null : documentPriceFor(d.hours);
    return {
      name: d.name ?? null,
      hours: d.hours ?? null,
      price: base === null ? null : base + addOn,
      needsScopingCall: base === null,
    };
  });
  const unpriceable = priced.some(d => d.needsScopingCall);
  const rawTotal = priced.reduce((sum, d) => sum + (d.price ?? 0), 0);
  const documentsTotal = unpriceable || docs.length === 0
    ? null
    : Math.round(rush ? rawTotal * RUSH_MULTIPLIER : rawTotal);
  return {
    tier,
    monthlyFee: tier ? PORTAL_MONTHLY_FEE[tier] : null,
    onboardingFee: ONBOARDING_FEE,
    documents: priced,
    documentsTotal,
    setupFee: documentsTotal === null ? null : ONBOARDING_FEE + documentsTotal,
    rush,
    needsRealScopingCall: !tier || docs.length === 0 || unpriceable,
  };
}
