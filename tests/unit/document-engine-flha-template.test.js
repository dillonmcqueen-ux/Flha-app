// The FLHA template (server-lib/documentEngine/templates/flha.js) driven through
// the real engine service: seeded once, cloned to a company, then filed the way
// today's FLHA is (worker signature, Extreme risk needs a supervisor, crew sign-off).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './_fakeDb.js';
import { FLHA_TEMPLATE, FLHA_LAYOUT, seedFlhaTemplate } from '../../server-lib/documentEngine/templates/flha.js';
import { validateLayout } from '../../server-lib/documentEngine/layoutSchema.js';
import { normalizeFields, normalizeRules } from '../../server-lib/documentEngine/validate.js';
import { cloneTemplate, setCompanyDocument, saveDraft, publishDraft, submitRecord, reviewRecord, signNow, getDocumentForWorker } from '../../server-lib/documentEngine/service.js';

const deps = {
  resolveFile: (v) => (typeof v === 'string' && v.startsWith('rcpt:') ? v.slice(5) : null),
  resolveSiteId: async (raw) => (Number(raw) === 5 ? 5 : null),
};
const worker = { role: 'worker', userId: 11, companyId: 1, name: 'Wes Worker' };
const supervisor = { role: 'supervisor', userId: 21, companyId: 1, name: 'Sue Super' };

function seedDb() {
  return makeDb({
    sites: [{ id: 5, company_id: 1, name: 'North Yard' }],
    companies: [{ id: 1, suspended: false }],
    roster: [
      { id: 11, company_id: 1, name: 'Wes Worker', role: 'worker', active: true, email: 'wes@x.test', departments: [], divisions: [], default_site_id: 5 },
      { id: 12, company_id: 1, name: 'Cora Crew', role: 'worker', active: true, departments: [], divisions: [] },
      { id: 21, company_id: 1, name: 'Sue Super', role: 'supervisor', active: true, is_owner: false, email: 'sue@x.test', default_site_id: 5, departments: [], divisions: [] },
    ],
  });
}

async function companyFlha(db) {
  const { definitionId } = await seedFlhaTemplate(db);
  const clone = await cloneTemplate(db, { companyId: 1, templateId: definitionId });
  const id = clone.definition ? clone.definition.id : clone.definitionId;
  await publishDraft(db, { companyId: 1, definitionId: id });
  await setCompanyDocument(db, { companyId: 1, definitionId: id, isEnabled: true });
  return id;
}

const lowAnswers = { task_summary: 'Trenching near a road', hazards: [{ task: 'Trenching', hazard: 'Cave-in', control: 'Trench box', sopRef: null, risk: 'High' }], ppe: ['Hard hat'], sop_alerts: ['Call before you dig'], ai_assisted: 'yes' };

test('the template is valid on its own: fields, rules and layout pass the engine checks', () => {
  assert.equal(normalizeFields(FLHA_TEMPLATE.fields).error, undefined);
  assert.equal(normalizeRules(FLHA_TEMPLATE.rules).error, undefined);
  assert.equal(validateLayout(FLHA_LAYOUT).error, undefined);
  const keys = FLHA_TEMPLATE.fields.map((f) => f.fieldKey);
  assert.deepEqual(keys, ['task_summary', 'hazards', 'sop_alerts', 'ppe', 'notes', 'ai_assisted', 'crew']);
  // Every layout field reference points at a field the template has.
  for (const b of FLHA_LAYOUT.blocks) if (b.field) assert.ok(keys.includes(b.field), `${b.id} reads ${b.field}`);
});

test('seeding creates and publishes the template once, with no company, and leaves an existing one alone', async () => {
  const db = seedDb();
  const first = await seedFlhaTemplate(db);
  assert.equal(first.created, true);
  const def = db.tables.document_definitions[0];
  assert.equal(def.company_id, null);
  assert.equal(def.key, 'flha');
  assert.ok(def.current_version_id);
  assert.equal(db.tables.document_fields.length, FLHA_TEMPLATE.fields.length);
  assert.equal(db.tables.document_rules.length, FLHA_TEMPLATE.rules.length);
  const again = await seedFlhaTemplate(db);
  assert.deepEqual(again, { created: false, definitionId: first.definitionId });
  assert.equal(db.tables.document_definitions.length, 1);
  assert.equal((db.tables.company_documents || []).length, 0, 'seeding switches it on for nobody');
});

test('a normal FLHA is filed signed and needs nobody; an Extreme hazard goes to a supervisor', async () => {
  const db = seedDb();
  const id = await companyFlha(db);
  const normal = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, siteId: 5, signature: 'rcpt:1/sig.png', answers: lowAnswers, deps });
  assert.equal(normal.record.status, 'submitted');
  const extreme = await submitRecord(db, {
    session: worker, companyId: 1, definitionId: id, siteId: 5, signature: 'rcpt:1/sig2.png',
    answers: { ...lowAnswers, hazards: [{ task: 'Tie-in', hazard: 'Live main', control: 'Isolate', sopRef: null, risk: 'Extreme' }] }, deps,
  });
  assert.equal(extreme.record.status, 'pending_approval');
  await reviewRecord(db, { session: supervisor, companyId: 1, recordId: extreme.record.id, decision: 'approve', deps });
  assert.equal(db.tables.document_records.find((r) => r.id === extreme.record.id).status, 'approved');
});

