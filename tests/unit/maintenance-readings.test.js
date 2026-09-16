// Pins preventative maintenance to reading from every source that captures a
// meter reading, not just inspections.
//
// api/maintenance.js decides whether a machine is OK / due soon / overdue by
// comparing its latest usage reading against the reading at its last service.
// It used to build "latest reading" from the inspections table alone, while
// api/fuellogs.js's check_equipment already treated fuel-ups and inspections
// as one shared "last known reading" per machine. The gap was invisible: no
// error, no failing request. A company that fuels daily and inspects weekly
// simply had a PM clock running behind readings FORA already held, so a
// service could come due and never flag — and only for customers who bought
// both the fuel and maintenance modules, which is the hardest kind of bug to
// notice from the inside.
//
// What these cases exist to stop coming back:
//   * a source being dropped from the reducer, silently reverting the fix;
//   * ordering by row id across two tables, where ids are not comparable;
//   * a company without the fuel module seeing any change at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// api/maintenance.js builds its Supabase client at module scope, so the env
// has to be populated before the import even though nothing here makes a
// request — the same reason tests/unit/stripe-webhook-handler.test.js imports
// its handler dynamically. The reducer under test is pure.
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1/';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SESSION_SECRET ||= 'test-session-secret';

const {
  inspectionReadingPoint,
  fuelReadingPoint,
  latestReadingsByEquipment,
} = await import('../../api/maintenance.js');

const inspection = (o) => inspectionReadingPoint({ trip_type: 'pretrip', reading_unit: 'hrs', ...o });
const fuelLog = (o) => fuelReadingPoint({ reading_unit: 'hrs', ...o });

test('a newer fuel-up wins over an older inspection', () => {
  const readings = latestReadingsByEquipment([
    inspection({ id: 1, equipment_id: 7, start_reading: '1000', created_at: '2026-09-01T08:00:00Z' }),
    fuelLog({ id: 5, equipment_id: 7, hour_reading: '1240', created_at: '2026-09-14T16:00:00Z' }),
  ]);
  assert.equal(readings[7].reading, 1240);
  assert.equal(readings[7].readingSource, 'fuel_log');
});

test('a newer inspection still wins over an older fuel-up', () => {
  const readings = latestReadingsByEquipment([
    fuelLog({ id: 5, equipment_id: 7, hour_reading: '1240', created_at: '2026-09-01T16:00:00Z' }),
    inspection({ id: 1, equipment_id: 7, start_reading: '1300', created_at: '2026-09-14T08:00:00Z' }),
  ]);
  assert.equal(readings[7].reading, 1300);
  assert.equal(readings[7].readingSource, 'inspection');
});

test('a posttrip reports its end reading, not its start', () => {
  const readings = latestReadingsByEquipment([
    inspection({ id: 1, equipment_id: 7, trip_type: 'posttrip', start_reading: '1000', end_reading: '1008', created_at: '2026-09-01T08:00:00Z' }),
  ]);
  assert.equal(readings[7].reading, 1008);
});

test('a company with no fuel logs is unaffected', () => {
  const inspections = [
    inspection({ id: 1, equipment_id: 7, start_reading: '1000', created_at: '2026-09-01T08:00:00Z' }),
    inspection({ id: 2, equipment_id: 7, start_reading: '1100', created_at: '2026-09-08T08:00:00Z' }),
  ];
  const readings = latestReadingsByEquipment(inspections);
  assert.equal(readings[7].reading, 1100);
  assert.equal(readings[7].readingSource, 'inspection');
});

test('an exact timestamp tie falls to the inspection, not to whichever id is larger', () => {
  // Row ids are only comparable within their own table. Ordering across the
  // two would be arbitrary, so the inspection — a deliberate reading of the
  // meter — is the documented tie-break, in both argument orders.
  const at = '2026-09-14T12:00:00Z';
  const insp = inspection({ id: 1, equipment_id: 7, start_reading: '1300', created_at: at });
  const fuel = fuelLog({ id: 900, equipment_id: 7, hour_reading: '1240', created_at: at });

  assert.equal(latestReadingsByEquipment([insp, fuel])[7].reading, 1300);
  assert.equal(latestReadingsByEquipment([fuel, insp])[7].reading, 1300);
});

