// Pins which reading a weekly equipment-report line ends the week on.
//
// Break #1's second half. api/maintenance.js has computed preventative
// maintenance from BOTH inspection readings and fuel-log readings since
// PR #118, but the weekly equipment report went on reading inspections
// alone -- so a machine fuelled on Friday after its last post-trip showed a
// Thursday odometer to the supervisor billing from it.
//
// The trap this file exists to stop coming back: "usage" and "ending
// reading" are two different questions, and closing this break by feeding
// fuel logs into BOTH is the obvious wrong fix. A fuel-up is a
// point-in-time odometer, not a trip, so adding it to a sum of trip deltas
// either double-counts or invents usage that never happened.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1/';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SESSION_SECRET ||= 'test-session-secret';

const { applyLatestReadings } = await import('../../api/equipmentreports.js');

const entry = (o = {}) => ({
  equipmentId: 8, equipmentLabel: 'Truck 12', unit: 'hrs',
  usage: 100, endingReading: 1100, endingReadingDate: '2026-09-10T17:00:00Z',
  issues: [], noPostTripCount: 0, attachments: [], ...o,
});
const posttrip = (o) => ({ trip_type: 'posttrip', equipment_id: 8, reading_unit: 'hrs', ...o });
const fuel = (o) => ({ equipment_id: 8, reading_unit: 'hrs', ...o });

test('a Friday fuel-up after the last post-trip becomes the ending reading', () => {
  const by = { 'eq:8': entry() };
  applyLatestReadings(by, [posttrip({ id: 1, start_reading: 1000, end_reading: 1100, created_at: '2026-09-10T17:00:00Z' })],
    [fuel({ id: 5, hour_reading: 1255, created_at: '2026-09-11T08:00:00Z' })]);
  assert.equal(by['eq:8'].endingReading, 1255);
  assert.equal(by['eq:8'].endingReadingDate, '2026-09-11T08:00:00Z');
  assert.equal(by['eq:8'].endingReadingSource, 'fuel_log');
});

test('usage is NOT touched — a fuel-up is an odometer, not a trip', () => {
  const by = { 'eq:8': entry({ usage: 100 }) };
  applyLatestReadings(by, [posttrip({ id: 1, start_reading: 1000, end_reading: 1100, created_at: '2026-09-10T17:00:00Z' })],
    [fuel({ id: 5, hour_reading: 1255, created_at: '2026-09-11T08:00:00Z' })]);
  // 1255 - 1000 = 255 would be the tempting number. It is not usage: nothing
  // says the machine ran those hours inside this week's logged trips.
  assert.equal(by['eq:8'].usage, 100);
});

test('an older fuel-up does not overwrite a newer post-trip reading', () => {
  const by = { 'eq:8': entry({ endingReading: 1100, endingReadingDate: '2026-09-10T17:00:00Z' }) };
  applyLatestReadings(by, [posttrip({ id: 1, start_reading: 1000, end_reading: 1100, created_at: '2026-09-10T17:00:00Z' })],
    [fuel({ id: 5, hour_reading: 900, created_at: '2026-09-08T08:00:00Z' })]);
  assert.equal(by['eq:8'].endingReading, 1100);
  assert.equal(by['eq:8'].endingReadingSource, undefined);
});

test('a same-moment tie keeps the inspection reading', () => {
  const at = '2026-09-10T17:00:00Z';
  const by = { 'eq:8': entry({ endingReading: 1100, endingReadingDate: at }) };
  applyLatestReadings(by, [posttrip({ id: 1, start_reading: 1000, end_reading: 1100, created_at: at })],
    [fuel({ id: 5, hour_reading: 1255, created_at: at })]);
  assert.equal(by['eq:8'].endingReading, 1100);
});

test('a reading in a different unit is skipped, not printed under the wrong heading', () => {
  const by = { 'eq:8': entry({ unit: 'hrs' }) };
  applyLatestReadings(by, [], [fuel({ id: 5, hour_reading: 4000, reading_unit: 'km', created_at: '2026-09-11T08:00:00Z' })]);
  // 4000 km is not 4000 hrs. maintenance.js has a unit_mismatch status for
  // this; here the safe answer is to leave the line as it was.
  assert.equal(by['eq:8'].endingReading, 1100);
  assert.equal(by['eq:8'].unit, 'hrs');
});

