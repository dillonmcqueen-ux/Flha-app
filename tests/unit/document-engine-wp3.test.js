// WP3: the rules that do things. Reviewer chain, notifications, escalations,
// the Brain signal, the inbox, and the time-based sweeps, driven against the
// in-memory client (tests/unit/_fakeDb.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './_fakeDb.js';
import {
  EngineError, createDefinition, saveDraft, publishDraft, setCompanyDocument, submitRecord, resubmitRecord, signNow,
  reviewRecord, myInbox, listEscalations, actionEscalation, setOwnerMute, getRecord,
} from '../../server-lib/documentEngine/service.js';
import { closeStaleUnsignedEngine, alertOverdueUnsignedEngine, escalateStalePending } from '../../server-lib/documentEngine/sweeps.js';
import { runDigest } from '../../server-lib/notifyDigest.js';
import { routeNotification } from '../../server-lib/notifyRouting.js';

const mail = () => {
  const sent = [];
  return { sent, sendEmail: async (m) => { sent.push(m); } };
};
const mkDeps = (m) => ({
  resolveFile: (v) => (typeof v === 'string' && v.startsWith('rcpt:') ? v.slice(5) : null),
  resolveSiteId: async (raw) => (Number(raw) === 5 ? 5 : null),
  sendEmail: m ? m.sendEmail : null,
});

const worker = { role: 'worker', userId: 11, companyId: 1, name: 'Wes Worker' };
const lead = { role: 'worker', userId: 12, companyId: 1, name: 'Lena Lead' };
const supA = { role: 'supervisor', userId: 21, companyId: 1, name: 'Sue Super' };
const supB = { role: 'supervisor', userId: 23, companyId: 1, name: 'Bo Super' };
const owner = { role: 'supervisor', userId: 24, companyId: 1, name: 'Olive Owner', isOwner: true };
const founder = { role: 'admin' };

function seed(extra = {}) {
  return makeDb({
    sites: [{ id: 5, company_id: 1, name: 'North Yard' }],
    companies: [{ id: 1, suspended: false }, { id: 2, suspended: false }],
    roster: [
      { id: 11, company_id: 1, name: 'Wes Worker', role: 'worker', active: true, email: 'wes@x.test', departments: ['crew1'], divisions: [], default_site_id: 5 },
      { id: 12, company_id: 1, name: 'Lena Lead', role: 'worker', active: true, is_lead: true, email: 'lena@x.test', departments: ['crew1'], divisions: [], default_site_id: null },
      { id: 13, company_id: 1, name: 'Lou Lead', role: 'worker', active: true, is_lead: true, email: 'lou@x.test', departments: ['crew1'], divisions: [], default_site_id: null },
      { id: 15, company_id: 1, name: 'Out Crew', role: 'worker', active: true, email: 'out@x.test', departments: ['crew9'], divisions: [], default_site_id: 99 },
      { id: 21, company_id: 1, name: 'Sue Super', role: 'supervisor', active: true, is_owner: false, email: 'sue@x.test', default_site_id: 5, departments: [], divisions: [] },
      { id: 23, company_id: 1, name: 'Bo Super', role: 'supervisor', active: true, is_owner: false, email: 'bo@x.test', default_site_id: 5, departments: [], divisions: [] },
      { id: 24, company_id: 1, name: 'Olive Owner', role: 'supervisor', active: true, is_owner: true, email: 'olive@x.test', default_site_id: null, departments: [], divisions: [] },
      { id: 25, company_id: 1, name: 'Sal Safety', role: 'supervisor', active: true, is_owner: false, email: 'sal@x.test', default_site_id: 99, departments: ['safety'], divisions: [] },
      { id: 31, company_id: 2, name: 'Other Oscar', role: 'supervisor', active: true, is_owner: true, email: 'oscar@other.test', default_site_id: 5, departments: ['safety'], divisions: [] },
    ],
    ...extra,
  });
}

const FIELDS = [
  { label: 'Task', fieldType: 'short_text', required: true },
  { label: 'Injury?', fieldType: 'yesno' },
  { label: 'Risk', fieldType: 'dropdown', config: { options: ['Low', 'High'] } },
  { label: 'Notes', fieldType: 'long_text' },
];
const REVIEW = (config = {}) => ({ ruleType: 'reviewer_step', config });
const SIGN = { ruleType: 'signature_step', config: { signer: 'worker' } };

async function doc(db, { rules = [], fields = FIELDS, title = 'Pre Shift', setting = {} } = {}) {
  const { definition } = await createDefinition(db, { companyId: 1, title });
  await saveDraft(db, { companyId: 1, definitionId: definition.id, title, fields, rules });
  await publishDraft(db, { companyId: 1, definitionId: definition.id });
  await setCompanyDocument(db, { companyId: 1, definitionId: definition.id, isEnabled: true, ...setting });
  return definition.id;
}

const file = (db, id, session, extra = {}, m) => submitRecord(db, {
  session, companyId: 1, definitionId: id, answers: { task: 'Trench' }, siteId: 5, deps: mkDeps(m), ...extra,
});

async function rejects(promise, status, pattern) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof EngineError, `expected EngineError, got ${e && e.message}`);
    assert.equal(e.status, status, e.message);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });
}

// ── Reviewer chain ─────────────────────────────────────────────────────────

