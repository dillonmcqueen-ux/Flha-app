// Drives server-lib/documentEngine/service.js against an in-memory client
// (tests/unit/_fakeDb.js). Covers the rules the engine must hold before any
// customer touches it: tenant isolation, immutable published versions,
// idempotent submits, server-validated signatures, and review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './_fakeDb.js';
import {
  EngineError, createDefinition, cloneTemplate, saveDraft, publishDraft, setCompanyDocument, listCompanyDocuments,
  getDefinitionForBuilder, getDocumentForWorker, listWorkerDocuments, submitRecord, resubmitRecord, signNow,
  getRecord, listRecords, reviewRecord,
} from '../../server-lib/documentEngine/service.js';

const FIELDS = [
  { label: 'Task', fieldType: 'short_text', required: true },
  { label: 'Risk', fieldType: 'dropdown', config: { options: ['Low', 'High'] } },
];
const WORKER_SIG_RULE = { ruleType: 'signature_step', config: { signer: 'worker' } };
const REVIEW_RULE = { ruleType: 'reviewer_step', config: { role: 'supervisor' } };

const deps = {
  resolveFile: (v) => (typeof v === 'string' && v.startsWith('rcpt:') ? v.slice(5) : null),
  resolveSiteId: async (raw) => (Number(raw) === 5 || Number(raw) === 6 ? Number(raw) : null),
};

const worker = { role: 'worker', userId: 11, companyId: 1, name: 'Wes Worker' };
const supervisor = { role: 'supervisor', userId: 21, companyId: 1, name: 'Sue Super' };
const admin = { role: 'admin' };

function seedDb() {
  return makeDb({
    roster: [
      { id: 11, company_id: 1, name: 'Wes Worker', role: 'worker', active: true, departments: [], divisions: [] },
      { id: 12, company_id: 1, name: 'Cora Crew', role: 'worker', active: true, departments: [], divisions: [] },
      { id: 13, company_id: 1, name: 'Inactive Ian', role: 'worker', active: false, departments: [], divisions: [] },
      { id: 21, company_id: 1, name: 'Sue Super', role: 'supervisor', active: true, is_owner: false, default_site_id: 5, departments: [], divisions: [] },
      { id: 22, company_id: 1, name: 'Sam Other', role: 'supervisor', active: true, is_owner: false, default_site_id: 9, departments: [], divisions: [] },
      { id: 31, company_id: 2, name: 'Other Co Oscar', role: 'worker', active: true, departments: [], divisions: [] },
      { id: 32, company_id: 2, name: 'Other Co Sara', role: 'supervisor', active: true, is_owner: false, default_site_id: 5, departments: [], divisions: [] },
    ],
  });
}

async function publishedDoc(db, { companyId = 1, rules = [], fields = FIELDS, enable = true, title = 'Pre Shift' } = {}) {
  const { definition } = await createDefinition(db, { companyId, title });
  await saveDraft(db, { companyId, definitionId: definition.id, title, fields, rules });
  await publishDraft(db, { companyId, definitionId: definition.id });
  if (enable) await setCompanyDocument(db, { companyId, definitionId: definition.id, isEnabled: true });
  return definition.id;
}

async function rejects(promise, status, pattern) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof EngineError, `expected EngineError, got ${e && e.message}`);
    assert.equal(e.status, status, e.message);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });
}

// ── Definitions and versions ───────────────────────────────────────────────

test('a company document and a template can share a key, but not twice within one scope', async () => {
  const db = seedDb();
  await createDefinition(db, { companyId: null, title: 'FLHA' });
  await createDefinition(db, { companyId: 1, title: 'FLHA' });
  await rejects(createDefinition(db, { companyId: 1, title: 'FLHA' }), 409);
  await rejects(createDefinition(db, { companyId: null, title: 'FLHA' }), 409);
  await createDefinition(db, { companyId: 2, title: 'FLHA' });
});

test('saving a draft replaces its fields instead of piling them up', async () => {
  const db = seedDb();
  const { definition } = await createDefinition(db, { companyId: 1, title: 'Check' });
  await saveDraft(db, { companyId: 1, definitionId: definition.id, fields: FIELDS });
  await saveDraft(db, { companyId: 1, definitionId: definition.id, fields: [FIELDS[0]] });
  assert.equal(db.tables.document_fields.length, 1);
  assert.equal(db.tables.document_versions.length, 1);
});

