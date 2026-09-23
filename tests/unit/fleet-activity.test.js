// Breaks #13 and #18, the pure halves.
//
// #13: daily_reports.equipment_ids was written, vetted and read by nothing.
// Fleet Overview now answers "when was this machine last on site, and where"
// from it (Dillon, 2026-09-23: Fleet Overview first).
//
// #18 (Dillon, 2026-09-23): attachments don't get a PM schedule unless
// they're a trailer; a trailer's clock runs on the distance it was towed.
// Fleet Overview shows what each attachment was last mounted on, and
// analytics names the most used and most repaired attachment.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  lastOnSiteByEquipment,
  mountedOnByAttachment,
  attachmentStats,
  towedDistanceSince,
  pmAllowedFor,
} = await import('../../server-lib/fleetActivity.js');

// ── #13: last on site ─────────────────────────────────────────────────────

test('the latest daily report naming a machine gives its last day on site', () => {
  const out = lastOnSiteByEquipment([
    { equipment_ids: [3, 12], site: 'Hwy 2 Overpass', report_date: '2026-09-10', created_at: '2026-09-10T23:00:00Z' },
    { equipment_ids: [3], site: 'North Pit', report_date: '2026-09-18', created_at: '2026-09-18T23:00:00Z' },
  ]);
  assert.deepEqual(out[3], { date: '2026-09-18', site: 'North Pit' });
  assert.deepEqual(out[12], { date: '2026-09-10', site: 'Hwy 2 Overpass' });
});

test('a report with no ids, or a non-array, is ignored rather than thrown on', () => {
  const out = lastOnSiteByEquipment([{ equipment_ids: null, site: 'x', report_date: '2026-09-01' }, { equipment_ids: 'oops' }]);
  assert.deepEqual({ ...out }, {});
});

// ── #18: mounted on ───────────────────────────────────────────────────────

const pretrip = (over) => ({ trip_type: 'pretrip', start_reading: null, end_reading: null, reading_unit: 'KM', ...over });

test('an attachment shows the machine on its most recent pre-trip', () => {
  const out = mountedOnByAttachment([
    pretrip({ id: 1, equipment_id: 3, equipment_label: 'Loader 3', created_at: '2026-09-10T13:00:00Z', results_json: { attachments: [{ id: 12, label: 'Forks 12' }] } }),
    pretrip({ id: 2, equipment_id: 5, equipment_label: 'Loader 5', created_at: '2026-09-15T13:00:00Z', results_json: { attachments: [{ id: 12, label: 'Forks 12' }] } }),
  ]);
  assert.deepEqual(out[12], { hostId: 5, hostLabel: 'Loader 5', at: '2026-09-15T13:00:00Z' });
});

test('a legacy attachedTrailer record counts too', () => {
  const out = mountedOnByAttachment([
    pretrip({ id: 1, equipment_id: 8, equipment_label: 'Kenworth 8', created_at: '2026-09-01T13:00:00Z', results_json: { attachedTrailer: { id: 40, label: 'Dump Trailer 40' } } }),
  ]);
  assert.equal(out[40].hostLabel, 'Kenworth 8');
});

// ── #18: trailer PM runs on towed distance ────────────────────────────────

const TRAILER = 40;
const trip = (pretripId, posttripId, day, start, end, attachments) => [
  pretrip({ id: pretripId, equipment_id: 8, equipment_label: 'Kenworth 8', created_at: `2026-09-${day}T13:00:00Z`, results_json: { attachments } }),
  { id: posttripId, trip_type: 'posttrip', linked_inspection_id: pretripId, equipment_id: 8, start_reading: String(start), end_reading: String(end), reading_unit: 'KM', created_at: `2026-09-${day}T23:00:00Z`, results_json: {} },
];

test('a trailer is credited the distance of every trip it was towed on, since the service date', () => {
  const rows = [
    ...trip(1, 2, '05', 1000, 1300, [{ id: TRAILER, label: 'Dump Trailer 40' }]), // before service: not counted
    ...trip(3, 4, '12', 1300, 1450, [{ id: TRAILER, label: 'Dump Trailer 40' }]),
    ...trip(5, 6, '13', 1450, 1500, []), // trailer not attached
    ...trip(7, 8, '14', 1500, 1620, [{ id: TRAILER, label: 'Dump Trailer 40' }]),
  ];
  const out = towedDistanceSince(rows, TRAILER, '2026-09-10');
  assert.equal(out.distance, 270);
  assert.equal(out.trips, 2);
  assert.equal(out.unit, 'KM');
});

test('an hour-metered tow vehicle credits a trailer nothing, since hours are not distance', () => {
  const rows = trip(1, 2, '12', 100, 108, [{ id: TRAILER, label: 'Dump Trailer 40' }]).map(r => ({ ...r, reading_unit: 'Hours' }));
  assert.equal(towedDistanceSince(rows, TRAILER, '2026-09-01').distance, 0);
});

test('only trailers may carry a PM schedule among attachments', () => {
  assert.equal(pmAllowedFor({ is_attachment: false, type: 'Excavator' }), true);
  assert.equal(pmAllowedFor({ is_attachment: true, type: 'Dump Trailer' }), true);
  assert.equal(pmAllowedFor({ is_attachment: true, type: 'Pallet Forks' }), false);
  assert.equal(pmAllowedFor({ is_attachment: true, type: 'Hydraulic Hammer' }), false);
});

// ── #18: most used / most repaired ────────────────────────────────────────

test('attachment stats count trips and repairs, attachments only, busiest first', () => {
  const fleet = [
    { id: 3, is_attachment: false, label: 'Loader 3' },
    { id: 12, is_attachment: true, label: 'Forks 12' },
    { id: 13, is_attachment: true, label: 'Bucket 13' },
  ];
  const inspections = [
    pretrip({ id: 1, equipment_id: 3, created_at: '2026-09-10T13:00:00Z', results_json: { attachments: [{ id: 12, label: 'Forks 12' }] } }),
    pretrip({ id: 2, equipment_id: 3, created_at: '2026-09-11T13:00:00Z', results_json: { attachments: [{ id: 12, label: 'Forks 12' }, { id: 13, label: 'Bucket 13' }] } }),
  ];
  const logs = [
    { equipment_id: 13, entry_type: 'field_service' },
    { equipment_id: 13, entry_type: 'field_service' },
    { equipment_id: 12, entry_type: 'field_service' },
    { equipment_id: 3, entry_type: 'field_service' },
  ];
  const out = attachmentStats(fleet, inspections, logs);
  assert.deepEqual(out.mostUsed.map(a => [a.equipmentId, a.trips]), [[12, 2], [13, 1]]);
  assert.deepEqual(out.mostRepaired.map(a => [a.equipmentId, a.repairs]), [[13, 2], [12, 1]]);
});
