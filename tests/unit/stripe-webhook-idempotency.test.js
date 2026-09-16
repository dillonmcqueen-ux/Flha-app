// Regression tests for webhook retry handling in api/stripe-webhook.js.
//
// The handler recorded an event id in stripe_webhook_events BEFORE doing the
// work, and treated any later delivery of that id as a duplicate worth a
// bare 200. So a delivery that claimed the event and then failed could never
// be retried: Stripe's retry was told the event was already handled, and the
// customer's purchase was never staged into stripe_checkouts. The failure
// was also swallowed unlogged, so it was invisible as well as permanent.
//
// A function timeout was the worst case. There is no code still running to
// undo the claim, so "delete the row on failure" would not have covered it.
// The fix splits claimed from finished with a processed_at column.
//
// Nothing here talks to Stripe or Supabase. claimOutcome is the whole of the
// decision that was wrong, and the bug was invisible to tests precisely
// because it only appears on the SECOND delivery of an event whose FIRST
// delivery failed.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';

// api/stripe-webhook.js builds Supabase and Stripe clients at module load.
// Neither is used here, but both constructors reject empty values.
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_placeholder';

const { claimOutcome } = await import('../../api/stripe-webhook.js');

const DUPLICATE_KEY = { code: '23505', message: 'duplicate key value violates unique constraint' };

test('first delivery is processed', () => {
  assert.equal(claimOutcome(null, null), 'process');
});

test('redelivery of a FINISHED event is a genuine duplicate', () => {
  assert.equal(
    claimOutcome(DUPLICATE_KEY, { processed_at: '2026-09-16T03:00:00Z' }),
    'duplicate'
  );
});

// The regression. Before the fix this returned 'duplicate' and the purchase
// was lost for good.
test('retry of an event whose first attempt FAILED is processed again', () => {
  assert.equal(claimOutcome(DUPLICATE_KEY, { processed_at: null }), 'process');
});

// A function timeout leaves the claim row behind with no chance to clean up,
// so this is the same shape as above and the case "delete on failure" misses.
test('retry after a TIMEOUT is processed again', () => {
  assert.equal(claimOutcome(DUPLICATE_KEY, { processed_at: null }), 'process');
});

// Defensive: a claim row that somehow cannot be read back must not be
// mistaken for a finished one.
test('missing prior row is processed rather than skipped', () => {
  assert.equal(claimOutcome(DUPLICATE_KEY, null), 'process');
  assert.equal(claimOutcome(DUPLICATE_KEY, undefined), 'process');
  assert.equal(claimOutcome(DUPLICATE_KEY, {}), 'process');
});

test('a non-duplicate insert error fails so Stripe retries', () => {
  assert.equal(claimOutcome({ code: '08006', message: 'connection failure' }, null), 'error');
  assert.equal(claimOutcome({ code: '42501', message: 'permission denied' }, null), 'error');
});

// Whatever else changes, an unfinished claim must never resolve to
// 'duplicate'. That single mapping is what silently drops a paid purchase.
test('an unfinished claim never resolves to duplicate', () => {
  for (const prior of [null, undefined, {}, { processed_at: null }, { processed_at: '' }]) {
    assert.notEqual(claimOutcome(DUPLICATE_KEY, prior), 'duplicate');
  }
});