test('a published version is immutable: editing starts a new draft and the old one stays', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const v1 = db.tables.document_versions[0];
  assert.equal(v1.status, 'published');
  const v1FieldCount = db.tables.document_fields.filter((f) => f.version_id === v1.id).length;

  const saved = await saveDraft(db, { companyId: 1, definitionId: id, title: 'Pre Shift v2', fields: [{ label: 'Only one', fieldType: 'short_text' }] });
  assert.equal(saved.versionNumber, 2);
  assert.equal(db.tables.document_fields.filter((f) => f.version_id === v1.id).length, v1FieldCount, 'v1 fields untouched');
  assert.equal(db.tables.document_versions.find((v) => v.id === v1.id).status, 'published');

  await publishDraft(db, { companyId: 1, definitionId: id });
  assert.equal(db.tables.document_versions.find((v) => v.id === v1.id).status, 'retired');
  assert.equal(db.tables.document_definitions[0].current_version_id, saved.versionId);
  assert.equal(db.tables.document_definitions[0].title, 'Pre Shift v2');
});

test('publish needs a draft with at least one field', async () => {
  const db = seedDb();
  const { definition } = await createDefinition(db, { companyId: 1, title: 'Empty' });
  await rejects(publishDraft(db, { companyId: 1, definitionId: definition.id }), 409, /at least one field/);
  await publishedDoc(db, { title: 'Other' });
  const d2 = db.tables.document_definitions.find((d) => d.title === 'Other');
  await rejects(publishDraft(db, { companyId: 1, definitionId: d2.id }), 409, /no draft/);
});

test('bad builder input is refused before anything is written', async () => {
  const db = seedDb();
  const { definition } = await createDefinition(db, { companyId: 1, title: 'Check' });
  await rejects(saveDraft(db, { companyId: 1, definitionId: definition.id, fields: [{ label: 'x', fieldType: 'nope' }] }), 400);
  await rejects(saveDraft(db, { companyId: 1, definitionId: definition.id, fields: FIELDS, rules: [{ ruleType: 'bogus' }] }), 400);
  assert.equal((db.tables.document_fields || []).length, 0);
});

// ── Tenant isolation ───────────────────────────────────────────────────────

test('another company cannot read, edit, publish or switch on a company document', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { companyId: 1 });
  await rejects(getDefinitionForBuilder(db, { companyId: 2, definitionId: id }), 404);
  await rejects(saveDraft(db, { companyId: 2, definitionId: id, fields: FIELDS }), 404);
  await rejects(publishDraft(db, { companyId: 2, definitionId: id }), 404);
  await rejects(setCompanyDocument(db, { companyId: 2, definitionId: id, isEnabled: true }), 404);
  await rejects(getDocumentForWorker(db, { companyId: 2, definitionId: id }), 404);
  await rejects(submitRecord(db, { session: { role: 'worker', userId: 31, companyId: 2, name: 'O' }, companyId: 2, definitionId: id, answers: {}, deps }), 404);
});

test('a company can use a FORA template but never edit it', async () => {
  const db = seedDb();
  const { definition } = await createDefinition(db, { companyId: null, title: 'FLHA' });
  await saveDraft(db, { companyId: null, definitionId: definition.id, fields: FIELDS });
  await publishDraft(db, { companyId: null, definitionId: definition.id });
  await rejects(saveDraft(db, { companyId: 1, definitionId: definition.id, fields: FIELDS }), 403, /Clone/);
  await rejects(publishDraft(db, { companyId: 1, definitionId: definition.id }), 403);
  const setting = await setCompanyDocument(db, { companyId: 1, definitionId: definition.id, isEnabled: true });
  assert.equal(setting.is_enabled, true);
  const listed = await listWorkerDocuments(db, { companyId: 1 });
  assert.equal(listed.documents.length, 1);
  assert.equal((await listWorkerDocuments(db, { companyId: 2 })).documents.length, 0);
});

