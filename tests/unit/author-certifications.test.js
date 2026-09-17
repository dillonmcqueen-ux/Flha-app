// Pins what a supervisor is told about the person who filed a document.
//
// Break #8 in docs/feature-interaction-map.md: certification expiry gated,
// informed and reached nothing — `worker_certifications` was referenced by
// api/certifications.js and by no other file in the codebase.
//
// The break was written as "a worker whose ticket expired yesterday can
// still submit an FLHA for the task that ticket covers". Gating is the
// wrong fix, for two reasons this file exists to keep true:
//   1. cert_type is free text and nothing maps a ticket to the tasks it
//      covers, so "the task that ticket covers" is not computable;
//   2. refusing the submission would stop a worker filing safety paperwork
//      because an administrative record lapsed — worse than the gap.
//
// So the link runs the other way, and the cases below guard the two ways
// that can go wrong: telling a reviewer something FALSE about an old
// document, and telling them something they must not know about an
// anonymous one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { classifyExpiryAsOf, authorCertificationFlags, authorCertificationLabel } =
  await import('../../src/certificationStatus.js');

const certs = [
  { roster_id: 7, cert_type: 'Fall Protection', expiry_date: '2026-09-01' },
  { roster_id: 7, cert_type: 'H2S Alive', expiry_date: '2026-10-05' },
  { roster_id: 9, cert_type: 'First Aid', expiry_date: '2020-01-01' },
];

test('a document is judged as of the day it was filed, not today', () => {
  // THE case this whole helper exists for. Fall Protection lapsed
  // 2026-09-01. A document filed in June was filed by a fully ticketed
  // worker, and saying otherwise tells a supervisor something false about a
  // record they are reviewing.
  assert.equal(authorCertificationFlags(certs, 7, '2026-06-01'), null);

  const atReview = authorCertificationFlags(certs, 7, '2026-09-17');
  assert.deepEqual(atReview.expired, ['Fall Protection']);
});

test('expiring-soon is also measured from the filing date', () => {
  // H2S Alive expires 2026-10-05. On 2026-09-17 that is inside 30 days.
  const flags = authorCertificationFlags(certs, 7, '2026-09-17');
  assert.deepEqual(flags.expiringSoon, ['H2S Alive']);
  // On 2026-08-01 it is not.
  assert.deepEqual(authorCertificationFlags(certs, 7, '2026-08-01'), null);
});

test('an unattributed document returns null, never a reassuring zero-state', () => {
  // Documents filed before break #3 landed carry no roster id, and
  // anonymous near misses never carry one by design. "No expired tickets"
  // and "we do not know who filed this" are different answers — showing the
  // first when the second is true is how a reviewer gets false assurance.
  assert.equal(authorCertificationFlags(certs, null, '2026-09-17'), null);
  assert.equal(authorCertificationFlags(certs, undefined, '2026-09-17'), null);
  assert.equal(authorCertificationFlags(certs, '', '2026-09-17'), null);
});

test('a worker with no certifications on file reads as unknown, not as clean', () => {
  assert.equal(authorCertificationFlags(certs, 12345, '2026-09-17'), null);
});

test('one author\'s tickets never appear against another author\'s document', () => {
  const flags = authorCertificationFlags(certs, 9, '2026-09-17');
  assert.deepEqual(flags.expired, ['First Aid']);
  assert.equal(flags.expiringSoon.length, 0);
});

test('roster ids match across string and number', () => {
  // The id arrives from JSON on one side and from a form on the other.
  assert.deepEqual(authorCertificationFlags(certs, '7', '2026-09-17').expired, ['Fall Protection']);
});

test('a ticket with no expiry date is never flagged', () => {
  const noExpiry = [{ roster_id: 7, cert_type: 'Orientation', expiry_date: null }];
  assert.equal(authorCertificationFlags(noExpiry, 7, '2026-09-17'), null);
  assert.equal(classifyExpiryAsOf(null, '2026-09-17'), null);
});

test('an unparseable date is null rather than treated as expired', () => {
  assert.equal(classifyExpiryAsOf('not a date', '2026-09-17'), null);
  assert.equal(classifyExpiryAsOf('2026-09-01', 'not a date'), null);
});

test('the label says "when filed", because without it the reviewer reads it as today', () => {
  const label = authorCertificationLabel(authorCertificationFlags(certs, 7, '2026-09-17'));
  assert.match(label, /when filed$/);
  assert.equal(label, '1 expired ticket, 1 expiring soon when filed');
});

test('the label pluralizes on the count of expired tickets', () => {
  const two = [
    { roster_id: 7, cert_type: 'A', expiry_date: '2026-09-01' },
    { roster_id: 7, cert_type: 'B', expiry_date: '2026-09-02' },
  ];
  assert.equal(authorCertificationLabel(authorCertificationFlags(two, 7, '2026-09-17')), '2 expired tickets when filed');
  assert.equal(authorCertificationLabel(authorCertificationFlags([two[0]], 7, '2026-09-17')), '1 expired ticket when filed');
});

test('no flags means no label at all', () => {
  assert.equal(authorCertificationLabel(null), null);
});

test('anonymity is protected structurally, not by withholding the author column', () => {
  // This test previously asserted the opposite — that the near-miss list
  // must NOT select submitted_by_roster_id, on the reasoning that a column
  // which is always null for anonymous rows would make "this one is null"
  // readable beside rows where it is set.
  //
  // That reasoning was wrong, and tenant-scope-reviewer said so plainly.
  // `is_anonymous` is selected on the same line and src/Dashboard.jsx
  // renders it as the literal word "Anonymous". Anonymity is a designed,
  // visible property of a near miss; denying an inference that the payload
  // already states outright protects nothing, and it cost the break-#8
  // badge on the non-anonymous near misses, which are most of them.
  //
  // What the promise actually rests on is asserted below. Both halves have
  // to hold: nulling at write time alone would let a future code path set
  // it, and the constraint alone would turn a bug into a failed submit.
  const reports = readFileSync(new URL('../../api/reports.js', import.meta.url), 'utf8');
  assert.match(reports, /authorRosterId\(session, \{ isAnonymous: recordToInsert\.is_anonymous === true \}\)/,
    'the author must be nulled at write time when the report is anonymous');

  const migration = readFileSync(new URL('../../docs/schema/roster-attribution-migration.sql', import.meta.url), 'utf8');
  assert.match(migration, /check \(not \(is_anonymous is true and submitted_by_roster_id is not null\)\)/,
    'the database must refuse an anonymous row that carries an author');
});

test('a document from an anonymous report gets no badge, because it has no author', () => {
  // The end-to-end consequence of the two guarantees above: an anonymous
  // near miss carries a null roster id, so the badge helper returns nothing
  // for it — the same answer it gives any unattributed document.
  const certs = [{ roster_id: 7, cert_type: 'Fall Protection', expiry_date: '2026-09-01' }];
  const anonymousNearMiss = { submitted_by_roster_id: null, created_at: '2026-09-17' };
  assert.equal(
    authorCertificationFlags(certs, anonymousNearMiss.submitted_by_roster_id, anonymousNearMiss.created_at),
    null,
  );
});
