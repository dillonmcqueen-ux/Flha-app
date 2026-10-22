import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitInbox, summariseSentBatches, describeBatch, DONE_LIMIT } from '../../src/inbox.js';

test('splitInbox puts overdue first, then soonest due, then undated', () => {
  const { needs } = splitInbox([
    { key: 'undated', status: 'open' },
    { key: 'later', status: 'open', dueAt: '2026-12-01T00:00:00Z' },
    { key: 'late', status: 'overdue', dueAt: '2026-10-01T00:00:00Z' },
    { key: 'soon', status: 'open', dueAt: '2026-11-01T00:00:00Z' },
  ]);
  assert.deepEqual(needs.map((i) => i.key), ['late', 'soon', 'later', 'undated']);
});

test('splitInbox keeps completed apart, newest first, and capped', () => {
  const items = [{ key: 'todo', status: 'open' }];
  for (let i = 0; i < DONE_LIMIT + 5; i += 1) {
    items.push({ key: `d${i}`, status: 'done', doneAt: new Date(2026, 0, 1 + i).toISOString() });
  }
  const { needs, done } = splitInbox(items);
  assert.equal(needs.length, 1);
  assert.equal(done.length, DONE_LIMIT);
  assert.equal(done[0].key, `d${DONE_LIMIT + 4}`);
});

test('splitInbox tolerates bad input and unparseable dates', () => {
  assert.deepEqual(splitInbox(null), { needs: [], done: [] });
  const { needs } = splitInbox([null, { key: 'a', status: 'open', dueAt: 'nope' }]);
  assert.equal(needs.length, 1);
});

test('summariseSentBatches groups by batch and drops cancelled rows', () => {
  const rows = [
    { id: 1, batch_id: 'b1', title: 'Policy', mode: 'sign', displayStatus: 'completed', completed_at: '2026-10-02T00:00:00Z' },
    { id: 2, batch_id: 'b1', title: 'Policy', mode: 'sign', displayStatus: 'overdue' },
    { id: 3, batch_id: 'b1', title: 'Policy', mode: 'sign', displayStatus: 'cancelled' },
    { id: 4, batch_id: 'b2', title: 'Notice', mode: 'read', displayStatus: 'completed', completed_at: '2026-10-03T00:00:00Z' },
  ];
  const out = summariseSentBatches(rows);
  const b1 = out.find((b) => b.id === 'b1');
  const b2 = out.find((b) => b.id === 'b2');
  assert.equal(b1.total, 2);
  assert.equal(b1.status, 'overdue');
  assert.equal(describeBatch(b1), '1 of 2 still to sign, 1 overdue');
  assert.equal(b2.status, 'done');
  assert.equal(describeBatch(b2), 'All 1 read');
});
