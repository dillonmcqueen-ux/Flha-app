import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSteps, needsWorkerSignature, notifyPlan, answerRoutes, matchRoutes, reviewerMayAct, brainSignalFor } from '../../server-lib/documentEngine/rules.js';

const R = (rule_type, config, sort_order = 0) => ({ rule_type, config, sort_order });

test('reviewer steps come back in order, with labels and defaults', () => {
  const steps = reviewSteps([
    R('reviewer_step', { label: 'Owner sign off', role: 'owner' }, 2),
    R('reviewer_step', { allowLeads: true }, 1),
    R('signature_step', { signer: 'worker' }, 0),
  ]);
  assert.deepEqual(steps.map((s) => [s.index, s.label, s.role, s.allowLeads, s.distinct]), [
    [0, 'Review 1', 'supervisor', true, true],
    [1, 'Owner sign off', 'owner', false, true],
  ]);
  assert.deepEqual(reviewSteps([]), []);
});

test('a worker signature is required only by a worker signature step', () => {
  assert.equal(needsWorkerSignature([R('signature_step', { signer: 'worker' })]), true);
  assert.equal(needsWorkerSignature([R('signature_step', { signer: 'supervisor' })]), false);
  assert.equal(needsWorkerSignature([]), false);
});

test('a document is announced when it has a notify rule, a reviewer or a scope rule', () => {
  assert.equal(notifyPlan([]).announce, false);
  assert.equal(notifyPlan([R('reviewer_step', {})]).announce, true);
  assert.equal(notifyPlan([R('notify', {})]).announce, true);
  const plan = notifyPlan([R('notify', { extraRosterIds: [3, '4', 'x', -1], departments: ['safety'] }), R('route_by_scope', { departments: ['hr', 'safety'] })]);
  assert.deepEqual(plan.extraRosterIds, [3, 4]);
  assert.deepEqual(plan.departments.sort(), ['hr', 'safety']);
});

const row = (field_key, field_type, extra) => ({ field_key, field_type, question_text: `Q ${field_key}`, value_text: null, value_json: null, ...extra });

test('an answer that equals a route value escalates, case insensitively', () => {
  const routes = answerRoutes([R('route_by_answer', { fieldKey: 'injury', equals: 'Yes', department: 'safety' })]);
  const out = matchRoutes(routes, [row('injury', 'yesno', { value_text: 'yes' })]);
  assert.deepEqual(out, [{ fieldKey: 'injury', question: 'Q injury', value: 'Yes', department: 'safety' }]);
  assert.deepEqual(matchRoutes(routes, [row('injury', 'yesno', { value_text: 'no' })]), []);
});

test('dropdown, multiselect and condition answers can route, free text never does', () => {
  const routes = answerRoutes([
    R('route_by_answer', { fieldKey: 'sev', equals: ['High', 'Extreme'], department: 'safety' }),
    R('route_by_answer', { fieldKey: 'tags', equals: 'fire', department: 'operations_manager' }),
    R('route_by_answer', { fieldKey: 'cond', equals: 'Defective', department: 'maintenance' }),
    R('route_by_answer', { fieldKey: 'notes', equals: 'fire', department: 'safety' }),
  ]);
  const out = matchRoutes(routes, [
    row('sev', 'dropdown', { value_text: 'Extreme' }),
    row('tags', 'multiselect', { value_json: ['smoke', 'Fire'] }),
    row('cond', 'condition3', { value_text: 'Defective' }),
    row('notes', 'short_text', { value_text: 'fire' }),
  ]);
  assert.deepEqual(out.map((o) => [o.fieldKey, o.department]), [['sev', 'safety'], ['tags', 'operations_manager'], ['cond', 'maintenance']]);
});

test('incomplete routes are ignored and a field escalates once', () => {
  const routes = answerRoutes([
    R('route_by_answer', { fieldKey: '', equals: 'x', department: 'hr' }),
    R('route_by_answer', { fieldKey: 'a', equals: [], department: 'hr' }),
    R('route_by_answer', { fieldKey: 'a', equals: 'x' }),
    R('route_by_answer', { fieldKey: 'q', equals: 'yes', department: 'hr' }),
    R('route_by_answer', { fieldKey: 'q', equals: 'yes', department: 'safety' }),
  ]);
  assert.equal(routes.length, 2);
  assert.equal(matchRoutes(routes, [row('q', 'yesno', { value_text: 'yes' })]).length, 1);
});

// ── Who may act on a review step ───────────────────────────────────────────