test('a two step chain: each step is a signature, the second needs a different person', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW({ label: 'Supervisor' }), REVIEW({ label: 'Second look' })] });
  const rec = (await file(db, id, worker)).record;
  assert.equal(rec.status, 'pending_approval');

  const first = await reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' });
  assert.deepEqual(first, { status: 'pending_approval', step: 1 });
  assert.equal(db.tables.document_records[0].review_step, 1);
  await rejects(reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' }), 403, /different person/);

  const second = await reviewRecord(db, { session: supB, companyId: 1, recordId: rec.id, decision: 'approve' });
  assert.deepEqual(second, { status: 'approved' });
  assert.deepEqual(db.tables.document_signatures.filter((s) => s.kind === 'approval').map((s) => [s.step_key, s.signer_roster_id]), [['review_0', 21], ['review_1', 23]]);
  await rejects(reviewRecord(db, { session: supB, companyId: 1, recordId: rec.id, decision: 'approve' }), 409, /not waiting/);
});

test('an owner step is for the Owner and the founder only', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW({ role: 'owner' })] });
  const rec = (await file(db, id, worker)).record;
  await rejects(reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' }), 403);
  assert.equal((await reviewRecord(db, { session: owner, companyId: 1, recordId: rec.id, decision: 'approve' })).status, 'approved');
  const rec2 = (await file(db, id, worker)).record;
  assert.equal((await reviewRecord(db, { session: founder, companyId: 1, recordId: rec2.id, decision: 'approve' })).status, 'approved');
});

test('a crew lead reviews their own crew on a step that allows leads, and nobody else', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW({ allowLeads: true })] });
  const crewRec = (await file(db, id, worker)).record;
  const leadRec = (await file(db, id, { ...worker, userId: 13, name: 'Lou Lead' })).record;
  const outsider = (await file(db, id, { ...worker, userId: 15, name: 'Out Crew' }, { siteId: undefined })).record;

  await rejects(reviewRecord(db, { session: lead, companyId: 1, recordId: leadRec.id, decision: 'approve' }), 403, /needs a supervisor/);
  await rejects(reviewRecord(db, { session: lead, companyId: 1, recordId: outsider.id, decision: 'approve' }), 403);
  assert.equal((await reviewRecord(db, { session: lead, companyId: 1, recordId: crewRec.id, decision: 'approve' })).status, 'approved');
  assert.equal(db.tables.document_signatures.find((s) => s.kind === 'approval').signer_role, 'lead');
});

test('a lead cannot approve their own, nor on a step that does not allow leads, and a plain worker never can', async () => {
  const db = seed();
  const open = await doc(db, { rules: [REVIEW({ allowLeads: true })], title: 'Open' });
  const closed = await doc(db, { rules: [REVIEW({})], title: 'Closed' });
  const own = (await file(db, open, lead)).record;
  await rejects(reviewRecord(db, { session: lead, companyId: 1, recordId: own.id, decision: 'approve' }), 403, /your own/);
  const noLeads = (await file(db, closed, worker)).record;
  await rejects(reviewRecord(db, { session: lead, companyId: 1, recordId: noLeads.id, decision: 'approve' }), 403);
  const someone = (await file(db, open, worker)).record;
  await rejects(reviewRecord(db, { session: { ...worker, userId: 15, name: 'Out Crew' }, companyId: 1, recordId: someone.id, decision: 'approve' }), 403);
});

test('two reviewers approving the same step at once only count once', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW(), REVIEW()] });
  const rec = (await file(db, id, worker)).record;
  const results = await Promise.allSettled([
    reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' }),
    reviewRecord(db, { session: supB, companyId: 1, recordId: rec.id, decision: 'approve' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(db.tables.document_records[0].review_step, 1);
  assert.equal(db.tables.document_signatures.filter((s) => s.kind === 'approval').length, 1);
});

test('returning, then fixing, restarts the chain from its first step', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW(), REVIEW()] });
  const rec = (await file(db, id, worker)).record;
  await reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' });
  await reviewRecord(db, { session: supB, companyId: 1, recordId: rec.id, decision: 'return', reason: 'Wrong site' });
  assert.equal(db.tables.document_records[0].status, 'returned');
  await resubmitRecord(db, { session: worker, companyId: 1, recordId: rec.id, answers: { task: 'Fixed' }, deps: mkDeps() });
  assert.equal(db.tables.document_records[0].review_step, 0);
  assert.equal(db.tables.document_records[0].status, 'pending_approval');
});

// ── Notifications ──────────────────────────────────────────────────────────

test('a reviewer step tells the people who can open the record, never the author', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW()] });
  const m = mail();
  await file(db, id, worker, {}, m);
  const to = m.sent.map((x) => x.to).sort();
  assert.deepEqual(to, ['bo@x.test', 'lena@x.test', 'lou@x.test', 'sue@x.test'], 'supervisors at the site plus the leads of the author\'s crew');
  assert.ok(m.sent.every((x) => x.subject === 'New Pre Shift at North Yard'));
  const body = m.sent.map((x) => `${x.subject} ${x.text}`).join(' ');
  assert.equal(body.includes('Trench'), false, 'no answers in the email');
  assert.equal(body.includes('Wes'), false, 'no author in the email');
});

test('a document with no notify rule and no reviewer tells nobody', async () => {
  const db = seed();
  const id = await doc(db);
  const m = mail();
  await file(db, id, worker, {}, m);
  assert.equal(m.sent.length, 0);
});