// ── Cloning and switches ───────────────────────────────────────────────────

test('cloning copies the published template into an editable draft, once per company', async () => {
  const db = seedDb();
  const { definition: t } = await createDefinition(db, { companyId: null, title: 'FLHA' });
  await rejects(cloneTemplate(db, { companyId: 1, templateId: t.id }), 409, /no published/);
  await saveDraft(db, { companyId: null, definitionId: t.id, fields: FIELDS, rules: [WORKER_SIG_RULE], layout: { blocks: [1] } });
  await publishDraft(db, { companyId: null, definitionId: t.id });

  const out = await cloneTemplate(db, { companyId: 1, templateId: t.id });
  assert.equal(out.definition.company_id, 1);
  assert.equal(out.definition.template_id, t.id);
  const copied = db.tables.document_fields.filter((f) => f.version_id === out.draftVersionId);
  assert.equal(copied.length, 2);
  assert.equal(db.tables.document_rules.filter((r) => r.version_id === out.draftVersionId).length, 1);
  assert.deepEqual(db.tables.document_layouts.find((l) => l.version_id === out.draftVersionId).layout_json, { blocks: [1] });
  await rejects(cloneTemplate(db, { companyId: 1, templateId: t.id }), 409, /already has/);
  await rejects(cloneTemplate(db, { companyId: 1, templateId: out.definition.id }), 404, undefined);
});

test('a document cannot be switched on before it is published, and the worker list follows the switch', async () => {
  const db = seedDb();
  const { definition } = await createDefinition(db, { companyId: 1, title: 'Draft only' });
  await rejects(setCompanyDocument(db, { companyId: 1, definitionId: definition.id, isEnabled: true }), 409, /Publish/);
  const id = await publishedDoc(db, { enable: false, title: 'Live' });
  assert.equal((await listWorkerDocuments(db, { companyId: 1 })).documents.length, 0);
  await rejects(getDocumentForWorker(db, { companyId: 1, definitionId: id }), 404);
  await setCompanyDocument(db, { companyId: 1, definitionId: id, isEnabled: true });
  assert.equal((await listWorkerDocuments(db, { companyId: 1 })).documents.length, 1);
  await setCompanyDocument(db, { companyId: 1, definitionId: id, isEnabled: false });
  assert.equal((await listWorkerDocuments(db, { companyId: 1 })).documents.length, 0);
});

test('Brain defaults on, mute defaults off, both can be changed', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const listed = (await listCompanyDocuments(db, { companyId: 1 })).documents.find((d) => d.id === id);
  assert.equal(listed.brainEnabled, true);
  assert.equal(listed.ownerMuted, false);
  await setCompanyDocument(db, { companyId: 1, definitionId: id, brainEnabled: false, ownerMuted: true });
  const after = (await listCompanyDocuments(db, { companyId: 1 })).documents.find((d) => d.id === id);
  assert.equal(after.brainEnabled, false);
  assert.equal(after.ownerMuted, true);
  assert.equal(after.enabled, true, 'untouched flag keeps its value');
});

test('the worker view carries fields and signature steps, not the reviewer rules', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [WORKER_SIG_RULE, REVIEW_RULE] });
  const doc = await getDocumentForWorker(db, { companyId: 1, definitionId: id });
  assert.equal(doc.fields.length, 2);
  assert.deepEqual(doc.signatureSteps, [{ signer: 'worker' }]);
  assert.equal(JSON.stringify(doc).includes('reviewer_step'), false);
});

// ── Submitting ─────────────────────────────────────────────────────────────

test('a submit is refused for a document that is switched off', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { enable: false });
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, deps }), 403);
});

test('a submit files the record, snapshots the question text and stamps the author', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const out = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'Trench', risk: 'High' }, siteId: 5, deps });
  assert.equal(out.duplicate, false);
  assert.equal(out.record.status, 'submitted');
  assert.equal(out.record.submitted_by_roster_id, 11);
  assert.equal(out.record.site_id, 5);
  const answers = db.tables.document_answers.filter((a) => a.record_id === out.record.id);
  assert.deepEqual(answers.map((a) => [a.question_text, a.value_text]), [['Task', 'Trench'], ['Risk', 'High']]);
});

