// Pins the attachment rules, on both sides of the shape change.
//
// `results_json.attachedTrailer` (one trailer, or null) and
// `results_json.attachments` ([{ id, label }]) are both live at once, and
// will be for years: every inspection already submitted carries the first
// spelling, and those are signed safety records that get re-rendered and
// re-reported rather than rewritten.
//
// What these cases exist to stop coming back:
//   * a legacy record silently losing its trailer — no error, the trailer
//     just stops appearing on the PDF and stops being credited any hours;
//   * a defect landing on the machine instead of the attachment it was
//     flagged against, which is how a bad trailer tire reads as a fault on
//     whatever truck happened to be pulling it that day;
//   * two attachments sharing a label and a defect being routed by that
//     label alone — the same ambiguity break #7 exists to prevent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1/';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SESSION_SECRET ||= 'test-session-secret';

const { inspectionAttachments, attachmentForItem } = await import('../../server-lib/inspectionAttachments.js');
const { foldWeeklyUsage } = await import('../../api/equipmentreports.js');

// ── reading both shapes ─────────────────────────────────────────────────

test('a legacy attachedTrailer reads as one attachment', () => {
  assert.deepEqual(
    inspectionAttachments({ attachedTrailer: { id: 3, label: '5x10 Dump Trailer' } }),
    [{ id: 3, label: '5x10 Dump Trailer' }],
  );
});

test('a new attachments array reads through as-is', () => {
  const list = [{ id: 3, label: 'Dump Trailer' }, { id: 4, label: 'Forks' }];
  assert.deepEqual(inspectionAttachments({ attachments: list }), list);
});

test('an empty attachments array means nothing attached, and does not fall back to the legacy field', () => {
  // A record written by the new client saying "nothing attached" means it.
  // Falling back here would resurrect a trailer the worker removed.
  assert.deepEqual(inspectionAttachments({ attachments: [], attachedTrailer: { id: 3, label: 'Dump Trailer' } }), []);
});

test('nothing attached, a null trailer, and a junk results_json all read as no attachments', () => {
  assert.deepEqual(inspectionAttachments({}), []);
  assert.deepEqual(inspectionAttachments({ attachedTrailer: null }), []);
  assert.deepEqual(inspectionAttachments(null), []);
  assert.deepEqual(inspectionAttachments('nope'), []);
});

test('an attachment with no label is dropped — a label is the minimum needed to name it on a report', () => {
  assert.deepEqual(inspectionAttachments({ attachments: [{ id: 3 }, { id: 4, label: 'Forks' }] }), [{ id: 4, label: 'Forks' }]);
});

// ── routing a defect back to the right machine ──────────────────────────

test('a machine item belongs to the machine, never to an attachment', () => {
  const attachments = [{ id: 3, label: 'Dump Trailer' }];
  assert.equal(attachmentForItem({ unit: 'truck', item: 'Brakes' }, attachments), null);
});

test('an attachment item routes by id, not by label', () => {
  // Two attachments, one label. Only the id can tell them apart, which is
  // exactly the case label matching gets wrong.
  const attachments = [{ id: 3, label: 'Dump Trailer' }, { id: 4, label: 'Dump Trailer' }];
  const hit = attachmentForItem({ unit: 'attachment', unitLabel: 'Dump Trailer', attachmentId: 4 }, attachments);
  assert.equal(hit.id, 4);
});

test('an id that round-tripped through jsonb as a string still matches its attachment', () => {
  const attachments = [{ id: 3, label: 'Dump Trailer' }];
  assert.equal(attachmentForItem({ unit: 'attachment', attachmentId: '3' }, attachments).id, 3);
});

test('a free-typed attachment has no id and routes by label', () => {
  const attachments = [{ id: null, label: 'Rental Tilt Deck' }, { id: 4, label: 'Forks' }];
  assert.equal(attachmentForItem({ unit: 'attachment', unitLabel: 'Rental Tilt Deck' }, attachments).label, 'Rental Tilt Deck');
});

test('a legacy trailer item, which carries no id at all, still routes to the one attachment', () => {
  const attachments = [{ id: 3, label: '5x10 Dump Trailer' }];
  assert.equal(attachmentForItem({ unit: 'trailer' }, attachments).id, 3);
});

