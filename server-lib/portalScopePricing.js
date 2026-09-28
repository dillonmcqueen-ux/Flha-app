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
