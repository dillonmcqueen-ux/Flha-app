import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugKey, validateDefinitionInput, normalizeFields, normalizeLayout, normalizeRules, validateAnswers, validateAnswerValue,
} from '../../server-lib/documentEngine/validate.js';
import { ENGINE_FIELD_TYPE_KEYS, ENGINE_RULE_TYPES, fieldTypeNeedsOptions } from '../../server-lib/documentEngine/fieldTypes.js';

test('slugKey makes a stable lowercase key', () => {
  assert.equal(slugKey('Field Level Hazard Assessment (FLHA)'), 'field_level_hazard_assessment_flha');
  assert.equal(slugKey('  --  '), '');
});

test('definition input needs a title and caps its length', () => {
  assert.ok(validateDefinitionInput({ title: '  ' }).error);
  assert.ok(validateDefinitionInput({ title: 'x'.repeat(151) }).error);
  const ok = validateDefinitionInput({ title: 'Pre Shift Check', icon: 'abcdefghijkl', category: ' Safety ' });
  assert.equal(ok.key, 'pre_shift_check');
  assert.equal(ok.icon.length, 8);
  assert.equal(ok.category, 'Safety');
});

test('the type list covers the Portal types and the FLHA blocks', () => {
  for (const k of ['yesno', 'signature', 'file_upload', 'condition3', 'equipment_picker', 'hazard_table', 'crew_signatures']) {
    assert.ok(ENGINE_FIELD_TYPE_KEYS.includes(k), k);
  }
  assert.ok(fieldTypeNeedsOptions('dropdown') && fieldTypeNeedsOptions('multiselect'));
  assert.equal(fieldTypeNeedsOptions('short_text'), false);
});

test('normalizeFields rejects empty, unknown and under-optioned fields', () => {
  assert.ok(normalizeFields([]).error);
  assert.ok(normalizeFields('x').error);
  assert.ok(normalizeFields([{ label: 'A', fieldType: 'nope' }]).error);
  assert.ok(normalizeFields([{ label: '', fieldType: 'short_text' }]).error);
  assert.ok(normalizeFields([{ label: 'Pick', fieldType: 'dropdown', config: { options: ['only one'] } }]).error);
  assert.ok(normalizeFields([{ label: 'Pick', fieldType: 'dropdown', config: { options: ['a', 'a'] } }]).error, 'duplicate options collapse to one');
});

test('normalizeFields makes keys, de-duplicates them and keeps order', () => {
  const out = normalizeFields([
    { label: 'Site name', fieldType: 'short_text' },
    { label: 'Site name', fieldType: 'short_text' },
    { label: 'Risk', fieldType: 'dropdown', config: { options: ['Low', 'High'], junk: 1 }, required: true },
  ]);
  assert.deepEqual(out.fields.map((f) => f.field_key), ['site_name', 'site_name_2', 'risk']);
  assert.deepEqual(out.fields.map((f) => f.sort_order), [0, 1, 2]);
  assert.deepEqual(out.fields[2].config.options, ['Low', 'High']);
  assert.equal(out.fields[2].required, true);
});

test('normalizeFields refuses two explicit keys that collide, and bad keys', () => {
  assert.ok(normalizeFields([{ fieldKey: 'a', label: 'A', fieldType: 'short_text' }, { fieldKey: 'a', label: 'B', fieldType: 'short_text' }]).error);
  assert.ok(normalizeFields([{ fieldKey: 'Bad Key', label: 'A', fieldType: 'short_text' }]).error);
});

test('normalizeFields drops options from types that take none and cleans attachment rules', () => {
  const out = normalizeFields([
    { label: 'Notes', fieldType: 'long_text', config: { options: ['x', 'y'] } },
    { label: 'Photo', fieldType: 'photo', attachmentRules: { allowed: ['image', 'exe'], maxMb: 99, required: true } },
  ]);
  assert.equal(out.fields[0].config.options, undefined);
  assert.deepEqual(out.fields[1].attachment_rules, { allowed: ['image'], maxMb: 10, required: true });
});

test('layout and rules validate their shape', () => {
  assert.deepEqual(normalizeLayout(null), { layout: {} });
  assert.ok(normalizeLayout([]).error);
  assert.ok(normalizeLayout({ big: 'x'.repeat(250 * 1024) }).error);
  assert.deepEqual(normalizeRules(undefined), { rules: [] });
  assert.ok(normalizeRules('x').error);
  assert.ok(normalizeRules([{ ruleType: 'launch_missiles' }]).error);
  for (const t of ENGINE_RULE_TYPES) assert.equal(normalizeRules([{ ruleType: t, config: { a: 1 } }]).rules[0].rule_type, t);
});