test('the Owner can mute a document, and unmute it', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW()] });
  await setOwnerMute(db, { companyId: 1, definitionId: id, muted: true });
  const m = mail();
  await file(db, id, worker, {}, m);
  assert.equal(m.sent.length, 0);
  await setOwnerMute(db, { companyId: 1, definitionId: id, muted: false });
  await file(db, id, worker, { clientSubmissionId: 'again' }, m);
  assert.ok(m.sent.length > 0);
  await rejects(setOwnerMute(db, { companyId: 1, definitionId: id, muted: 'yes' }), 400);
});

test('no mail key means no email and no failure', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW()] });
  const out = await file(db, id, worker, {}, null);
  assert.equal(out.record.status, 'pending_approval');
});

test('a notify rule can add named people and whole departments', async () => {
  const db = seed();
  const id = await doc(db, { rules: [{ ruleType: 'notify', config: { extraRosterIds: [24], departments: ['safety'] } }] });
  const m = mail();
  await file(db, id, worker, {}, m);
  const to = m.sent.map((x) => x.to).sort();
  assert.ok(to.includes('olive@x.test'), 'the named Owner');
  assert.ok(to.includes('sal@x.test'), 'the safety supervisor, though not at this site');
  assert.ok(!to.some((a) => a.endsWith('other.test')), 'never another company');
});

test('a person is told at most three times per window, the rest are held for the digest', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW()] });
  const m = mail();
  for (let i = 0; i < 5; i += 1) await file(db, id, worker, { clientSubmissionId: `s${i}` }, m);
  assert.equal(m.sent.filter((x) => x.to === 'sue@x.test').length, 3);
});

test('a suspended company is not emailed', async () => {
  const db = seed({ companies: [{ id: 1, suspended: true }] });
  const id = await doc(db, { rules: [REVIEW()] });
  const m = mail();
  await file(db, id, worker, {}, m);
  assert.equal(m.sent.length, 0);
});

test('the next reviewer is told when a step is approved, the one who approved is not', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW(), REVIEW()] });
  const rec = (await file(db, id, worker)).record;
  const m = mail();
  await reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve', deps: mkDeps(m) });
  const to = m.sent.map((x) => x.to);
  assert.ok(to.includes('bo@x.test'));
  assert.ok(!to.includes('sue@x.test'));
  assert.ok(!to.includes('wes@x.test'));
});

test('a returned document emails its author without the reason, and respects the mute', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW()] });
  const rec = (await file(db, id, worker)).record;
  const m = mail();
  await reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'return', reason: 'Secret detail about Jamie', deps: mkDeps(m) });
  assert.deepEqual(m.sent.map((x) => x.to), ['wes@x.test']);
  assert.match(m.sent[0].subject, /sent back/);
  assert.equal(m.sent[0].text.includes('Secret'), false);

  const db2 = seed();
  const id2 = await doc(db2, { rules: [REVIEW()] });
  await setOwnerMute(db2, { companyId: 1, definitionId: id2, muted: true });
  const rec2 = (await file(db2, id2, worker)).record;
  const m2 = mail();
  await reviewRecord(db2, { session: supA, companyId: 1, recordId: rec2.id, decision: 'return', reason: 'x', deps: mkDeps(m2) });
  assert.equal(m2.sent.length, 0);
});

test('a sign-afterwards record tells nobody until it is signed', async () => {
  const db = seed();
  const id = await doc(db, { rules: [SIGN, REVIEW()] });
  const m = mail();
  const rec = (await file(db, id, worker, { signLater: true }, m)).record;
  assert.equal(m.sent.length, 0);
  await signNow(db, { session: worker, companyId: 1, recordId: rec.id, signature: 'rcpt:1/s.png', deps: mkDeps(m) });
  assert.ok(m.sent.length > 0);
});

// ── Escalations ────────────────────────────────────────────────────────────

const ROUTE = { ruleType: 'route_by_answer', config: { fieldKey: 'injury', equals: 'yes', department: 'safety' } };

test('a routing rule must point at a real routable field and a real department', async () => {
  const db = seed();
  const { definition } = await createDefinition(db, { companyId: 1, title: 'Bad routes' });
  const bad = (rule) => rejects(saveDraft(db, { companyId: 1, definitionId: definition.id, fields: FIELDS, rules: [rule] }), 400);
  await bad({ ruleType: 'route_by_answer', config: { fieldKey: 'nope', equals: 'yes', department: 'safety' } });
  await bad({ ruleType: 'route_by_answer', config: { fieldKey: 'notes', equals: 'yes', department: 'safety' } });
  await bad({ ruleType: 'route_by_answer', config: { fieldKey: 'injury', equals: 'yes', department: 'catering' } });
  await bad({ ruleType: 'notify', config: { departments: ['catering'] } });
  await saveDraft(db, { companyId: 1, definitionId: definition.id, fields: FIELDS, rules: [ROUTE] });
});

test('a matching answer files an escalation and tells the department, never the answer', async () => {
  const db = seed();
  const id = await doc(db, { rules: [ROUTE] });
  const m = mail();
  const rec = (await file(db, id, worker, { answers: { task: 'Trench', injury: 'yes' } }, m)).record;
  const esc = db.tables.document_escalations;
  assert.equal(esc.length, 1);
  assert.deepEqual([esc[0].record_id, esc[0].field_key, esc[0].trigger_value, esc[0].target_department, esc[0].status], [rec.id, 'injury', 'yes', 'safety', 'open']);
  assert.deepEqual(m.sent.map((x) => x.to), ['sal@x.test']);
  assert.match(m.sent[0].subject, /routed to Safety/);
  assert.equal(m.sent[0].text.includes('Injury'), false, 'not even the question');
});

