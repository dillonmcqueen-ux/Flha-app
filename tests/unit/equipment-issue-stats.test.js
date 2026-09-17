// Pins Equipment Analytics to counting every inspection, not just pre-trips.
//
// equipmentIssueStats used to open with `if (i.trip_type !== "pretrip")
// return;`, justified by a comment claiming "defectiveCount/monitorCount
// only exist on pretrip results_json (posttrip rows don't have them)."
// That was false as shipped — src/Inspection.jsx's submitPosttrip writes
// both counters from the operator's reported change.
//
// The cost was real and silent: the one screen meant to answer "which
// machine keeps failing" could not see damage caught at the END of a
// shift, which is when in-service damage actually surfaces. And three
// readers disagreed about one number — Dashboard.jsx's "Defective items"
// KPI summed both trip types, this summed pre-trip only, and
// api/equipmentreports.js counted post-trip changes a third way. A
// supervisor comparing the Inspections tab against the Analytics tab saw
// two different numbers for the same company with nothing explaining it.
//
// What these cases exist to stop coming back: a trip-type filter
// reappearing here, and this drifting back out of agreement with the
// Dashboard KPI.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { equipmentIssueStats } = await import('../../src/analyticsUtils.js');

const pretrip = (label, defective, monitor, at = '2026-09-01T08:00:00Z') => ({
  trip_type: 'pretrip', equipment_label: label, created_at: at,
  results_json: { defectiveCount: defective, monitorCount: monitor },
});
const posttrip = (label, condition, at = '2026-09-01T18:00:00Z') => ({
  trip_type: 'posttrip', equipment_label: label, created_at: at,
  results_json: {
    hasChanges: !!condition,
    changeCondition: condition,
    defectiveCount: condition === 'Defective' ? 1 : 0,
    monitorCount: condition === 'Monitor' ? 1 : 0,
  },
});

test('post-trip damage is counted, not dropped', () => {
  // The whole point of the fix. Before, this returned an empty array.
  const stats = equipmentIssueStats([posttrip('CAT 336 (Unit 12)', 'Defective')]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].defective, 1);
  assert.equal(stats[0].inspectionCount, 1);
});

test('pre-trip and post-trip findings on one machine add up', () => {
  const stats = equipmentIssueStats([
    pretrip('CAT 336 (Unit 12)', 1, 1),
    posttrip('CAT 336 (Unit 12)', 'Defective'),
    posttrip('CAT 336 (Unit 12)', 'Monitor'),
  ]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].defective, 2);
  assert.equal(stats[0].monitor, 2);
  assert.equal(stats[0].inspectionCount, 3);
});

test('a clean post-trip still counts as an inspection but flags nothing', () => {
  const stats = equipmentIssueStats([posttrip('Kenworth T800', null)]);
  assert.equal(stats[0].inspectionCount, 1);
  assert.equal(stats[0].defective, 0);
  assert.equal(stats[0].monitor, 0);
  assert.equal(stats[0].lastFlaggedAt, null);
});

test('lastFlaggedAt can come from a post-trip', () => {
  // A machine inspected clean in the morning and damaged by evening should
  // report the evening as its last flagged time, not "never flagged".
  const stats = equipmentIssueStats([
    pretrip('CAT 336 (Unit 12)', 0, 0, '2026-09-10T08:00:00Z'),
    posttrip('CAT 336 (Unit 12)', 'Defective', '2026-09-10T18:00:00Z'),
  ]);
  assert.equal(stats[0].lastFlaggedAt, '2026-09-10T18:00:00Z');
});

test('machines are ranked by total findings across both trip types', () => {
  const stats = equipmentIssueStats([
    pretrip('Quiet machine', 1, 0),
    posttrip('Broken machine', 'Defective'),
    posttrip('Broken machine', 'Defective'),
    posttrip('Broken machine', 'Monitor'),
  ]);
  assert.equal(stats[0].label, 'Broken machine');
  assert.equal(stats[0].defective + stats[0].monitor, 3);
});

test('this agrees with the Dashboard KPI, which sums both trip types', () => {
  // src/Dashboard.jsx's StatStrip reduces results_json.defectiveCount over
  // every inspection with no trip-type filter. The two surfaces must
  // reconcile — them disagreeing silently is what this whole change fixed.
  const inspections = [
    pretrip('A', 2, 1),
    posttrip('A', 'Defective'),
    posttrip('B', 'Monitor'),
    pretrip('B', 0, 3),
  ];
  const dashboardDefective = inspections.reduce((n, i) => n + (i.results_json?.defectiveCount || 0), 0);
  const dashboardMonitor = inspections.reduce((n, i) => n + (i.results_json?.monitorCount || 0), 0);

  const stats = equipmentIssueStats(inspections);
  const analyticsDefective = stats.reduce((n, e) => n + e.defective, 0);
  const analyticsMonitor = stats.reduce((n, e) => n + e.monitor, 0);

  assert.equal(analyticsDefective, dashboardDefective);
  assert.equal(analyticsMonitor, dashboardMonitor);
});

test('an unlabeled machine is still counted', () => {
  const stats = equipmentIssueStats([posttrip('', 'Defective'), posttrip('   ', 'Monitor')]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].label, 'Unlabeled equipment');
  assert.equal(stats[0].inspectionCount, 2);
});

test('a missing results_json does not throw', () => {
  const stats = equipmentIssueStats([{ trip_type: 'posttrip', equipment_label: 'X', created_at: '2026-09-01T00:00:00Z' }]);
  assert.equal(stats[0].defective, 0);
  assert.equal(stats[0].inspectionCount, 1);
});
