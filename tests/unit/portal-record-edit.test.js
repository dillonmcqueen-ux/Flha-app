import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEditedPortalAnswer as v } from '../../server-lib/portalFieldTypes.js';

test('yes/no accepts only yes or no', () => {
  assert.equal(v('yesno', [], 'yes'), null);
  assert.equal(v('yesno', [], 'no'), null);
  assert.ok(v('yesno', [], 'maybe'));
  assert.ok(v('yesno', [], true));
});

test('number, date and text are checked', () => {
  assert.equal(v('number', [], '12.5'), null);
  assert.ok(v('number', [], 'abc'));
  assert.ok(v('number', [], ''));
  assert.equal(v('date', [], '2026-09-30'), null);
  assert.ok(v('date', [], '30/09/2026'));
  assert.equal(v('short_text', [], 'ok'), null);
  assert.ok(v('short_text', [], 'x'.repeat(2001)));
  assert.ok(v('short_text', [], 5));
});

test('dropdown and multiselect must stay inside the defined options', () => {
  assert.equal(v('dropdown', ['A', 'B'], 'A'), null);
  assert.ok(v('dropdown', ['A', 'B'], 'C'));
  assert.equal(v('multiselect', ['A', 'B'], ['A', 'B']), null);
  assert.equal(v('multiselect', ['A', 'B'], []), null);
  assert.ok(v('multiselect', ['A', 'B'], ['A', 'Z']));
  assert.ok(v('multiselect', ['A', 'B'], 'A'));
});

test('signatures and uploads cannot be edited', () => {
  assert.ok(v('signature', [], 'x'));
  assert.ok(v('file_upload', [], 'x'));
  assert.ok(v('unknown', [], 'x'));
});

test('stricter number, date and multiselect checks', () => {
  assert.ok(v('number', [], '0x1F'));
  assert.ok(v('number', [], '1e5'));
  assert.equal(v('number', [], '-3.25'), null);
  assert.ok(v('date', [], '2026-99-99'));
  assert.ok(v('date', [], '2026-02-30'));
  assert.equal(v('date', [], '2028-02-29'), null);
  assert.ok(v('multiselect', ['A', 'B'], ['A', 'A']));
});