test('a non matching answer escalates nothing, and an empty department falls back to the Owner', async () => {
  const db = seed();
  const id = await doc(db, { rules: [ROUTE] });
  const m = mail();
  await file(db, id, worker, { answers: { task: 'x', injury: 'no' } }, m);
  assert.equal((db.tables.document_escalations || []).length, 0);

  const db2 = seed();
  db2.tables.roster = db2.tables.roster.filter((r) => r.id !== 25);
  const id2 = await doc(db2, { rules: [ROUTE] });
  const m2 = mail();
  await file(db2, id2, worker, { answers: { task: 'x', injury: 'yes' } }, m2);
  assert.deepEqual(m2.sent.map((x) => x.to), ['olive@x.test']);
});

test('an escalation is filed once the record counts, not while it waits for a signature', async () => {
  const db = seed();
  const id = await doc(db, { rules: [SIGN, ROUTE] });
  const rec = (await file(db, id, worker, { answers: { task: 'x', injury: 'yes' }, signLater: true })).record;
  assert.equal((db.tables.document_escalations || []).length, 0);
  await signNow(db, { session: worker, companyId: 1, recordId: rec.id, signature: 'rcpt:1/s.png', deps: mkDeps() });
  assert.equal(db.tables.document_escalations.length, 1);
});

test('a returned record that is fixed does not escalate the same field twice', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW(), ROUTE] });
  const rec = (await file(db, id, worker, { answers: { task: 'x', injury: 'yes' } })).record;
  await reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'return', reason: 'fix' });
  await resubmitRecord(db, { session: worker, companyId: 1, recordId: rec.id, answers: { task: 'y', injury: 'yes' }, deps: mkDeps() });
  assert.equal(db.tables.document_escalations.length, 1);
});

test('escalations are seen and actioned by their department, the Owner and the founder only', async () => {
  const db = seed();
  const id = await doc(db, { rules: [ROUTE] });
  await file(db, id, worker, { answers: { task: 'x', injury: 'yes' } });
  const safety = { role: 'supervisor', userId: 25, companyId: 1, name: 'Sal Safety' };
  assert.equal((await listEscalations(db, { session: safety, companyId: 1 })).escalations.length, 1);
  assert.equal((await listEscalations(db, { session: supA, companyId: 1 })).escalations.length, 0);
  assert.equal((await listEscalations(db, { session: owner, companyId: 1 })).escalations.length, 1);
  assert.equal((await listEscalations(db, { session: founder, companyId: 1 })).escalations.length, 1);
  await rejects(listEscalations(db, { session: worker, companyId: 1 }), 403);
  const eid = db.tables.document_escalations[0].id;
  await rejects(actionEscalation(db, { session: supA, companyId: 1, escalationId: eid }), 403);
  await rejects(actionEscalation(db, { session: founder, companyId: 2, escalationId: eid }), 404);
  await actionEscalation(db, { session: safety, companyId: 1, escalationId: eid });
  await rejects(actionEscalation(db, { session: safety, companyId: 1, escalationId: eid }), 409);
  assert.equal(db.tables.document_escalations[0].actioned_by_roster_id, 25);
  assert.equal((await listEscalations(db, { session: owner, companyId: 1, status: 'open' })).escalations.length, 0);
});

test('a failure writing escalations never fails the submit', async () => {
  const db = seed();
  const id = await doc(db, { rules: [ROUTE] });
  db.failOn('document_escalations', 'insert');
  const out = await file(db, id, worker, { answers: { task: 'x', injury: 'yes' } });
  assert.equal(out.record.status, 'submitted');
});

// ── Brain ──────────────────────────────────────────────────────────────────

test('a filed document tells the Brain option answers and flagged questions, nothing personal', async () => {
  const db = seed();
  const id = await doc(db, { rules: [ROUTE] });
  await file(db, id, worker, { answers: { task: 'Jamie fell', injury: 'yes', risk: 'High', notes: 'Private note' } });
  const sig = db.tables.company_signals[0];
  assert.equal(sig.source_type, 'engine_document');
  assert.equal(sig.company_id, 1);
  const json = JSON.stringify(sig.signal_json);
  assert.deepEqual(sig.signal_json.answers.map((a) => a.answer).sort(), ['High', 'yes']);
  assert.deepEqual(sig.signal_json.flagged, [{ question: 'Injury?', department: 'safety' }]);
  for (const secret of ['Jamie', 'Private', 'Wes']) assert.equal(json.includes(secret), false, secret);
});

test('Brain off for a document, or a record still unsigned, writes no signal', async () => {
  const db = seed();
  const id = await doc(db, { setting: { brainEnabled: false } });
  await file(db, id, worker, { answers: { task: 'x', risk: 'High' } });
  assert.equal((db.tables.company_signals || []).length, 0);

  const db2 = seed();
  const id2 = await doc(db2, { rules: [SIGN] });
  const rec = (await file(db2, id2, worker, { answers: { task: 'x', risk: 'High' }, signLater: true })).record;
  assert.equal((db2.tables.company_signals || []).length, 0);
  await signNow(db2, { session: worker, companyId: 1, recordId: rec.id, signature: 'rcpt:1/s.png', deps: mkDeps() });
  assert.equal(db2.tables.company_signals.length, 1);
});

