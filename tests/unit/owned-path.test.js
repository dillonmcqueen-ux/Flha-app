import { test } from 'node:test';
import assert from 'node:assert/strict';

const { isOwnedPath } = await import('../../server-lib/ownedPath.js');

test('accepts a path under the caller prefix', () => {
  assert.equal(isOwnedPath('5/7/abc123-ticket.pdf', '5/7/'), true);
});

test('rejects dot-segment traversal out of the prefix', () => {
  assert.equal(isOwnedPath('5/7/../../../flha-reports/9/x.pdf', '5/7/'), false);
  assert.equal(isOwnedPath('5/7/./x.pdf', '5/7/'), false);
  assert.equal(isOwnedPath('5/7//x.pdf', '5/7/'), false);
});

test('rejects other prefixes and non-strings', () => {
  assert.equal(isOwnedPath('6/7/x.pdf', '5/7/'), false);
  assert.equal(isOwnedPath(undefined, '5/7/'), false);
  assert.equal(isOwnedPath(null, '5/7/'), false);
});