test('the worker must sign, or save to sign later and an Extreme one waits for the signature before review', async () => {
  const db = seedDb();
  const id = await companyFlha(db);
  await assert.rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, siteId: 5, answers: lowAnswers, deps }), /Sign the document/);
  const later = await submitRecord(db, {
    session: worker, companyId: 1, definitionId: id, siteId: 5, signLater: true, deps,
    answers: { ...lowAnswers, hazards: [{ hazard: 'Live main', control: 'Isolate', risk: 'Extreme' }] },
  });
  assert.equal(later.record.awaiting_signature, true);
  await assert.rejects(reviewRecord(db, { session: supervisor, companyId: 1, recordId: later.record.id, decision: 'approve', deps }), /hasn't signed/);
  await signNow(db, { session: worker, companyId: 1, recordId: later.record.id, signature: 'rcpt:1/late.png', deps });
  await reviewRecord(db, { session: supervisor, companyId: 1, recordId: later.record.id, decision: 'approve', deps });
});

test('crew sign-off is checked against the roster, never trusted from the request', async () => {
  const db = seedDb();
  const id = await companyFlha(db);
  const file = (crew) => submitRecord(db, { session: worker, companyId: 1, definitionId: id, siteId: 5, signature: 'rcpt:1/sig.png', answers: lowAnswers, crew, deps });
  const ok = await file([{ rosterId: 12, signature: 'rcpt:1/crew.png', name: 'FORGED NAME' }]);
  const sigs = db.tables.document_signatures.filter((s) => s.record_id === ok.record.id);
  assert.deepEqual(sigs.map((s) => [s.kind, s.signer_name]).sort(), [['crew', 'Cora Crew'], ['worker', 'Wes Worker']]);
  await assert.rejects(file([{ rosterId: 999, signature: 'rcpt:1/c.png' }]), /roster/);
  await assert.rejects(file([{ rosterId: 11, signature: 'rcpt:1/c.png' }]), /own crew member/);
  await assert.rejects(file([{ rosterId: 12, signature: 'rcpt:1/c.png' }, { rosterId: 12, signature: 'rcpt:1/c2.png' }]), /only sign once/);
});

test('a bad hazard risk is refused and the hidden AI flag is stored as a plain answer', async () => {
  const db = seedDb();
  const id = await companyFlha(db);
  await assert.rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, siteId: 5, signature: 'rcpt:1/s.png', answers: { ...lowAnswers, hazards: [{ hazard: 'x', risk: 'Catastrophic' }] }, deps }), /risk of Low/);
  const ok = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, siteId: 5, signature: 'rcpt:1/s.png', answers: lowAnswers, deps });
  assert.equal(db.tables.document_answers.find((a) => a.record_id === ok.record.id && a.field_key === 'ai_assisted').value_text, 'yes');
  const form = await getDocumentForWorker(db, { companyId: 1, definitionId: id });
  assert.equal(form.fields.find((f) => f.field_key === 'ai_assisted').config.hidden, true);
  assert.equal(form.fields.find((f) => f.field_key === 'hazards').config.aiAssist.taskField, 'task_summary');
});

test('a review condition must point at a field that can answer it', async () => {
  const db = seedDb();
  const { definition } = await (await import('../../server-lib/documentEngine/service.js')).createDefinition(db, { companyId: 1, title: 'Cond' });
  const fields = [{ label: 'Hazards', fieldType: 'hazard_table' }, { label: 'Note', fieldType: 'short_text' }, { label: 'Injury?', fieldType: 'yesno' }];
  const rule = (onlyIf) => [{ ruleType: 'reviewer_step', config: { onlyIf } }];
  const save = (onlyIf) => saveDraft(db, { companyId: 1, definitionId: definition.id, fields, rules: rule(onlyIf) });
  await assert.rejects(save({ field: 'typo', riskIn: ['Extreme'] }), /does not have/);
  await assert.rejects(save({ field: 'note', riskIn: ['Extreme'] }), /no hazard risks/);
  await assert.rejects(save({ field: 'hazards', riskIn: ['Severe'] }), /risk that does not exist/);
  await assert.rejects(save({ field: 'hazards', riskIn: [] }), /risk that does not exist/);
  await assert.rejects(save({ field: 'note', equalsAny: ['x'] }), /cannot decide/);
  await assert.rejects(save({ field: 'hazards' }), /riskIn or equalsAny/);
  await assert.rejects(save('nope'), /does not have/);
  await save({ field: 'hazards', riskIn: ['Extreme', 'High'] });
  await save({ field: 'injury', equalsAny: ['yes'] });
});

test('a seed that stopped half way is finished on the next run', async () => {
  const db = seedDb();
  const { createDefinition } = await import('../../server-lib/documentEngine/service.js');
  await createDefinition(db, { companyId: null, title: 'FLHA', key: 'flha' }); // created, never saved or published
  const out = await seedFlhaTemplate(db);
  assert.equal(out.created, true);
  assert.ok(db.tables.document_definitions[0].current_version_id);
  assert.equal(db.tables.document_definitions.length, 1);
});
