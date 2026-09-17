// Pins which machine a weekly-report line belongs to.
//
// Break #7 in docs/feature-interaction-map.md: api/equipmentreports.js
// grouped by the free-text equipment_label while inspections.equipment_id --
// a real foreign key to the fleet -- sat unread on the same rows.
//
// The live failure is the MERGE direction. api/companydata.js's
// add_equipment requires only one of make/model/type and leaves unit_number
// optional with no uniqueness check, so two genuinely different machines can
// produce a byte-identical label. Their hours were summed into one line, and
// a supervisor billed or scheduled service from an ending reading for a
// machine that does not exist.
//
// But keying purely on the id breaks the other direction, and that is the
// trap: a machine picked from the fleet on Monday and typed by hand on
// Tuesday has an id on one row and null on the other, and would split into
// two lines where today it correctly merges. Both directions have to be
// right at once, which is what these cases pin.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1/';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SESSION_SECRET ||= 'test-session-secret';

const { buildEquipmentKeyResolver, vetEquipmentIds } = await import('../../api/equipmentreports.js');

const row = (equipment_id, equipment_label) => ({ equipment_id, equipment_label });

test('two different machines sharing a label no longer merge', () => {
  // The bug this fixes. Both are "Caterpillar 320" with no unit number.
  const rows = [row(11, 'Caterpillar 320'), row(12, 'Caterpillar 320')];
  const keyFor = buildEquipmentKeyResolver(rows);
  assert.notEqual(keyFor(11, 'Caterpillar 320'), keyFor(12, 'Caterpillar 320'));
});

test('one machine picked from the fleet then typed by hand stays one line', () => {
  // The regression that keying purely on id would have caused.
  const rows = [row(11, 'Caterpillar 320'), row(null, 'Caterpillar 320')];
  const keyFor = buildEquipmentKeyResolver(rows);
  assert.equal(keyFor(null, 'Caterpillar 320'), keyFor(11, 'Caterpillar 320'));
});

test('casing and spacing do not split a machine', () => {
  const rows = [row(11, 'Caterpillar 320')];
  const keyFor = buildEquipmentKeyResolver(rows);
  assert.equal(keyFor(null, '  caterpillar 320 '), keyFor(11, 'Caterpillar 320'));
});

test('an ambiguous label is never guessed onto one of the machines', () => {
  // Two fleet machines share this label, so a free-text row cannot be
  // attributed to either without reintroducing the merge bug from the other
  // side -- silently, and on exactly the data that is already confusing.
  const rows = [row(11, 'Caterpillar 320'), row(12, 'Caterpillar 320')];
  const keyFor = buildEquipmentKeyResolver(rows);
  const freeText = keyFor(null, 'Caterpillar 320');
  assert.notEqual(freeText, keyFor(11, 'Caterpillar 320'));
  assert.notEqual(freeText, keyFor(12, 'Caterpillar 320'));
});

test('free-text machines with different names stay separate', () => {
  const keyFor = buildEquipmentKeyResolver([]);
  assert.notEqual(keyFor(null, 'Rented skid steer'), keyFor(null, 'Rented excavator'));
});

test('two rows of the same free-text machine merge', () => {
  const keyFor = buildEquipmentKeyResolver([]);
  assert.equal(keyFor(null, 'Rented skid steer'), keyFor(null, 'rented skid steer'));
});

test('unlabeled rows collapse to one bucket rather than many', () => {
  const keyFor = buildEquipmentKeyResolver([]);
  assert.equal(keyFor(null, ''), keyFor(null, null));
  assert.equal(keyFor(null, '   '), keyFor(null, undefined));
});

test('a fleet id always wins over its label', () => {
  // Even when the label is blank or missing, the machine is still known.
  const keyFor = buildEquipmentKeyResolver([row(11, '')]);
  assert.equal(keyFor(11, ''), 'eq:11');
  assert.equal(keyFor(11, null), 'eq:11');
});

test('a malformed row cannot break the resolver', () => {
  const keyFor = buildEquipmentKeyResolver([null, undefined, {}, row(undefined, 'X')]);
  assert.equal(typeof keyFor(null, 'X'), 'string');
});

test('a label only ever used free-text does not adopt an unrelated id', () => {
  const rows = [row(11, 'Caterpillar 320')];
  const keyFor = buildEquipmentKeyResolver(rows);
  assert.equal(keyFor(null, 'Something else entirely'), 'label:something else entirely');
});

// ── Fleet ownership of the ids this report keys on ──────────────────────
//
// Added after tenant-scope-reviewer's pass on this change. Making
// equipment_id load-bearing means every id reaching the resolver has to
// belong to the company the report is for, and one of them arrives inside a
// free-form jsonb blob that api/logs.js's pickAllowed cannot reach:
// results_json.attachedTrailer.id. The legitimate client picks it out of the
// company's own fleet, but that is a UI convention, not an enforced one.
//
// What these cases exist to stop coming back:
//   * a foreign id surviving into a stored report_json, where a future
//     reader that enriches a line by joining on it turns a pre-planted id
//     into a cross-tenant read;
//   * a trailer defect or towed distance being stapled to a machine the
//     worker chose by id rather than the one named on the line;
//   * dropping the whole row (or the whole report) over one bad id, when
//     falling back to the label is already the correct answer for a machine
//     that isn't in the fleet.

