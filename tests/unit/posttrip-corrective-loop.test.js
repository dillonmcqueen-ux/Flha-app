// Pins the pre-trip → post-trip corrective-action loop.
//
// The break Dillon hit on 2026-09-17: he flagged a flat tire on a pre-trip,
// then did the post-trip on the same machine, and the post-trip neither
// showed him the tire nor recorded that it was still (or no longer) flat.
// Two separate causes, both pinned here:
//
//   1. A post-trip's results_json had NO `items` array — it was a single
//      {hasChanges, changeCondition, changeNotes} blob. correctiveActions-
//      FromInspection has always read `results.items`, so a defect found at
//      the END of a shift opened no corrective action at all, silently,
//      while the identical defect found at the start opened one.
//   2. Nothing could ever close an equipment corrective action from the
//      field. There was no resolution path and no repair record.
//
// What these cases exist to stop coming back:
//   * a carried-forward defect opening a SECOND action and thereby faking a
//     recurrence in a single day;
//   * a "Monitor" item that genuinely deteriorated during the shift being
//     swallowed by that same guard;
//   * 'worse' or 'still an issue' closing anything;
//   * a resolve that is not scoped to one machine, which would close another
//     machine's identically-named defect.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  correctiveActionsFromInspection,
  resolvedItemsFromPosttrip,
  resolveCorrectiveActionsForItems,
} = await import('../../server-lib/correctiveActions.js');

const item = (over = {}) => ({ item: 'Tires, wheels, lug nuts, and locks', category: 'Walkaround', condition: 'Good', note: '', ...over });

// ── 1. A post-trip defect now opens an action at all ──────────────────

test('a post-trip checklist opens actions exactly like a pre-trip one', () => {
  // This is the whole fix for cause (1): the function is unchanged, the
  // post-trip's shape is. A defect found at the end of a shift must behave
  // identically to one found at the start.
  const results = { items: [item({ condition: 'Defective', note: 'flat' })] };
  assert.deepEqual(correctiveActionsFromInspection(results, 'Kenworth T800'), [{
    description: 'Kenworth T800: Tires, wheels, lug nuts, and locks — flat',
    itemKey: 'tires, wheels, lug nuts, and locks',
  }]);
});

test('the OLD post-trip shape still opens nothing, and that is correct', () => {
  // Post-trips submitted before this change carry no items. They must not
  // start inventing corrective actions out of a free-text change note.
  const legacy = { hasChanges: true, changeCondition: 'Defective', changeNotes: 'tire went flat' };
  assert.deepEqual(correctiveActionsFromInspection(legacy, 'Kenworth T800'), []);
});

test('a trailer defect is labelled with the trailer, not the tow vehicle', () => {
  const [finding] = correctiveActionsFromInspection({
    items: [item({ condition: 'Defective', unit: 'trailer', unitLabel: '5x10 Dump Trailer (Unit 7)' })],
  }, 'Kenworth T800');
  assert.match(finding.description, /^5x10 Dump Trailer \(Unit 7\):/);
});

// ── 2. Carried-forward items must not double up ───────────────────────

test('a defect carried forward and still defective does not open a second action', () => {
  // The pre-trip already opened one. A second would double the supervisor's
  // open list AND push one stubborn fault over the 3-in-90-days threshold in
  // a single day, which is the opposite of what a pattern means.
  const out = correctiveActionsFromInspection({
    items: [item({ condition: 'Defective', carriedFrom: true, carriedCondition: 'Defective', resolution: 'still_open' })],
  }, 'Kenworth T800');
  assert.deepEqual(out, []);
});

test('a carried Monitor item that became Defective DOES open one', () => {
  // Monitor never opened an action, so there is nothing to double. The
  // machine genuinely deteriorated during the shift and somebody has to
  // action it.
  const out = correctiveActionsFromInspection({
    items: [item({ condition: 'Defective', carriedFrom: true, carriedCondition: 'Monitor', resolution: 'worse', note: 'now flat' })],
  }, 'Kenworth T800');
  assert.equal(out.length, 1);
  assert.match(out[0].description, /now flat/);
});

test('a brand new defect found on the post-trip opens one', () => {
  const out = correctiveActionsFromInspection({
    items: [
      item({ condition: 'Defective', carriedFrom: true, carriedCondition: 'Defective', resolution: 'still_open' }),
      item({ item: 'Coolant level', condition: 'Defective', note: 'low' }),
    ],
  }, 'Kenworth T800');
  assert.equal(out.length, 1);
  assert.equal(out[0].itemKey, 'coolant level');
});

// ── 3. What counts as "fixed" ─────────────────────────────────────────

test('only a carried item marked fixed is a resolution', () => {
  const resolved = resolvedItemsFromPosttrip({
    items: [
      item({ carriedFrom: true, resolution: 'fixed', resolutionNote: 'aired up and patched' }),
      item({ item: 'Coolant level', carriedFrom: true, resolution: 'still_open' }),
      item({ item: 'Engine oil level', carriedFrom: true, resolution: 'worse' }),
      // Not carried — an item the operator simply left at Good. It was never
      // an issue, so there is nothing to resolve.
      item({ item: 'Belts and hoses', condition: 'Good' }),
    ],
  });
  assert.deepEqual(resolved, [{
    itemKey: 'tires, wheels, lug nuts, and locks',
    item: 'Tires, wheels, lug nuts, and locks',
    note: 'aired up and patched',
  }]);
});