test('within one source, a tie falls to the higher id', () => {
  const at = '2026-09-14T12:00:00Z';
  const readings = latestReadingsByEquipment([
    inspection({ id: 1, equipment_id: 7, start_reading: '1000', created_at: at }),
    inspection({ id: 2, equipment_id: 7, start_reading: '1100', created_at: at }),
  ]);
  assert.equal(readings[7].reading, 1100);
});

test('readings with no equipment_id are ignored', () => {
  // equipment_id is null when a worker types a free-text machine name rather
  // than picking from the registered fleet. There is nothing to attach that
  // reading to, and matching on the label has no uniqueness guarantee.
  const readings = latestReadingsByEquipment([
    fuelLog({ id: 5, equipment_id: null, hour_reading: '1240', created_at: '2026-09-14T16:00:00Z' }),
  ]);
  // Keys, not deepEqual — the accumulator is a null-prototype object, which
  // deepEqual treats as distinct from a plain `{}`.
  assert.deepEqual(Object.keys(readings), []);
});

test('the accumulator cannot be poisoned through a key', () => {
  // These reducers are exported for these tests, so they are no longer
  // reachable only from database rows. A null-prototype accumulator means a
  // caller that ever passes request-shaped data can't corrupt it.
  const readings = latestReadingsByEquipment([
    fuelLog({ id: 5, equipment_id: '__proto__', hour_reading: '1240', created_at: '2026-09-14T16:00:00Z' }),
  ]);
  // On a null-prototype object "__proto__" is an ordinary own key, so the
  // reading is stored as plain data instead of reaching a prototype setter.
  assert.deepEqual(Object.keys(readings), ['__proto__']);
  assert.equal(readings['__proto__'].reading, 1240);
  assert.equal(Object.getPrototypeOf(readings), null);
  assert.equal({}.reading, undefined, 'Object.prototype must be untouched');
});

test('blank, missing and unparseable readings are skipped, not treated as zero', () => {
  // A worker can submit a fuel-up without touching the meter field. Reading
  // that as 0 would make usageSinceService negative and clamp to 0, hiding a
  // machine that is actually overdue.
  const readings = latestReadingsByEquipment([
    inspection({ id: 1, equipment_id: 7, start_reading: '1000', created_at: '2026-09-01T08:00:00Z' }),
    fuelLog({ id: 5, equipment_id: 7, hour_reading: '', created_at: '2026-09-10T16:00:00Z' }),
    fuelLog({ id: 6, equipment_id: 7, hour_reading: null, created_at: '2026-09-11T16:00:00Z' }),
    fuelLog({ id: 7, equipment_id: 7, hour_reading: 'n/a', created_at: '2026-09-12T16:00:00Z' }),
  ]);
  assert.equal(readings[7].reading, 1000);
  assert.equal(readings[7].readingSource, 'inspection');
});

test('each machine is reduced independently', () => {
  const readings = latestReadingsByEquipment([
    inspection({ id: 1, equipment_id: 7, start_reading: '1000', created_at: '2026-09-01T08:00:00Z' }),
    fuelLog({ id: 5, equipment_id: 8, hour_reading: '440', created_at: '2026-09-14T16:00:00Z' }),
  ]);
  assert.equal(readings[7].reading, 1000);
  assert.equal(readings[8].reading, 440);
});

test('the unit travels with the reading, so a mismatch stays detectable', () => {
  // list_status returns unit_mismatch rather than doing arithmetic across
  // hours and kilometres. That depends on the winning point's unit being the
  // one reported, whichever table it came from.
  const readings = latestReadingsByEquipment([
    inspection({ id: 1, equipment_id: 7, start_reading: '1000', created_at: '2026-09-01T08:00:00Z' }),
    fuelLog({ id: 5, equipment_id: 7, hour_reading: '1240', reading_unit: 'km', created_at: '2026-09-14T16:00:00Z' }),
  ]);
  assert.equal(readings[7].readingUnit, 'km');
});
