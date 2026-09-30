import test from 'node:test';
import assert from 'node:assert/strict';
import { stampAuthorName, sessionDisplayName } from '../../server-lib/authorStamp.js';
import { formatOccurredAt, isLocalInput } from '../../src/occurredAt.js';

test('roster session overwrites a client-asserted name', () => {
  const rec = { worker_name: 'Somebody Else', signed_by: 'Somebody Else', x: 1 };
  stampAuthorName({ userId: 5, name: ' Rob Smith ' }, rec, ['worker_name', 'signed_by']);
  assert.equal(rec.worker_name, 'Rob Smith');
  assert.equal(rec.signed_by, 'Rob Smith');
  assert.equal(rec.x, 1);
});

test('session with no individual identity leaves the typed name alone', () => {
  const rec = { worker_name: 'Typed Name' };
  stampAuthorName({ role: 'admin' }, rec, ['worker_name']);
  assert.equal(rec.worker_name, 'Typed Name');
  assert.equal(sessionDisplayName(null), '');
});

test('anonymous reports are never stamped', () => {
  const rec = { reporter_name: 'Anonymous' };
  stampAuthorName({ userId: 5, name: 'Rob Smith' }, rec, ['reporter_name'], { isAnonymous: true });
  assert.equal(rec.reporter_name, 'Anonymous');
});

test('occurred-at formatting passes legacy free text through', () => {
  assert.equal(formatOccurredAt('Today at 5:45 PM'), 'Today at 5:45 PM');
  assert.equal(formatOccurredAt(''), '');
  assert.equal(isLocalInput('2026-09-30T14:30'), true);
  assert.equal(isLocalInput('June 22 at 3:45 pm'), false);
  assert.notEqual(formatOccurredAt('2026-09-30T14:30'), '2026-09-30T14:30');
});
