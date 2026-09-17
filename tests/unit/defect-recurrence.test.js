// Pins "this keeps happening" detection for equipment defects.
//
// Dillon, 2026-09-17, after flagging a flat tire on a pre-trip and finding
// nothing anywhere that said the unit had had one before:
//
//   "3 low tire corrective actions in a row should flag something as a
//    pattern to say 'hey maybe this tire needs to be repaired or replaced'"
//
// What these cases exist to stop coming back:
//   * a fault nobody has fixed yet reporting itself as RECURRING, which
//     would turn "replace the tire" into a restatement of "nobody fixed the
//     tire" and train a supervisor to ignore the badge;
//   * a machine picked from the fleet on Monday and typed by hand on
//     Tuesday counting as two machines (or, keyed the other way, two
//     different machines with the same label counting as one);
//   * the same checklist line under two spellings of whitespace or case
//     counting separately — the failure that reads exactly like "no
//     pattern";
//   * the window silently disappearing, so a machine sits permanently
//     flagged for a fault properly fixed two years ago.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  normalizeItemKey,
  machineKey,
  recurrenceKey,
  summarizeRecurrence,
  annotateRecurrence,
  patternsByEquipment,
  RECURRENCE_THRESHOLD,
  RECURRENCE_WINDOW_DAYS,
} = await import('../../server-lib/recurrence.js');