// ── Inbox ──────────────────────────────────────────────────────────────────

test('the inbox lists what is sent back, what needs a signature, and what a reviewer can act on', async () => {
  const db = seed();
  const id = await doc(db, { rules: [SIGN, REVIEW({ allowLeads: true })] });
  const sent = (await file(db, id, worker, { signature: 'rcpt:1/s.png' })).record;
  await file(db, id, worker, { signLater: true, clientSubmissionId: 'later' });
  await reviewRecord(db, { session: supA, companyId: 1, recordId: sent.id, decision: 'return', reason: 'fix' });
  const again = (await file(db, id, worker, { signature: 'rcpt:1/s.png', clientSubmissionId: 'third' })).record;

  const mine = await myInbox(db, { session: worker, companyId: 1 });
  assert.deepEqual(mine.mine.map((i) => i.kind).sort(), ['returned', 'sign']);
  assert.equal(mine.mine.find((i) => i.kind === 'returned').reason, 'fix');
  assert.equal(mine.review.length, 0);

  const sup = await myInbox(db, { session: supB, companyId: 1 });
  assert.deepEqual(sup.review.map((i) => i.recordId), [again.id], 'the unsigned one is not reviewable yet');
  const lead = await myInbox(db, { session: { ...worker, userId: 12, name: 'Lena Lead' }, companyId: 1 });
  assert.deepEqual(lead.review.map((i) => i.recordId), [again.id], 'a lead sees their crew\'s record on a step that allows leads');
  const nobody = await myInbox(db, { session: { ...worker, userId: 15, name: 'Out Crew' }, companyId: 1 });
  assert.equal(nobody.counts.total, 0);
  assert.equal((await myInbox(db, { session: founder, companyId: 1 })).review.length, 1);
});

// ── Sweeps ─────────────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

async function unsignedRecord(db, id, hoursAgo, extra = {}) {
  const rec = (await file(db, id, worker, { signLater: true, clientSubmissionId: `u${Math.random()}` })).record;
  const row = db.tables.document_records.find((r) => r.id === rec.id);
  row.signature_requested_at = ago(hoursAgo * HOUR);
  Object.assign(row, extra);
  return row;
}

test('an unsigned record gets one heads-up after 24 hours, to the people who would be told, and only once', async () => {
  const db = seed();
  const id = await doc(db, { rules: [SIGN, REVIEW()], title: 'Pre Shift' });
  const fresh = await unsignedRecord(db, id, 2);
  const old = await unsignedRecord(db, id, 30);
  const m = mail();
  const out = await alertOverdueUnsignedEngine(db, { sendEmail: m.sendEmail });
  assert.equal(out.alerted, 1);
  assert.ok(m.sent.length > 0);
  assert.ok(m.sent.every((x) => /1 Pre Shift still unsigned/.test(x.subject)));
  assert.ok(m.sent.every((x) => x.to !== 'wes@x.test'), 'not the author');
  assert.ok(db.tables.document_records.find((r) => r.id === old.id).unsigned_alerted_at);
  assert.equal(db.tables.document_records.find((r) => r.id === fresh.id).unsigned_alerted_at, null);
  const again = await alertOverdueUnsignedEngine(db, { sendEmail: m.sendEmail });
  assert.equal(again.alerted, 0);
});

test('the unsigned heads-up respects the mute and hands the claim back when nobody can be told', async () => {
  const db = seed();
  const id = await doc(db, { rules: [SIGN, REVIEW()], setting: { ownerMuted: true } });
  await unsignedRecord(db, id, 30);
  const m = mail();
  await alertOverdueUnsignedEngine(db, { sendEmail: m.sendEmail });
  assert.equal(m.sent.length, 0);

  // Somebody is due to be told but every send fails: the claim is handed back, retried next run.
  const db2 = seed();
  const id2 = await doc(db2, { rules: [SIGN, REVIEW()] });
  const row = await unsignedRecord(db2, id2, 30);
  const out = await alertOverdueUnsignedEngine(db2, { sendEmail: async () => { throw new Error('mail is down'); } });
  assert.equal(out.alerted, 0);
  assert.ok(out.failed > 0);
  assert.equal(db2.tables.document_records.find((r) => r.id === row.id).unsigned_alerted_at, null, 'retried next run');

  // Nobody on the roster has an address: stamped and left alone, so it cannot hold up the queue forever.
  const db3 = seed();
  db3.tables.roster.forEach((r) => { r.email = null; });
  const id3 = await doc(db3, { rules: [SIGN, REVIEW()] });
  const row3 = await unsignedRecord(db3, id3, 30);
  await alertOverdueUnsignedEngine(db3, { sendEmail: mail().sendEmail });
  assert.ok(db3.tables.document_records.find((r) => r.id === row3.id).unsigned_alerted_at);
});