const step = (over) => ({ index: 0, label: 'Review 1', role: 'supervisor', allowLeads: false, distinct: true, ...over });
const sup = { founder: false, bypass: false, rosterId: 21, role: 'supervisor', isLead: false };
const lead = { founder: false, bypass: false, rosterId: 12, role: 'worker', isLead: true };
const crew = { ids: new Set([11, 14]), leadIds: new Set([14]) };

test('a supervisor may review someone else, never their own document', () => {
  assert.equal(reviewerMayAct({ actor: sup, record: { submitted_by_roster_id: 11 }, step: step() }).ok, true);
  const own = reviewerMayAct({ actor: sup, record: { submitted_by_roster_id: 21 }, step: step() });
  assert.equal(own.ok, false);
  assert.match(own.error, /your own/);
});

test('a founder may always review, an Owner may take an owner step, a plain supervisor may not', () => {
  assert.equal(reviewerMayAct({ actor: { founder: true, rosterId: null, role: 'admin' }, record: { submitted_by_roster_id: 11 }, step: step({ role: 'owner' }) }).ok, true);
  assert.equal(reviewerMayAct({ actor: { ...sup, bypass: true }, record: { submitted_by_roster_id: 11 }, step: step({ role: 'owner' }) }).ok, true);
  assert.equal(reviewerMayAct({ actor: sup, record: { submitted_by_roster_id: 11 }, step: step({ role: 'owner' }) }).ok, false);
});

test('a crew lead needs a step that allows leads, and only reviews their own crew', () => {
  const rec = (id) => ({ submitted_by_roster_id: id });
  assert.equal(reviewerMayAct({ actor: lead, record: rec(11), step: step(), crew }).ok, false, 'step does not allow leads');
  assert.equal(reviewerMayAct({ actor: lead, record: rec(11), step: step({ allowLeads: true }), crew }).ok, true);
  assert.equal(reviewerMayAct({ actor: lead, record: rec(99), step: step({ allowLeads: true }), crew }).ok, false, 'not on the crew');
  const other = reviewerMayAct({ actor: lead, record: rec(14), step: step({ allowLeads: true }), crew });
  assert.equal(other.ok, false);
  assert.match(other.error, /crew lead's document/, 'no lead reviewing another lead');
  assert.equal(reviewerMayAct({ actor: lead, record: rec(null), step: step({ allowLeads: true }), crew }).ok, false, 'no author, no crew');
  assert.equal(reviewerMayAct({ actor: lead, record: rec(12), step: step({ allowLeads: true }), crew }).ok, false, 'own document');
});

test('an ordinary worker can never review', () => {
  assert.equal(reviewerMayAct({ actor: { rosterId: 11, role: 'worker', isLead: false }, record: { submitted_by_roster_id: 12 }, step: step({ allowLeads: true }), crew }).ok, false);
});

test('the same person cannot review two steps of one record', () => {
  const out = reviewerMayAct({ actor: sup, record: { submitted_by_roster_id: 11 }, step: step({ index: 1 }), priorReviewerIds: [21] });
  assert.equal(out.ok, false);
  assert.match(out.error, /different person/);
  assert.equal(reviewerMayAct({ actor: sup, record: { submitted_by_roster_id: 11 }, step: step({ index: 1, distinct: false }), priorReviewerIds: [21] }).ok, true);
});

// ── Brain ──────────────────────────────────────────────────────────────────

test('the Brain signal carries option answers and flagged questions, never free text or people', () => {
  const sig = brainSignalFor({
    title: 'Pre "Shift" Check',
    answerRows: [
      row('risk', 'dropdown', { value_text: 'High' }),
      row('tags', 'multiselect', { value_json: ['Fire', 'Smoke'] }),
      row('notes', 'long_text', { value_text: 'Jamie fell near the loader' }),
      row('who', 'person_picker', { value_json: { rosterId: 5 } }),
    ],
    escalations: [{ question: 'Any injury?', department: 'safety' }],
  });
  assert.equal(sig.document, 'Pre Shift Check');
  assert.deepEqual(sig.answers.map((a) => a.answer), ['High', 'Fire, Smoke']);
  assert.equal(JSON.stringify(sig).includes('Jamie'), false);
  assert.deepEqual(sig.flagged, [{ question: 'Any injury?', department: 'safety' }]);
});

test('there is no signal when nothing option-based was answered', () => {
  assert.equal(brainSignalFor({ title: 'Notes only', answerRows: [row('n', 'long_text', { value_text: 'x' })] }), null);
  assert.equal(brainSignalFor({ title: '', answerRows: [row('r', 'dropdown', { value_text: 'High' })] }), null);
});