test('an unmatchable attachment item on a multi-attachment record routes nowhere rather than guessing', () => {
  const attachments = [{ id: 3, label: 'Dump Trailer' }, { id: 4, label: 'Forks' }];
  assert.equal(attachmentForItem({ unit: 'attachment', unitLabel: 'Mulcher' }, attachments), null);
});

// ── weekly usage ────────────────────────────────────────────────────────

const weekOf = () => '2026-09-14'; // every row lands in one week unless a test says otherwise

test('usage is the completed trip delta, and an unfinished trip counts nothing', () => {
  const machines = foldWeeklyUsage([
    { id: 1, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'pretrip', start_reading: '100', created_at: '2026-09-15T08:00:00Z' },
    { id: 2, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'posttrip', linked_inspection_id: 1, start_reading: '100', end_reading: '180', reading_unit: 'KM', created_at: '2026-09-15T17:00:00Z' },
    { id: 3, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'pretrip', start_reading: '180', created_at: '2026-09-16T08:00:00Z' },
  ], weekOf);
  assert.equal(machines.length, 1);
  assert.equal(machines[0].total, 80);
  assert.equal(machines[0].unit, 'KM');
});

test('a towed unit is credited the distance whatever pulled it logged', () => {
  // A trailer has no meter. Without this it reads zero forever, which looks
  // like an answer rather than a gap.
  const machines = foldWeeklyUsage([
    { id: 1, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'pretrip', start_reading: '100', created_at: '2026-09-15T08:00:00Z',
      results_json: { attachments: [{ id: 9, label: '5x10 Dump Trailer' }] } },
    { id: 2, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'posttrip', linked_inspection_id: 1, start_reading: '100', end_reading: '180', reading_unit: 'KM', created_at: '2026-09-15T17:00:00Z' },
  ], weekOf);
  const trailer = machines.find(m => m.equipmentId === 9);
  assert.equal(trailer.total, 80);
  assert.equal(machines.find(m => m.equipmentId === 7).total, 80);
});

test('a legacy attachedTrailer is credited the same way', () => {
  const machines = foldWeeklyUsage([
    { id: 1, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'pretrip', start_reading: '0', created_at: '2026-09-15T08:00:00Z',
      results_json: { attachedTrailer: { id: 9, label: '5x10 Dump Trailer' } } },
    { id: 2, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'posttrip', linked_inspection_id: 1, start_reading: '0', end_reading: '50', reading_unit: 'KM', created_at: '2026-09-15T17:00:00Z' },
  ], weekOf);
  assert.equal(machines.find(m => m.equipmentId === 9).total, 50);
});

test('usage lands in the week the trip was FINISHED, not when it started', () => {
  const byPosttrip = (createdAt) => (createdAt === '2026-09-14T02:00:00Z' ? '2026-09-14' : '2026-09-07');
  const machines = foldWeeklyUsage([
    { id: 1, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'pretrip', start_reading: '0', created_at: '2026-09-13T20:00:00Z' },
    { id: 2, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'posttrip', linked_inspection_id: 1, start_reading: '0', end_reading: '9', reading_unit: 'Hours', created_at: '2026-09-14T02:00:00Z' },
  ], byPosttrip);
  assert.deepEqual(machines[0].weeks, { '2026-09-14': 9 });
});

test('a reading that went backwards is ignored rather than counted as negative usage', () => {
  // A meter rollover or a typo, not a machine that un-worked nine hours.
  const machines = foldWeeklyUsage([
    { id: 2, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'posttrip', start_reading: '180', end_reading: '100', reading_unit: 'KM', created_at: '2026-09-15T17:00:00Z' },
  ], weekOf);
  assert.equal(machines.length, 0);
});

test('a free-text row merges onto the fleet machine its label points at', () => {
  // Same reconciliation the weekly report does: picked from the list on
  // Monday and typed by hand on Tuesday is still one machine.
  const machines = foldWeeklyUsage([
    { id: 1, equipment_id: 7, equipment_label: 'Truck 12', trip_type: 'posttrip', start_reading: '0', end_reading: '10', reading_unit: 'KM', created_at: '2026-09-15T17:00:00Z' },
    { id: 2, equipment_id: null, equipment_label: 'Truck 12', trip_type: 'posttrip', start_reading: '10', end_reading: '25', reading_unit: 'KM', created_at: '2026-09-16T17:00:00Z' },
  ], weekOf);
  assert.equal(machines.length, 1);
  assert.equal(machines[0].total, 25);
});
