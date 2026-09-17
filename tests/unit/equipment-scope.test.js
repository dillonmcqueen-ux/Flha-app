// Pins the tenancy rules for a client-supplied equipment_id.
//
// Found by tenant-scope-reviewer on the break #7 diff: `equipment_id` had
// been in api/logs.js's SUBMITTABLE_FIELDS.inspection all along with no
// ownership check, while api/fuellogs.js guarded its own copy of the same
// column inline. Break #7 made that column the grouping key for weekly
// equipment reports, so the dormant inconsistency became load-bearing.
//
// What these cases exist to stop coming back:
//   * a cross-tenant id being accepted, or silently nulled instead of 403'd
//     (the 403 is the tripwire for a real client bug or a probe);
//   * a MISSING id being 403'd, which permanently wedges an offline queue —
//     drainQueue has no attempt cap and no drop path, so a submission that
//     can never succeed blocks every later one of its form type;
//   * a database error being read as "wrong company";
//   * the caller's value being echoed back instead of the row's own id;
//   * an unreadable fleet collapsing into an empty one, which would strip
//     every legitimate id off a week of inspections.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { resolveEquipmentId, companyEquipmentIndex } = await import('../../server-lib/equipmentScope.js');

// Minimal stand-in for the supabase-js builder chain these helpers use:
// .from(t).select(c).eq(k, v)[.limit(n)] resolving to { data, error }.
function fakeClient({ rows = [], error = null, onQuery } = {}) {
  return {
    from(table) {
      const q = { table, filters: {} };
      const builder = {
        select() { return builder; },
        eq(key, value) { q.filters[key] = value; return builder; },
        limit() { return builder; },
        then(resolve, reject) {
          if (onQuery) onQuery(q);
          return Promise.resolve({ data: error ? null : rows, error }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('an equipment id owned by the caller resolves to the row\'s own id', async () => {
  const client = fakeClient({ rows: [{ id: 7, company_id: 'acme' }] });
  assert.equal(await resolveEquipmentId(client, 'acme', 7), 7);
});

test('the row\'s id wins over the caller\'s value, so a string id comes back a number', async () => {
  const client = fakeClient({ rows: [{ id: 7, company_id: 'acme' }] });
  assert.strictEqual(await resolveEquipmentId(client, 'acme', '7'), 7);
});

test('another company\'s equipment is false, not null — the caller 403s', async () => {
  const client = fakeClient({ rows: [{ id: 4711, company_id: 'other-co' }] });
  assert.strictEqual(await resolveEquipmentId(client, 'acme', 4711), false);
});

test('an equipment id that does not exist is null, NOT false — a 403 here wedges the offline queue', async () => {
  const client = fakeClient({ rows: [] });
  assert.strictEqual(await resolveEquipmentId(client, 'acme', 99999), null);
});

test('a database error is null, never false — an outage must not read as wrong company', async () => {
  const client = fakeClient({ error: { message: 'connection reset' } });
  assert.strictEqual(await resolveEquipmentId(client, 'acme', 7), null);
});

test('nothing to link short-circuits without a query', async () => {
  let queried = false;
  const client = fakeClient({ rows: [], onQuery: () => { queried = true; } });
  for (const empty of [undefined, null, '']) {
    assert.strictEqual(await resolveEquipmentId(client, 'acme', empty), null);
  }
  assert.equal(queried, false);
});

test('the lookup is filtered by id and the answer compared to the caller\'s company', async () => {
  let seen = null;
  const client = fakeClient({ rows: [{ id: 7, company_id: 'acme' }], onQuery: (q) => { seen = q; } });
  await resolveEquipmentId(client, 'acme', 7);
  assert.equal(seen.table, 'equipment');
  assert.equal(seen.filters.id, 7);
});

test('the fleet index holds exactly the company\'s own equipment', async () => {
  let seen = null;
  const client = fakeClient({ rows: [{ id: 1 }, { id: 2 }], onQuery: (q) => { seen = q; } });
  const index = await companyEquipmentIndex(client, 'acme');
  assert.equal(seen.filters.company_id, 'acme');
  assert.deepEqual([...index.values()].sort(), [1, 2]);
});

test('the index is keyed by string, so an id that round-tripped through jsonb still matches', async () => {
  // attachedTrailer.id arrives inside client JSON. The code this replaced
  // keyed on `eq:${id}`, which string-coerced — a number-only lookup would
  // silently drop a string id and regress a real trailer to label grouping.
  // The value is the fleet row's OWN id, so the caller's spelling never
  // survives into a stored report.
  const index = await companyEquipmentIndex(fakeClient({ rows: [{ id: 3 }] }), 'acme');
  assert.strictEqual(index.get('3'), 3);
});

test('a company with no equipment is an empty index, not null', async () => {
  const index = await companyEquipmentIndex(fakeClient({ rows: [] }), 'acme');
  assert.ok(index instanceof Map);
  assert.equal(index.size, 0);
});

test('an unreadable fleet is null, so a caller can refuse rather than strip every id', async () => {
  const index = await companyEquipmentIndex(fakeClient({ error: { message: 'down' } }), 'acme');
  assert.strictEqual(index, null);
});

// ── the array form, for a daily report's list of machines ────────────────
//
// Same rules as the single-id form above, and these cases exist to keep
// them the same: a second set of semantics for the same question is a
// second set of bugs.

// The array form queries with .in(), which the builder above doesn't model,
// so it gets its own minimal stand-in.
function fakeInClient({ rows = [], error = null, onQuery } = {}) {
  return {
    from(table) {
      const q = { table, in: null };
      const builder = {
        select() { return builder; },
        in(key, values) { q.in = { key, values }; return builder; },
        then(resolve, reject) {
          if (onQuery) onQuery(q);
          return Promise.resolve({ data: error ? null : rows, error }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const { resolveEquipmentIds } = await import('../../server-lib/equipmentScope.js');

test('owned ids resolve to the rows\' own ids, so strings come back as numbers', async () => {
  const client = fakeInClient({ rows: [{ id: 7, company_id: 'acme' }, { id: 8, company_id: 'acme' }] });
  assert.deepEqual(await resolveEquipmentIds(client, 'acme', ['7', 8]), [7, 8]);
});

test('one id belonging to another company fails the whole list — the cross-tenant tripwire stays', async () => {
  const client = fakeInClient({ rows: [{ id: 7, company_id: 'acme' }, { id: 4711, company_id: 'other-co' }] });
  assert.strictEqual(await resolveEquipmentIds(client, 'acme', [7, 4711]), false);
});

test('an id that does not exist is dropped, not rejected — a 403 here wedges the offline queue', async () => {
  const client = fakeInClient({ rows: [{ id: 7, company_id: 'acme' }] });
  assert.deepEqual(await resolveEquipmentIds(client, 'acme', [7, 999]), [7]);
});

test('an empty list, a non-array, and a list of nothings are all null — one spelling of "no machines"', async () => {
  const client = fakeInClient({ rows: [] });
  assert.equal(await resolveEquipmentIds(client, 'acme', []), null);
  assert.equal(await resolveEquipmentIds(client, 'acme', null), null);
  assert.equal(await resolveEquipmentIds(client, 'acme', ['', null, undefined]), null);
});

test('duplicates are collapsed before the query, so one machine is stored once', async () => {
  let seen = null;
  const client = fakeInClient({ rows: [{ id: 7, company_id: 'acme' }], onQuery: q => { seen = q.in.values; } });
  assert.deepEqual(await resolveEquipmentIds(client, 'acme', [7, '7', 7]), [7]);
  assert.deepEqual(seen, ['7']);
});

test('a database error is not read as "wrong company"', async () => {
  const client = fakeInClient({ error: { message: 'connection reset' } });
  assert.equal(await resolveEquipmentIds(client, 'acme', [7]), null);
});

test('a list past the cap is rejected, not truncated — truncating would let padding silence the 403', async () => {
  // Dropping ids before the ownership loop means a cross-tenant id parked
  // at index 50 is silently discarded instead of tripping the alarm.
  let queried = false;
  const many = Array.from({ length: 80 }, (_, i) => i + 1);
  const client = fakeInClient({ rows: [], onQuery: () => { queried = true; } });
  assert.strictEqual(await resolveEquipmentIds(client, 'acme', many), false);
  assert.equal(queried, false);
});

test('one junk id is dropped on its own, and does not take the whole list with it', async () => {
  // `.in()` on a bigint column 400s on a value it can't coerce, which would
  // return null and strip every machine off the report with no error.
  let seen = null;
  const client = fakeInClient({ rows: [{ id: 7, company_id: 'acme' }, { id: 8, company_id: 'acme' }], onQuery: q => { seen = q.in.values; } });
  assert.deepEqual(await resolveEquipmentIds(client, 'acme', [7, 'none', 8, {}, true]), [7, 8]);
  assert.deepEqual(seen, ['7', '8']);
});