const NOW = Date.parse('2026-09-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

const action = (over = {}) => ({
  id: over.id ?? Math.random(),
  company_id: 1,
  source_type: 'equipment_inspection',
  equipment_id: 7,
  equipment_label: 'Kenworth T800 (Unit 3)',
  item_key: 'tires, wheels, lug nuts, and locks',
  description: 'Kenworth T800 (Unit 3): Tires, wheels, lug nuts, and locks — low',
  status: 'resolved',
  created_at: daysAgo(1),
  ...over,
});

// ── Keys ──────────────────────────────────────────────────────────────

test('item keys normalize case and whitespace', () => {
  assert.equal(normalizeItemKey('  Rear   Tire  '), 'rear tire');
  assert.equal(normalizeItemKey('Rear Tire'), normalizeItemKey('rear\ttire'));
  assert.equal(normalizeItemKey(''), null);
  assert.equal(normalizeItemKey(null), null);
});

test('the normalizer matches what the migration backfill does in SQL', () => {
  // docs/schema/corrective-actions-equipment-recurrence-migration.sql uses
  // lower(btrim(regexp_replace(item, '\\s+', ' ', 'g'))). If these two ever
  // drift, a backfilled row and a freshly written one describe the same
  // checklist line under two keys and never count together.
  const sqlEquivalent = (raw) => raw.replace(/\s+/g, ' ').replace(/^ | $/g, '').toLowerCase();
  for (const sample of ['  Engine oil level ', 'Belts,\tpulleys,  hoses', 'ROPS/FOPS structure']) {
    assert.equal(normalizeItemKey(sample), sqlEquivalent(sample));
  }
});

test('a fleet machine keys on its id and a free-text one on its label', () => {
  assert.equal(machineKey({ equipment_id: 7, equipment_label: 'X' }), 'id:7');
  assert.equal(machineKey({ company_id: 1, equipment_id: null, equipment_label: ' Kenworth  T800 ' }), 'co:1|label:kenworth t800');
  assert.equal(machineKey({ company_id: 1, equipment_id: null, equipment_label: '' }), null);
});

test('the two key spaces never collide', () => {
  // A free-text machine whose label happens to read like an id must not be
  // counted against the registered machine with that id.
  assert.notEqual(machineKey({ equipment_id: 7 }), machineKey({ company_id: 1, equipment_label: '7' }));
});

test('two companies typing the same machine label never merge', () => {
  // api/monthly.js runs the reducer over whatever list_corrective_actions
  // returned, which for an ADMIN session is every company at once. Without
  // the company in the label key, two tenants each reporting a flat tire
  // twice on their own "Kenworth T800" merge into one group of four and
  // report a pattern that exists in neither — built out of another tenant's
  // data.
  const free = (company_id, id) => action({ id, company_id, equipment_id: null, equipment_label: 'Kenworth T800', created_at: daysAgo(id) });
  const groups = summarizeRecurrence([free(1, 1), free(1, 2), free(2, 3), free(2, 4)], { now: NOW });
  assert.equal(groups.size, 2);
  for (const group of groups.values()) {
    assert.equal(group.count, 2);
    assert.equal(group.isPattern, false);
  }
});

test('a fleet id needs no company key, because it already is one', () => {
  // equipment.id is a global primary key. Adding the company would be
  // harmless but would imply an id can be ambiguous, which it cannot.
  assert.equal(machineKey({ company_id: 1, equipment_id: 7 }), machineKey({ company_id: 2, equipment_id: 7 }));
});

test('an action with no machine or no item is ungroupable, not bucketed', () => {
  // Every monthly answer, every incident, and every equipment row written
  // before the migration lands here. Bucketing them into a catch-all would
  // report a "pattern" made of unrelated findings.
  assert.equal(recurrenceKey({ equipment_id: 7, item_key: null }), null);
  assert.equal(recurrenceKey({ equipment_id: null, equipment_label: null, item_key: 'rear tire' }), null);
  assert.equal(recurrenceKey(action()), 'id:7|tires, wheels, lug nuts, and locks');
});

// ── Counting ──────────────────────────────────────────────────────────

test('three of the same fault on the same machine inside the window is a pattern', () => {
  const groups = summarizeRecurrence([
    action({ id: 1, created_at: daysAgo(60) }),
    action({ id: 2, created_at: daysAgo(30) }),
    action({ id: 3, created_at: daysAgo(2), status: 'open' }),
  ], { now: NOW });

  const group = groups.get('id:7|tires, wheels, lug nuts, and locks');
  assert.equal(group.count, 3);
  assert.equal(group.openCount, 1);
  assert.equal(group.isPattern, true);
  assert.equal(group.firstSeen, daysAgo(60));
  assert.equal(group.lastSeen, daysAgo(2));
});

test('two is not a pattern', () => {
  const groups = summarizeRecurrence([
    action({ id: 1, created_at: daysAgo(10) }),
    action({ id: 2, created_at: daysAgo(2) }),
  ], { now: NOW });
  assert.equal(groups.get('id:7|tires, wheels, lug nuts, and locks').isPattern, false);
});

test('resolved actions count toward a pattern — that is the whole point', () => {
  // Three flat tires in a quarter is a pattern precisely BECAUSE somebody
  // fixed the first two. Counting only open ones would mean a machine that
  // gets patched up every week never trips the threshold.
  const groups = summarizeRecurrence([
    action({ id: 1, status: 'resolved', created_at: daysAgo(50) }),
    action({ id: 2, status: 'resolved', created_at: daysAgo(25) }),
    action({ id: 3, status: 'resolved', created_at: daysAgo(3) }),
  ], { now: NOW });
  assert.equal(groups.get('id:7|tires, wheels, lug nuts, and locks').isPattern, true);
});

test('an occurrence outside the window does not count', () => {
  const groups = summarizeRecurrence([
    action({ id: 1, created_at: daysAgo(400) }),
    action({ id: 2, created_at: daysAgo(200) }),
    action({ id: 3, created_at: daysAgo(1) }),
  ], { now: NOW });
  const group = groups.get('id:7|tires, wheels, lug nuts, and locks');
  assert.equal(group.count, 1);
  assert.equal(group.isPattern, false);
});

test('different faults on one machine do not add up', () => {
  const groups = summarizeRecurrence([
    action({ id: 1, item_key: 'rear tire' }),
    action({ id: 2, item_key: 'engine oil level' }),
    action({ id: 3, item_key: 'coolant level' }),
  ], { now: NOW });
  assert.equal(groups.size, 3);
  for (const group of groups.values()) assert.equal(group.isPattern, false);
});

test('the same fault on different machines does not add up', () => {
  const groups = summarizeRecurrence([
    action({ id: 1, equipment_id: 7 }),
    action({ id: 2, equipment_id: 8 }),
    action({ id: 3, equipment_id: 9 }),
  ], { now: NOW });
  assert.equal(groups.size, 3);
  for (const group of groups.values()) assert.equal(group.isPattern, false);
});

test('an action with an unreadable timestamp is skipped, not assumed recent', () => {
  // Counting it would inflate a pattern that might be years old.
  const groups = summarizeRecurrence([
    action({ id: 1, created_at: daysAgo(5) }),
    action({ id: 2, created_at: daysAgo(4) }),
    action({ id: 3, created_at: 'not a date' }),
    action({ id: 4, created_at: null }),
  ], { now: NOW });
  assert.equal(groups.get('id:7|tires, wheels, lug nuts, and locks').count, 2);
});

test('monthly answers and incidents are left out entirely', () => {
  const groups = summarizeRecurrence([
    { id: 1, source_type: 'monthly_answer', created_at: daysAgo(1), description: 'Fire extinguisher missing' },
    { id: 2, source_type: 'incident', created_at: daysAgo(2), description: 'Re-train crew' },
    { id: 3, source_type: 'near_miss', created_at: daysAgo(3), description: 'Re-train crew' },
  ], { now: NOW });
  assert.equal(groups.size, 0);
});

// ── Annotation and the per-machine view ───────────────────────────────

test('every grouped action is annotated, below the threshold too', () => {
  // "2nd time in 90 days" is useful context on a single action even before
  // it becomes a pattern; the UI decides how loudly to say it.
  const out = annotateRecurrence([
    action({ id: 1, created_at: daysAgo(10) }),
    action({ id: 2, created_at: daysAgo(2) }),
    { id: 3, source_type: 'incident', created_at: daysAgo(1), description: 'x' },
  ], { now: NOW });

  assert.equal(out[0].recurrence.count, 2);
  assert.equal(out[0].recurrence.isPattern, false);
  assert.equal(out[1].recurrence.count, 2);
  assert.equal(out[2].recurrence, null, 'an incident has nothing to count against');
});

test('the annotation reports the window and threshold it used', () => {
  const [one] = annotateRecurrence([action({ id: 1 })], { now: NOW });
  assert.equal(one.recurrence.windowDays, RECURRENCE_WINDOW_DAYS);
  assert.equal(one.recurrence.threshold, RECURRENCE_THRESHOLD);
  assert.equal(RECURRENCE_THRESHOLD, 3);
  assert.equal(RECURRENCE_WINDOW_DAYS, 90);
});

test('only patterns reach the per-machine list, keyed by fleet id', () => {
  const byEquipment = patternsByEquipment([
    action({ id: 1, equipment_id: 7, created_at: daysAgo(40) }),
    action({ id: 2, equipment_id: 7, created_at: daysAgo(20) }),
    action({ id: 3, equipment_id: 7, created_at: daysAgo(1) }),
    action({ id: 4, equipment_id: 8, item_key: 'engine oil level' }),
  ], { now: NOW });

  assert.deepEqual(Object.keys(byEquipment), ['7']);
  assert.equal(byEquipment[7].length, 1);
  assert.equal(byEquipment[7][0].count, 3);
});

test('a free-text machine gets no per-machine row but is still annotated', () => {
  // The maintenance screen lists the REGISTERED fleet, so there is no row to
  // hang a free-text machine's pattern on. Dropping the annotation as well
  // would hide it everywhere, so the corrective action still carries it.
  const rows = [
    action({ id: 1, equipment_id: null, created_at: daysAgo(30) }),
    action({ id: 2, equipment_id: null, created_at: daysAgo(15) }),
    action({ id: 3, equipment_id: null, created_at: daysAgo(1) }),
  ];
  assert.deepEqual(patternsByEquipment(rows, { now: NOW }), {});
  assert.equal(annotateRecurrence(rows, { now: NOW })[0].recurrence.isPattern, true);
});