const F = (over) => ({ id: 1, field_key: 'k', label: 'Q', field_type: 'short_text', config: {}, required: false, ...over });

test('yes/no, number and date answers are normalized or refused', () => {
  assert.equal(validateAnswerValue(F({ field_type: 'yesno' }), ' YES ').value_text, 'yes');
  assert.ok(validateAnswerValue(F({ field_type: 'yesno' }), 'maybe').error);
  assert.equal(validateAnswerValue(F({ field_type: 'number' }), '12.50').value_text, '12.5');
  assert.ok(validateAnswerValue(F({ field_type: 'number' }), 'abc').error);
  assert.equal(validateAnswerValue(F({ field_type: 'date' }), '2026-10-09').value_text, '2026-10-09');
  assert.ok(validateAnswerValue(F({ field_type: 'date' }), '09/10/2026').error);
  assert.ok(validateAnswerValue(F({ field_type: 'date' }), '2026-13-45').error);
});

test('dropdown and multiselect answers must be among the options', () => {
  const dd = F({ field_type: 'dropdown', config: { options: ['A', 'B'] } });
  assert.equal(validateAnswerValue(dd, 'A').value_text, 'A');
  assert.ok(validateAnswerValue(dd, 'C').error);
  const ms = F({ field_type: 'multiselect', config: { options: ['A', 'B', 'C'] } });
  assert.deepEqual(validateAnswerValue(ms, ['A', 'C', 'A']).value_json, ['A', 'C']);
  assert.ok(validateAnswerValue(ms, ['Z']).error);
  assert.ok(validateAnswerValue(ms, 'A').error);
});

test('text answers are length capped', () => {
  assert.ok(validateAnswerValue(F(), 'x'.repeat(2001)).error);
  assert.ok(validateAnswerValue(F({ field_type: 'long_text' }), 'x'.repeat(10001)).error);
  assert.equal(validateAnswerValue(F({ field_type: 'long_text' }), 'x'.repeat(10000)).value_text.length, 10000);
});

test('file answers only store a path the server resolved', () => {
  const field = F({ field_type: 'photo' });
  assert.equal(validateAnswerValue(field, 'rcpt:1/a.png', { resolveFile: (v) => (v.startsWith('rcpt:') ? v.slice(5) : null) }).file_path, '1/a.png');
  assert.deepEqual(validateAnswerValue(field, '../../etc/passwd', { resolveFile: () => null }), {});
  assert.deepEqual(validateAnswerValue(field, 'x', {}), {});
});

test('structured types accept objects and arrays but not strings or huge blobs', () => {
  const f = F({ field_type: 'section_table' });
  assert.deepEqual(validateAnswerValue(f, [{ a: 1 }]).value_json, [{ a: 1 }]);
  assert.ok(validateAnswerValue(f, 'text').error);
  assert.ok(validateAnswerValue(f, { x: 'y'.repeat(200 * 1024) }).error);
});

test('hazard rows are checked and rebuilt from known keys, and a bad risk is refused', () => {
  const f = F({ field_type: 'hazard_table', label: 'Hazards' });
  const ok = validateAnswerValue(f, [{ task: ' T ', hazard: ' Struck by ', control: 'Spotter', sopRef: '  ', risk: 'High', extra: 'drop me' }, { hazard: '  ', risk: 'Low' }]);
  assert.deepEqual(ok.value_json, [{ task: 'T', hazard: 'Struck by', control: 'Spotter', sopRef: null, risk: 'High' }]);
  assert.deepEqual(validateAnswerValue(f, [{ hazard: '', risk: 'Low' }]), {}, 'only blank rows is no answer');
  assert.match(validateAnswerValue(f, [{ hazard: 'x', risk: 'Severe' }]).error, /risk of Low, Medium, High or Extreme/);
  assert.match(validateAnswerValue(f, [{ hazard: 'x' }]).error, /risk/);
  assert.ok(validateAnswerValue(f, [1]).error);
  assert.ok(validateAnswerValue(f, { hazard: 'x', risk: 'Low' }).error);
  assert.ok(validateAnswerValue(f, Array.from({ length: 101 }, () => ({ hazard: 'x', risk: 'Low' }))).error);
  assert.ok(validateAnswerValue(f, [{ hazard: 'x'.repeat(301), risk: 'Low' }]).error);
});

