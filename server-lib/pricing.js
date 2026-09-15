// server-lib/pricing.js
// The single source of truth for what FORA costs. Every price on the public
// pricing page, every Stripe line item, and the set of document types a new
// company gets switched on all resolve from the tables below.
//
// Lives outside api/ on purpose: Vercel only turns files directly under api/
// into functions, and this is imported by api/checkout.js, api/login.js and
// server-lib/onboardingApproval.js.
//
// There is no plan. A company pays BASE for the platform and then adds only
// the modules it runs. Nothing here is discounted or bundled: a module costs
// the same whether it is the only one or one of eight, so adding one always
// costs exactly its listed price and dropping one always saves exactly that.
//
// IMPORTANT: website/pricing.html duplicates these numbers in its calculator
// (the `data-s` / `data-l` attributes on each module checkbox and the
// `.price-card` figures). That page is a separate Vercel project with no
// access to this module, so the two have to be changed together. The
// calculator is only ever an estimate shown to a visitor; what a customer is
// actually charged is built here, server-side, from the keys in the request
// and never from any amount the browser sends.

// Seat tiers. `plan_tier` on the companies table has used these two values
// since before modular pricing and still drives the seat cap and analytics
// depth, so the names are kept rather than renamed to something like
// small/large.
export const TIERS = ['basic', 'advanced'];

export const TIER_LABELS = {
  basic: 'Up to 10 users',
  advanced: '11 to 50 users',
};

// Monthly platform fee: login, roster, PIN access, the supervisor dashboard,
// analytics, unlimited PDF export and the company's Brain. Required
// underneath any module. Amounts are whole dollars.
export const BASE = { basic: 60, advanced: 140 };

// One-time, charged on the first invoice only. Flat regardless of how many
// modules are taken, because reading a company's SOPs and building its
// account is the same work either way.
export const SETUP = { basic: 350, advanced: 500 };

// Applied to everything, monthly and setup alike, because Checkout takes
// cards. The pricing page quotes the pre-surcharge figure and says so.
export const CARD_SURCHARGE_RATE = 0.03;

export const CURRENCY = 'cad';

// Each module maps to the document_key values it switches on in
// company_document_settings. Those keys are the same list as
// BUILTIN_DOC_KEYS in api/customforms.js; every one of them must appear in
// exactly one module here, or ALL_DOC_KEYS below will not cover it and a
// company could be charged for something it cannot see, or see something it
// was not charged for.
//
// `requires` is a hard dependency: preventative maintenance is driven
// entirely by what equipment inspections report, so it cannot be bought on
// its own. resolveModules() below rejects a selection that breaks this.
export const MODULES = {
  safety: {
    label: 'Safety Forms Suite',
    blurb: 'FLHA, Toolbox Talk, Incident Report and Near Miss',
    price: { basic: 70, advanced: 160 },
    docKeys: ['flha', 'toolbox', 'incident', 'nearmiss'],
  },
  inspections: {
    label: 'Equipment Inspections',
    blurb: 'Pre-use and post-trip checklists, per machine type',
    price: { basic: 30, advanced: 70 },
    docKeys: ['inspection', 'equipment_reports'],
  },
  maintenance: {
    label: 'Preventative Maintenance',
    blurb: 'Service intervals by hours or mileage, with due-soon flags',
    price: { basic: 35, advanced: 80 },
    docKeys: ['maintenance'],
    requires: ['inspections'],
  },
  timeclock: {
    label: 'Time Clock + GPS',
    blurb: 'Clock in and out against the roster, location on every punch',
    price: { basic: 50, advanced: 110 },
    docKeys: ['timeclock'],
  },
  daily: {
    label: 'Daily Reports',
    blurb: 'End-of-shift site summaries',
    price: { basic: 25, advanced: 60 },
    docKeys: ['daily'],
  },
  certifications: {
    label: 'Certification Tracking',
    blurb: 'Every ticket in one directory, with expiry alerts',
    price: { basic: 18, advanced: 40 },
    docKeys: ['certifications'],
  },
  fuel: {
    label: 'Fuel & Consumables',
    blurb: 'Fuel-ups logged against the actual unit',
    price: { basic: 15, advanced: 35 },
    docKeys: ['fuellog'],
  },
  monthly: {
    label: 'Monthly Site Inspections',
    blurb: 'Recurring compliance walk-throughs from your own checklist',
    price: { basic: 12, advanced: 28 },
    docKeys: ['monthly'],
  },
};