test('a legacy post-trip resolves nothing', () => {
  assert.deepEqual(resolvedItemsFromPosttrip({ hasChanges: false }), []);
  assert.deepEqual(resolvedItemsFromPosttrip(null), []);
});

// ── 4. Resolving is scoped to one machine ─────────────────────────────

// Minimal stand-in for the PostgREST builder, recording what was asked for.
//
// Thenable rather than promise-returning per call, because the code under
// test keeps chaining AFTER .in() — `query.in(...)` then `query.eq(...)`
// then `await query` — which is exactly how PostgREST builders behave and
// exactly what a fake that resolved on .in() would fail to catch.
function fakeSupabase({ openRows = [], readError = null, updateError = null } = {}) {
  const calls = { filters: {}, updated: null, updatedIds: null };
  const builder = {
    select() { return builder; },
    eq(col, val) { calls.filters[col] = val; return builder; },
    neq(col, val) { calls.filters[`not:${col}`] = val; return builder; },
    in(col, vals) {
      if (calls.updated) calls.updatedIds = vals;
      else calls.filters[col] = vals;
      return builder;
    },
    update(patch) { calls.updated = patch; return builder; },
    then(resolve, reject) {
      const result = calls.updated
        ? { data: null, error: updateError }
        : { data: openRows, error: readError };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return { from() { return builder; }, calls };
}

const openRow = (over = {}) => ({ id: 11, item_key: 'rear tire', company_id: 1, equipment_id: 7, equipment_label: 'Kenworth T800', ...over });

test('resolving scopes to the fleet id when the machine has one', async () => {
  const db = fakeSupabase({ openRows: [openRow()] });
  const closed = await resolveCorrectiveActionsForItems(db, {
    companyId: 1, equipmentId: 7, equipmentLabel: 'Kenworth T800',
    itemKeys: ['Rear  Tire'], resolvedBy: 'Rob', note: 'patched it',
  });

  assert.equal(closed.length, 1);
  assert.equal(closed[0].id, 11);
  // The machine is matched in JS with the same machineKey() the recurrence
  // count uses, so only the narrowing predicates reach the query.
  assert.deepEqual(db.calls.filters.item_key, ['rear tire'], 'keys are normalized before matching');
  assert.equal(db.calls.filters['not:status'], 'resolved');
  assert.equal(db.calls.filters.company_id, 1);
  assert.equal(db.calls.filters.source_type, 'equipment_inspection');
  assert.equal(db.calls.updated.status, 'resolved');
  assert.equal(db.calls.updated.resolution_source, 'posttrip');
  assert.equal(db.calls.updated.resolved_by, 'Rob');
  assert.equal(db.calls.updated.resolved_note, 'patched it');
  assert.deepEqual(db.calls.updatedIds, [11]);
});

test('a free-text machine matches only other free-text rows with that label', async () => {
  const db = fakeSupabase({ openRows: [openRow({ id: 12, equipment_id: null })] });
  const closed = await resolveCorrectiveActionsForItems(db, {
    companyId: 1, equipmentId: null, equipmentLabel: 'Kenworth T800', itemKeys: ['rear tire'],
  });
  assert.deepEqual(db.calls.updatedIds, [12]);
  assert.equal(closed.length, 1);
});

test('a typed label never closes a FLEET-REGISTERED machine sharing that label', async () => {
  // Found by tenant-scope-reviewer. equipment_label is written on every
  // equipment-sourced row, including ones that also carry an equipment_id.
  // A query-level `.eq('equipment_label', ...)` fallback therefore closed the
  // registered Unit 7's defects when a worker skipped the fleet dropdown and
  // typed the same words — and wrote NO repair line for them, because that
  // path needs an equipment_id. The action would vanish off the supervisor's
  // list with nothing behind it.
  const db = fakeSupabase({ openRows: [openRow({ id: 13, equipment_id: 7 })] });
  const closed = await resolveCorrectiveActionsForItems(db, {
    companyId: 1, equipmentId: null, equipmentLabel: 'Kenworth T800', itemKeys: ['rear tire'],
  });
  assert.deepEqual(closed, []);
  assert.equal(db.calls.updated, null);
});

test('a label differing only in case or spacing still closes', async () => {
  // `.eq` is an exact string match while machineKey() normalizes, so the two
  // used to disagree: "kenworth  t800" counted toward a recurrence group it
  // could never close. Closing and counting now use one definition.
  const db = fakeSupabase({ openRows: [openRow({ id: 14, equipment_id: null, equipment_label: 'Kenworth  T800' })] });
  const closed = await resolveCorrectiveActionsForItems(db, {
    companyId: 1, equipmentId: null, equipmentLabel: 'kenworth t800', itemKeys: ['rear tire'],
  });
  assert.deepEqual(db.calls.updatedIds, [14]);
  assert.equal(closed.length, 1);
});

test('a fleet machine never closes a different machine with the same label', async () => {
  const db = fakeSupabase({ openRows: [openRow({ id: 15, equipment_id: 8 })] });
  assert.deepEqual(await resolveCorrectiveActionsForItems(db, {
    companyId: 1, equipmentId: 7, equipmentLabel: 'Kenworth T800', itemKeys: ['rear tire'],
  }), []);
  assert.equal(db.calls.updated, null);
});

test('with no machine at all, nothing is resolved', async () => {
  // An unscoped resolve would close another machine's identically-named
  // defect. Fail closed.
  const db = fakeSupabase({ openRows: [openRow({ id: 16 })] });
  const closed = await resolveCorrectiveActionsForItems(db, {
    companyId: 1, equipmentId: null, equipmentLabel: '  ', itemKeys: ['rear tire'],
  });
  assert.deepEqual(closed, []);
  assert.equal(db.calls.updated, null);
});

test('with no company, nothing is resolved', async () => {
  const db = fakeSupabase({ openRows: [openRow({ id: 17 })] });
  assert.deepEqual(await resolveCorrectiveActionsForItems(db, { companyId: null, equipmentId: 7, itemKeys: ['rear tire'] }), []);
  assert.equal(db.calls.updated, null);
});

test('no matching open action means no update is attempted', async () => {
  const db = fakeSupabase({ openRows: [] });
  assert.deepEqual(await resolveCorrectiveActionsForItems(db, { companyId: 1, equipmentId: 7, itemKeys: ['rear tire'] }), []);
  assert.equal(db.calls.updated, null, 'an empty update would close nothing but still write');
});

test('a read failure is swallowed, never thrown at the worker', async () => {
  // The inspection is already saved by the time this runs. A worker on a
  // jobsite must not lose a finished post-trip because a follow-up row could
  // not be read — same best-effort discipline as every other writer here.
  const db = fakeSupabase({ readError: { message: 'boom', code: '500' } });
  assert.deepEqual(await resolveCorrectiveActionsForItems(db, { companyId: 1, equipmentId: 7, itemKeys: ['rear tire'] }), []);
});

test('a missing-column error degrades quietly instead of failing the submit', async () => {
  // If this code reaches production before
  // corrective-actions-equipment-recurrence-migration.sql runs, the resolve
  // is simply unavailable. Losing the post-trip itself is not acceptable.
  const db = fakeSupabase({ readError: { message: 'column "item_key" does not exist', code: '42703' } });
  assert.deepEqual(await resolveCorrectiveActionsForItems(db, { companyId: 1, equipmentId: 7, itemKeys: ['rear tire'] }), []);
});

// ── 5. The Company Brain must not double-count one fault ──────────────

// api/logs.js builds a Supabase client at module load, which throws on an
// undefined URL. Same stubs tests/unit/brain-signal-capture.test.js uses —
// nothing here makes a request.
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1/';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { inspectionFindingSignal } = await import('../../api/logs.js');

test('a carried fault that has not changed contributes no second Brain signal', () => {
  // A post-trip now carries a full checklist, so the Brain reads both halves
  // of a trip. A defect the pre-trip reported and the post-trip confirms is
  // still there is ONE fault on ONE machine — tallying it twice makes
  // whatever a machine breaks most often look twice as common as it is.
  const signal = inspectionFindingSignal({
    equipment_label: 'Kenworth T800',
    results_json: {
      items: [
        item({ condition: 'Defective', carriedFrom: true, carriedCondition: 'Defective', resolution: 'still_open' }),
        item({ item: 'Coolant level', condition: 'Monitor', carriedFrom: true, carriedCondition: 'Monitor', resolution: 'still_open' }),
      ],
    },
  });
  assert.equal(signal, null, 'nothing changed during the shift, so there is nothing new to learn');
});

test('a carried fault that got WORSE during the shift is new signal', () => {
  const signal = inspectionFindingSignal({
    equipment_label: 'Kenworth T800',
    results_json: {
      items: [item({ condition: 'Defective', carriedFrom: true, carriedCondition: 'Monitor', resolution: 'worse' })],
    },
  });
  assert.deepEqual(signal.defective, ['Tires, wheels, lug nuts, and locks']);
});

test('a fault that first appeared on the post-trip is signal', () => {
  const signal = inspectionFindingSignal({
    equipment_label: 'Kenworth T800',
    results_json: { items: [item({ item: 'Coolant level', condition: 'Defective' })] },
  });
  assert.deepEqual(signal.defective, ['Coolant level']);
  assert.equal(signal.equipment, 'Kenworth T800');
});

test('a pre-trip is unaffected — it has no carried items', () => {
  const signal = inspectionFindingSignal({
    equipment_label: 'CAT 336',
    results_json: { items: [item({ condition: 'Defective' }), item({ item: 'Belts', condition: 'Monitor' })] },
  });
  assert.deepEqual(signal.defective, ['Tires, wheels, lug nuts, and locks']);
  assert.deepEqual(signal.monitor, ['Belts']);
});