test('a client cannot pick its own author or company', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const out = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, deps, submitted_by_roster_id: 12, company_id: 2 });
  assert.equal(out.record.submitted_by_roster_id, 11);
  assert.equal(out.record.company_id, 1);
});

test('answers are validated: required, options, unknown keys', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: {}, deps }), 400, /required/);
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x', risk: 'Extreme' }, deps }), 400, /options/);
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x', sneaky: 1 }, deps }), 400, /Unknown field/);
  assert.equal((db.tables.document_records || []).length, 0);
});

test('a site from another company is refused, an unknown one is stored as text only', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const strict = { ...deps, resolveSiteId: async (raw) => (Number(raw) === 99 ? false : null) };
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, siteId: 99, deps: strict }), 403);
  const out = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, siteId: 12345, deps });
  assert.equal(out.record.site_id, null);
});

test('a replayed offline submit returns the first record and creates no second', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const a = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, clientSubmissionId: 'abc-1', deps });
  const b = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, clientSubmissionId: 'abc-1', deps });
  assert.equal(b.duplicate, true);
  assert.equal(b.record.id, a.record.id);
  assert.equal(db.tables.document_records.length, 1);
  assert.equal(db.tables.document_answers.length, 1);
});

test('a failure saving answers leaves no half-saved record behind', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  db.failOn('document_answers', 'insert');
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, deps }), 500);
  assert.equal(db.tables.document_records.length, 0);
});

test('a reviewer rule starts the record pending approval', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [REVIEW_RULE] });
  const out = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, deps });
  assert.equal(out.record.status, 'pending_approval');
});

// ── Signatures ─────────────────────────────────────────────────────────────

test('a required worker signature must be a receipt the server resolves', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [WORKER_SIG_RULE] });
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, deps }), 400, /Sign/);
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, signature: 'data:image/png;base64,AAAA', deps }), 400, /Sign/);
  const out = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, signature: 'rcpt:1/sig.png', deps });
  const sig = db.tables.document_signatures.find((s) => s.record_id === out.record.id);
  assert.equal(sig.kind, 'worker');
  assert.equal(sig.signer_roster_id, 11);
  assert.equal(sig.signer_name, 'Wes Worker', 'name comes from the session');
  assert.equal(sig.signature_path, '1/sig.png');
});

test('signing afterwards saves an unsigned record that only its author can finish', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [WORKER_SIG_RULE, REVIEW_RULE] });
  await rejects(submitRecord(db, { session: admin, companyId: 1, definitionId: id, answers: { task: 'x' }, signLater: true, deps }), 400, /individual/);
  const out = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, signLater: true, deps });
  assert.equal(out.record.awaiting_signature, true);
  assert.ok(out.record.signature_requested_at);
  assert.equal(db.tables.document_signatures?.length || 0, 0);

  await rejects(reviewRecord(db, { session: admin, companyId: 1, recordId: out.record.id, decision: 'approve' }), 409, /hasn't signed/);
  await rejects(signNow(db, { session: { ...worker, userId: 12 }, companyId: 1, recordId: out.record.id, signature: 'rcpt:1/s.png', deps }), 403);
  await rejects(signNow(db, { session: worker, companyId: 1, recordId: out.record.id, signature: 'forged', deps }), 400);
  await signNow(db, { session: worker, companyId: 1, recordId: out.record.id, signature: 'rcpt:1/s.png', pdfReceipt: 'rcpt:1/r.pdf', deps });
  const rec = db.tables.document_records[0];
  assert.equal(rec.awaiting_signature, false);
  assert.ok(rec.worker_signed_at);
  assert.equal(rec.pdf_path, '1/r.pdf');
  assert.equal(db.tables.document_signatures.length, 1);
  await rejects(signNow(db, { session: worker, companyId: 1, recordId: out.record.id, signature: 'rcpt:1/s2.png', deps }), 409);
});

test('a document with no signature rule cannot be signed afterwards', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, signLater: true, deps }), 400, /nothing to sign/);
});

