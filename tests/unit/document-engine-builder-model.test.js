import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addField, removeField, moveField, updateField, setOptions, fieldUsage, fieldProblems, rulesToView, viewToRules,
  rulesProblems, routingSummary, BUILDER_FIELD_TYPES, newField,
} from '../../src/documentEngine/builderModel.js';
import { normalizeFields, normalizeRules } from '../../server-lib/documentEngine/validate.js';
import { fieldsForSave, rulesForSave } from '../../src/documentEngine/builderApi.js';

test('added fields get unique keys and what the server accepts', () => {
  let f = [];
  f = addField(f, 'short_text', 'Site name').fields;
  f = addField(f, 'short_text', 'Site name').fields;
  f = addField(f, 'dropdown', 'Weather').fields;
  assert.deepEqual(f.map((x) => x.field_key), ['site_name', 'site_name_2', 'weather']);
  assert.equal(normalizeFields(fieldsForSave(f)).error, undefined);
});

test('changing type resets options, move and remove work', () => {
  let f = addField([], 'dropdown', 'A').fields;
  f = setOptions(f, 'a', ['x', 'y', 'z']);
  f = updateField(f, 'a', { field_type: 'short_text' });
  assert.deepEqual(f[0].config, {});
  f = updateField(f, 'a', { field_type: 'multiselect' });
  assert.equal(f[0].config.options.length, 2);
  f = addField(f, 'number', 'B').fields;
  assert.deepEqual(moveField(f, 'b', -1).map((x) => x.field_key), ['b', 'a']);
  assert.equal(moveField(f, 'a', -1), f);
  assert.equal(removeField(f, 'a').length, 1);
});

test('fieldProblems and fieldUsage', () => {
  const f = [{ ...newField([], 'dropdown', 'W'), config: { options: ['only'] } }];
  assert.ok(fieldProblems(f).some((p) => p.includes('two options')));
  assert.ok(fieldProblems([]).length);
  const layout = { blocks: [{ id: 'b1', type: 'text', field: 'w' }, { id: 'b2', type: 'text', showIf: { answer: 'w' } }] };
  const rules = [{ rule_type: 'route_by_answer', config: { fieldKey: 'w' } }];
  assert.equal(fieldUsage('w', layout, rules).length, 3);
  assert.equal(fieldUsage('zzz', layout, rules).length, 0);
});

test('rules round trip through the view and pass the server check', () => {
  const rows = [
    { rule_type: 'signature_step', config: { signer: 'worker' }, sort_order: 0 },
    { rule_type: 'reviewer_step', config: { label: 'Supervisor', allowLeads: true }, sort_order: 1 },
    { rule_type: 'reviewer_step', config: { role: 'owner', distinct: false }, sort_order: 2 },
    { rule_type: 'notify', config: { departments: ['safety'], extraRosterIds: [4] }, sort_order: 3 },
    { rule_type: 'route_by_scope', config: { departments: ['hr'] }, sort_order: 4 },
    { rule_type: 'route_by_answer', config: { fieldKey: 'q', equals: ['Yes'], department: 'safety' }, sort_order: 5 },
    { rule_type: 'corrective_action', config: { x: 1 }, sort_order: 6 },
  ];
  const v = rulesToView(rows);
  assert.equal(v.reviewers.length, 2);
  const back = viewToRules(v);
  assert.equal(normalizeRules(rulesForSave(back)).error, undefined);
  assert.ok(back.some((r) => r.rule_type === 'corrective_action'));
  assert.deepEqual(back.find((r) => r.rule_type === 'notify' && r.config.extraRosterIds).config.extraRosterIds, [4]);
  assert.equal(back.find((r) => r.rule_type === 'reviewer_step' && r.config.role === 'owner').config.distinct, false);
  assert.deepEqual(rulesToView(back).routes, v.routes);
});

test('rulesProblems catches unroutable fields and gaps', () => {
  const fields = [{ field_key: 't', label: 'Text', field_type: 'short_text' }];
  const v = rulesToView([]); v.routes.push({ fieldKey: 't', equals: [], department: '' });
  const p = rulesProblems(v, fields);
  assert.equal(p.length, 3);
});

test('routingSummary describes each stage in plain words', () => {
  const fields = [{ field_key: 'q', label: 'Any injuries?', field_type: 'yesno' }];
  const v = rulesToView([
    { rule_type: 'signature_step', config: { signer: 'worker' } },
    { rule_type: 'reviewer_step', config: { allowLeads: true } },
    { rule_type: 'route_by_answer', config: { fieldKey: 'q', equals: ['Yes'], department: 'safety' } },
  ]);
  const text = routingSummary(v, fields).map((l) => `${l.step}: ${l.detail}`).join('\n');
  assert.match(text, /crew lead/);
  assert.match(text, /Any injuries\?" is Yes, Safety/);
  assert.match(text, /48 hours/);
  assert.match(routingSummary(rulesToView([]), []).map((l) => l.detail).join(' '), /Nobody is notified/);
  assert.ok(BUILDER_FIELD_TYPES.some((t) => t.notYet));
});