test('a record unsigned for 10 days closes, only after its heads-up, and can no longer be signed', async () => {
  const db = seed();
  const id = await doc(db, { rules: [SIGN] });
  const alerted = await unsignedRecord(db, id, 24 * 11, { unsigned_alerted_at: ago(24 * 10 * HOUR) });
  const silent = await unsignedRecord(db, id, 24 * 11);
  const young = await unsignedRecord(db, id, 24 * 3, { unsigned_alerted_at: ago(HOUR) });
  assert.equal(await closeStaleUnsignedEngine(db), 1);
  assert.ok(db.tables.document_records.find((r) => r.id === alerted.id).unsigned_closed_at);
  assert.equal(db.tables.document_records.find((r) => r.id === silent.id).unsigned_closed_at, null);
  assert.equal(db.tables.document_records.find((r) => r.id === young.id).unsigned_closed_at, null);
  await rejects(signNow(db, { session: worker, companyId: 1, recordId: alerted.id, signature: 'rcpt:1/s.png', deps: mkDeps() }), 409, /closed unsigned/);
  assert.equal((await myInbox(db, { session: worker, companyId: 1 })).mine.some((i) => i.recordId === alerted.id), false);
});

test('a record waiting 48 hours for review escalates once to the Owner', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW()] });
  const old = (await file(db, id, worker)).record;
  const fresh = (await file(db, id, worker, { clientSubmissionId: 'f' })).record;
  db.tables.document_records.find((r) => r.id === old.id).submitted_at = ago(50 * HOUR);
  const m = mail();
  const out = await escalateStalePending(db, { sendEmail: m.sendEmail });
  assert.deepEqual([out.escalated, out.emailed], [1, 1]);
  assert.deepEqual(m.sent.map((x) => x.to), ['olive@x.test']);
  assert.match(m.sent[0].subject, /1 document waiting for review/);
  assert.ok(db.tables.document_records.find((r) => r.id === old.id).review_alerted_at);
  assert.equal(db.tables.document_records.find((r) => r.id === fresh.id).review_alerted_at, null);
  assert.equal((await escalateStalePending(db, { sendEmail: m.sendEmail })).escalated, 0);
});

test('a muted document does not escalate, and with no Owner address the stamp is handed back', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW()], setting: { ownerMuted: true } });
  const rec = (await file(db, id, worker)).record;
  db.tables.document_records.find((r) => r.id === rec.id).submitted_at = ago(50 * HOUR);
  const m = mail();
  await escalateStalePending(db, { sendEmail: m.sendEmail });
  assert.equal(m.sent.length, 0);

  const db2 = seed();
  db2.tables.roster.find((r) => r.id === 24).email = null;
  const id2 = await doc(db2, { rules: [REVIEW()] });
  const rec2 = (await file(db2, id2, worker)).record;
  db2.tables.document_records.find((r) => r.id === rec2.id).submitted_at = ago(50 * HOUR);
  const out = await escalateStalePending(db2, { sendEmail: mail().sendEmail });
  assert.equal(out.escalated, 0);
  assert.equal(db2.tables.document_records.find((r) => r.id === rec2.id).review_alerted_at, null);
});

test('the sweeps skip quietly when the WP3 columns are not there yet', async () => {
  const db = seed();
  db.failOn('document_records', 'update');
  assert.equal(await closeStaleUnsignedEngine(db), 0);
  const m = mail();
  assert.deepEqual(await alertOverdueUnsignedEngine(db, { sendEmail: m.sendEmail }), { alerted: 0, emailed: 0, failed: 0 });
});

// ── Digest ─────────────────────────────────────────────────────────────────

test('the digest reports held engine notices under the document title, and drops a muted document', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW()], title: 'Pre Shift' });
  const muted = await doc(db, { rules: [REVIEW()], title: 'Muted One', setting: { ownerMuted: true } });
  db.rpcHandlers.claim_held_notices = async () => ({
    data: [
      { company_id: 1, roster_id: 21, document_key: `engine_${id}`, held: 2 },
      { company_id: 1, roster_id: 21, document_key: `engine_${muted}`, held: 4 },
    ],
    error: null,
  });
  const m = mail();
  const out = await runDigest(db, { sendEmail: m.sendEmail });
  assert.equal(out.sent, 1);
  assert.equal(out.dropped, 1);
  assert.match(m.sent[0].subject, /^Pre Shift: 2 new$/);
});

// ── Review hardening ───────────────────────────────────────────────────────

test('the same reviewer approving the same step twice at once is recorded once, the other request is a 409', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW(), REVIEW()] });
  const rec = (await file(db, id, worker)).record;
  const results = await Promise.allSettled([
    reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' }),
    reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(db.tables.document_records[0].review_step, 1, 'advanced once, not twice');
  assert.equal(db.tables.document_signatures.filter((s) => s.kind === 'approval').length, 1);
  await rejects(reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' }), 403, /different person/);
});

test('a lost race takes its approval signature back', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW()] });
  const rec = (await file(db, id, worker)).record;
  // Someone returns it between this reviewer's checks and their approval.
  db.tables.document_records[0].status = 'returned';
  await rejects(reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' }), 409);
  assert.equal((db.tables.document_signatures || []).length, 0);
});

test('an approval from an earlier round does not block a reviewer once the record is fixed and sent back', async () => {
  const db = seed();
  const id = await doc(db, { rules: [REVIEW(), REVIEW()] });
  const rec = (await file(db, id, worker)).record;
  await reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' });
  await reviewRecord(db, { session: supB, companyId: 1, recordId: rec.id, decision: 'return', reason: 'fix' });
  await resubmitRecord(db, { session: worker, companyId: 1, recordId: rec.id, answers: { task: 'fixed' }, deps: mkDeps() });
  assert.equal(db.tables.document_records[0].review_round, 1);
  const again = await reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'approve' });
  assert.deepEqual(again, { status: 'pending_approval', step: 1 }, 'the first reviewer is free to take step one again');
  assert.deepEqual(db.tables.document_signatures.filter((s) => s.kind === 'approval').map((s) => s.meta.round), [0, 1]);
  await reviewRecord(db, { session: supB, companyId: 1, recordId: rec.id, decision: 'approve' });
  assert.equal(db.tables.document_records[0].status, 'approved');
});