test('crew signatures take the NAME from the roster and must be on this company\'s active roster', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const base = { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, deps };
  const ok = await submitRecord(db, { ...base, crew: [{ rosterId: 12, signature: 'rcpt:1/c.png', name: 'Forged Name' }] });
  const sig = db.tables.document_signatures.find((s) => s.record_id === ok.record.id);
  assert.equal(sig.signer_name, 'Cora Crew', 'a client-sent name is ignored');
  assert.equal(sig.kind, 'crew');

  await rejects(submitRecord(db, { ...base, crew: [{ rosterId: 31, signature: 'rcpt:1/c.png' }] }), 400, /roster/);
  await rejects(submitRecord(db, { ...base, crew: [{ rosterId: 13, signature: 'rcpt:1/c.png' }] }), 400, /roster/);
  await rejects(submitRecord(db, { ...base, crew: [{ rosterId: 999, signature: 'rcpt:1/c.png' }] }), 400, /roster/);
  await rejects(submitRecord(db, { ...base, crew: [{ rosterId: 11, signature: 'rcpt:1/c.png' }] }), 400, /own crew/);
  await rejects(submitRecord(db, { ...base, crew: [{ rosterId: 12, signature: 'rcpt:1/a.png' }, { rosterId: 12, signature: 'rcpt:1/b.png' }] }), 400, /only sign once/);
  await rejects(submitRecord(db, { ...base, crew: [{ rosterId: 12, signature: 'nope' }] }), 400, /still needs to sign/);
});

// ── Viewing and listing ────────────────────────────────────────────────────

async function fileThree(db, id) {
  const mine = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'mine' }, siteId: 5, deps });
  const sameSite = await submitRecord(db, { session: { ...worker, userId: 12, name: 'Cora Crew' }, companyId: 1, definitionId: id, answers: { task: 'cora' }, siteId: 5, deps });
  const elsewhere = await submitRecord(db, { session: { ...worker, userId: 12, name: 'Cora Crew' }, companyId: 1, definitionId: id, answers: { task: 'far' }, siteId: 6, deps });
  return { mine: mine.record, sameSite: sameSite.record, elsewhere: elsewhere.record };
}

test('a worker lists and reads only their own records', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const r = await fileThree(db, id);
  const list = await listRecords(db, { session: worker, companyId: 1 });
  assert.deepEqual(list.records.map((x) => x.id), [r.mine.id]);
  await rejects(getRecord(db, { session: worker, companyId: 1, recordId: r.sameSite.id }), 403);
  assert.equal((await getRecord(db, { session: worker, companyId: 1, recordId: r.mine.id })).answers.length, 1);
});

test('a supervisor sees records inside their scope only, a founder sees the company', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const r = await fileThree(db, id);
  const seen = (await listRecords(db, { session: supervisor, companyId: 1 })).records.map((x) => x.id).sort();
  assert.deepEqual(seen, [r.mine.id, r.sameSite.id].sort(), 'site 5 only');
  await rejects(getRecord(db, { session: supervisor, companyId: 1, recordId: r.elsewhere.id }), 403);
  assert.equal((await listRecords(db, { session: admin, companyId: 1 })).records.length, 3);
});

test('records never cross companies, even for a founder naming the wrong company', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const r = await fileThree(db, id);
  assert.equal((await listRecords(db, { session: admin, companyId: 2 })).records.length, 0);
  await rejects(getRecord(db, { session: admin, companyId: 2, recordId: r.mine.id }), 404);
});

// ── Review ─────────────────────────────────────────────────────────────────

test('a worker cannot review; a supervisor approves inside scope and leaves an approval signature', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [REVIEW_RULE] });
  const rec = (await submitRecord(db, { session: { ...worker, userId: 12, name: 'Cora Crew' }, companyId: 1, definitionId: id, answers: { task: 'x' }, siteId: 5, deps })).record;
  await rejects(reviewRecord(db, { session: worker, companyId: 1, recordId: rec.id, decision: 'approve' }), 403);
  const out = await reviewRecord(db, { session: supervisor, companyId: 1, recordId: rec.id, decision: 'approve' });
  assert.equal(out.status, 'approved');
  const sig = db.tables.document_signatures.find((s) => s.kind === 'approval');
  assert.equal(sig.signer_roster_id, 21);
  assert.equal(sig.signer_name, 'Sue Super');
  await rejects(reviewRecord(db, { session: supervisor, companyId: 1, recordId: rec.id, decision: 'approve' }), 409, /not waiting/);
});