test('PPE and text lists are plain lists of short strings', () => {
  for (const type of ['ppe_list', 'text_list']) {
    const f = F({ field_type: type, label: 'List' });
    assert.deepEqual(validateAnswerValue(f, [' Hard hat ', 'Hard hat', 'Vest']).value_json, ['Hard hat', 'Vest']);
    assert.deepEqual(validateAnswerValue(f, ['', '  ']), {});
    assert.ok(validateAnswerValue(f, 'Hard hat').error);
    assert.ok(validateAnswerValue(f, [{ a: 1 }]).error);
    assert.ok(validateAnswerValue(f, ['x'.repeat(301)]).error);
    assert.ok(validateAnswerValue(f, Array.from({ length: 41 }, (_, i) => `i${i}`)).error);
  }
});
test('types that carry ids are refused until their ids are validated', () => {
  for (const t of ['equipment_picker', 'attachment_picker', 'site_picker', 'person_picker', 'linked_document', 'crew_signatures']) {
    assert.match(validateAnswerValue(F({ field_type: t }), { id: 4 }).error, /can't be answered yet/, t);
    assert.deepEqual(validateAnswerValue(F({ field_type: t }), null), {}, `${t} left blank is fine`);
  }
});

test('validateAnswers enforces required, rejects unknown keys, snapshots question text', () => {
  const fields = [
    F({ id: 1, field_key: 'site', label: 'Site', required: true }),
    F({ id: 2, field_key: 'ok', label: 'Safe?', field_type: 'yesno' }),
  ];
  assert.match(validateAnswers(fields, {}).error, /required/);
  assert.match(validateAnswers(fields, { site: 'North', extra: 1 }).error, /Unknown field/);
  const out = validateAnswers(fields, { site: 'North', ok: 'no' }, { notes: { ok: 'wet floor' } });
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.rows[0], { field_id: 1, field_key: 'site', question_text: 'Site', field_type: 'short_text', value_text: 'North', value_json: null, file_path: null, notes: null });
  assert.equal(out.rows[1].notes, 'wet floor');
});

test('blank optional answers are skipped, a note alone is kept', () => {
  const fields = [F({ id: 1, field_key: 'a' }), F({ id: 2, field_key: 'b', field_type: 'yesno' })];
  const out = validateAnswers(fields, { a: '  ' }, { notes: { b: 'just a note' } });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].field_key, 'b');
});

test('a Monitor or Defective condition needs a note, Good does not', () => {
  const fields = [F({ id: 1, field_key: 'hoses', label: 'Hoses', field_type: 'condition3' })];
  assert.match(validateAnswers(fields, { hoses: 'Defective' }).error, /needs a note/);
  assert.match(validateAnswers(fields, { hoses: 'Monitor' }).error, /needs a note/);
  assert.ok(validateAnswers(fields, { hoses: 'Defective' }, { notes: { hoses: 'leaking' } }).rows);
  assert.equal(validateAnswers(fields, { hoses: 'Good' }).rows.length, 1);
  assert.ok(validateAnswers(fields, { hoses: 'Broken' }).error);
});

test('a required file field fails when the receipt does not resolve', () => {
  const fields = [F({ id: 1, field_key: 'photo', label: 'Photo', field_type: 'photo', required: true })];
  assert.match(validateAnswers(fields, { photo: 'forged' }, { resolveFile: () => null }).error, /required/);
});

import { ATTACHMENT_EXTENSIONS } from '../../server-lib/documentEngine/validate.js';

test('a file field only accepts the kinds the builder allowed, and photos default to images', () => {
  const resolveFile = (v) => (typeof v === 'string' ? v : null);
  const doc = { field_type: 'file_upload', label: 'Quote', attachment_rules: { allowed: ['pdf', 'word'] }, config: {} };
  assert.deepEqual(validateAnswerValue(doc, '1/a-quote.docx', { resolveFile }), { file_path: '1/a-quote.docx' });
  assert.deepEqual(validateAnswerValue(doc, '1/a-quote.pdf', { resolveFile }), { file_path: '1/a-quote.pdf' });
  assert.match(validateAnswerValue(doc, '1/a-sheet.xlsx', { resolveFile }).error, /does not accept/);
  const photo = { field_type: 'photo', label: 'Pic', attachment_rules: {}, config: {} };
  assert.deepEqual(validateAnswerValue(photo, '1/a.jpg', { resolveFile }), { file_path: '1/a.jpg' });
  assert.match(validateAnswerValue(photo, '1/a.pdf', { resolveFile }).error, /does not accept/);
  const free = { field_type: 'file_upload', label: 'Any', attachment_rules: {}, config: {} };
  assert.deepEqual(validateAnswerValue(free, '1/a.xls', { resolveFile }), { file_path: '1/a.xls' });
  const sig = { field_type: 'signature', label: 'Sig', attachment_rules: { allowed: ['pdf'] }, config: {} };
  assert.deepEqual(validateAnswerValue(sig, '1/s.png', { resolveFile }), { file_path: '1/s.png' });
  assert.ok(!ATTACHMENT_EXTENSIONS.word.includes('docm') && !ATTACHMENT_EXTENSIONS.excel.includes('xlsm'));
});
