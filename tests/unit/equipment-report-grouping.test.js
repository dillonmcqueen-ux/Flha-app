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

const { buildEquipmentKeyResolver } = await import('../../api/equipmentreports.js');

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