test('a supervisor outside the record\'s scope cannot review it', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [REVIEW_RULE] });
  const rec = (await submitRecord(db, { session: { ...worker, userId: 12, name: 'Cora Crew' }, companyId: 1, definitionId: id, answers: { task: 'x' }, siteId: 5, deps })).record;
  await rejects(reviewRecord(db, { session: { ...supervisor, userId: 22, name: 'Sam Other' }, companyId: 1, recordId: rec.id, decision: 'approve' }), 403);
});

test('nobody reviews their own document', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [REVIEW_RULE] });
  const rec = (await submitRecord(db, { session: supervisor, companyId: 1, definitionId: id, answers: { task: 'x' }, siteId: 5, deps })).record;
  await rejects(reviewRecord(db, { session: supervisor, companyId: 1, recordId: rec.id, decision: 'approve' }), 403, /your own/);
});

test('returning needs a reason, then the worker fixes the same record and it goes back to review', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [REVIEW_RULE] });
  const rec = (await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'wrong' }, siteId: 5, deps })).record;
  await rejects(reviewRecord(db, { session: supervisor, companyId: 1, recordId: rec.id, decision: 'return' }), 400, /what needs fixing/);
  await reviewRecord(db, { session: supervisor, companyId: 1, recordId: rec.id, decision: 'return', reason: 'Wrong task' });
  const returned = db.tables.document_records[0];
  assert.equal(returned.status, 'returned');
  assert.equal(returned.returned_reason, 'Wrong task');

  await rejects(resubmitRecord(db, { session: { ...worker, userId: 12 }, companyId: 1, recordId: rec.id, answers: { task: 'x' }, deps }), 403);
  await rejects(resubmitRecord(db, { session: worker, companyId: 1, recordId: rec.id, answers: {}, deps }), 400, /required/);
  await resubmitRecord(db, { session: worker, companyId: 1, recordId: rec.id, answers: { task: 'right' }, deps });
  const fixed = db.tables.document_records[0];
  assert.equal(fixed.id, rec.id, 'same record');
  assert.equal(fixed.status, 'pending_approval');
  assert.equal(fixed.returned_reason, null);
  assert.deepEqual(db.tables.document_answers.map((a) => a.value_text), ['right']);
  await rejects(resubmitRecord(db, { session: worker, companyId: 1, recordId: rec.id, answers: { task: 'again' }, deps }), 409, /not sent back/);
});

test('review and records ignore a record id from another company', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [REVIEW_RULE] });
  const rec = (await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, deps })).record;
  await rejects(reviewRecord(db, { session: { role: 'supervisor', userId: 32, companyId: 2, name: 'x' }, companyId: 2, recordId: rec.id, decision: 'approve' }), 404);
  await rejects(signNow(db, { session: worker, companyId: 2, recordId: rec.id, signature: 'rcpt:x', deps }), 404);
});

// ── Hardening from the tenant review ───────────────────────────────────────

test('picker and crew-signature fields cannot be answered until their ids are validated', async () => {
  const db = seedDb();
  const fields = [
    { label: 'Task', fieldType: 'short_text' },
    { label: 'Machine', fieldType: 'equipment_picker' },
  ];
  const id = await publishedDoc(db, { fields });
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x', machine: { equipmentId: 777 } }, deps }), 400, /can't be answered yet/);
  const ok = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, deps });
  assert.equal(ok.record.status, 'submitted', 'leaving the picker blank still works');
});

test('a coworker reusing a client submission id is not handed the first record', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  const a = await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'mine' }, clientSubmissionId: 'same-id', deps });
  const b = await submitRecord(db, { session: { ...worker, userId: 12, name: 'Cora Crew' }, companyId: 1, definitionId: id, answers: { task: 'hers' }, clientSubmissionId: 'same-id', deps });
  assert.equal(b.duplicate, false);
  assert.notEqual(b.record.id, a.record.id);
});