export const MODULE_KEYS = Object.keys(MODULES);

// Every document_key any module can switch on. Provisioning writes a row for
// each of these so nothing is left to the "no row means active" default in
// api/customforms.js, which is what would otherwise hand a company document
// types it never paid for.
export const ALL_DOC_KEYS = MODULE_KEYS.flatMap(k => MODULES[k].docKeys);

export function isTier(tier) {
  return TIERS.includes(tier);
}

// Takes whatever module keys arrived on the request and returns the ones
// that are real, de-duplicated and in MODULE_KEYS order, or an error if the
// selection is not buyable. Unknown keys are dropped rather than failing the
// whole checkout, but a broken dependency is an error: silently adding the
// module someone did not ask for would charge them for it.
export function resolveModules(raw) {
  const requested = (Array.isArray(raw) ? raw : String(raw || '').split(','))
    .map(k => String(k).trim().toLowerCase())
    .filter(Boolean);

  const selected = MODULE_KEYS.filter(k => requested.includes(k));
  if (selected.length === 0) {
    return { error: 'Pick at least one module. The platform base on its own has nothing to file.' };
  }

  for (const key of selected) {
    const needs = MODULES[key].requires || [];
    const missing = needs.filter(n => !selected.includes(n));
    if (missing.length > 0) {
      const names = missing.map(n => MODULES[n].label).join(' and ');
      return { error: `${MODULES[key].label} needs ${names} as well.` };
    }
  }

  return { modules: selected };
}

// Whole-dollar monthly and setup totals before the card surcharge. These are
// the figures the pricing page quotes.
export function quote(tier, modules) {
  const monthly = modules.reduce((sum, k) => sum + MODULES[k].price[tier], BASE[tier]);
  return { monthly, setup: SETUP[tier] };
}

// Cents, rounded to the nearest cent. Stripe takes integer minor units, so
// the surcharge is computed per line rather than on the total, which keeps
// each line item's amount matching what its own description says.
function withSurcharge(dollars) {
  return Math.round(dollars * 100 * (1 + CARD_SURCHARGE_RATE));
}

// Builds the Checkout Session payload. Recurring lines (base + each module)
// go in line_items; the one-time setup fee goes in add_invoice_items so it
// lands on the first invoice only and never recurs. Stripe anchors the
// billing cycle to the moment the subscription is created, which is the
// "monthly from sign up date" behaviour we want, so no billing_cycle_anchor
// is set.
export function buildCheckoutLineItems(tier, modules) {
  const recurring = [
    {
      quantity: 1,
      price_data: {
        currency: CURRENCY,
        unit_amount: withSurcharge(BASE[tier]),
        recurring: { interval: 'month' },
        product_data: {
          name: `FORA platform base (${TIER_LABELS[tier]})`,
          description: 'Login, roster, supervisor dashboard, analytics, PDF export and your company Brain. Includes the 3% card processing fee.',
        },
      },
    },
    ...modules.map(key => ({
      quantity: 1,
      price_data: {
        currency: CURRENCY,
        unit_amount: withSurcharge(MODULES[key].price[tier]),
        recurring: { interval: 'month' },
        product_data: {
          name: MODULES[key].label,
          description: `${MODULES[key].blurb}. Includes the 3% card processing fee.`,
        },
      },
    })),
  ];

  const invoiceItems = [
    {
      price_data: {
        currency: CURRENCY,
        unit_amount: withSurcharge(SETUP[tier]),
        product_data: {
          name: 'One-time setup fee',
          description: 'Building your account from your SOPs, equipment list and roster. Charged once. Includes the 3% card processing fee.',
        },
      },
    },
  ];

  return { recurring, invoiceItems };
}

// The company_document_settings rows to write when a purchased request is
// approved. Every key a module can unlock gets a row, so a document type the
// company did not buy is explicitly off rather than defaulted on.
export function documentSettingsFor(companyId, modules) {
  const bought = new Set(modules.flatMap(k => (MODULES[k] ? MODULES[k].docKeys : [])));
  return ALL_DOC_KEYS.map(documentKey => ({
    company_id: companyId,
    document_key: documentKey,
    is_active: bought.has(documentKey),
  }));
}
