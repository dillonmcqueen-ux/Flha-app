import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAiResult, withoutAiPatch } from '../../src/documentEngine/hazardAssist.js';
import { buildHazardPrompt, parseHazardResponse, stripUngroundedHazards, stripHedged, ensureBaselineHazards, computeFlhaEditSignal, selectRelevantPolicies } from '../../src/flhaHazardAi.js';

const CFG = { taskField: 'task_summary', alertsField: 'sop_alerts', ppeField: 'ppe', notesField: 'notes', flagField: 'ai_assisted' };
const MODEL = JSON.stringify({
  taskSummary: 'Dig a trench for a water line',
  hazards: [
    { hazard: 'Trench collapse', risk: 'High', control: 'Trench box', sopRef: null },
    { hazard: 'Overhead power lines (if present)', risk: 'High', control: 'Stay clear', sopRef: null },
    { hazard: 'Working alone', risk: 'Medium', control: 'Check in', sopRef: null },
  ],
  sopAlerts: ['Call before you dig', 'Wear a face shield (if performing pin driving)'],
  ppeRequired: ['Hard hat', 'High-visibility clothing'],
  additionalNotes: 'Locate utilities first.',
});

test('the model answer is cleaned the way the FLHA always cleaned it', () => {
  const r = parseHazardResponse(`here you go ${MODEL} thanks`, 'digging a trench for a water line', 'digging');
  assert.deepEqual(r.tagged.map((h) => h.hazard), ['Trench collapse'], 'a hedged hazard and an ungrounded working-alone hazard are dropped');
  assert.equal(r.tagged[0].task, 'Dig a trench for a water line');
  assert.deepEqual(r.groundedAlerts, ['Call before you dig']);
  assert.deepEqual(r.groundedPPE, ['Hard hat', 'High-visibility clothing']);
  assert.throws(() => parseHazardResponse('no json here', 'x', 'x'), /Invalid response/);
  assert.equal(stripUngroundedHazards([{ hazard: 'Working alone' }], 'with the crew').length, 0);
  assert.equal(stripUngroundedHazards([{ hazard: 'Working alone' }], 'I am alone on site').length, 1);
  assert.equal(stripHedged(['fine', 'maybe if applicable'], (x) => x).length, 1);
});

test('the guaranteed baseline hazards are added once', () => {
  const out = ensureBaselineHazards([{ hazard: 'Slip', risk: 'Low', control: 'Boots' }], 'task');
  assert.deepEqual(out.map((h) => h.hazard), ['Slip', 'Fitness for duty', 'Muster point and emergency response plan awareness']);
  assert.equal(ensureBaselineHazards(out, 'task').length, 3);
});

test('a fresh generation fills the task, hazards, alerts, PPE, notes and the AI flag', () => {
  const result = parseHazardResponse(MODEL, 'digging a trench for a water line', 'digging');
  const { patch, baseline } = applyAiResult({ result, cfg: CFG, hazardKey: 'hazards', answers: {}, taskLabel: 'digging' });
  assert.equal(patch.task_summary, 'Dig a trench for a water line');
  assert.equal(patch.hazards.length, 3);
  assert.deepEqual(patch.ppe, ['Hard hat', 'High-visibility clothing']);
  assert.deepEqual(patch.sop_alerts, ['Call before you dig']);
  assert.equal(patch.notes, 'Locate utilities first.');
  assert.equal(patch.ai_assisted, 'yes');
  assert.deepEqual(baseline, [{ hazard: 'Trench collapse', risk: 'High' }]);
});

test('adding a second task keeps what is there, merges PPE and alerts, and leaves the notes', () => {
  const result = parseHazardResponse(MODEL, 'digging a trench for a water line', 'digging');
  const answers = { task_summary: 'First task', hazards: [{ hazard: 'Existing', risk: 'Low', control: 'c' }], ppe: ['Hard hat', 'Gloves'], sop_alerts: ['Old alert'], notes: 'Keep me' };
  const { patch } = applyAiResult({ result, cfg: CFG, hazardKey: 'hazards', answers, taskLabel: 'x', addingTask: true });
  assert.deepEqual(patch.hazards.map((h) => [h.hazard, h.task]), [['Existing', 'First task'], ['Trench collapse', 'Dig a trench for a water line']]);
  assert.deepEqual(patch.ppe, ['Hard hat', 'Gloves', 'High-visibility clothing']);
  assert.deepEqual(patch.sop_alerts, ['Old alert', 'Call before you dig']);
  assert.equal(patch.notes, undefined);
  assert.equal(patch.task_summary, undefined);
});

test('carrying on without the AI uses the worker\'s own words and flags it', () => {
  assert.deepEqual(withoutAiPatch({ cfg: CFG, description: '  digging a trench ' }), { task_summary: 'digging a trench', ai_assisted: 'no' });
});

test('the prompt is built from the worker\'s task, the company and its SOPs', () => {
  const p = buildHazardPrompt({ companyName: 'ABC', workerName: 'Jamie', jobSite: 'North', cleanTranscript: 'digging a trench', relevantPolicies: ['SOP one'], companyProfile: null });
  assert.match(p, /Company: ABC/);
  assert.match(p, /Task Description: "digging a trench"/);
  assert.match(p, /1\. SOP one/);
  assert.equal(selectRelevantPolicies(['a', 'b'], 'x', 25).length, 2);
});

test('the edit signal only notices added, removed or re-rated hazards', () => {
  const base = [{ hazard: 'A', risk: 'Low' }, { hazard: 'B', risk: 'High' }];
  assert.equal(computeFlhaEditSignal(base, [{ hazard: 'a', risk: 'Low', control: 'reworded' }, { hazard: 'B', risk: 'High' }]), null);
  assert.deepEqual(computeFlhaEditSignal(base, [{ hazard: 'A', risk: 'Medium' }, { hazard: 'C', risk: 'Low' }]), { added: ['c'], removed: ['b'], riskChanged: [{ hazard: 'a', from: 'Low', to: 'Medium' }] });
  assert.equal(computeFlhaEditSignal([], [{ hazard: 'A', risk: 'Low' }]), null);
});