test('an archived document cannot be opened or filed', async () => {
  const db = seedDb();
  const id = await publishedDoc(db);
  db.tables.document_definitions.find((d) => d.id === id).archived_at = new Date().toISOString();
  await rejects(getDocumentForWorker(db, { companyId: 1, definitionId: id }), 404);
  await rejects(submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, deps }), 403);
  assert.equal((await listWorkerDocuments(db, { companyId: 1 })).documents.length, 0);
});

test('approving twice writes one approval, not two', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [REVIEW_RULE] });
  const rec = (await submitRecord(db, { session: { ...worker, userId: 12, name: 'Cora Crew' }, companyId: 1, definitionId: id, answers: { task: 'x' }, siteId: 5, deps })).record;
  const results = await Promise.allSettled([
    reviewRecord(db, { session: supervisor, companyId: 1, recordId: rec.id, decision: 'approve' }),
    reviewRecord(db, { session: supervisor, companyId: 1, recordId: rec.id, decision: 'approve' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(db.tables.document_signatures.filter((s) => s.kind === 'approval').length, 1);
});

test('a failed approval signature puts the record back to waiting', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [REVIEW_RULE] });
  const rec = (await submitRecord(db, { session: { ...worker, userId: 12, name: 'Cora Crew' }, companyId: 1, definitionId: id, answers: { task: 'x' }, siteId: 5, deps })).record;
  db.failOn('document_signatures', 'insert');
  await rejects(reviewRecord(db, { session: supervisor, companyId: 1, recordId: rec.id, decision: 'approve' }), 500);
  assert.equal(db.tables.document_records[0].status, 'pending_approval');
});

test('signing twice at once writes one signature', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [WORKER_SIG_RULE] });
  const rec = (await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, signLater: true, deps })).record;
  const results = await Promise.allSettled([
    signNow(db, { session: worker, companyId: 1, recordId: rec.id, signature: 'rcpt:1/a.png', deps }),
    signNow(db, { session: worker, companyId: 1, recordId: rec.id, signature: 'rcpt:1/b.png', deps }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(db.tables.document_signatures.filter((s) => s.kind === 'worker').length, 1);
});

test('a failed signature save puts the record back to awaiting', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [WORKER_SIG_RULE] });
  const rec = (await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'x' }, signLater: true, deps })).record;
  db.failOn('document_signatures', 'insert');
  await rejects(signNow(db, { session: worker, companyId: 1, recordId: rec.id, signature: 'rcpt:1/a.png', deps }), 500);
  assert.equal(db.tables.document_records[0].awaiting_signature, true);
});

test('resubmitting twice at once only lands once, and a failure puts the record back as returned', async () => {
  const db = seedDb();
  const id = await publishedDoc(db, { rules: [REVIEW_RULE] });
  const rec = (await submitRecord(db, { session: worker, companyId: 1, definitionId: id, answers: { task: 'wrong' }, siteId: 5, deps })).record;
  await reviewRecord(db, { session: supervisor, companyId: 1, recordId: rec.id, decision: 'return', reason: 'fix it' });
  const results = await Promise.allSettled([
    resubmitRecord(db, { session: worker, companyId: 1, recordId: rec.id, answers: { task: 'a' }, deps }),
    resubmitRecord(db, { session: worker, companyId: 1, recordId: rec.id, answers: { task: 'b' }, deps }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(db.tables.document_answers.length, 1);

  const db2 = seedDb();
  const id2 = await publishedDoc(db2, { rules: [REVIEW_RULE] });
  const r2 = (await submitRecord(db2, { session: worker, companyId: 1, definitionId: id2, answers: { task: 'wrong' }, siteId: 5, deps })).record;
  await reviewRecord(db2, { session: supervisor, companyId: 1, recordId: r2.id, decision: 'return', reason: 'fix it' });
  db2.failOn('document_answers', 'insert');
  await rejects(resubmitRecord(db2, { session: worker, companyId: 1, recordId: r2.id, answers: { task: 'z' }, deps }), 500);
  assert.equal(db2.tables.document_records[0].status, 'returned');
  assert.equal(db2.tables.document_records[0].returned_reason, 'fix it');
});