// ── Escalation visibility, suspended companies, override guard, lead reading ──

test('a department supervisor sees only their own department, and one with no departments sees none', async () => {
  const db = seed();
  const id = await doc(db, { rules: [ROUTE, { ruleType: 'route_by_answer', config: { fieldKey: 'risk', equals: 'High', department: 'hr' } }] });
  await file(db, id, worker, { answers: { task: 'x', injury: 'yes', risk: 'High' } });
  assert.equal(db.tables.document_escalations.length, 2);
  const safety = { role: 'supervisor', userId: 25, companyId: 1, name: 'Sal Safety' };
  assert.deepEqual((await listEscalations(db, { session: safety, companyId: 1 })).escalations.map((e) => e.target_department), ['safety']);
  assert.equal((await listEscalations(db, { session: supA, companyId: 1 })).escalations.length, 0);
});

test('a suspended company gets no sent-back or routed notices either', async () => {
  const db = seed({ companies: [{ id: 1, suspended: true }] });
  const id = await doc(db, { rules: [REVIEW(), ROUTE] });
  const m = mail();
  const rec = (await file(db, id, worker, { answers: { task: 'x', injury: 'yes' } }, m)).record;
  await reviewRecord(db, { session: supA, companyId: 1, recordId: rec.id, decision: 'return', reason: 'fix', deps: mkDeps(m) });
  assert.equal(m.sent.length, 0);
});

test('a setting override can never switch a built-in or custom document', async () => {
  const db = seed();
  for (const key of ['flha', 'incident', 'custom_3', 'engine_', 'engine_x', 'portal_1']) {
    const out = await routeNotification(db, { companyId: 1, documentKey: key, record: { site_id: 5, submitted_by_roster_id: 11 }, settingOverride: { enabled: true, extraRosterIds: [21] } });
    assert.deepEqual([out.enabled, out.recipients.length, out.reason], [false, 0, 'off'], key);
  }
  const ok = await routeNotification(db, { companyId: 1, documentKey: 'engine_7', record: { site_id: 5, submitted_by_roster_id: 11 }, settingOverride: { enabled: true, extraRosterIds: [] } });
  assert.equal(ok.enabled, true);
});

test('a crew lead can open a record they are asked to review, and nothing else', async () => {
  const db = seed();
  const open = await doc(db, { rules: [REVIEW({ allowLeads: true })], title: 'Open' });
  const closed = await doc(db, { rules: [REVIEW({})], title: 'Closed' });
  const crewRec = (await file(db, open, worker)).record;
  const noLeadsRec = (await file(db, closed, worker)).record;
  const outsider = (await file(db, open, { ...worker, userId: 15, name: 'Out Crew' }, { siteId: undefined })).record;
  const leadsRec = (await file(db, open, { ...worker, userId: 13, name: 'Lou Lead' })).record;
  assert.equal((await getRecord(db, { session: lead, companyId: 1, recordId: crewRec.id })).record.id, crewRec.id);
  await rejects(getRecord(db, { session: lead, companyId: 1, recordId: noLeadsRec.id }), 403);
  await rejects(getRecord(db, { session: lead, companyId: 1, recordId: outsider.id }), 403);
  await rejects(getRecord(db, { session: lead, companyId: 1, recordId: leadsRec.id }), 403);
  await reviewRecord(db, { session: supA, companyId: 1, recordId: crewRec.id, decision: 'approve' });
  await rejects(getRecord(db, { session: lead, companyId: 1, recordId: crewRec.id }), 403, undefined);
});

// ── Retrying failed follow-ups (interaction map weak point E-1) ─────────────

import { retryFailedFollowUps } from '../../server-lib/documentEngine/sweeps.js';

test('a record whose escalations failed is flagged, then the sweep finishes it without repeating what worked', async () => {
  const db = seed();
  const m = mail();
  const id = await doc(db, { rules: [ROUTE, REVIEW()] });
  db.failOn('document_escalations', 'insert');
  const out = await file(db, id, worker, { answers: { task: 'x', injury: 'yes' } }, m);
  assert.equal(out.record.status, 'pending_approval');
  let rec = db.tables.document_records[0];
  assert.equal(rec.meta.followups_failed, true);
  assert.equal(rec.meta.followups.notify, true, 'the notification that worked is remembered');
  assert.equal(db.tables.document_escalations.length, 0);
  const sentBefore = m.sent.length;
  const signals = db.tables.company_signals.length;

  // Too soon: the live run may still be finishing.
  assert.equal((await retryFailedFollowUps(db, { sendEmail: m.sendEmail })).retried, 0);

  db.clearFailures();
  db.tables.document_records[0].created_at = new Date(Date.now() - 3600 * 1000).toISOString();
  const res = await retryFailedFollowUps(db, { sendEmail: m.sendEmail });
  assert.deepEqual(res, { retried: 1, stillFailing: 0 });
  rec = db.tables.document_records[0];
  assert.equal(rec.meta.followups_failed, false);
  assert.equal(db.tables.document_escalations.length, 1);
  assert.equal(db.tables.company_signals.length, signals, 'the Brain is told once');
  assert.ok(m.sent.length >= sentBefore);

  // Nothing left to do.
  assert.equal((await retryFailedFollowUps(db, { sendEmail: m.sendEmail })).retried, 0);
});

