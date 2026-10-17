// The Portal tab gate. The FORA Field Portal is a separate, quoted product, so
// a company that only bought Platform modules must not see a Portal tab.
// Before this, the tab rode companies.roster_enabled, which every provisioned
// company has, so every Platform customer saw an empty Portal tab.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './_fakeDb.js';
import { withPortalFlag, portalTabVisible } from '../../server-lib/portalEnabled.js';

const quiet = (fn) => async (...args) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(...args); } finally { console.error = orig; }
};

test('a company with Portal documents is flagged, one without is not', async () => {
  const db = makeDb({ portal_documents: [{ id: 1, company_id: 2, title: 'Daily pre-trip', is_active: true }] });
  const out = await withPortalFlag(db, [{ id: 1, name: 'Platform only' }, { id: 2, name: 'Has Portal' }]);
  assert.equal(out.find((c) => c.id === 1).portal_enabled, false);
  assert.equal(out.find((c) => c.id === 2).portal_enabled, true);
});

test('another company\'s Portal documents never enable this one', async () => {
  const db = makeDb({ portal_documents: [{ id: 1, company_id: 7, title: 'Not yours', is_active: true }] });
  const out = await withPortalFlag(db, [{ id: 1, name: 'ABC' }]);
  assert.equal(out[0].portal_enabled, false);
});

test('switched-off documents still count, so the Inbox and history stay reachable', async () => {
  const db = makeDb({ portal_documents: [{ id: 1, company_id: 1, title: 'Old form', is_active: false }] });
  const out = await withPortalFlag(db, [{ id: 1, name: 'Former Portal customer' }]);
  assert.equal(out[0].portal_enabled, true);
});

test('the other company fields come through untouched', async () => {
  const db = makeDb({});
  const out = await withPortalFlag(db, [{ id: 1, name: 'ABC', logo_url: 'x', plan_tier: 'basic', roster_enabled: true }]);
  assert.deepEqual(out[0], { id: 1, name: 'ABC', logo_url: 'x', plan_tier: 'basic', roster_enabled: true, portal_enabled: false });
});

test('an empty or missing company list is returned as an empty list', async () => {
  const db = makeDb({});
  assert.deepEqual(await withPortalFlag(db, []), []);
  assert.deepEqual(await withPortalFlag(db, null), []);
});

test('a failed lookup answers true, so a Portal customer never loses its Inbox to a blip', quiet(async () => {
  const db = makeDb({});
  db.failOn('portal_documents', 'select');
  const out = await withPortalFlag(db, [{ id: 1, name: 'ABC' }]);
  assert.equal(out[0].portal_enabled, true);
}));

test('the tab needs both Portal documents and a roster', () => {
  assert.equal(portalTabVisible({ roster_enabled: true, portal_enabled: true }), true);
  assert.equal(portalTabVisible({ roster_enabled: true, portal_enabled: false }), false);
  assert.equal(portalTabVisible({ roster_enabled: false, portal_enabled: true }), false);
  assert.equal(portalTabVisible({ roster_enabled: true }), false);
});

test('portalTabVisible is safe on a company that has not loaded yet', () => {
  assert.equal(portalTabVisible(undefined), false);
  assert.equal(portalTabVisible(null), false);
  assert.equal(portalTabVisible({}), false);
});
