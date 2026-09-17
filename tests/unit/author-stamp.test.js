// Pins who gets recorded as a document's author — and, more importantly,
// who does not.
//
// Break #3 in docs/feature-interaction-map.md: every document identified its
// author by free-text name while roster login exists so a person is a real
// record. The id was already in the session; nothing persisted it.
//
// The single most important case here is the anonymous near miss.
// src/NearMiss.jsx promises the worker in so many words that the report is
// anonymous and takes no signature. Recording who filed it would silently
// break that promise — the worker believes they are unidentifiable while the
// database knows exactly who they are. That is a trust violation, not a
// data-quality issue, and it is the worst thing this change could get wrong.
//
// The database enforces it too (near_misses_anonymous_has_no_author,
// verified against production with a rolled-back probe). These cases pin the
// application half, so a caller never even tries.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { authorRosterId } = await import('../../server-lib/authorStamp.js');

const rosterSession = { userId: 42, companyId: 1, role: 'worker', name: 'Rob' };

test('an identified worker is recorded as the author', () => {
  assert.equal(authorRosterId(rosterSession), 42);
});

test('an anonymous near miss records no author, ever', () => {
  assert.equal(authorRosterId(rosterSession, { isAnonymous: true }), null);
});

test('only an explicit true anonymises — nothing else is treated as the flag', () => {
  // is_anonymous arrives from a client record. A missing or falsy value must
  // attribute normally, and a truthy non-boolean must NOT silently suppress
  // attribution either — that would quietly lose authorship on ordinary
  // reports, which is the opposite failure.
  assert.equal(authorRosterId(rosterSession, { isAnonymous: false }), 42);
  assert.equal(authorRosterId(rosterSession, {}), 42);
  assert.equal(authorRosterId(rosterSession), 42);
  assert.equal(authorRosterId(rosterSession, { isAnonymous: 'yes' }), 42);
  assert.equal(authorRosterId(rosterSession, { isAnonymous: 1 }), 42);
});

test('a shared-login company records no author', () => {
  // Two of the three companies today have no roster rows, so there is
  // nothing to point at. The record keeps its text name — the same graceful
  // degradation as break #2's "other site" path, not a gap.
  assert.equal(authorRosterId({ companyId: 1, role: 'worker' }), null);
  assert.equal(authorRosterId({ companyId: 1, userId: null }), null);
});

test('a missing session cannot throw', () => {
  // This runs inline in an insert. Throwing here would fail a submit that
  // was otherwise fine.
  assert.equal(authorRosterId(null), null);
  assert.equal(authorRosterId(undefined), null);
  assert.equal(authorRosterId(null, { isAnonymous: true }), null);
});

test('anonymity wins over an identified session', () => {
  // The order matters: a worker who is fully identified and chooses to
  // report anonymously must still be unattributed.
  assert.equal(authorRosterId({ userId: 7, name: 'Rob' }, { isAnonymous: true }), null);
});