test('a record that keeps failing is tried five times and then left alone', async () => {
  const db = seed();
  const id = await doc(db, { rules: [ROUTE] });
  db.failOn('document_escalations', 'insert');
  await file(db, id, worker, { answers: { task: 'x', injury: 'yes' } });
  db.tables.document_records[0].created_at = new Date(Date.now() - 3600 * 1000).toISOString();
  let total = 0;
  for (let i = 0; i < 8; i += 1) total += (await retryFailedFollowUps(db, {})).retried;
  assert.equal(total, 4, 'one live attempt plus four retries makes five');
  assert.equal(db.tables.document_records[0].meta.followups_failed, false);
  assert.equal(db.tables.document_records[0].meta.followups_attempts, 5);
});

test('a retry is dropped for a document that was switched off after it was filed', async () => {
  const db = seed();
  const id = await doc(db, { rules: [ROUTE] });
  db.failOn('document_escalations', 'insert');
  await file(db, id, worker, { answers: { task: 'x', injury: 'yes' } });
  db.clearFailures();
  db.tables.document_records[0].created_at = new Date(Date.now() - 3600 * 1000).toISOString();
  await setCompanyDocument(db, { companyId: 1, definitionId: id, isEnabled: false });
  await retryFailedFollowUps(db, {});
  assert.equal(db.tables.document_escalations.length, 0);
  assert.equal(db.tables.document_records[0].meta.followups_failed, false);
});

test('a lost Brain signal is retried, and giving up after five tries is recorded on the record', async () => {
  const db = seed();
  const id = await doc(db, { rules: [ROUTE] });
  db.failOn('company_signals', 'insert');
  await file(db, id, worker, { answers: { task: 'x', injury: 'yes' } });
  assert.equal(db.tables.document_records[0].meta.followups_failed, true);
  db.clearFailures();
  db.tables.document_records[0].created_at = new Date(Date.now() - 3600 * 1000).toISOString();
  await retryFailedFollowUps(db, {});
  assert.equal(db.tables.company_signals.length, 1);
  assert.equal(db.tables.document_records[0].meta.followups_failed, false);

  const db2 = seed();
  const id2 = await doc(db2, { rules: [ROUTE] });
  db2.failOn('company_signals', 'insert');
  await file(db2, id2, worker, { answers: { task: 'x', injury: 'yes' } });
  db2.tables.document_records[0].created_at = new Date(Date.now() - 3600 * 1000).toISOString();
  for (let i = 0; i < 6; i += 1) await retryFailedFollowUps(db2, {});
  assert.equal(db2.tables.document_records[0].meta.followups_gave_up, true);
});

// ── Conditional review (the FLHA: only an Extreme risk hazard needs a supervisor) ──

import { reviewApplies } from '../../server-lib/documentEngine/rules.js';

const EXTREME_ONLY = { ruleType: 'reviewer_step', config: { onlyIf: { field: 'hazards', riskIn: ['Extreme'] } } };

test('reviewApplies: no steps never, a plain step always, conditional steps only when a condition holds', () => {
  const rows = (risk) => [{ field_key: 'hazards', value_json: [{ hazard: 'x', risk }] }];
  assert.equal(reviewApplies([], rows('Extreme')), false);
  assert.equal(reviewApplies([{ rule_type: 'reviewer_step', config: {} }], []), true);
  const cond = [{ rule_type: 'reviewer_step', config: { onlyIf: { field: 'hazards', riskIn: ['Extreme'] } } }];
  assert.equal(reviewApplies(cond, rows('Extreme')), true);
  assert.equal(reviewApplies(cond, rows('High')), false);
  assert.equal(reviewApplies(cond, []), true, 'no answer to judge by: review applies');
  const answer = [{ rule_type: 'reviewer_step', config: { onlyIf: { field: 'injury', equalsAny: ['yes'] } } }];
  assert.equal(reviewApplies(answer, [{ field_key: 'injury', value_text: 'yes' }]), true);
  assert.equal(reviewApplies(answer, [{ field_key: 'injury', value_text: 'no' }]), false);
  // One plain step keeps the whole chain on.
  assert.equal(reviewApplies([...cond, { rule_type: 'reviewer_step', config: {} }], rows('Low')), true);
});

test('a document with a conditional review is filed straight away unless the condition holds', async () => {
  const db = seed();
  const id = await doc(db, { fields: [{ label: 'Task', fieldType: 'short_text', required: true }, { label: 'Hazards', fieldType: 'hazard_table' }], rules: [EXTREME_ONLY] });
  const low = await file(db, id, worker, { answers: { task: 'a', hazards: [{ hazard: 'Slip', risk: 'Low' }] } });
  assert.equal(low.record.status, 'submitted');
  const extreme = await file(db, id, worker, { answers: { task: 'b', hazards: [{ hazard: 'Live line', risk: 'Extreme' }] } });
  assert.equal(extreme.record.status, 'pending_approval');
  await reviewRecord(db, { session: supA, companyId: 1, recordId: extreme.record.id, decision: 'approve', deps: mkDeps() });
  assert.equal(db.tables.document_records.find((r) => r.id === extreme.record.id).status, 'approved');
  assert.equal((await myInbox(db, { session: supA, companyId: 1 })).review.length, 0);
});
