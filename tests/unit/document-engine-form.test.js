import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialAnswers, isFilled, clientProblems, splitAnswers, cleanHazard, extForDataUrl, UNANSWERABLE_TYPES,
} from '../../src/documentEngine/formModel.js';
import { submitEngineDocument } from '../../src/documentEngine/engineSubmit.js';
import { validateAnswers } from '../../server-lib/documentEngine/validate.js';

const DATA = 'data:image/png;base64,iVBORw0KGgo=';
const fields = [
  { field_key: 'site_ok', label: 'Site safe?', field_type: 'yesno', required: true, config: {} },
  { field_key: 'cond', label: 'Brakes', field_type: 'condition3', config: {} },
  { field_key: 'ppe', label: 'PPE', field_type: 'ppe_list', config: {} },
  { field_key: 'hz', label: 'Hazards', field_type: 'hazard_table', config: {} },
  { field_key: 'pic', label: 'Photo', field_type: 'photo', config: {} },
  { field_key: 'eq', label: 'Machine', field_type: 'equipment_picker', required: true, config: {} },
];

test('initial answers and filled checks', () => {
  const a = initialAnswers(fields);
  assert.deepEqual([a.site_ok, a.ppe, a.hz], ['', [], []]);
  assert.equal(isFilled(fields[0], '  '), false);
  assert.equal(isFilled(fields[3], [{ hazard: ' ' }]), false);
  assert.equal(isFilled(fields[3], [{ hazard: 'Fall' }]), true);
  assert.equal(isFilled(fields[0], 'yes'), true);
});

test('client problems: required, flagged note, unanswerable types skipped', () => {
  let p = clientProblems(fields, initialAnswers(fields));
  assert.deepEqual(p, ['"Site safe?" is required.']);
  p = clientProblems(fields, { ...initialAnswers(fields), site_ok: 'yes', cond: 'Defective' });
  assert.deepEqual(p, ['"Brakes" needs a note.']);
  p = clientProblems(fields, { ...initialAnswers(fields), site_ok: 'yes', cond: 'Defective' }, { cond: 'Leaking' });
  assert.deepEqual(p, []);
  assert.ok(UNANSWERABLE_TYPES.includes('equipment_picker'));
});

test('splitAnswers separates files and drops empties and unanswerable types', () => {
  const { values, uploads } = splitAnswers(fields, { site_ok: 'yes', cond: '', ppe: ['Hard hat'], hz: [{ hazard: 'Fall', risk: 'Bogus' }, { hazard: '' }], pic: DATA, eq: [1] });
  assert.deepEqual(Object.keys(values).sort(), ['hz', 'ppe', 'site_ok']);
  assert.equal(values.hz.length, 1);
  assert.equal(values.hz[0].risk, 'Low');
  assert.deepEqual(uploads.map((u) => [u.key, u.kind]), [['pic', 'attachment']]);
  assert.equal(cleanHazard({ hazard: 'x'.repeat(999) }).hazard.length, 300);
  assert.equal(extForDataUrl(DATA), 'png');
  assert.equal(extForDataUrl('data:image/jpeg;base64,xx'), 'jpg');
});

test('what the form sends passes the server validation', () => {
  const fs = fields.filter((f) => f.field_key !== 'eq');
  const { values } = splitAnswers(fs, { site_ok: 'yes', ppe: ['Hard hat'], hz: [{ hazard: 'Fall', control: 'Rail', risk: 'High' }] });
  assert.equal(validateAnswers(fs, values, { resolveFile: () => null }).error, undefined);
});

const payload = () => ({
  definitionId: 5, title: 'Daily', layout: {}, fields: fields.filter((f) => f.field_key !== 'eq'), siteId: '3', siteName: 'North', companyName: 'ABC', submittedBy: 'Jamie',
  answers: { site_ok: 'yes', ppe: ['Hard hat'], hz: [], pic: DATA, cond: '' }, notes: {}, signature: DATA, signLater: false, dateText: 'd', dateTimeText: 'dt',
});

test('submit uploads files, signature and PDF, then files the record', async () => {
  const uploads = []; let body;
  const out = await submitEngineDocument(payload(), 'csid-1', 'tok', {
    upload: async (u) => { uploads.push(u.kind); return `rcpt-${u.kind}`; },
    render: async () => new Blob(['pdf']), logo: null,
    fetchFn: async (url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ ok: true, id: 9 }) }; },
  });
  assert.equal(out.id, 9);
  assert.deepEqual(uploads.sort(), ['attachment', 'pdf', 'signature']);
  assert.equal(body.answers.pic, 'rcpt-attachment');
  assert.equal(body.signature, 'rcpt-signature');
  assert.equal(body.pdfReceipt, 'rcpt-pdf');
  assert.equal(body.clientSubmissionId, 'csid-1');
  assert.equal(body.siteId, '3');
});

test('a failed upload or PDF does not lose the record', async () => {
  let body;
  await submitEngineDocument(payload(), 'c2', 't', {
    upload: async () => { throw new Error('storage down'); }, render: async () => new Blob(['x']), logo: null,
    fetchFn: async (u, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({}) }; },
  });
  assert.equal(body.answers.pic, undefined);
  assert.equal(body.signature, null);
  assert.equal(body.pdfReceipt, undefined);
  assert.equal(body.answers.site_ok, 'yes');
});

test('network failure and server refusal are flagged differently', async () => {
  const base = { upload: async () => 'r', render: async () => new Blob(['x']), logo: null };
  await assert.rejects(submitEngineDocument(payload(), 'c3', 't', { ...base, fetchFn: async () => { throw new TypeError('offline'); } }), (e) => e.isNetworkFailure === true);
  await assert.rejects(submitEngineDocument(payload(), 'c4', 't', { ...base, fetchFn: async () => ({ ok: false, status: 400, json: async () => ({ error: 'Nope.' }) }) }), (e) => e.isServerError === true && e.message === 'Nope.' && e.status === 400);
});
