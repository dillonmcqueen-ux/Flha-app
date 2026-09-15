// Regression tests for the extreme-risk supervisor approval gate.
//
// The gate used to live only in the browser: src/App.jsx computed `status`
// from the hazard list and posted it, and api/flhas.js accepted whatever it
// was sent. A worker could therefore post `status: 'complete'` alongside an
// Extreme-risk hazard and mark their own FLHA done without a supervisor ever
// signing it. api/flhas.js now derives `status` itself and ignores the
// client's value; these cases pin that behaviour down.
//
// Run with `npm run test:unit`. Uses node:test — no extra dependency, and
// deliberately separate from the Playwright suite in tests/, which stubs
// /api/flhas and so never exercises the real handler.

import test from 'node:test';
import assert from 'node:assert/strict';

// api/flhas.js builds a Supabase client at module load. These are never used
// (nothing here makes a request) but the constructor rejects empty values.
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SESSION_SECRET ||= 'test-session-secret';

const { deriveFlhaStatus, normalizeHazardsJson } = await import('../../api/flhas.js');

test('an Extreme hazard forces pending_approval', () => {
  assert.equal(
    deriveFlhaStatus({ hazards: [{ risk: 'Low' }, { risk: 'Extreme' }] }),
    'pending_approval'
  );
});

test('High is not Extreme and completes without sign-off', () => {
  assert.equal(
    deriveFlhaStatus({ hazards: [{ risk: 'Low' }, { risk: 'Medium' }, { risk: 'High' }] }),
    'complete'
  );
});

test('risk matching is case- and whitespace-insensitive', () => {
  // Broader than the client's exact `h.risk === "Extreme"` on purpose, so
  // nothing the browser would gate can slip past the server.
  for (const risk of ['extreme', 'EXTREME', ' Extreme ']) {
    assert.equal(deriveFlhaStatus({ hazards: [{ risk }] }), 'pending_approval', risk);
  }
});

test('malformed or empty hazard data falls back to complete, never to approved-looking', () => {
  for (const input of [null, undefined, 'not json', {}, { hazards: [] }, { hazards: 'nope' }, { hazards: [{}, { risk: null }] }]) {
    assert.equal(deriveFlhaStatus(input), 'complete', JSON.stringify(input));
  }
});

test('normalizeHazardsJson accepts a plain object and a JSON string for one', () => {
  const obj = { hazards: [{ risk: 'Extreme' }] };
  assert.deepEqual(normalizeHazardsJson(obj), { ok: true, value: obj });
  assert.deepEqual(normalizeHazardsJson(JSON.stringify(obj)), { ok: true, value: obj });
});

test('normalizeHazardsJson treats an absent payload as absent, not malformed', () => {
  assert.deepEqual(normalizeHazardsJson(null), { ok: true, value: null });
  assert.deepEqual(normalizeHazardsJson(undefined), { ok: true, value: null });
});

test('normalizeHazardsJson rejects anything that is not a plain object', () => {
  // An array or a primitive would spread into a shape with no `hazards` key.
  for (const input of [[{ risk: 'Extreme' }], 'not json', 42, true]) {
    assert.equal(normalizeHazardsJson(input).ok, false, JSON.stringify(input));
  }
});

test('stamping the offline idempotency key cannot strip the hazards', () => {
  // The bypass this pair exists to close: the submit handler spreads
  // hazards_json to attach client_submission_id. Spreading a *string*
  // produces a character-indexed object with no `hazards` key, so an
  // Extreme-risk FLHA would have derived as 'complete'. Normalizing first
  // means the spread always operates on the real object.
  for (const raw of [{ hazards: [{ risk: 'Extreme' }] }, JSON.stringify({ hazards: [{ risk: 'Extreme' }] })]) {
    const normalized = normalizeHazardsJson(raw);
    assert.equal(normalized.ok, true);
    const stored = { ...(normalized.value || {}), client_submission_id: 'abc-123' };
    assert.equal(deriveFlhaStatus(stored), 'pending_approval');
  }
});
