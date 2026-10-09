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
  assert.deepEqual(p, ['"Site safe?" is required.', '"Machine" is required.']);
  p = clientProblems(fields, { ...initialAnswers(fields), eq: { text: '  ' } });
  assert.ok(p.includes('"Machine" is required.'), 'a typed-in machine with no name is not an answer');
  p = clientProblems(fields, { ...initialAnswers(fields), site_ok: 'yes', cond: 'Defective', eq: { equipmentId: 1 } });
  assert.deepEqual(p, ['"Brakes" needs a note.']);
  p = clientProblems(fields, { ...initialAnswers(fields), site_ok: 'yes', cond: 'Defective', eq: { equipmentId: 1 } }, { cond: 'Leaking' });
  assert.deepEqual(p, []);
  assert.deepEqual(UNANSWERABLE_TYPES, ['crew_signatures']);
});

test('splitAnswers separates files and drops empties', () => {
  const { values, uploads } = splitAnswers(fields, { site_ok: 'yes', cond: '', ppe: ['Hard hat'], hz: [{ hazard: 'Fall', risk: 'Bogus' }, { hazard: '' }], pic: DATA, eq: { equipmentId: 1 }, crew: 'x' });
  assert.deepEqual(Object.keys(values).sort(), ['eq', 'hz', 'ppe', 'site_ok']);
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

import { formatAnswer, rowsToForm, hasFiles, statusLabel, inboxCount } from '../../src/documentEngine/recordView.js';

test('answers read back in plain words', () => {
  assert.equal(formatAnswer({ field_type: 'yesno', value_text: 'yes' }), 'Yes');
  assert.equal(formatAnswer({ field_type: 'multiselect', value_json: ['A', 'B'] }), 'A, B');
  assert.equal(formatAnswer({ field_type: 'hazard_table', value_json: [{ hazard: 'Fall', risk: 'High', control: 'Rail' }] }), 'Fall (High): Rail');
  assert.equal(formatAnswer({ file_path: 'x/y.png' }), 'File attached');
  assert.equal(formatAnswer(null), '');
  assert.equal(statusLabel('pending_approval'), 'Waiting for review');
});

test('stored rows go back into the form without files, and files are noticed', () => {
  const rows = [
    { field_key: 'a', value_text: 'x', notes: 'n' }, { field_key: 'b', value_json: ['1'] }, { field_key: 'c', file_path: 'p.png' },
  ];
  assert.deepEqual(rowsToForm(rows), { answers: { a: 'x', b: ['1'] }, notes: { a: 'n' } });
  assert.equal(hasFiles(rows), true);
  assert.equal(inboxCount({ counts: { review: 2 } }, [{}, {}, {}]), 5);
  assert.equal(inboxCount(null, null), 0);
});

import { resubmitEngineDocument, signEngineDocument, loadRecordForWorker } from '../../src/documentEngine/engineSubmit.js';

test('resubmit sends the fixed answers and a redrawn PDF; sign uploads the signature then the PDF', async () => {
  const sent = [];
  const deps = {
    upload: async (u) => `rcpt-${u.kind}`, render: async () => new Blob(['x']), logo: null,
    fetchFn: async (u, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true }) }; },
  };
  await resubmitEngineDocument(payload(), 9, 't', deps);
  assert.equal(sent[0].action, 'resubmit');
  assert.equal(sent[0].recordId, 9);
  assert.equal(sent[0].pdfReceipt, 'rcpt-pdf');
  assert.equal(sent[0].answers.pic, 'rcpt-attachment');
  await signEngineDocument(payload(), 9, DATA, 't', deps);
  assert.deepEqual([sent[1].action, sent[1].signature, sent[1].pdfReceipt], ['sign_now', 'rcpt-signature', 'rcpt-pdf']);
  await assert.rejects(signEngineDocument(payload(), 9, DATA, 't', { ...deps, upload: async () => null }), /signature did not upload/);
});

test('loadRecordForWorker flags a document that changed version since the record was filed', async () => {
  const call = async (t, action) => (action === 'get_record' ? { record: { definition_id: 5, version_id: 11 }, answers: [], signatures: [] } : { versionId: 12, fields: [] });
  assert.equal((await loadRecordForWorker('t', 1, 3, call)).sameVersion, false);
  const call2 = async (t, action) => (action === 'get_record' ? { record: { definition_id: 5, version_id: 12 }, answers: [], signatures: [] } : { versionId: 12, fields: [] });
  assert.equal((await loadRecordForWorker('t', 1, 3, call2)).sameVersion, true);
});

test('an earlier file satisfies a required photo when fixing a returned document', () => {
  const f = [{ field_key: 'pic', label: 'Photo', field_type: 'photo', required: true, config: {} }];
  assert.deepEqual(clientProblems(f, { pic: '' }), ['"Photo" is required.']);
  assert.deepEqual(clientProblems(f, { pic: '' }, {}, ['pic']), []);
});

test('signing skips the PDF when the form changed since the document was filed', async () => {
  const uploads = [];
  await signEngineDocument({ ...payload(), skipPdf: true }, 9, DATA, 't', {
    upload: async (u) => { uploads.push(u.kind); return `rcpt-${u.kind}`; }, render: async () => { throw new Error('should not draw'); }, logo: null,
    fetchFn: async () => ({ ok: true, json: async () => ({}) }),
  });
  assert.deepEqual(uploads, ['signature']);
});

test('crew signatures upload with their roster ids, and one that cannot upload stops the submit', async () => {
  let body; const kinds = [];
  const deps = {
    upload: async (u) => { kinds.push(u.filename); return `rcpt-${u.filename}`; }, render: async () => new Blob(['x']), logo: null,
    fetchFn: async (u, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({}) }; },
  };
  await submitEngineDocument({ ...payload(), crew: [{ rosterId: 12, name: 'Cora Crew', signature: DATA }, { rosterId: 13, name: 'Lou', signature: DATA }] }, 'c9', 't', deps);
  assert.deepEqual(body.crew, [{ rosterId: 12, signature: 'rcpt-crew-12.png' }, { rosterId: 13, signature: 'rcpt-crew-13.png' }]);
  assert.ok(!JSON.stringify(body.crew).includes('Cora'), 'names are never sent');
  await assert.rejects(
    submitEngineDocument({ ...payload(), crew: [{ rosterId: 12, name: 'Cora Crew', signature: DATA }] }, 'c10', 't', { ...deps, upload: async (u) => (u.filename.startsWith('crew') ? null : 'r') }),
    (e) => e.isServerError === true && /Cora Crew's signature did not upload/.test(e.message),
  );
});

test('hidden fields are not asked for', () => {
  const f = [{ field_key: 'flag', label: 'AI', field_type: 'yesno', required: true, config: { hidden: true } }];
  assert.deepEqual(clientProblems(f, { flag: '' }), []);
});
