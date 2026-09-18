// Regression tests for the Stripe Checkout payload built by
// server-lib/pricing.js.
//
// The setup fee originally rode in `subscription_data.add_invoice_items`.
// That is wrong twice over, and either mistake alone fails the call:
//
//   1. Checkout Sessions have no `add_invoice_items` parameter. Stripe
//      rejects unknown parameters with a 400, so every real checkout would
//      have landed in api/checkout.js's catch block and bounced the buyer
//      to "Could not start checkout".
//   2. Even where `add_invoice_items` does exist (the Subscriptions API),
//      its `price_data` takes a `product` id, not `product_data`. Verified
//      against the live test-mode API, which answered: "Received unknown
//      parameter: add_invoice_items[0][price_data][product_data]".
//
// The fix is Stripe's documented setup-fee pattern: a non-recurring line
// item alongside the recurring ones in a mode:subscription session, which
// lands on the first invoice and never recurs. These cases pin that down,
// since the failure only ever showed up against the real API.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE, SETUP, MODULES, MODULE_KEYS, CARD_SURCHARGE_RATE, CURRENCY,
  resolveModules, quote, buildCheckoutLineItems,
} from '../../server-lib/pricing.js';

// Every module key, and it has to be kept in step BY HAND: this is a string,
// so doc-key-module-invariant.test.js cannot see it. Forget a module here and
// every "all modules" assertion below quietly stops covering it while the
// suite still goes green.
const ALL = 'safety,inspections,maintenance,timeclock,daily,certifications,compliance,fuel,monthly';
const cents = d => Math.round(d * 100 * (1 + CARD_SURCHARGE_RATE));

function build(tier, raw = ALL) {
  const { modules, error } = resolveModules(raw);
  assert.equal(error, undefined, `resolveModules rejected: ${error}`);
  return { modules, ...buildCheckoutLineItems(tier, modules) };
}

test('builder returns a flat line_items array and nothing else', () => {
  const out = buildCheckoutLineItems('basic', resolveModules(ALL).modules);
  assert.deepEqual(Object.keys(out), ['lineItems']);
  // add_invoice_items is not a Checkout parameter. If this key ever comes
  // back, api/checkout.js will start 400ing on every request again.
  assert.equal(out.invoiceItems, undefined);
});

for (const tier of ['basic', 'advanced']) {
  test(`${tier}: exactly one non-recurring line, and it is the setup fee`, () => {
    const { lineItems } = build(tier);
    const oneTime = lineItems.filter(l => !l.price_data.recurring);
    assert.equal(oneTime.length, 1);
    assert.equal(oneTime[0].price_data.product_data.name, 'One-time setup fee');
    assert.equal(oneTime[0].price_data.unit_amount, cents(SETUP[tier]));
    // A `recurring` key here would bill the setup fee every month forever.
    assert.ok(!('recurring' in oneTime[0].price_data));
  });

  test(`${tier}: one recurring line per purchased module, plus the base`, () => {
    const { modules, lineItems } = build(tier);
    const recurring = lineItems.filter(l => l.price_data.recurring);
    assert.equal(recurring.length, modules.length + 1);
    for (const line of recurring) {
      assert.deepEqual(line.price_data.recurring, { interval: 'month' });
    }
    assert.equal(recurring[0].price_data.unit_amount, cents(BASE[tier]));
    modules.forEach((key, i) => {
      assert.equal(recurring[i + 1].price_data.unit_amount, cents(MODULES[key].price[tier]));
      assert.equal(recurring[i + 1].price_data.product_data.name, MODULES[key].label);
    });
  });

  test(`${tier}: totals match the quote once the surcharge is removed`, () => {
    const { modules, lineItems } = build(tier);
    const { monthly, setup } = quote(tier, modules);
    const sum = ls => ls.reduce((s, l) => s + l.price_data.unit_amount, 0);
    assert.equal(sum(lineItems.filter(l => l.price_data.recurring)), cents(monthly));
    assert.equal(sum(lineItems.filter(l => !l.price_data.recurring)), cents(setup));
  });

  test(`${tier}: every line is a whole-cent integer with a quantity`, () => {
    const { lineItems } = build(tier);
    for (const line of lineItems) {
      assert.equal(line.quantity, 1);
      assert.equal(line.price_data.currency, CURRENCY);
      assert.ok(Number.isInteger(line.price_data.unit_amount));
      // product_data is only valid on line_items price_data, which is the
      // whole reason the setup fee had to move here.
      assert.equal(typeof line.price_data.product_data.name, 'string');
    }
  });
}

test('a single module still gets a setup fee line', () => {
  const { lineItems } = build('basic', 'safety');
  assert.equal(lineItems.length, 3); // base + safety + setup
  assert.equal(lineItems.filter(l => !l.price_data.recurring).length, 1);
});

test('maintenance without inspections is rejected, never silently added', () => {
  const { modules, error } = resolveModules('maintenance');
  assert.equal(modules, undefined);
  assert.match(error, /Equipment Inspections/);
});

test('unknown module keys are dropped rather than priced', () => {
  const { modules } = resolveModules('safety,free-stuff,../../etc/passwd');
  assert.deepEqual(modules, ['safety']);
});

test('every module key is priced on both tiers', () => {
  for (const key of MODULE_KEYS) {
    for (const tier of ['basic', 'advanced']) {
      assert.ok(MODULES[key].price[tier] > 0, `${key} has no ${tier} price`);
    }
  }
});