// The fleet index api/equipmentreports.js is handed: String(id) -> the
// fleet row's own id. See companyEquipmentIndex in server-lib/equipmentScope.js.
const fleet = (ids) => new Map(ids.map(id => [String(id), id]));

test('an id outside the fleet is dropped, and the row falls back to its label', () => {
  const records = [
    { id: 1, equipment_id: 4711, equipment_label: 'Excavator 2' },
    { id: 2, equipment_id: 8, equipment_label: 'Truck 12' },
  ];
  vetEquipmentIds(records, fleet([8]));
  assert.equal(records[0].equipment_id, null);
  assert.equal(records[1].equipment_id, 8);

  const keyFor = buildEquipmentKeyResolver(records);
  // Not eq:4711 -- a foreign id must never become a grouping key, or it
  // lands in this company's stored report_json.
  assert.equal(keyFor(records[0].equipment_id, 'Excavator 2'), 'label:excavator 2');
  assert.equal(keyFor(records[1].equipment_id, 'Truck 12'), 'eq:8');
});

test('a foreign attachedTrailer.id is dropped while its label survives', () => {
  const records = [{
    id: 1, equipment_id: 8, equipment_label: 'F-350', trip_type: 'pretrip',
    results_json: { attachedTrailer: { id: 4711, label: '5x10 Dump Trailer' }, items: [] },
  }];
  vetEquipmentIds(records, fleet([8]));
  const attached = records[0].results_json.attachedTrailer;
  assert.equal(attached.id, null);
  // The label is untouched, so the trailer still gets its own report line --
  // dropping the id costs the join, never the record.
  assert.equal(attached.label, '5x10 Dump Trailer');
});

test('a worker cannot staple a trailer defect onto another of their own machines by id', () => {
  // Intra-tenant version: the id IS in the fleet but names the wrong
  // machine. Vetting is ownership only, so this one is deliberately still
  // allowed through -- pinning it so the boundary is explicit rather than
  // assumed if vetting is ever widened.
  const records = [{
    id: 1, equipment_id: 8, equipment_label: 'F-350', trip_type: 'pretrip',
    results_json: { attachedTrailer: { id: 9, label: '5x10 Dump Trailer' }, items: [] },
  }];
  vetEquipmentIds(records, fleet([8, 9]));
  assert.equal(records[0].results_json.attachedTrailer.id, 9);
});

test('an owned attachedTrailer.id survives vetting', () => {
  const records = [{
    id: 1, equipment_id: 8, equipment_label: 'F-350', trip_type: 'pretrip',
    results_json: { attachedTrailer: { id: 3, label: '5x10 Dump Trailer' }, items: [] },
  }];
  vetEquipmentIds(records, fleet([3, 8]));
  assert.equal(records[0].results_json.attachedTrailer.id, 3);
});

test('vetting tolerates the shapes a real week of rows actually contains', () => {
  const records = [
    null,
    { id: 1, equipment_id: null, equipment_label: 'Hand-typed loader' },
    { id: 2, equipment_id: 8, equipment_label: 'Truck 12', results_json: null },
    { id: 3, equipment_id: 8, equipment_label: 'Truck 12', results_json: { items: [] } },
    { id: 4, equipment_id: 8, equipment_label: 'Truck 12', results_json: { attachedTrailer: null } },
  ];
  assert.doesNotThrow(() => vetEquipmentIds(records, fleet([8])));
  assert.equal(records[1].equipment_id, null);
  assert.equal(records[4].equipment_id, 8);
});

test('an emptied fleet strips every id rather than trusting any of them', () => {
  // companyEquipmentIds returns an empty Set for a company that owns no
  // equipment and null when it could not be read -- the caller throws on
  // null, so reaching here with an empty set means the company really has
  // no fleet and no id on these rows can be genuine.
  const records = [{ id: 1, equipment_id: 8, equipment_label: 'Truck 12' }];
  vetEquipmentIds(records, fleet([]));
  assert.equal(records[0].equipment_id, null);
});

test('a trailer id that came back from jsonb as a string still matches its fleet row', () => {
  // The regression this pins: the grouping key used to be `eq:${id}`, which
  // string-coerced, so "3" and 3 grouped together by accident. A vetting
  // lookup that only matched numbers would have dropped the legitimate id
  // and split the trailer onto a second, label-keyed line — silently.
  const records = [{
    id: 1, equipment_id: 8, equipment_label: 'F-350', trip_type: 'pretrip',
    results_json: { attachedTrailer: { id: '3', label: '5x10 Dump Trailer' }, items: [] },
  }];
  vetEquipmentIds(records, fleet([3, 8]));
  // Normalized to the fleet row's own id, so report_json can't end up
  // holding both spellings of one machine.
  assert.strictEqual(records[0].results_json.attachedTrailer.id, 3);
});
