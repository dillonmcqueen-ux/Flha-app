// Regression tests for server-lib/portalScopePricing.js — the single
// source of truth for Ted's client-scoping pipeline's pricing (see
// CLAUDE.md's "Client scoping pipeline" section). Pins down the exact
// numbers the Boardroom decision locked in (2026-09-28) so a future edit
// to this module can't silently drift the quote a client sees away from
// what api/scope-approval.js actually invoices.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tierFor, setupFeeFor, quotePortalScope, PORTAL_MONTHLY_FEE, SETUP_FEE_BANDS,
} from '../../server-lib/portalScopePricing.js';

test('tierFor: 10 or fewer employees is basic, 11+ is advanced', () => {
  assert.equal(tierFor(1), 'basic');
  assert.equal(tierFor(10), 'basic');
  assert.equal(tierFor(11), 'advanced');
  assert.equal(tierFor(50), 'advanced');
});

test('tierFor: missing or non-positive input returns null rather than a guess', () => {
  assert.equal(tierFor(undefined), null);
  assert.equal(tierFor(null), null);
  assert.equal(tierFor(0), null);
  assert.equal(tierFor(-5), null);
  assert.equal(tierFor('not a number'), null);
});

test('setupFeeFor: matches the Boardroom decision bands exactly', () => {
  assert.deepEqual(setupFeeFor(1), { band: '1-5', fee: 900 });
  assert.deepEqual(setupFeeFor(5), { band: '1-5', fee: 900 });
  assert.deepEqual(setupFeeFor(6), { band: '6-10', fee: 1800 });
  assert.deepEqual(setupFeeFor(10), { band: '6-10', fee: 1800 });
  assert.deepEqual(setupFeeFor(11), { band: '11-15', fee: 2800 });
  assert.deepEqual(setupFeeFor(13), { band: '11-15', fee: 2800 }); // the reference-scale example
  assert.deepEqual(setupFeeFor(15), { band: '11-15', fee: 2800 });
});

test('setupFeeFor: 16+ documents returns a band with no fee, never a guessed number', () => {
  const result = setupFeeFor(16);
  assert.equal(result.band, '16+');
  assert.equal(result.fee, null);
});

test('setupFeeFor: missing or non-positive input returns no band and no fee', () => {
  assert.deepEqual(setupFeeFor(0), { band: null, fee: null });
  assert.deepEqual(setupFeeFor(undefined), { band: null, fee: null });
});

test('quotePortalScope: the 50-employee/13-document reference case from the Build Spec', () => {
  const quote = quotePortalScope({ employeeCount: 50, documentCount: 13 });
  assert.equal(quote.tier, 'advanced');
  assert.equal(quote.monthlyFee, 100);
  assert.equal(quote.docBand, '11-15');
  assert.equal(quote.setupFee, 2800);
  assert.equal(quote.needsRealScopingCall, false);
});

test('quotePortalScope: 16+ documents forces needsRealScopingCall regardless of tier', () => {
  const quote = quotePortalScope({ employeeCount: 50, documentCount: 20 });
  assert.equal(quote.needsRealScopingCall, true);
  assert.equal(quote.setupFee, null);
  // the monthly fee is still knowable even when the setup fee isn't
  assert.equal(quote.monthlyFee, 100);
});

test('quotePortalScope: missing employee count forces needsRealScopingCall', () => {
  const quote = quotePortalScope({ documentCount: 5 });
  assert.equal(quote.tier, null);
  assert.equal(quote.monthlyFee, null);
  assert.equal(quote.needsRealScopingCall, true);
});

test('PORTAL_MONTHLY_FEE sits between Equipment Compliance and Time Clock in server-lib/pricing.js', () => {
  // Not a live import comparison (portalScopePricing.js is deliberately
  // decoupled from pricing.js) — this pins the two numbers the Boardroom
  // decision reasoned about explicitly, so the comment in
  // portalScopePricing.js can't drift from the actual exported values.
  assert.equal(PORTAL_MONTHLY_FEE.basic, 45);
  assert.equal(PORTAL_MONTHLY_FEE.advanced, 100);
});

test('SETUP_FEE_BANDS is ordered and non-overlapping', () => {
  for (let i = 1; i < SETUP_FEE_BANDS.length; i++) {
    assert.ok(SETUP_FEE_BANDS[i].max > SETUP_FEE_BANDS[i - 1].max, 'bands must be strictly increasing');
  }
});