test('a label-keyed line with no fleet id is left alone', () => {
  // Break #7's ambiguous case: the row could not be reconciled onto the
  // fleet, so there is nothing to join a fuel log to. Guessing which machine
  // was fuelled is the mistake break #7 exists to prevent.
  //
  // Defended twice on purpose — latestReadingsByEquipment drops points with
  // no equipment_id, and applyLatestReadings skips entries with no
  // equipmentId. Removing either one alone leaves this passing, so the
  // assertion below deliberately covers both halves rather than assuming
  // one implies the other.
  const by = { 'label:hand-typed loader': entry({ equipmentId: null, endingReading: 1100 }) };
  applyLatestReadings(by, [], [fuel({ id: 5, hour_reading: 1255, created_at: '2026-09-11T08:00:00Z' })]);
  assert.equal(by['label:hand-typed loader'].endingReading, 1100);
  assert.equal(by['label:hand-typed loader'].endingReadingSource, undefined);
});

test('a fuel log whose unowned id was vetted away cannot reach any line', () => {
  // This is the reachable version of the case above: vetEquipmentIds nulls
  // equipment_id on a fuel log that is not this company's, and the nulled
  // row must then join nothing rather than falling through to some entry.
  const by = { 'eq:8': entry({ equipmentId: 8, endingReading: 1100 }) };
  applyLatestReadings(by, [], [fuel({ id: 5, equipment_id: null, hour_reading: 9999, created_at: '2026-09-11T08:00:00Z' })]);
  assert.equal(by['eq:8'].endingReading, 1100);
  assert.equal(by['eq:8'].endingReadingSource, undefined);
});

test('a company with no fuel module is byte-for-byte unchanged', () => {
  const before = entry();
  const by = { 'eq:8': { ...before } };
  applyLatestReadings(by, [posttrip({ id: 1, start_reading: 1000, end_reading: 1100, created_at: '2026-09-10T17:00:00Z' })], []);
  assert.deepEqual(by['eq:8'], before);
});

test('a fuel-up for a machine with no report line creates nothing', () => {
  // Deliberate boundary: a machine fuelled but never inspected this week
  // gets no report row. Its line would carry no usage, no trip and no
  // issues. Adding such rows is a product decision, not this fix.
  const by = {};
  applyLatestReadings(by, [], [fuel({ id: 5, equipment_id: 99, hour_reading: 1255, created_at: '2026-09-11T08:00:00Z' })]);
  assert.deepEqual(Object.keys(by), []);
});

test('a fuel-up on one machine does not move another machine\'s reading', () => {
  const by = { 'eq:8': entry({ equipmentId: 8 }), 'eq:9': entry({ equipmentId: 9, endingReading: 500, endingReadingDate: '2026-09-09T12:00:00Z' }) };
  applyLatestReadings(by, [], [fuel({ id: 5, equipment_id: 8, hour_reading: 1255, created_at: '2026-09-11T08:00:00Z' })]);
  assert.equal(by['eq:8'].endingReading, 1255);
  assert.equal(by['eq:9'].endingReading, 500);
});

test('an unreturned trip\'s pre-trip reading can supply the ending reading', () => {
  // Consistent with maintenance.js: a pre-trip start_reading is a real
  // reading of the machine. Previously only post-trips could set this, so an
  // open trip left a stale number on the line.
  const by = { 'eq:8': entry({ endingReading: 1100, endingReadingDate: '2026-09-10T17:00:00Z' }) };
  applyLatestReadings(by, [
    posttrip({ id: 1, start_reading: 1000, end_reading: 1100, created_at: '2026-09-10T17:00:00Z' }),
    { trip_type: 'pretrip', equipment_id: 8, reading_unit: 'hrs', id: 2, start_reading: 1180, created_at: '2026-09-11T06:00:00Z' },
  ], []);
  assert.equal(by['eq:8'].endingReading, 1180);
  assert.equal(by['eq:8'].endingReadingSource, 'inspection');
});
